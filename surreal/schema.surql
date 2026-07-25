-- Estrutura da definição global (caminho B: o fixture git é projetado aqui).
-- Aplicado pela migração antes do upsert dos registros. Idempotente.

-- migração: campos que saíram do modelo coarse (pluginByPurpose + marketplace-singleton
-- viraram as tabelas `marketplace` e `skill`). REMOVE explícito — tirar a linha DEFINE não
-- dropa o campo num DB que já existe. Idempotente (IF EXISTS).
REMOVE FIELD IF EXISTS marketplace   ON config;
REMOVE FIELD IF EXISTS ambientPlugin ON config;
REMOVE FIELD IF EXISTS plugin        ON purpose;
REMOVE FIELD IF EXISTS razao         ON purpose;  -- renamed to `reason` (contract v2)
REMOVE FIELD IF EXISTS scope         ON bucket;   -- renamed to `rowScope` (contract v2)
REMOVE FIELD IF EXISTS agentPlugin      ON purpose;  -- folded into `agent` (authored ref string, contract v2)
REMOVE FIELD IF EXISTS agentMarketplace ON purpose;

-- ─── Leitura estrutural por lineage (ADR 0016: "o grafo também é dado") ─────
-- FOR select das estruturais é escopado pela MESMA régua do inbox (ADR 0014):
-- visível se algum purpose ATRIBUÍDO ao $auth é ancestral-ou-self do alvo — via
-- campos denormalizados (lineage/readers) + dot-access. NUNCA subquery dentro de
-- permission: scans em permission-context NÃO rodam com as perms do caller (vazam
-- — provado empiricamente em 2026-07-25). Escrita estrutural segue NONE para
-- record users (só root/apply). Com isso, build/graph rodam COMO A PESSOA
-- (conexão por senha) e o banco entrega exatamente a fatia dela.

-- singleton da namespace (ambient skills — sempre on, todo workspace recebe;
-- por isso legível por qualquer identidade autenticada)
DEFINE TABLE OVERWRITE config SCHEMAFULL
  PERMISSIONS FOR select WHERE $auth FOR create, update, delete NONE;
DEFINE FIELD OVERWRITE ambient ON config TYPE array<string>;

DEFINE TABLE OVERWRITE purpose SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth->responsible->purpose CONTAINSANY lineage
    FOR create, update, delete NONE;
DEFINE FIELD OVERWRITE reason   ON purpose TYPE string;
DEFINE FIELD OVERWRITE parent  ON purpose TYPE option<record<purpose>>;
DEFINE FIELD OVERWRITE decides ON purpose TYPE array<string>;
DEFINE FIELD OVERWRITE owns    ON purpose TYPE array<record<bucket>>;
DEFINE FIELD OVERWRITE reads   ON purpose TYPE array<record<bucket>>;
DEFINE FIELD OVERWRITE skills  ON purpose TYPE array<string>;
DEFINE FIELD OVERWRITE tools   ON purpose TYPE array<string>;
-- the purpose's persona, as AUTHORED: "name" (library agent) or "plugin@marketplace"
-- (external). "@" is the discriminator on read-back.
DEFINE FIELD OVERWRITE agent ON purpose TYPE option<string>;
-- linhagem denormalizada [self, parent, ..., raiz]; recursão feita na migração,
-- pra permission de dado checar ancestralidade de forma flat
DEFINE FIELD OVERWRITE lineage ON purpose TYPE array<record<purpose>>;

-- visível se a fatia do caller alcança um purpose que OWNS ou READS o bucket.
-- `readers` é derivado no apply (records.ts, irmão do lineage): todos os purposes
-- que referenciam o bucket — dot-access confiável, sem subquery.
DEFINE TABLE OVERWRITE bucket SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth->responsible->purpose CONTAINSANY array::flatten(readers.lineage)
    FOR create, update, delete NONE;
DEFINE FIELD OVERWRITE backend ON bucket TYPE string;
DEFINE FIELD OVERWRITE repo    ON bucket TYPE option<string>;
DEFINE FIELD OVERWRITE tables  ON bucket TYPE array<string>;
DEFINE FIELD OVERWRITE owner   ON bucket TYPE record<purpose>;
DEFINE FIELD OVERWRITE rowScope ON bucket TYPE option<string>;  -- the row-scoping FIELD (e.g. "account")
DEFINE FIELD OVERWRITE sens    ON bucket TYPE string;
DEFINE FIELD OVERWRITE readers ON bucket TYPE array<record<purpose>> DEFAULT [];

