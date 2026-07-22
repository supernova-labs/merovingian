# ADR 0014 — Frictions com escopo e governança local: subsidiariedade no loop FFF

**Status:** Consolidada — implementação entregue em 2026-07-10 (mesmo dia do design: schema +
permissions por lineage, apply re-scope na deleção de purpose, MCP `pending`/`resolve`/`rescope`,
CLI `--rescope`, console com scope, skills friction/pending, drain com triagem — plugin 0.4.0).
Resolução do spike incorporada: a permission de UPDATE é checada também contra a linha NOVA —
membro re-escopa só dentro do próprio alcance; escalada além do alcance acontece no CREATE
(scope livre no nascimento) ou via root. `at` ficou 100% server-stamped (nem root retro-data).
**Data:** 2026-07-10
**Origem:** sparring Luis × Claude (2026-07-10), dias depois da primeira semana de uso real
dos primeiros tenants reais — a colheita de frictions operacionais mostrou o loop pela
metade (ver Contexto).
**Relacionado:** completa o loop FFF do `0010`/II.3 (inbox); reusa o mecanismo de permission
por lineage do `0013` (`decision_log`); mantém os invariantes de enforcement de `0002`/`0011`
(mount ≠ authority, o banco decide). O campo `origin` (2026-07-08) é o irmão de telemetria
deste `scope`.

## Contexto

O caminho **aferente** do loop FFF está completo: qualquer agente, em qualquer workspace,
escreve friction → root drena (`merovingian inbox <ns>`) → a governança decide. O caminho
**eferente** não existe:

- O drain de hoje só produz UM tipo de resolução: mudança estrutural (graph, library,
  decisions), que o architect aplica ele mesmo no tenant repo.
- Mas a colheita real (2026-07-09/10) é majoritariamente **operacional do purpose**:
  "encerrar 3 eventos vencidos em `upcoming/`", "marcar artigos `-draft` publicados no KB",
  "mover deals para o repo comercial". A governança enxerga, mas não tem braço — resolver
  isso exige os mounts e o contexto do workspace do purpose.
- O purpose tem braço, mas é **cego por design**: `inbox` é `FOR select NONE` — a persona
  de eventos não lê nem a friction que ela mesma escreveu ontem.
- Root não tem como atribuir trabalho aos filhos, e a governança não roda na pasta local.

A pergunta filosófica tinha duas respostas com almas diferentes: **subsidiariedade**
(cada purpose drena o que é seu — mas a chave seria o `origin` auto-declarado, e telemetria
não pode virar autorização) ou **triagem central com despacho** (root vê tudo e atribui —
mas pedia um primitivo novo de "task"). A decisão é a síntese das duas, corrigidas:
a autorização vem da **permissão real do usuário** (lineage via JWT, não auto-declaração),
e **a friction É a task** — o despacho é um campo, não uma tabela.

## Decisão

**1. Dois campos irmãos, propósitos distintos.**

| | `origin` (2026-07-08) | `scope` (este ADR) |
|---|---|---|
| Pergunta | quem escreveu? | de quem é o problema? |
| Natureza | telemetria auto-declarada | roteamento/atribuição |
| Tipo | `option<string>` (nome livre) | `option<record<purpose>>` |
| Mutável? | imutável pós-create | re-escopável (triagem, escalada, fishing) |
| Autoriza algo? | **nunca** | é a chave da permission de leitura/resolução |

**2. O escritor escopa no nascimento.** A skill/MCP de friction instrui: se o agente acha
que o próprio purpose resolve, escopa para si; se acha que é de um propósito superior,
escopa para o ancestral; **se não escopar, é do root** (`scope = NONE` = fila da governança
principal). Auto-declaração errada tem custo mínimo: a leitura é filtrada pela permissão
real do usuário — no pior caso ele vê o que já era dele.

**3. Leitura e resolução por lineage do scope (o banco decide).** O mecanismo é o provado
no `decision_log` (`0013`):

```sql
FOR select WHERE $auth AND scope IS NOT NONE
  AND $auth->responsible->purpose CONTAINSANY scope.lineage
```

Quem está no purpose do scope — ou num ancestral dele — lê. Operações lê as frictions de
financeiro e jurídico por ser ancestral; vendas não aparece na query de quem não alcança
vendas. `scope = NONE` (fila do root) não é legível por ninguém escopado — como hoje.

**4. Update abre no mesmo alcance, com conteúdo imutável.** O truque `VALUE $before OR ...`
(o mesmo do `user`) generaliza: `user`, `kind`, `text`, `origin`, `at` ficam imutáveis
pós-create. O `FOR update` abre para o alcance do scope, e só três coisas mudam de fato:

