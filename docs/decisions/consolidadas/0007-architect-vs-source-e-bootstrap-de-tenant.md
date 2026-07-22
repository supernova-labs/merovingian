# ADR 0007 — Architect vs. Source: duas roles, e o bootstrap do tenant

> **Refinado por [0010](0010-governanca-e-tooling-de-repo.md) (2026-07-01):** a parte
> "architect = propósito singular do grafo" está **superada** — o architect é *tooling de
> repo* (agente+skill instalados no tenant repo), não um nó do grafo. A distinção
> Architect-role vs Source segue de pé.

**Status:** Consolidada (2026-06-30)
**Data:** 2026-06-30
**Origem:** sparring Luis × Claude (2026-06-30)
**Relacionado:** `0006` (governança como migração), `0004` (governança = build),
`0002` (permissionamento), `0008` (owner vs member), `0009` (topologia de deploy),
`MODELO-v3.md`

> **Aplicado (parcial, 2026-06-30):** o propósito `infra-os` foi renomeado para
> `architect` no grafo (fixture: id, razão, `agentByPurpose`, `owner` do bucket
> `arquitetura`). **Pendente:** renomear o plugin `infra` → `architect` no
> o marketplace pessoal do usuário e mover `governanca` para skill do
> `architect` (hoje a governança ainda roda no clone do repo do círculo).

## Contexto

Duas camadas vinham sendo **amassadas numa só**, gerando atrito recorrente:

1. **Operar um tenant** — organizar o workspace, evoluir o grafo (migrações =
   atualizar o banco), conduzir governança, curar tools e plugins.
2. **Construir o código-fonte** do Merovingian OS — build service, providers,
   schema, MCPs, motor de migração, tooling de governança.

Sintomas da confusão:
- O propósito `infra-os` dizia *"arquitetar o sistema operacional"* — linguagem
  de **produto** num papel de **tenant**. Um propósito de tenant não *constrói*
  o OS; ele *opera* o tenant.
- O círculo incubador do código carregava a skill
  `governanca` (concern de operação do tenant) e se descrevia como "arquitetando
  a v2".
- A `governanca` nunca achou casca boa (ambient? infra?) — **porque pertence à
  role de operação do tenant**, não ao ambient nem ao dev.

## Decisão (fermentação)

Separar explicitamente **duas roles** (analogia Matrix, fechando o trio com o
próprio Merovingian):

| Role | O que faz | Onde mora |
|---|---|---|
| **Architect** | **opera** um tenant — workspace, banco/migrações, governança, tools | **propósito no grafo do tenant** |
| **the Source** | **constrói** o código-fonte do OS — build, providers, schema, MCPs, tooling | **upstream**, fora do grafo de qualquer tenant |

> **A linha: o Source constrói a máquina; o Architect opera a máquina para um tenant.**

Consequências diretas:
- `infra-os` → **`architect`** (propósito do tenant). Razão: *"operar o tenant —
  workspace, banco/migrações, governança, tools"*. É aqui que a **`governanca`
  mora**.
- o círculo incubador (hoje, este repo) = **incubador do Source** (gradua pro
  `merovingian-os`). **Sai do grafo de negócio do tenant**; constrói a máquina,
  não opera o tenant.
- **Grão da governança:** (a) um círculo arrumando o **próprio** contexto/KB
  (leve, amplo) vs (b) **evoluir o grafo do tenant** via migração
  (graph-altering → **só o Architect**). A Fase 3 (`0006`) é o grão (b).

## O bootstrap do Architect (o paradoxo e as 3 garantias)

`architect` deve ser **role padrão de todo tenant**. Mas "a governança garante
que o Architect existe" tem um **dead-man's-switch**: a governança é *rodada
pelo* Architect — se o role some, não sobra quem o recrie. Resolução em camadas:

1. **Nascimento — o template do tenant.** Todo tenant nasce de um **baseline**
   que o **Source** semeia: shell raiz + **Architect** + skill de governança +
   ambient (inbox). O role nunca está ausente em t=0.
