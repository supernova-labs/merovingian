# Índice das ADRs — v2 do Merovingian

Estado de todas as decisões num lugar só. **Fonte da verdade do status.** O conteúdo
de cada uma está em `fermentacao/` (em discussão) ou `consolidadas/` (fechadas — lastro
*ou* superseded).

| # | Título | Status | Pasta | Uma linha |
|---|---|---|---|---|
| 0001 | Modelo de uso/deploy | 🟡 Superseded → 04/05/09 | `consolidadas/` | semente (padrão Omnigent); decisões migraram |
| 0002 | Permissionamento e domínio | 🟢 Consolidada | `consolidadas/` | permissão por user-token; trava física diferida |
| 0003 | Modelo de decisões | 🟡 Superseded → 09 | `consolidadas/` | raiz do Primitivo "Decisões" (→ tabela `decision`) |
| 0004 | Topologia + build-time | 🟢 Consolidada | `consolidadas/` | mono-repo / launch≠build / governança-PR |
| 0005 | Deploy e distribuição | 🟢 Consolidada | `consolidadas/` | build=projeção; *secret-is-data*; 4 camadas |
| 0006 | Governança como migração | 🔵 Fermentação | `fermentacao/` | PR atômico; mecânica refinada pelo 0009 |
| 0007 | Architect vs. Source | 🟢 Consolidada | `consolidadas/` | duas roles; bootstrap de tenant; ~~architect=propósito~~ (refinado → 0010) |
| 0008 | Owner vs. Member | 🟢 Consolidada | `consolidadas/` | role na aresta; dono⇒sem-escopo; gravidade |
| 0009 | Topologia de deploy + governança declarativa | 🔵 Fermentação | `fermentacao/` | YAML declarativo; governança=skill; ID estável |
| 0010 | Governança é tooling de repo, não propósito | 🟢 Consolidada | `consolidadas/` | architect sai do grafo; auth=repo+Surreal; init semeia via marketplace |
| 0011 | Dados de domínio são do tenant | 🟢 Consolidada | `consolidadas/` | client/by-client saem do motor; inbox fica; deploy provisiona domínio do grafo (impl. entregue 2026-07-02) |
| 0012 | Library do tenant + distribuição híbrida | 🟢 Consolidada | `consolidadas/` | conteúdo comportamental no tenant repo (build materializa a fatia); marketplace = produto + terceiros; init semeia cópias |
| 0013 | Domínio de decisões: log + jurisprudência | 🟢 Consolidada | `consolidadas/` | log em voo (padrão inbox, purpose-scoped) · record ratificado (git→db, padrão library) · promoção via drain · `decides:` ganha significado (impl. entregue 2026-07-03) |
| 0014 | Frictions com escopo + governança local | 🟢 Consolidada | `consolidadas/` | a friction É a task: `scope` (escritor escopa, root re-escopa/pesca) · leitura/resolução por lineage REAL (não origin) · governança local = skill `pending` (humano invoca) · um `drained` só + `resolved_through` (impl. entregue 2026-07-10) |
| 0015 | SIGNIN por senha antes do service | 🟢 Consolidada | `consolidadas/` | cada pessoa com a própria senha (argon2 em `credential`, runtime); o banco emite o token (KEY nunca sai); coexiste com JWT externo → service vira sucessor, não pré-requisito; condição: banco em rede privada (impl. entregue 2026-07-24) |
| 0016 | O grafo também é dado | 🟢 Consolidada | `consolidadas/` | FOR select estrutural pela régua de lineage (0014) + `readers`/`ambient` derivados → build/graph rodam COMO a pessoa (senha), zero credencial de sistema em máquina de membro; regra nova: nunca subquery em permission (não roda com perms do caller — achado 2026-07-25); invariante: paridade byte-a-byte do manifest (impl. entregue 2026-07-25) |
| 0017 | Projeção multi-harness | 🟢 Consolidada | `consolidadas/` | um manifest neutro → emitters Claude + Codex no mesmo workspace; sessão raiz chama agentes de propósito como subagentes; ownership por arquivo, aplicação transacional e degradação explícita (impl. entregue 2026-07-26) |