- `drained` — **um carimbo só**: "recebeu destino", seja pela governança root ou local.
- `resolved_through` — `option<string>`, texto livre com o rastro da resolução: link de PR,
  commit, doc, "encerrado via /encerrar-evento". Traceability do problema à solução.
- `scope` — re-atribuição: o root tria ("não sou eu que resolvo → operações") e pesca
  ("isso parece local mas é sistêmico → root"); o local escala para um ancestral.

**5. Governança local é skill de workspace, não drain pesado.** Uma skill leve (template da
library) que roda NA PASTA LOCAL: lê as frictions pendentes do alcance (via tool nova do
MCP inbox — o banco filtra pelo token), resolve o que é operacional com os mounts que já
tem, carimba `drained` + `resolved_through`, journala o que fez. O que for estrutural ela
NÃO resolve — escala o scope para cima. A hierarquia de governanças espelha a árvore de
purposes; "a governança só acontece na raiz" vira o caso degenerado de uma árvore que ainda
não delegou nada.

**6. O drain principal ganha triagem e relatório.** A passada root continua vendo TUDO
(root bypassa permissions — a visão sinóptica é metade do valor do drain: três frictions
"KB desatualizado" em purposes diferentes são UMA tensão sistêmica). Passos novos:
resolve o que é global; re-escopa o que é local ("não sou eu"); e reporta como warning —
"N frictions aguardam governança local em eventos e comercial; recomendo que esses times
rodem as suas" — sem transformar warning em obrigação de agir.

**7. Superfícies.**

- **MCP inbox** ganha: `pending` (lista frictions não-drenadas no alcance do token) e
  `resolve` (carimba `drained` + `resolved_through`; re-escopar também passa por aqui).
  A tool `friction` ganha o parâmetro `scope`.
- **CLI** `merovingian inbox <ns>`: render mostra scope; flags de triagem para o drain
  root (re-scope por id).
- **Console**: chip de scope nos cards; contagem de pendências por purpose (o warning do
  §6 em forma de painel).

**8. Journals ficam fora da subsidiariedade.** `scope` existe na tabela (é uma só), mas o
journal é narrativa para a governança principal — nasce sem scope (root) por default. A
leitura local (`pending`) lista **frictions**.

## Alternativas consideradas

- **Tabela `task` (despacho como primitivo novo)** — rejeitada: a friction já É a unidade
  de trabalho; uma segunda tabela duplicaria o registro e criaria burocracia de
  sincronização. Se um dia existir despacho SEM friction por trás, a ideia volta.
- **Autorização por `origin`** — rejeitada: telemetria auto-declarada não pode virar chave
  de permissão (mount ≠ authority). O `scope` também é declarado, mas quem FILTRA a
  leitura é o lineage real do usuário no JWT.
- **Governança local com root creds** — rejeitada: quebraria a topologia (root creds nunca
  descem ao workspace); o MCP com token escopado + PERMISSIONS é exatamente o desenho
  existente de `surreal-data`/`decisions`.

## No dia a dia do workspace (materialização)

- **Início de sessão**: o CLAUDE.md emitido ganha a afordância — "seu escopo tem N
  frictions pendentes (tool `pending` do inbox)"; o shell/route pode checar ao abrir.
- **friction skill**: passo novo de escopo (para si / ancestral / vazio=root) com o
  critério "quem tem os mounts para resolver isto?".
- **Skill nova de governança local** (library template): pending → resolver operacional →
  carimbar com rastro → journalar → escalar o resto.
- **Drain do plugin** (root): triagem/re-scope/warning (§6).
- **Emit/resolve**: o manifest passa a saber os purposes visíveis para montar a afordância
  (já sabe — mesma união usada pelos decision domains).

## Implementação (notas para o plano)

- `inbox` ganha `scope option<record<purpose>>` + `resolved_through option<string>`;
  permissions novas (select/update por lineage; create como hoje); `VALUE $before`-guard
  nos campos imutáveis. `ensureDataSchema` re-aplica.
- Deleção de purpose com frictions escopadas: re-scope automático para o parent
  (gravidade, `0008`) — não bloquear o apply por runtime data.
- Canário de upgrade: a permission usa dot-access em record link (`scope.lineage`) — o
  mesmo comportamento pinado nos testes do `0013`.
- Testes: matriz de visibilidade por lineage (ada/ben/cleo), imutabilidade pós-create,
  resolve local vs root, re-scope/escalada, journal invisível ao `pending`.