2. **Manutenção — a governança auto-cura.** A skill de governança, a cada run,
   re-assere o invariante: *"existe um Architect bem-formado? Se não,
   propõe/recria."* Idempotente. (Estende o `bootstrap.md` que a skill já tem
   para círculo novo.)
3. **Backstop — o validador do Source.** O "lint do grafo" da Fase 3 (`0006`)
   sinaliza qualquer tenant sem Architect válido. Rede de segurança upstream.

> **O Source dá à luz; a governança mantém vivo; o validador vigia.**

## O conceito novo: template/baseline de tenant

Cai daqui um artefato que não existia: **o "mínimo viável de um tenant"** — o que
todo Merovingian nasce sabendo (shell + Architect + governança + inbox ambient).
É **propriedade do Source**, materializado por algo como `merovingian init
<tenant>`. **A Supernova é a primeira instância desse template, não um caso
especial.**

## Corte de propriedade (o que é tenant vs. produto)

- ~~As **decisões de arquitetura do tenant** ficam como **KB do Architect**.~~
  **Refinado pelo `0009`:** "decisão" são 4 coisas distintas — racional de mudança
  do grafo → **com o PR**; jurisprudência operacional → **tabela `decision` no
  Surreal** (o Primitivo `0003`); ADR de produto → Source; ADR durável do tenant
  (opcional, prosa) → tenant repo. Não é "tudo vira KB".
- O **design do produto Merovingian** (estes ADRs, o MODELO, o código) sobe pro
  repo do **Source** (`merovingian-os` / este círculo enquanto incubador).
- Implica revisitar o bucket `arquitetura` + o pai `fundacao` no fixture: o que é
  config/decisão **do tenant** vs. o que é **do produto**.

## Benefícios

- Mata a confusão de fundação que vinha vazando em vários pontos (governança sem
  casca, `infra-os` esquisito, "este círculo arquiteta a v2" vs. opera a Supernova).
- Dá à **governança** um dono claro (Architect) e um grão claro (graph-altering),
  destravando a Fase 3 como **o loop do Architect** movido por tooling do Source.
- Nomeia o **template de tenant** → o caminho para **multi-tenant** deixa de ser
  ad-hoc (todo tenant nasce do mesmo baseline).
- Reforça a separação de creds/escopo: o Architect opera *dentro* do tenant
  (escopado); o Source é upstream (não toca dado de tenant).

## Cuidados / em aberto

1. **Mesma pessoa, dois chapéus.** Hoje Luis é Source **e** Architect da Supernova.
   O corte é de **role/contexto** (chapéu, tools, escopo), não necessariamente de
   pessoa — mas o design tem que permitir separá-los (ex.: um Architect de tenant
   que não é dev do OS).
2. **Onde a governança "mora" para poder bootstrapar.** Se ela for gated atrás do
   plugin do Architect, o cold-start trava. Resolver via camada 1 (o baseline já
   traz o Architect + a governança ligados desde o nascimento).
3. **O `architect` é um propósito ou um círculo? — DECIDIDO (2026-06-30):**
   **propósito-role singular por padrão**, que a governança pode **decompor em
   sub-propósitos** (virar um pequeno círculo: governança / migrações / curadoria de
   tools) quando o tenant escala. A árvore sempre cresce — nasce mínimo, decompõe sob
   demanda. O template de tenant semeia um `architect`.
4. **Reescopar o bucket `arquitetura`** sem perder a trilha (parte vira KB do
   Architect, parte sobe pro Source).

## Consequências

- Renomear `infra-os` → `architect` no grafo (propósito, agente, plugin), com a
  `governanca` como sua skill.
- o círculo incubador reposicionado como **incubador do Source**, não propósito de
  negócio do tenant.
- Surge o item de roadmap **"template/baseline de tenant"** (`merovingian init`),
  propriedade do Source.
- A Fase 3 (`0006`) ganha dono (**Architect**) e o invariante de auto-cura do role.
