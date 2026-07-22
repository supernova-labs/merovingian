# ADR 0009 — Topologia de deploy & governança declarativa (estilo k8s)

**Status:** Fermentação
**Data:** 2026-06-30
**Origem:** sparring Luis × Claude (2026-06-30), desembaralhando deploy vs. governança
**Relacionado:** `0007` (Architect vs. Source), `0006` (governança como migração),
`0004` (governança = build), `0002` (permissionamento), `0008` (owner vs member)

## Contexto

Ao desenhar o deploy da v2, caiu a ficha: **governança e deploy são a mesma
máquina.** "Evoluir o grafo do tenant" *é* um deploy. Logo a escolha de como a
governança autora a mudança **define a topologia de repositórios**.

Este repo (incubador) vai virar o **Source**: a plataforma genérica, em inglês,
`bun install`-ável, server deployável (AWS → SurrealDB). Com isso, **o que é
específico da Supernova tem que sair daqui**. A pergunta "precisa de um repo da
Supernova?" se reduz a **uma só**: *onde o grafo é autorado?* — o velho A/B
(Surreal-nativo vs. git→projeta), que este ADR resolve.

Três perguntas vinham **conflatadas** e precisam ser separadas:
- **(a) Modelo de autoria:** estado-desejado declarativo vs. migração imperativa.
- **(b) Auditoria:** artefato externo em git vs. time-travel dentro do banco.
- **(c) Escopo da ação:** governança toca só o Surreal, ou orquestra Surreal +
  gh (repos/ACLs) + marketplace? **É multi** — e isso puxa a resposta.

## Decisão (fermentação)

### 1. As três camadas (repo ≠ tenant)

Um **tenant não é um repo de código** — é um composto de runtime.

| Camada | O que é | Onde vive |
|---|---|---|
| **Plataforma (Source)** | CLI, server, schema DDL, MCPs, `deploy`/reconcile, agente architect genérico, `init` | **este repo** (genérico) |
| **Estado do tenant** | grafo + users + assignments + time-travel + **dado de negócio** | **SurrealDB** (database do tenant) |
| **Conteúdo do tenant** | KB (okf) + plugins (marketplace) | repos `kb-*` + marketplace (ACL via gh = fronteira) |
| **Fonte-de-verdade do tenant** | `graph.yaml` (estado-desejado) + migrações-escape-hatch + ops/IaC | **tenant repo fino, dedicado** |

### 2. Autoria: YAML declarativo (estado-desejado, estilo k8s)

O grafo é **config, não schema de alta velocidade** — config quer
estado-desejado, igual manifesto k8s. O `graph.yaml` **é** a verdade; o `deploy`
**reconcilia** o banco até bater. Consequências:
- O **console vira o render do estado-desejado**, e os "gaps" que ele já mostra
  viram **drift** (desejado × real).
- Revisão = **diffar o YAML** num PR (legível, discutível — o "porquê" da Fix mora aqui).
- Reprodutível: aplica num banco vazio = o tenant. DR trivial.

### 3. Governança é uma **skill agêntica**, não um engine determinístico

O "reconcile" **não é um monolito tipo Terraform**. É uma **skill do Claude Code**
(genérica, do marketplace público do Merovingian) que o humano roda **dentro do
tenant repo**. Ela **orquestra + julga + pergunta ao humano**, carregando **tools**
pros pedaços mecânicos. Separação que importa:

- **Orquestração = agêntica** (pode ser não-determinística — é human-in-the-loop,
  baixa frequência; o humano revisa o PR no fim). Claude rodar script de gh e ler o
  resultado é trivial.
- **Mutação crítica = tool determinística** (o apply no banco oficial é uma tool, não
  bash livre — reproduzível e segura). *O agente decide o quê; a tool faz o como.*

`merovingian deploy` (= o ato de governança), via a skill + tools:
1. **diff** `graph.yaml` × banco (tool);
2. **narra/propõe** o plano ao humano (agente);
3. **testa num clone** do banco (export/import — o grafo é minúsculo) (tool);
4. **aplica** no oficial + **loga** (tool).

