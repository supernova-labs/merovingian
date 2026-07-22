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

-- singleton da namespace (ambient skills — sempre on, todo workspace recebe)
DEFINE TABLE OVERWRITE config SCHEMAFULL;
DEFINE FIELD OVERWRITE ambient ON config TYPE array<string>;

DEFINE TABLE OVERWRITE purpose SCHEMAFULL;
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

DEFINE TABLE OVERWRITE bucket SCHEMAFULL;
DEFINE FIELD OVERWRITE backend ON bucket TYPE string;
DEFINE FIELD OVERWRITE repo    ON bucket TYPE option<string>;
DEFINE FIELD OVERWRITE tables  ON bucket TYPE array<string>;
DEFINE FIELD OVERWRITE owner   ON bucket TYPE record<purpose>;
DEFINE FIELD OVERWRITE rowScope ON bucket TYPE option<string>;  -- the row-scoping FIELD (e.g. "account")
DEFINE FIELD OVERWRITE sens    ON bucket TYPE string;

-- registry de tools (tubos): id = nome (tool:perplexity). env usa ${VAR} refs.
-- kind espelha os tipos do .mcp.json: stdio (command local) | http | sse (url remota).
DEFINE TABLE OVERWRITE tool SCHEMAFULL;
DEFINE FIELD OVERWRITE kind      ON tool TYPE string DEFAULT "stdio";
DEFINE FIELD OVERWRITE command   ON tool TYPE option<string>;
DEFINE FIELD OVERWRITE args      ON tool TYPE array<string>;
DEFINE FIELD OVERWRITE env       ON tool TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE keySource ON tool TYPE string;
DEFINE FIELD OVERWRITE url       ON tool TYPE option<string>;

-- registry de marketplaces: id = nome (marketplace:`acme-plugins`). repo = owner/name no github.
DEFINE TABLE OVERWRITE marketplace SCHEMAFULL;
DEFINE FIELD OVERWRITE repo ON marketplace TYPE string;

-- the "meat" catalog: id = skill name. Delivered by an external plugin (source
-- "plugin") OR carried inline from the tenant library (source "library", ADR 0012 —
-- deploy ships the files; build materializes them).
DEFINE TABLE OVERWRITE skill SCHEMAFULL;
DEFINE FIELD OVERWRITE source      ON skill TYPE string ASSERT $value IN ["plugin", "library"];
DEFINE FIELD OVERWRITE plugin      ON skill TYPE option<string>;
DEFINE FIELD OVERWRITE marketplace ON skill TYPE option<record<marketplace>>;
DEFINE FIELD OVERWRITE files       ON skill TYPE option<object> FLEXIBLE;

-- library agent content: id = agent name (deduped — several purposes may share one).
DEFINE TABLE OVERWRITE agent SCHEMAFULL;
DEFINE FIELD OVERWRITE content ON agent TYPE string;

DEFINE TABLE OVERWRITE user SCHEMAFULL;
DEFINE FIELD OVERWRITE name   ON user TYPE string;
DEFINE FIELD OVERWRITE github ON user TYPE option<string>;  -- anchor de identidade (gh login)

-- atribuição = aresta de grafo: user -> responsible -> purpose (scope + papel na aresta)
-- role: owner (accountable, governa/migra/decide) vs member (trabalha). Acesso é igual;
-- o papel só governa accountability. Um dono por propósito (holacracia).
DEFINE TABLE OVERWRITE responsible TYPE RELATION FROM user TO purpose SCHEMAFULL;
DEFINE FIELD OVERWRITE scope ON responsible TYPE option<string>;
DEFINE FIELD OVERWRITE role  ON responsible TYPE string DEFAULT "member" ASSERT $value IN ["owner", "member"];