-- registry de tools (tubos): id = nome (tool:perplexity). env usa ${VAR} refs.
-- kind espelha os tipos do .mcp.json: stdio (command local) | http | sse (url remota).
-- Estrito (ADR 0016): membro só lê a tool que algum purpose da fatia referencia.
DEFINE TABLE OVERWRITE tool SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth->responsible->purpose CONTAINSANY array::flatten(readers.lineage)
    FOR create, update, delete NONE;
DEFINE FIELD OVERWRITE kind      ON tool TYPE string DEFAULT "stdio";
DEFINE FIELD OVERWRITE command   ON tool TYPE option<string>;
DEFINE FIELD OVERWRITE args      ON tool TYPE array<string>;
DEFINE FIELD OVERWRITE env       ON tool TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE keySource ON tool TYPE string;
DEFINE FIELD OVERWRITE url       ON tool TYPE option<string>;
DEFINE FIELD OVERWRITE readers   ON tool TYPE array<record<purpose>> DEFAULT [];

-- registry de marketplaces: id = nome (marketplace:`acme-plugins`). repo = owner/name no github.
-- Estrito: legível se a fatia usa algum plugin (skill OU agent) dele; ambient = true
-- quando um skill ambient (que vai em todo workspace) o referencia.
DEFINE TABLE OVERWRITE marketplace SCHEMAFULL
  PERMISSIONS
    FOR select WHERE ambient = true OR $auth->responsible->purpose CONTAINSANY array::flatten(readers.lineage)
    FOR create, update, delete NONE;
DEFINE FIELD OVERWRITE repo ON marketplace TYPE string;
DEFINE FIELD OVERWRITE readers ON marketplace TYPE array<record<purpose>> DEFAULT [];
DEFINE FIELD OVERWRITE ambient ON marketplace TYPE bool DEFAULT false;

-- the "meat" catalog: id = skill name. Delivered by an external plugin (source
-- "plugin") OR carried inline from the tenant library (source "library", ADR 0012 —
-- deploy ships the files; build materializes them).
-- Estrito, com UMA exceção: skills de config.ambient entram em TODO workspace,
-- então carregam ambient = true e são legíveis por qualquer identidade.
DEFINE TABLE OVERWRITE skill SCHEMAFULL
  PERMISSIONS
    FOR select WHERE ambient = true OR $auth->responsible->purpose CONTAINSANY array::flatten(readers.lineage)
    FOR create, update, delete NONE;
DEFINE FIELD OVERWRITE source      ON skill TYPE string ASSERT $value IN ["plugin", "library"];
DEFINE FIELD OVERWRITE plugin      ON skill TYPE option<string>;
DEFINE FIELD OVERWRITE marketplace ON skill TYPE option<record<marketplace>>;
DEFINE FIELD OVERWRITE files       ON skill TYPE option<object> FLEXIBLE;
DEFINE FIELD OVERWRITE readers     ON skill TYPE array<record<purpose>> DEFAULT [];
DEFINE FIELD OVERWRITE ambient     ON skill TYPE bool DEFAULT false;

-- library agent content: id = agent name (deduped — several purposes may share one;
-- readers = a UNIÃO dos purposes que o usam). Estrito: persona é prompt da fatia.
DEFINE TABLE OVERWRITE agent SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth->responsible->purpose CONTAINSANY array::flatten(readers.lineage)
    FOR create, update, delete NONE;
DEFINE FIELD OVERWRITE content ON agent TYPE string;
DEFINE FIELD OVERWRITE readers ON agent TYPE array<record<purpose>> DEFAULT [];

-- a pessoa lê o PRÓPRIO record (login/name); os demais humanos ficam invisíveis.
DEFINE TABLE OVERWRITE user SCHEMAFULL
  PERMISSIONS FOR select WHERE id = $auth FOR create, update, delete NONE;
DEFINE FIELD OVERWRITE name   ON user TYPE string;
DEFINE FIELD OVERWRITE github ON user TYPE option<string>;  -- anchor de identidade (gh login)

-- atribuição = aresta de grafo: user -> responsible -> purpose (scope + papel na aresta)
-- role: owner (accountable, governa/migra/decide) vs member (trabalha). Acesso é igual;
-- o papel só governa accountability. Um dono por propósito (holacracia).
-- A pessoa lê as PRÓPRIAS arestas (o build precisa das suas atribuições).
DEFINE TABLE OVERWRITE responsible TYPE RELATION FROM user TO purpose SCHEMAFULL
  PERMISSIONS FOR select WHERE in = $auth FOR create, update, delete NONE;
DEFINE FIELD OVERWRITE scope ON responsible TYPE option<string>;
DEFINE FIELD OVERWRITE role  ON responsible TYPE string DEFAULT "member" ASSERT $value IN ["owner", "member"];
