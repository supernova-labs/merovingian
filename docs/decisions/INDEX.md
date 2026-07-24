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