**Audit-first:** o 1º corte é só a skill **dizer ao humano o que está fora do
estado-desejado**; o **auto-reconcile** (aplicar sozinho) é **roadmap**. Roda local
ou em CI/CD.

### 4. `deploy` é multi-provider (o ponto (c))

Governança faz mais que sync de banco: **cria repos, seta ACLs no gh, garante
plugins, abre PR de marketplace, atribui humanos.** Isso é estado-desejado
**atravessando 3 providers** (Surreal + gh + marketplace) — o modelo Terraform.
O `graph.yaml` declara *"este propósito existe, dono X, repo Y com ACL Z,
plugin-agente W, humanos [A,B]"* e o reconcile faz tudo existir. (Outros
marketplaces / repos de KB seguem em PRs próprios — a atomicidade "1 PR" é
parcial de qualquer jeito.)

### 5. IDs estáveis: o ID é a identidade (nunca UUID, nunca muta)

**Todo record usa um slug humano e estável** — `purpose:delivery`, `user:luis`,
`bucket:clientes` — **nunca um UUID gerado**, porque **tabelas de runtime
referenciam esses IDs** (um `project` aponta `purpose:delivery`; um dado aponta
`user:renato`). Mudar o ID quebra a referência.

Disso cai um princípio **k8s**: **"rename" não existe.** Renomear um recurso é
**deletar o antigo + criar o novo (identidade nova) + re-apontar as referências
proativamente.** O upsert declarativo enxerga: ID antigo ausente → deleta; ID
novo presente → cria. Se havia dado de runtime apontando o antigo, a mudança
**tem que** incluir o re-apontamento (uma migração — o escape-hatch abaixo).

> **Exemplo real:** o rename `infra-os` → `architect` (ADR 0007) foi, de fato,
> deletar + criar + re-apontar — tivemos que mudar à mão o `owner` do bucket
> `arquitetura`. Num deploy declarativo, o reconcile deletaria `infra-os` e
> criaria `architect`; o re-apontamento da referência entra na mesma mudança.

**O guarda das referências — tool determinística na skill, NÃO `REFERENCE` (decidido 2026-06-30).**
Antes de deletar um record, a skill faz um **referrer-check**: *"`purpose:X` vai sumir
e N coisas apontam pra ele — re-aponto pra onde?"* → pergunta ao humano. A deleção é
referência-ciente, não cega. **Mas o mecanismo é uma tool que enumera os campos-link
conhecidos** (`purpose.parent`, `bucket.owner`, `purpose.owns/reads`, `skill.marketplace`)
com `SELECT`s diretos — **não** o `REFERENCE`+`<~` do Surreal 3.0.

Cogitamos `REFERENCE` e o **rejeitamos**, por três razões:
1. **Schema fechado.** Nós autoramos todas as tabelas de estrutura; os referrers são
   uma **lista finita e conhecida**. O `<~` só ganha quando existe um referrer que você
   *não sabe enumerar* — aqui você sabe. Vira puro ergonomics.
2. **`REFERENCE` não é automático.** O `<~` só enxerga campos **declarados** `REFERENCE`.
   O motivo original — proteger *tabelas futuras do tenant* que apontem pra `purpose:luis` —
   **não fecha**: se o tenant criar a tabela dele com `record<purpose>` puro (o caminho
   natural), o `<~` não vê. `REFERENCE` só ajudaria impondo ao tenant a convenção de
   declarar todo FK como `REFERENCE` — regra a policiar, não proteção de graça. O mesmo
   trabalho, sem impor convenção, sai de um `INFO FOR DB` + varredura genérica (rede de
   segurança pro mundo aberto — **roadmap**, quando tenant tables existirem; hoje não há).
3. **O enforcement mora na skill, não no banco (§3).** O único ganho que sobraria seria o
   `ON DELETE REJECT/CASCADE` — deixar o *banco* ser a guarda. Mas o 0009 já decidiu
   audit-first, guarda na skill (explicabilidade: o diff mostra *por que* rejeitou; um
   REJECT do banco só estoura erro). E `ON DELETE REJECT` quebraria o `migrate`
   wipe-and-reproject. Custo real, benefício que não queremos.

