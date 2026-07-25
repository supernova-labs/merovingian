# ADR 0016 — O grafo também é dado: leitura estrutural por lineage

**Status:** Consolidada — implementação entregue em 2026-07-25 (mesmo dia do spike e do
design: PERMISSIONS de SELECT em todas as tabelas estruturais, campos derivados
`readers`/`ambient`, branch senha no `buildServiceFor`, paridade de manifest coberta na
golden — `test/lineage-read.test.ts`).
**Data:** 2026-07-25
**Origem:** sparring Luis × Claude no dia seguinte à ADR 0015. A issue #19 propunha subir o
build/auth service só para servir `/manifest` a membros (o `build` exigia credencial de
SISTEMA para ler a estrutura). O Luis desafiou a premissa: *"por que ele teria que ter acesso
ao mapa completo de purposes para fazer o build local?"* — e não precisava. O mapa completo
era artefato da implementação (provider lê tudo como root e o resolve filtra em memória),
não necessidade do domínio.
**Relacionado:** é a tese de `0002`/`0011` ("enforcement mora no banco") aplicada à PRÓPRIA
projeção; reusa a régua de alcance da `0014` (lineage denormalizado + dot-access) e completa
a `0015` (a senha da pessoa passa a cobrir TODO o ciclo: login, dados, MCPs e agora
build/graph). Decisão do Luis: **estrito desde o início** — membro só lê o que pode ler,
catálogos inclusive.

## Contexto

Com o SIGNIN (0015), `login`/`data`/MCPs rodavam com a senha da própria pessoa. Mas
`build`/`graph` conectavam como usuário de SISTEMA para ler as tabelas estruturais
(fechadas a record users) — então onboardar um membro exigia ou entregar credencial de
sistema (vaza tudo: system user ignora PERMISSIONS) ou subir o service (#19) só pra isso.

O manifest de uma pessoa consome exatamente a fatia dela: as próprias atribuições, a
subárvore alcançável, os buckets/skills/tools/agents pendurados nela, o ambient. Se o banco
souber entregar essa fatia, o build roda COMO a pessoa.

## Decisão

**As tabelas estruturais ganham FOR select escopado pela régua de lineage** (a mesma do
inbox/0014); escrita estrutural segue NONE para record users (só root/apply). O
`buildServiceFor` ganha o branch senha: com `MEROVINGIAN_PASS`, o provider lê sobre a
conexão da própria pessoa e o banco entrega a fatia — `build`/`graph` sem credencial de
sistema na máquina.

| Tabela | FOR select |
|---|---|
| purpose | atribuído é ancestral-ou-self: `$auth->responsible->purpose CONTAINSANY lineage` |
| bucket | fatia owns OU reads: `... CONTAINSANY array::flatten(readers.lineage)` |
| tool / skill / agent | estrito: referenciado por purpose da fatia (`readers` derivado); skill/marketplace ambient = legível por qualquer `$auth` (vai em todo workspace) |
| marketplace | estrito: a fatia usa um plugin (skill ou agent) dele |
| decision_domain | dono ao alcance: `owner.lineage` |
| responsible / user | só as próprias arestas (`in = $auth`) / o próprio record (`id = $auth`) |
| config | qualquer autenticado (singleton global do tenant) |

`readers` (e a flag `ambient`) são **derivados no apply** (`records.ts`, irmãos do
`lineage`): write-only — fora do `Definition` lido de volta e fora do diff do plan, logo
**zero drift fantasma** no `deploy plan`.

## O achado que fixa o mecanismo

Empiricamente (spike 2026-07-25, SurrealDB 3.x): **subquery dentro de PERMISSIONS não roda
com as permissões do caller** — vê MAIS do que o caller deveria (cleo enxergou 7 buckets em
vez de 3 na variante com subquery). A nota antiga em `data.surql` afirmava o oposto. O
mecanismo confiável é o padrão da casa: **denormalizar + record-pointer dot-access** — agora
registrado como regra: nunca subquery em permission.

## Invariante de teste (o que segura isso de pé)

O `resolve()` **degrada em silêncio** quando um item do catálogo não resolve (skill some,
tool vira stub) — uma permission errada não quebraria o build, só entregaria menos, mudo.
Por isso a régua da golden é **paridade byte-a-byte**: o manifest computado sobre a conexão
da pessoa (cleo = member escopado; ada = owner da raiz) tem que ser IDÊNTICO ao computado
pelo provider root, mais leak-checks exatos por tabela. Qualquer regressão de permission
quebra a paridade.

## Consequências

- Onboarding completo só com senha: `passwd` → `.env` → `login`/`build`/`graph`/MCPs.
  Nenhuma credencial de sistema em máquina de membro, nunca.
- **#19 reposicionada**: o service deixa de ser pré-requisito de onboarding; fica para o
  que só ele dá (identidade GitHub, esconder o banco da rede das máquinas).
- Metadado estrutural da fatia é visível por design (nomes de buckets/tools que a fatia
  referencia) — dado de DOMÍNIO segue nas PERMISSIONS de linha da 0011 (visível ≠ legível:
  cleo vê o bucket `clients` existir; as linhas continuam `account:north`).
- A visibilidade estrutural agora é jurisdição do banco — mudanças nela passam por
  `schema.surql` + esta ADR, não por filtro no código.
