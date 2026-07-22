# ADR 0008 — Owner vs. Member: papel na atribuição e o humano em vários propósitos

**Status:** Consolidada (2026-06-30) — `role` owner/member + invariante dono⇒sem-escopo
+ dono efetivo por gravidade; **em código + console**. Itens de roadmap seguem abertos.
**Data:** 2026-06-30
**Origem:** sparring Luis × Claude (2026-06-30), durante a construção do console
**Relacionado:** `0002` (permissionamento), `0004` (governança = build),
`0006` (governança como migração), `0007` (Architect vs. Source), `0009` (deploy)

## Contexto

A atribuição de um humano a um propósito é uma **aresta de grafo**
(`user → responsible → purpose`). Pergunta que disparou o ADR: *"hoje só dá pra
ter um humano por propósito? Eu queria mais de um humano como parte de um
propósito, e até um humano como DONO — ex.: um colega trabalha comigo em marketing,
mas a responsa ainda é minha."*

Ao olhar o modelo real, duas surpresas:

1. **Vários humanos no mesmo propósito já funcionava — estruturalmente.** Uma
   `RELATION` não tem unicidade; nada impedia N arestas entrarem no mesmo
   propósito. O console (visão-deus) já listava todos. O que faltava era
   **semântica**, não capacidade.
2. **O modelo era cego a dois conceitos:**
   - **Dono vs. parte.** A aresta carregava só `scope`. Não havia papel. Todo
     pertencimento era liso, sem accountability. (Curiosidade: "dono" *existia*,
     mas só para **bucket** — `bucket.owner → purpose`. Propósito não tinha dono
     humano.)
   - **Um humano em vários propósitos.** O grafo aceitava, mas o **caminho de
     leitura colapsava**: `resolveUser` fazia `edges[0]` e `User.assignment` era
     **singular**. A visão-deus era N:N; a projeção (workspace) era 1:1.

## Decisão (fermentação)

Adicionar um campo **`role`** na aresta `responsible` — `owner | member` —, e
tornar a atribuição **multivalorada** (um humano pertence a um conjunto de
propósitos). Dois eixos **independentes**:

| Eixo | O que é | Como funciona |
|---|---|---|
| **Acesso** | que workspace você recebe (contexto, tools, skills) | **= pertencimento**: tem aresta ⇒ recebe. **Cego ao papel** (owner e member recebem o mesmo) |
| **Accountability** | quem responde, governa, migra, decide, dreno do inbox | **= papel `owner`**. `member` trabalha, não é o accountable |

> **A linha: acesso é pertencimento; o papel é responsabilidade.** Misturar os
> dois infla a projeção sem ganho — então o papel é, por ora, um conceito de
> **governança**, e a projeção quase não muda.

Regras consolidadas no sparring:

- **Accountability é singular: um `owner` por propósito** (holacracia/RACI —
  accountability que se divide é de ninguém). N `member`s livres.
- **`User.assignment` (singular) → `User.assignments: Assignment[]`.** Um humano
  pode sentar em vários propósitos; **acesso = união** dos sub-grafos.
- **`resolveUser` lê todas as arestas** (não mais `edges[0]`), cada uma com seu
  `role` e `scope`.
- **Escopo é por-aresta.** Cada `assignment` escopa seu próprio sub-grafo; ao
  estampar um bucket `by-client`, vale o escopo da atribuição que o concede. Um
  caminho **não-escopado ganha** (acesso mais amplo prevalece).
- **Dono ⇒ sem escopo (invariante).** Uma aresta `owner` **não pode ter `scope`**.
  Accountability é de **nó inteiro**: o dono responde por *todo* o propósito (todos
  os dados, todos os sub-propósitos). "Dono de uma fatia" é incoerente — se você só
  vê `nord`, não responde por acme/globex. **Remédio:** quem precisa de
  accountability sobre uma fatia vira **dono de um sub-propósito** que a representa
  (ex.: `delivery-nord`), possuído por inteiro. *Se a fatia merece um dono, a fatia
  merece ser um propósito.* Mantém os dois conceitos limpos: **escopo = partição de
  dado** (um *member* numa fatia); **ownership = nó inteiro**.

Exemplo (a demo que ficou no fixture, hoje `acme`): ada é `owner` da raiz **e**
`owner` de `content` (accountability, mesmo já vendo content pela raiz); ben é
`member` de `content` — mesmo workspace, sem ser o accountable; cleo é `member`
de `delivery` escopada em `north` (não `owner`, pelo invariante
abaixo) — então `delivery` não tem dono próprio e seu **dono efetivo** é Luis,
por gravidade, via a raiz.