### 6. Migração imperativa: escape-hatch

O upsert declarativo cobre add/remove/retie. Pras mudanças que **carregam dado**
(rename-com-referências, backfill), existe a **migração imperativa à mão** — um
mecanismo, não o modo primário. (Refina o `0006`: a "migração" passa a ser
majoritariamente o *plano gerado* do diff; o script à mão é a exceção.)

### 7. Time-travel: audit de runtime, **não** governança

Adotar o time-travel do Surreal — mas no papel certo: ele responde o que **1 e 2
não conseguem** (o que aconteceu com o **dado de negócio** e com **edições ao
vivo pelo console**). Mas **audit ≠ review ≠ reprodutibilidade**: é forense
pós-fato, não o portão de aprovação nem te reconstrói de fonte externa. **Não
troca o repo por ele** — perderíamos o review-antes-de-aplicar e o "porquê".

### 8. A fronteira estrutura × dado (vale nos 4 casos)

O YAML/migração dona `purpose/bucket/skill/tool/marketplace/config` + arestas
`responsible` (atribuição *é* decisão de governança) + `user`. **Nunca** toca
`clientes/inbox/proposal/contract` (dado de negócio). Sem essa linha, um `deploy`
declarativo nuke o dado. O `migrate` atual **já respeita isso** (só recria as
tabelas de estrutura).

### 9. Repo de tenant: dedicado e fino (rejeita 1.b)

O marketplace repo **não** vira o repo de governança. Conveniente agora,
conflatado depois: mistura *conteúdo de marketplace* (estrutura de plugin do
Claude Code) com *definição de grafo* (YAML), revisores diferentes; e o
`core`/`ambient` tende a virar **baseline genérico do Source**. O tenant repo é
**dedicado e fino** (`graph.yaml` + migrações + ops), e *referencia* o
marketplace.

## Por que (benefícios)

- **Source-of-truth-as-state** + review trivial (diff) + reprodutibilidade + drift.
- O **console-como-spec** cai de graça (render do estado-desejado).
- Resolve o A/B em aberto **a favor do B**, mas declarativo (não migração à mão).
- Mantém a Supernova dogfoodando o loop de governança-como-PR (`0006`).
- IDs estáveis blindam as referências de runtime e tornam o modelo de mudança
  explícito (sem rename mágico).

## Decidido no sparring (pós-rascunho)

