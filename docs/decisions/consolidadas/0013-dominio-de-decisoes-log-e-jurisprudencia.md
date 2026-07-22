# ADR 0013 — O domínio de decisões: log em voo, record ratificado, jurisprudência como mecanismo

**Status:** Consolidada — implementação entregue em 2026-07-03 (3 tabelas engine + records
git→deploy + MCP `decisions` ambient + CLI `merovingian decisions` + skill drain com promoção,
plugin 0.3.0; resoluções abaixo)
**Data:** 2026-07-03
**Origem:** sparring Luis × Claude (2026-07-03), no dia seguinte à primeira passada de
governança real — as decisões tomadas na passada ("conteúdo canônico é o do plugin",
"connectors saem do registry") viveram só na conversa e no commit message.
**Relacionado:** materializa o Primitivo "Decisões" (`0003` → `0009` §tabela decision);
compõe três padrões existentes: inbox (`0010`/II.3), library (`0012`), enforcement (`0002`/`0011`)

## Contexto

O terceiro primitivo do produto é o único sem storage. A indústria tem as duas metades,
separadas: o **corpus oficial** (prática de ADR — Nygard 2011: records versionados em git,
lifecycle `proposed → accepted → superseded`, accepted imutável; Zimmermann generaliza para
*Any* Decision Record — qualquer domínio, não só arquitetura) e o **log de voo** (RAID logs
de PM: decisões ad-hoc registradas no fluxo, com quem/quando/porquê). O que a indústria
NÃO formalizou é a **ponte**: o rito que olha o log e pergunta "o que aqui virou
jurisprudência?". Essa ponte é exatamente o que a nossa governança já faz com fricções.

O achado do sparring: o domínio de decisões inteiro é **composição de três padrões que o
motor já tem** — nada de maquinário novo, um campo de link novo.

## Decisão

**1. Dois objetos, dois donos, duas mecânicas.**

| | `decision_log` (em voo) | `decision` (record oficial) |
|---|---|---|
| O que é | decisão tomada no trabalho, ainda não oficial — observabilidade + candidata a jurisprudência | decisão convergida e ratificada — jurisprudência que vincula |
| Quem escreve | o membro, via MCP `register-decision` (identidade autenticada, carimbo server-side — padrão inbox) | só a reconciliação: autorado em `decisions/` no tenant repo, ratificado por commit/PR de governança, `deploy` persiste o corpo no db (padrão library) |
| Quem lê | **purpose-scoped**: membros no alcance (lineage) do purpose dono do domínio | tenant-wide autenticado (v1) |
| Vive | db (runtime data) | git (verdade) → db (serving) |

Tabelas separadas por necessidade estrutural: membros escrevem logs, só o deploy escreve
records — misturar linhas de runtime com desired-state numa tabela quebraria o invariante
que sustenta a atomicidade do apply ("apply nunca toca tabela de runtime"). O inbox
permanece o que é (`select NONE`, matéria crua da governança); o log é irmão legível.

**2. `decides:` ganha significado: domínios de decisão são os buckets das decisões.**
`decides: [pricing, discount-policy]` no purpose declara os domínios que ele possui.
Mesmas regras da 0011: um domínio pertence a UM purpose (validateGraph); o acesso de
leitura do log anda pela lineage do dono. `decisionType` é obrigatório no
`register-decision` e precisa casar com um domínio declarado. O teste de propriedade
passa: segundo tenant declara seus domínios e o motor os serve.

**3. Distribuição é db + MCP, nunca arquivo no workspace.** Decisões não materializam no
build (diferente de skills): consulta é live via MCP `decisions` (get/search), sem
depender de rebuild, sem cópias em disco de conteúdo sensível. O MCP é **veículo** — passa
o token, valida `decisionType` na borda para UX; **quem decide é o banco** (PERMISSIONS
por `$auth` × lineage — mount ≠ authority, como tudo). O schema reserva o campo de
embedding (`option<array<float>>`) para o slice futuro de busca vetorial (SurrealDB 3,
HNSW): "decisões relacionadas a precificação no setor automotivo".

**4. Autoria do record é git, e isso não é cerimônia extra.** Motivos, em ordem:
(a) **o invariante da reconciliação** — o tenant repo reconstrói o tenant; records
só-no-banco seriam o único ativo não-recuperável do git, e logo a constituição da empresa;
(b) **imutabilidade com testemunha** — accepted é imutável, mudou = supersede; git não
consegue mentir sobre histórico, row editada por root some sem rastro;
(c) **atomicidade** — a política que nasce junto de mudança no graph é UM commit.
Na experiência do operador é um gesto só: a passada de drain já termina editando arquivos
+ `deploy apply` + commit — o record pega carona. Membro nunca vê os arquivos (tenant repo
é ACL de governança); a visibilidade deles é exclusivamente a tabela.

**5. O link de lastro: `records: option<array<record<decision>>>` no log.** Uma decisão em
voo pode citar os records que aplicou ("apliquei a 0003 no enquadramento da 0001"). Isso é
**telemetria de jurisprudência**: record com muitas aplicações = load-bearing (cuidado ao
superseder); sem nenhuma = letra morta (candidato a revogar); com aplicações "esticadas" =
pressão de revisão. O drain deixa de garimpar e passa a colher.