## Propriedade por gravidade (derivado, no console)

Accountability **cai pela árvore**: o **dono efetivo** de um propósito é o seu
dono explícito; se não tem, é o dono efetivo do pai — recursivamente, até a raiz.
**Member não segura a gravidade — só um dono explícito segura.** Logo `crescimento`
(sem dono próprio) é do Luis por gravidade; uma fatia órfã de verdade é só quando
**nem ele nem nenhum ancestral** tem dono. É conceito **derivado** (calculado do
`parent` + `assignments`), não muda schema; vive no console (linha "dono efetivo"
no propósito; seção "cobre por gravidade" na pessoa).

## O que isso destrava

- **Governança (Fase 3, `0006`) ganha o sujeito certo:** quem pode rodar a
  migração / governar um propósito é o seu `owner`. O papel é o gancho de
  permissão de governança que faltava.
- **Liga a `0007`:** o `architect` é o `owner` do propósito-role de operação do
  tenant; a governança que ele roda é a do(s) propósito(s) que ele dona.
- **Console mais explicável:** mostra dono/membro por humano (coroa na árvore,
  badge no detalhe), o **dono efetivo por gravidade**, a seção **"cobre por
  gravidade"** na pessoa, e os gaps **"sem dono efetivo"** (órfão real) e
  **"scoped owner"** (dono com escopo — viola o invariante, vire sub-propósito).

## Cuidados / em aberto

1. **O invariante "um dono por propósito" não é enforçado.** Hoje é convenção +
   um *sinal* no console ("membros sem dono"). Não há constraint no schema que
   barre dois `owner`s na mesma aresta-destino. Decidir se vira invariante de
   governança (lint da Fase 3) ou constraint no banco.
2. **Multi-escopo do mesmo bucket.** Se um humano tiver duas atribuições
   escopadas (ex.: `delivery@nord` **e** `delivery@acme`), o `SurrealMount.scope`
   é um único string — não representa "nord + acme". Hoje a regra é "um caminho
   não-escopado ganha"; o caso de múltiplos escopos distintos no mesmo bucket é
   **futuro** (viraria `scopes[]` / mounts por escopo). O fixture não exercita.
5. **Escopo no nó (a mecânica do remédio).** O invariante diz "pra ter dono de
   fatia, faça a fatia um sub-propósito". Mas quando `delivery-nord` nasce, o
   **escopo precisa migrar da aresta pro nó**: hoje `scope="nord"` vive na
   atribuição e filtra `clientes` por linha; num sub-propósito-dono-sem-escopo,
   esse filtro teria que viver no **binding de bucket do nó** (ou num `scope` do
   próprio propósito), não na aresta. É uma fatia de modelo a desenhar — **adiada**,
   mas nomeada aqui. Até lá, o invariante é só validação + sinal (não há um caminho
   automático de "promover fatia a sub-propósito").
3. **`role` ainda não entra no enforcement do Surreal.** As `PERMISSIONS` por
   linha (caminho de enforcement) não consultam `role` — isto é **geração**, não
   enforcement. Quando o papel passar a *barrar* (ex.: só `owner` escreve
   decisão/roda migração via MCP), é uma fatia à parte.
4. **Acesso por papel (deferido).** Decidimos que `member` recebe o mesmo
   workspace que `owner`. Se algum dia um papel precisar **reduzir** acesso
   (member vê menos buckets / só leitura), é uma extensão consciente — e
   reabre a mistura dos dois eixos.

## Consequências

- Schema: `DEFINE FIELD role ON responsible TYPE string DEFAULT "member" ASSERT
  $value IN ["owner", "member"]`.
- Modelo: `User.assignments: Assignment[]`; `Assignment` ganha `role`;
  `AssignmentRow` (console) ganha `role`.
- Projeção: `resolve` une os sub-grafos de todas as atribuições; escopo por-aresta;
  `Manifest.assignment` (singular) → `Manifest.assignments[]` (ripple em
  emit/graph/build/stamp).
- Migração: a aresta grava `role` (a "primeira migração" de `0006` agora carrega
  papel) e **falha loud** se uma aresta `owner` vier com `scope` (invariante).
- Fixture: a member escopada deixa de ser `owner@scope` e vira `member@scope` (respeita o
  invariante; a demo de enforcement continua valendo — acesso é cego ao papel).
- Console: dono/membro por humano + dono efetivo por gravidade + seção "cobre por
  gravidade" + gaps "sem dono efetivo" e "scoped owner".
- Fica de roadmap: o invariante de dono único (lint/constraint), o multi-escopo,
  o **escopo-no-nó** (mecânica do remédio de sub-propósito), e o `role` no
  enforcement.
