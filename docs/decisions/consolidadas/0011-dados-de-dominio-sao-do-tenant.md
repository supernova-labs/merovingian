# ADR 0011 — Dados de domínio são do tenant: o motor provisiona mecanismo, nunca schema

**Status:** Consolidada — implementação entregue em 2026-07-02 (gerador de domínio em `src/graph/domain.ts`, `data.surql` engine-only, MCP manifest-driven, `seed`/`clients` → `data`)
**Data:** 2026-07-02
**Origem:** sparring Luis × Claude (2026-07-02), ao montar o primeiro tenant pessoal — "por que
meu db tem uma tabela `client`?"
**Relacionado:** generaliza a implementação do `0002` (permissionamento); estende o `0009`
§faseamento (reconcile multi-provider); terceiro da família de fósseis que o `0010` inaugurou

## Contexto

O `surreal/data.surql` do Source mistura três espécies num arquivo:

1. `DEFINE ACCESS identity` (JWT) — **motor** (o mecanismo de identidade).
2. `inbox` (journal/friction) — **motor** (a tabela do loop FFF, feature de sistema).
3. `client` (account/name + PERMISSIONS) — **domínio da Supernova**, fossilizado da Fase 0,
   quando a Supernova *era* o único tenant.

A contaminação vai além do schema: o `ensureSchema` aplica `data.surql` em todo migrate (todo
tenant ganha uma tabela `client` que nunca pediu), o MCP `surreal-data` hard-coda
`list_clients`/`read_client`, e o CLI genérico carrega `clients` e `seed` (comandos de domínio).
Até a **linguagem do grafo** carrega o vazamento: a estratégia de row-scope se chama
`scope: by-client`.

O achado arquitetural, porém, é o **lado inverso**: a linguagem do grafo é maior que o mecanismo
do motor. O `bucket.tables` aceita qualquer declaração
(`{id: saude, backend: surreal, tables: [exame, consulta]}`), mas **nada provisiona** essas
tabelas nem gera suas PERMISSIONS — o motor aceita a declaração e não consegue servi-la. A
extração da II.1 genericizou os *nomes* (`clientes`→`clients`), não a *propriedade*.

**O teste de propriedade** (que decide tudo): *chega um segundo tenant com zero mudança de
código — o que quebra?* O que quebrar pertence ao lugar errado.

## Decisão

**1. O motor possui mecanismo; o tenant possui schema de domínio.**

| Motor (Source) | Tenant (derivado do grafo) |
|---|---|
| schema estrutural (`purpose`, `bucket`, `user`, …) | tabelas de negócio (declaradas em `bucket.tables`) |
| `DEFINE ACCESS identity` (JWT) | — |
| `inbox` (FFF — journal/friction) | — |
| a **convenção** de row-scope (o campo que a PERMISSION casa contra o scope da assignment) | os **valores** de scope e as colunas de negócio |
| o **gerador** de PERMISSIONS | — |

**2. `client` sai do motor.** A tabela sai do `data.surql`; `seed` e `clients` saem do CLI
genérico (rebaixados a tooling do fixture/dev); o MCP `surreal-data` deixa de hard-codar tools
de client e passa a ser **manifest-driven** (tools derivadas dos buckets/tabelas que a
identidade alcança). O fixture `acme` **continua** usando `client` — como domínio de *exemplo*,
passando pelo mecanismo genérico (os testes de enforcement passam a provar o gerador, não o
hard-code).

**3. `inbox` fica.** É a materialização do loop FFF — primitivo do produto, não domínio. O
`data.surql` se divide conceitualmente: identidade + inbox são schema do motor (junto do
estrutural); o resto nunca deveria ter estado lá.

**4. `scope: by-client` sai da linguagem.** Nenhuma palavra de domínio no `graph.yaml`
genérico: a declaração de row-scope vira genérica (o bucket declara o **campo** de scoping;
sintaxe exata em aberto). Quebra os dois graphs existentes — mudança pequena de contrato,
assumida.

**5. O deploy provisiona o domínio.** Na reconciliação, para cada bucket `surreal`: DEFINE
TABLE (schemaless, v1) + o campo de scope + PERMISSIONS geradas de
(estratégia de scope do bucket × modelo de assignments). É a mesma família do "apply alcança o
gh" (`0009` §faseamento): **reconcile multi-provider = Surreal estrutural + Surreal domínio +
gh**. Colunas SCHEMAFULL do tenant = migrações no tenant repo (fatia futura, não bloqueia).

## Por que

- **O teste de propriedade passa a passar:** um tenant pessoal (`saude`, `financas-pessoais`)
  declara seus buckets e o motor os serve — sem herdar o CRM de uma consultoria.
- **Generaliza sem tocar o que está de pé:** a linguagem do grafo (fora o rename do §4), o
  modelo de enforcement (`0002`, geração ≠ enforcement) e as PERMISSIONS por identidade **não
  mudam** — muda quem *escreve* o DDL de domínio: um gerador, não um arquivo embarcado.
- **Fecha a família de fósseis:** governança-como-propósito (`0010`), plugins de sistema no
  marketplace do tenant (sparring 2026-07-02, opção A), `client` no motor (esta). Padrão comum:
  a Fase 0 encravou Supernova-ismos no Source; a régua para os próximos é o teste de
  propriedade.

## Consequências

- `surreal/data.surql` se reparte: identidade + `inbox` (motor) · `client` (fixture, via
  mecanismo genérico). O `ensureSchema` para de aplicar schema de domínio embarcado.
- CLI: `clients` e `seed` saem do dispatch genérico (viram dev-tooling do fixture ou um
  inspetor genérico `data <ns> <bucket>` — decidir na implementação).
- MCP `surreal-data`: tools por bucket/tabela do manifest (nomes genéricos), não
  `list_clients`.
- Linguagem: `scope: by-client` → declaração genérica de campo de scope; os graphs `acme` e
  do primeiro tenant migram junto (deploy plan/apply cobre).
- Dbs existentes (primeiro tenant, tenants pessoais) carregam uma tabela `client` órfã e inofensiva
  até o mecanismo chegar; limpa na implementação.
- Docs: `concepts/enforcement.md` e `reference/graph-yaml.md` passam a apresentar o exemplo
  `client` explicitamente como domínio do fixture.

## Em aberto (implementação, II.3 — nada bloqueia)

- Sintaxe exata da declaração genérica de row-scope no `graph.yaml` (campo? estratégia nomeada?).
- Nomes/forma das tools genéricas do MCP manifest-driven.
- Migrações SCHEMAFULL de domínio no tenant repo (formato, quando o deploy as aplica).
- Se o provisionamento derruba/recria PERMISSIONS em toda reconciliação ou diffa.