- **Server multi-tenant.** Um **database = um tenant**; um server hospeda vários.
  Isolamento na fronteira do banco. (Hoje `namespace` é fixo `merovingian` e `db` é
  o tenant → na prática **db = tenant**.) *(Resolve a antiga pendência #2.)*
- **O reconcile não é engine** — é a skill agêntica + tools (ver §3). Some o medo do
  "Terraform-pra-AWS". 1º corte = **audit** (diz ao humano o que ajustar);
  auto-reconcile = roadmap. *(Resolve #1.)*
- **Rename-com-referências** = **tool de referrer-check** (enumera os campos-link
  conhecidos) + decisão do humano (ver §5). `REFERENCE`+`<~` **rejeitado** (schema
  fechado; não é automático; enforcement mora na skill). *(Resolve #3.)*
- **Onde o Architect roda** = a skill de governança (genérica, marketplace público)
  rodada **dentro do tenant repo**. *(Resolve a antiga pendência #5.)*
- **Onde vivem as "decisões"** (resolve a antiga pendência #4, refina/supera o `0007`):
  são **quatro coisas distintas**, não uma. (1) **ADRs de plataforma** (0001–0009) →
  Source repo (markdown). (2) **Racional de mudança do grafo** → **com o PR** (o PR já
  é o registro). (3) **Decisões first-class do tenant** (o Primitivo "Decisões", `0003`)
  → **tabela no Surreal**, jurisprudência operacional scoped, **irmã da inbox** (fecha o
  FFF: friction entra, Fix-que-compõe sai como decisão). (4) *opcional*: ADR de
  arquitetura **durável** do tenant → markdown no tenant repo, junto do `graph.yaml`.
  **(2) e (3) são ligadas** — uma mudança estrutural pode gerar o PR **e** (se for
  precedente durável) uma decisão que o referencia; **nem todo PR vira decisão** (evita
  ruído). ADRs de *produto* **não** vão pra tabela do tenant.

## Cuidados / em aberto

1. **Reconcile cross-provider** — **faseamento decidido (2026-06-30):** o **audit
   cobre todos os providers desde já** (read-only: lê `graph.yaml`, compara com Surreal,
   checa se os repos de KB existem no gh e se o marketplace tem os plugins → relatório de
   drift + checklist manual pro humano). A **automação do apply** entra em ordem:
   **(1) Surreal** (upsert/delete referência-ciente) → **(2) gh** (criar repo / setar ACL)
   → **(3) marketplace** (abrir PR de plugin). Audit dá valor no dia 1 mesmo sem apply.
2. ~~**A tool determinística de apply**~~ — **construída (I.4, 2026-07-01):** `applyGraph`
   (`merovingian deploy apply`). Contrato: upsert do desejado (lineage sempre recomputado) +
   reconcile de arestas em delta + delete **referrer-safe**. Garantias entregues: **idempotente**
   (no-op = zero escrita), **só-estrutura** (nunca toca `client`/`inbox`), **atômica no bloqueio**
   (pré-check de referrer aborta antes de escrever — sem TX porque apply não toca runtime, então o
   referrer lê igual antes/depois), **`--yes`** pra deleções. O **referrer-check virou guarda de
   dado vivo** (`inbox.user` hoje): os structural são provably-limpos (validate + upsert-antes-de-
   deletar), então só runtime pode bloquear. **`migrate` dobrou em `applyGraph({reset:true})`** — uma
   orquestração só. **Roadmap:** wrap em `BEGIN/COMMIT` (atomicidade de crash), clone-test
   (export/import), gate do replay de DDL, e o registry de referrer runtime cresce por FK nova.
3. **Escopo-no-nó** (`0008`) e este modelo se cruzam: criar `delivery-nord` é uma
   mudança declarativa de grafo + uma migração de dado (re-apontar escopo).
4. ~~**Adotar `REFERENCE` no schema**~~ — **rejeitado (2026-06-30, ver §5).** O
   referrer-check vira **tool determinística** (campos-link conhecidos). Fica de
   **roadmap** a varredura genérica (`INFO FOR DB`) como rede de segurança pra tenant
   tables — YAGNI hoje (nenhuma tenant table existe).
5. **Tabela `decision`** (o Primitivo `0003` materializado) — schema + casca scoped
   (irmã da `inbox`); a desenhar quando for a hora.

## Consequências

- Surge o artefato **tenant repo** (`merovingian-<tenant>`): `graph.yaml` +
  `migrations/` + `deploy/` (ops). Fino, sem código de plataforma.
- **Governança = skill agêntica** (genérica, marketplace público do Merovingian) que
  roda no tenant repo, carregando tools (diff, reverse-lookup, apply determinístico,
  ops de gh). O **`merovingian deploy`** é a tool de apply que ela chama — não um
  engine monolítico. Encarna a Fase 3 do MVP. 1º corte = **audit**.
- **Deleção referência-ciente** via **tool de referrer-check** na skill (campos-link
  conhecidos); `REFERENCE`+`<~` **rejeitado** (ver §5). Server **multi-tenant** (db = tenant).
- ~~**`fixtures/supernova/*` sai deste repo**~~ — **feito (II.1, 2026-07-01):** o grafo real
  do primeiro tenant migrou pro seu tenant repo (git); o Source virou genérico
  (fixture-exemplo `acme` sintético) com **zero refs "supernova"**; as commands de autoria leem
  o grafo de `--graph`/cwd, namespace do yaml (não mais registry). O `merovingian init` e a
  config de conexão do tenant ficam pra II.2+.
- **Princípio de ID estável** entra no schema/convenção (slugs, nunca UUID).
- Time-travel ligado no Surreal como audit de runtime.
- Fecha a decisão A/B do MVP a favor de **B declarativo**.
