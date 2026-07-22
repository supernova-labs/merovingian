# ADR 0010 — Governança é tooling de repo, não propósito do grafo

**Status:** Consolidada
**Data:** 2026-07-01
**Origem:** sparring Luis × Claude (2026-07-01), ao desenhar o `merovingian init` (II.2)
**Relacionado:** refina `0007` (Architect vs. Source) e `0009` §3 (governança = skill no repo);
toca `0008` (permissionamento)

## Contexto

Ao planejar o que o `merovingian init` semeia, a ficha caiu: o grafo modelava um
propósito **`architect`** ("operar o tenant — workspace, banco, governança"). Mas
governança não é um propósito de domínio como `content`/`delivery` — é a camada **meta**
que *reconcilia o próprio grafo*. Modelá-la como um nó do grafo é auto-referência.

O argumento que fecha a questão: **o `deploy` conecta no Surreal como root — ele bypassa
as permissions do grafo.** O poder de governar nunca veio de uma aresta `responsible`; veio
de ter **a tool de deploy + credencial root do Surreal + acesso ao tenant repo**. Logo o
propósito `architect` **nunca concedeu a capacidade de governança** — era decorativo.

## Decisão

**1. Governança sai do grafo.** Dois tipos de "agente", distintos por origem e por auth:

| | Persona de domínio | Tooling de operador (governança) |
|---|---|---|
| Origem | **projetada do grafo** (`merovingian build`) | **instalada no tenant repo** (`merovingian init`) |
| Onde | `.claude/` gerado por persona | `.claude/agents/architect.*` + `.claude/skills/governance.*` |
| Acesso | escopado via aresta `responsible` | **git ACL do repo + credencial Surreal** |
| Exemplos | content, delivery | architect + skill de governança (deploy/PR) |

**2. Auth de governança = infra, não grafo.** Quem pode governar = quem tem push no tenant
repo + grant no Surreal. Isso é ACL de git + credencial de banco — coarse, no boundary de
infra. Não cabe numa aresta `responsible` (que fala de acesso a *buckets*, não de
"reconciliar o grafo inteiro"). Acountability coletiva (as chaves), rastreada out-of-band
(ex.: CODEOWNERS), não como dono-único holacrático.

**3. O tooling vem de marketplace (padrão harny).** Como o harny (o repo OSS carrega seu
`.claude-plugin/marketplace.json` + `plugin/`), o **Merovingian público carrega o plugin de
governança/architect**; o `merovingian init` **habilita** o plugin no `.claude/` do tenant
repo (referência a marketplace, não cópia de arquivos) — updates fluem pelo marketplace. É o
`0009` §3 estendido: não só a *skill* mora no repo, o *agente* também; e o propósito some.

**4. Ambient = só `journal` + `friction`.** `governance` **sai do ambient** — era lixo da
migração inicial. A capacidade de *reconciliar* é do architect (repo tooling), não uma skill
que toda persona de domínio carrega. (Levantar uma tensão continua sendo `friction` → o FFF.)

**5. Arquitetura sai do grafo como bucket.** O bucket de arquitetura do tenant (`kb-*-architecture`)
sai — decisões de arquitetura do tenant vivem como **markdown no tenant repo** (`0009` §Decisões
#4), não como um bucket okf de domínio. O repo do bucket `arquitetura` (vazio) é deletado.

## Por que (benefícios)

- **Remove a auto-referência:** o grafo é domínio puro; não contém quem o governa.
- **Permissão honesta:** governança já operava com root (fora do grafo). A decisão só remove a
  ficção — o `architect`-propósito não concedia nada.
- **Tooling idêntico entre tenants = plataforma, não dado.** Se é igual em todo tenant, mora no
  `.claude/` do repo (via marketplace), não no `graph.yaml`.
- **Console cai de graça:** o god-view renderiza o grafo (domínio) → para de mostrar governança,
  que é o certo.

## Consequências

- **O grafo do primeiro tenant** perde o propósito `architect`, o bucket `arquitetura` e o skill
  `governanca`-ambient — **feito (2026-07-01)** via `deploy apply` (−3 records, ~1 config); zero
  drift depois.
- **Fixture `acme`** (Source): `governance` sai do ambient/catálogo. (O `infra` segue como folha
  genérica de teste — rename pra algo claramente de domínio é cosmético, pode vir depois.)
- **`merovingian init` (II.2)** passa a semear o `.claude/` de governança (marketplace-ref) junto
  do `graph.yaml` baseline.
- **Refina `0007`:** o "architect = propósito singular decomponível" fica **superado nesse ponto** —
  architect não é propósito, é tooling de repo. (A distinção Architect-role vs Source segue de pé.)
- **Refina `0009` §3:** o agente de governança (não só a skill) mora no tenant repo; e o propósito
  correspondente é dropado do grafo.

## Em aberto (roadmap, não bloqueia)

- Forma exata do plugin de governança no marketplace público (agente + skill + tools de deploy).
- Se o `init` só cria arquivos ou também provisiona o db (roda `migrate`) — sparring da II.2.