🟢 consolidada (lastro) · 🟡 superseded (history, aponta pro sucessor) · 🔵 fermentação (aberta)

## A família que conta a história

`0007` (Architect opera o tenant ≠ Source constrói o OS) → `0008` (quem opera: owner/member)
→ `0009` (como opera: topologia de deploy + governança-como-skill). `0006` é o embrião da
mecânica que o `0009` refina. `0001`–`0005` são a fundação (deploy/permissão/topologia)
que a tríade 07/08/09 assume.

## Forks ainda abertos (precisam de martelo)

Vivem no `0009` (o único ativo de peso), todos **roadmap**, não bloqueantes:
- contrato da **tool determinística de apply** (idempotente, só-estrutura, referência-ciente)
- ~~adotar **`REFERENCE`** no DDL~~ — **resolvido 2026-06-30: rejeitado.** Referrer-check
  vira tool determinística (campos-link conhecidos); varredura genérica pra tenant tables = roadmap
- ~~schema da tabela **`decision`**~~ — **resolvido 2026-07-03: virou a `0013`** (log + record)
- cruzamento **escopo-no-nó** (`0008`) × deploy declarativo

## Histórico de curadoria

- **2026-07-26** — Nasce e é implementada a `0017` (consolidada, issue #17): o build
  passa a ser multi-harness por default — uma fatia/manifest neutro, emitters nativos de
  Claude e Codex no mesmo workspace e aplicação transacional. A sessão principal abre
  somente com o arquivo raiz e delega aos agentes dos propósitos; skills seguem Agent
  Skills; plugins ganham identidade lógica + bindings por harness e sync explícito.
  Ownership/inventário por emitter evita wipes amplos; SSE no Codex e plugins ausentes
  degradam com warning, nunca em silêncio. Segredos locais podem viver no config Codex
  gerenciado/0600 somente fora de Git.
- **2026-07-25** — Nasce `0016` (consolidada): **o grafo também é dado** — FOR select das
  tabelas estruturais escopado pela régua de lineage da 0014 (`readers`/`ambient` derivados
  no apply, padrão do `lineage`), e `build`/`graph` passam a rodar COMO a pessoa (conexão
  por senha): a fatia vem do banco, não de filtro em memória com root. Mata a necessidade
  do service para onboarding (#19 reposicionada). Achado que fixou o mecanismo: subquery em
  PERMISSIONS **não** roda com as perms do caller (vê demais) — denormalizar + dot-access é
  a regra. Invariante de teste: paridade byte-a-byte do manifest (o resolve degrada mudo).
  Detonador: pergunta do Luis ("por que o build precisa do mapa completo?") no dia seguinte
  à 0015.
- **2026-07-24** — Nasce `0015` (consolidada): **SIGNIN por senha antes do service** — cada
  pessoa autentica com a própria senha (hash argon2 na tabela runtime `credential`; o `apply`
  nunca a toca) e o próprio SurrealDB emite o token scoped: a KEY de assinatura não sai do
  banco, nenhuma máquina carrega chave-mestra. Coexiste com `WITH JWT` (dev-mint e o service
  futuro intactos) → o service (#6) vira sucessor do rollout, não pré-requisito. Condição
  registrada: o banco durável em rede privada. Detonador: onboarding da segunda pessoa
  (pergunta do Luis: "por que não a própria senha, que eu dou ao criar o usuário?").
- **2026-07-10** — Nasce `0014` (consolidada): **frictions com escopo + governança local** —
  o loop FFF ganha o caminho eferente. A friction É a task: `scope option<record<purpose>>`
  (escritor escopa no nascimento; vazio = fila do root; root re-escopa na triagem e pesca o
  sistêmico), leitura/resolução por lineage real do usuário (padrão `decision_log` da 0013 —
  telemetria `origin` nunca autoriza), conteúdo imutável pós-create (`VALUE $before`),
  governança local = skill leve de workspace via MCP (`pending`/`resolve`), um `drained` só
  + `resolved_through` (rastro PR/doc/commit). Nasceu do primeiro uso real: a colheita era
  majoritariamente operacional e o purpose que podia resolver era cego por design.
- **2026-07-03** — Implementação da `0013` entregue — 3 tabelas engine (`decision_domain`
  lookup dot-access — subquery-scan em PERMISSION roda com as perms do caller — + `decision`
  tenant-wide + `decision_log` com create=select), records git→deploy
  (`decisions/<dominio>/NNNN-slug.md`) com warning de imutabilidade e referrer-block no delete,
  MCP ambient `decisions` (postura epistêmica no CLAUDE.md emitido), CLI
  `merovingian decisions <ns>` (irmã do inbox, render com `applies:`), skill drain com a etapa
  de promoção (plugin 0.3.0).
- **2026-07-03** — Nasce `0013` (consolidada): **o domínio de decisões** — `decision_log`
  (em voo, escrito pelo membro via MCP, leitura purpose-scoped pela lineage, `records:` de
  lastro = telemetria de jurisprudência) + `decision` (record oficial: autorado em
  `decisions/` no tenant repo, ratificado pela governança, deploy persiste, leitura
  tenant-wide). Promoção = a passada de drain. `decides:` (reservado desde o início) ganha
  significado: domínios de decisão são os buckets das decisões. Fecha o fork do `0009`
  ("schema da tabela decision"); o Primitivo Decisões (`0003`) ganha corpo.
- **2026-07-02** — Implementação da `0011` entregue — gerador de domínio (`src/graph/domain.ts`),
  `data.surql` engine-only, MCP `surreal-data` manifest-driven (`tables`/`select` via
  `MEROVINGIAN_BUCKETS`), CLI `seed`/`clients` → `data <ns> <table>`.
- **2026-07-02** — Nasce `0012` (consolidada): **conteúdo comportamental mora na library do
  tenant repo** (`library/{agents,skills}/`), materializado seletivamente pelo build — a fronteira
  de acesso volta à projeção e a governança fica atômica (um PR = grafo + prompts). Marketplace
  vira canal de *externo* (produto `0010` + terceiros); o `<tenant>-plugins` obrigatório morre.
  `init` semeia journal/friction/route como **cópias** (0011: prompt = dado do tenant);
  `library update` (audit-first) puxa templates novos. Supersede a "opção A" (plugins de sistema
  no marketplace do Source) e mata o bootstrap de plugins na raiz.
- **2026-07-02** — Nasce `0011` (consolidada): **dados de domínio são do tenant** — o motor
  provisiona mecanismo (identidade, inbox, gerador de PERMISSIONS, convenção de scope), nunca
  schema de negócio. `client` (tabela, CLI `clients`/`seed`, tools do MCP) e `scope: by-client`
  saem; `inbox` fica; o deploy passa a provisionar domínio derivado do grafo (implementação =
  II.3, reconcile multi-provider). Régua nova: o *teste de propriedade* ("segundo tenant, zero
  código — o que quebra?"). Achado pelo primeiro tenant pessoal.
- **2026-07-01** — Nasce `0010` (consolidada): governança é **tooling de repo**, não propósito do
  grafo (o `deploy` já usa root — o propósito `architect` era decorativo). Auth = git ACL + Surreal;
  `init` semeia via marketplace (padrão harny); ambient = só journal+friction. Refina 0007/0009;
  `architect`+`arquitetura`+`governanca` saíram do grafo do primeiro tenant (via `deploy apply`).
- **2026-06-30** — Fork `REFERENCE` no DDL (0009) **resolvido: rejeitado**. Schema fechado
  (referrers finitos/conhecidos); `REFERENCE` não é automático (não protege tenant table ingênua);
  enforcement mora na skill, não no banco. Referrer-check vira tool determinística. Reformou a I.1 do MVP.
- **2026-06-30** — Primeira curadoria geral (9 ADRs, todas estavam em fermentação).
  Resolvidos 3 forks: architect=propósito singular decomponível (`0007`); trava física
  confirmada diferida (`0002`); faseamento do reconcile = audit-todos-providers + apply
  Surreal→gh→marketplace (`0009`). Graduadas pra `consolidadas/`: 0002, 0004, 0005, 0007,
  0008. Marcadas superseded: 0001 (→04/05/09), 0003 (→09). Seguem em fermentação: 0006, 0009.