**6. A promoção é a passada de drain.** Logs acumulados → conversa (uma tensão por vez) →
o que convergir vira arquivo em `decisions/<dominio>/NNNN-slug.md` no PR da governança →
deploy projeta. Cada re-aplicação confirmada de um log pode registrar novo log lastreado —
três logs dizendo a mesma coisa é candidatura gritante a record.

**7. Postura epistêmica declarada (honesty note).** O workspace narra: *records são
universais (vinculam); logs são construção ativa de jurisprudência e exigem confirmação
humana antes de aplicados*. Isso vive em prompt (CLAUDE.md/skill) = **generation, não
enforcement** — um agente ingênuo pode tratar log como norma, e o banco só controla QUEM
lê, não COMO interpreta. Mesma classe do mount ≠ authority; o guard real é a confirmação
humana + o scope de leitura.

**8. Reconciliação total, com duas guardas próprias.** Records entram no `deploy plan`
como a library (conteúdo = hash por arquivo; edição acidental em massa aparece ANTES de
convergir; git é a rede embaixo). E: (a) record `accepted` com conteúdo alterado → o plan
avisa "imutável; supersede em vez de editar"; (b) **referrer-check no delete** —
`decision_log.records → decision` entra na tabela de referrers de runtime (como
`inbox.user → user`): record citado por logs não deleta silenciosamente, o apply aborta
atômico.

## Por que

- **Composição, não invenção**: log = padrão inbox, record = padrão library, consulta =
  padrão surreal-data, scope = padrão lineage da 0011. Um campo de link novo.
- **A ponte que a indústria não tem**: promoção log→record como rito mecanizado da
  governança, com telemetria de aplicação orientando a curadoria.
- **O Source já vive esse ciclo** (`docs/decisions/` com fermentação/consolidadas): o
  produto oferece aos tenants o que a gente já faz na mão.

## Consequências

- Schema do motor: tabelas `decision_log` e `decision` (engine, `data.surql`/gerador —
  a decidir na implementação onde as PERMISSIONS por lineage são geradas).
- Graph: `decides:` validado (domínio único, tenant-wide); baseline do `init` pode nascer
  com `decides: []` documentado.
- MCP novo `decisions` (consulta) + tool `register-decision` (provavelmente no MCP inbox
  existente ou irmão — decidir na implementação).
- Drain skill ganha a etapa de promoção; architect ganha a narrativa epistêmica.
- `reference/graph-yaml.md`, `concepts/enforcement.md`, `concepts/the-graph.md` ganham o
  domínio.

## Em aberto (implementação — nada bloqueia)

- Formato do record em disco (frontmatter: id, domínio, status, supersedes, data).
- Shape exato das tools (`register-decision` args; `decisions` get/search).
- Pipeline de embedding (quando; qual modelo; deploy-time ou db-side).
- Write-policy fina do log (create validado contra domínio declarado?).
- Como o CLAUDE.md emitido narra o domínio (a postura epistêmica, §7).

### Resoluções da implementação (2026-07-03)

- **Formato do record**: frontmatter `status`/`title`/`date?`/`supersedes?` + corpo markdown
  verbatim; a pasta é o domínio, id = `<dominio>/<NNNN-slug>`. `validateGraph` exige domínio
  declarado em `decides:` e `supersedes` resolvível; o plan avisa quando um record `accepted`
  tem conteúdo editado ("supersede it instead of editing").
- **Write-policy do log**: **create = select** ("você loga onde opera"). O retorno de um CREATE
  é filtrado pela permissão de select — create mais frouxo escreveria linha que o autor não lê
  de volta, e `[]` ficaria ambíguo ("gravou-mas-não-vê" × bloqueado). Com as cláusulas iguais,
  `[]` sempre = bloqueado-nada-escrito; o MCP checa o resultado e reporta o no-op silencioso
  como erro legível.
- **Lookup `decision_domain`** (domínio → purpose dono, escrito e reconciliado pelo apply —
  autorização viva, domínio removido = row deletada): necessário porque subquery-SCAN dentro
  de PERMISSIONS roda com as permissões do CALLER (`purpose` fechado → vazio), enquanto
  dot-access via record pointer ignora as perms da tabela alvo — o mesmo mecanismo do
  `bucket:⟨id⟩.owner.lineage` da 0011. Comportamento observado, não contrato documentado:
  `test/decision-log.test.ts` pina como canário de upgrade do Surreal.
- **Shape das tools**: MCP `decisions` separado (ambient, todo workspace com access) —
  `register-decision({decisionType, text, records?})` com `decisionType` obrigatório, validado
  na borda contra `MEROVINGIAN_DECISION_DOMAINS` (afordância; o banco decide);
  `search-decisions({decisionType, query?, status?, limit?})`; `get-decision({id})`.
- **Superfície CLI separada**: `merovingian decisions <ns> [--all] [--drain [--ids]]`, irmã do
  inbox — render mostra domínio, autor e os records aplicados (`applies: decision:…`, a
  telemetria de jurisprudência).
- **Postura epistêmica**: seção "## Decisions" no CLAUDE.md emitido — *records are law; logs
  are jurisprudence under construction* — nunca aplicar um log sem confirmação humana.
- **Embedding**: segue reservado (`option<array<float>>`, nunca escrito) — o slice de busca
  vetorial foi para o roadmap (🧊).
