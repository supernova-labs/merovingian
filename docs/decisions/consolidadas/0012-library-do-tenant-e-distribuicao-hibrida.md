# ADR 0012 — Conteúdo comportamental mora na library do tenant; marketplace vira canal de externo

**Status:** Consolidada (implementação = roadmap)
**Data:** 2026-07-02
**Origem:** tensão levantada pelo Luis (2026-07-02) — granularidade de ACL, governança em N
repos, vazamento por máquina, lock-in de ecossistema
**Relacionado:** refina `0009` §3 e `0010` (o canal de *produto* fica; o de *conteúdo do tenant*
muda); aplica a régua do `0011`; resolve o bootstrap de plugins (sparring 2026-07-02, supersede
a "opção A")

## Contexto

Skills e agents de domínio (os *prompts* — `create-content`, `propostas`, …) são distribuídos
hoje via marketplaces Claude Code (`<tenant>-plugins`). Essa decisão (`0009` §3) foi tomada
**antes de existir tenant repo**. Com o tenant repo de pé, o modelo mostra quatro rachaduras:

1. **Granularidade = ACL de repo.** Para o Claude Code de um member instalar *seu* plugin, ele
   precisa de read no repo privado do marketplace **inteiro** → vê os plugins de todos os
   propósitos. A fronteira de acesso mora no gh, não na projeção — contradiz o resto do produto.
2. **Governança sem atomicidade.** Mudar um propósito (tenant repo) e o prompt da skill dele
   (marketplace repo) são dois PRs em dois repos. O diff-como-registro (`0009`) cobre só metade
   da mudança.
3. **Vazamento por máquina.** O gate de marketplace é por máquina; conteúdo instalado transborda
   o workspace que o justificou.
4. **Bootstrap e lock-in.** Pelo teste de propriedade do `0011` ("segundo tenant, zero código"):
   todo tenant novo é forçado a criar/manter repos de marketplace só para ter conteúdo próprio
   (o baseline do `init` nascia quebrado por isso). E marketplace é mecanismo proprietário do
   ecossistema Claude — outros harnesses ficam sem caminho.

## Decisão

**1. A library do tenant.** Conteúdo comportamental first-party mora no tenant repo, por
convenção:

```
<tenant-repo>/
  graph.yaml
  library/
    agents/<nome>.md
    skills/<nome>/SKILL.md
```

O catálogo do grafo resolve skills/agents locais **por convenção de nome** (nome → pasta na
library); a sintaxe exata do ref local × externo no yaml é detalhe de implementação.

**2. O build materializa seletivamente.** A projeção copia para o workspace
(`.claude/agents/`, `.claude/skills/`) **só o que o manifest daquela pessoa carrega**; ambient
vai em todo workspace. A fronteira de acesso volta a ser a projeção: o member recebe sua fatia
materializada e **nunca precisa de read no repo-fonte**. Propagação de update = rebuild (o loop
que já existe) — grafo e conteúdo versionam **juntos, atomicamente**, no mesmo repo e no mesmo
PR.

**3. Híbrido: marketplace vira o canal de *externo*.** Dois canais, por natureza do conteúdo:

| | Library (tenant repo) | Marketplace |
|---|---|---|
| O quê | conteúdo comportamental do tenant (prompts de domínio, ambient) | tooling de produto (`governance@merovingian`, `0010`) + plugins de terceiros/comunidade |
| Propriedade | do tenant — evolui por governança, PR a PR | do publisher — updates fluem pelo canal |
| Acesso | projeção (build entrega a fatia) | ACL do repo do marketplace |

O marketplace `<tenant>-plugins` **obrigatório morre**; `marketplaces:` no grafo vira opcional
(só para externos). O baseline do `init` para de referenciar marketplace inventado.

**4. O `init` semeia a library (cópia, não referência).** `journal`, `friction` e `route`
nascem como **cópias** dos templates do Source dentro da library — o tenant altera como quiser.
Simetria com o `0011`: o *prompt* é dado do tenant; o *mecanismo* (tabela `inbox`, MCP) é motor.
Isso supersede a "opção A" (plugins de sistema no marketplace do Source): o tenant nasce
**auto-contido**, sem dependência de runtime em repo externo algum.

**5. Refresh de template é comando de autoria, audit-first.** Atualizar os seeds para uma versão
nova do Source é **manual e explícito**, no padrão da casa:

```
merovingian library update           # diff: library do tenant × templates atuais do Source
merovingian library update --yes     # aplica o overwrite
```

Roda no tenant repo (autoria), nunca no build (projeção). O git do tenant é a rede de
segurança: o overwrite chega como working-tree diff revisável/revertível.

## Por que

- **O teste de propriedade passa:** tenant auto-contido, zero repos externos obrigatórios; o
  bootstrap de plugins morre na raiz.
- **Least-privilege real:** a fronteira volta pra projeção (como buckets/dados); member nunca
  enxerga o conteúdo dos outros propósitos.
- **Governança atômica:** um PR muda propósito + prompt + assignment num diff só — o FFF drena
  para um lugar único.
- **Onboarding sem gate:** some a aprovação por-máquina do marketplace do tenant (fricção medida
  no E2E de 2026-07-02). Fica só a do produto (governance), uma vez.
- **Portabilidade de harness:** a library é markdown neutro; o `emit` é a costura de adapter —
  hoje projeta pra Claude Code, amanhã pra outro harness, sem tocar o conteúdo.

## Contras assumidos

- **Perde autoUpdate para conteúdo do tenant** — aceito como feature: update sem rebuild
  entregaria prompt novo pra grafo velho; a coerência versionada vale mais. Staleness detection
  (hash no `build.json`) = roadmap; rebuild manual basta por ora.
- **Compartilhar conteúdo entre tenants duplica** — se é compartilhado, é externo → canal
  marketplace. A fronteira é essa.
- **Retrabalho de migração:** o conteúdo do marketplace v2 do primeiro tenant (11 plugins) migra pra
  sua library — é markdown, custo moderado.
- **Paridade de plugin:** skills/agents = pastas nativas do projeto; MCPs o `emit` já escreve;
  hooks via settings se precisar. Superfície a cobrir na implementação.

## Consequências

- **Refina `0009` §3 / `0010`:** o canal de marketplace **fica** para tooling de produto e
  terceiros; o conteúdo de domínio do tenant sai dele.
- **`init`:** baseline sem marketplace inventado (o default `--plugins` de 2026-07-02 vira
  desnecessário no caminho comum); semeia `library/` com os três seeds.
- **Grafo:** `marketplaces:`/`defaultMarketplace` viram opcionais; catálogo ganha resolução
  local por convenção.
- **Loader/emit/build:** resolução local + materialização seletiva + (futuro) `library update`.
- **Primeiro tenant:** conteúdo migra do marketplace legado para a library do seu tenant repo
  via governança, quando a implementação chegar.

## Em aberto (implementação — nada bloqueia)

- Sintaxe do ref local × `plugin@marketplace` no catálogo do yaml.
- Marcador de proveniência nos seeds (template + versão/hash) para o diff do `library update`
  distinguir "evoluído pelo tenant" de "desatualizado".
- Nome/forma final do comando (`library update`?) e granularidade do overwrite (por arquivo?).
- Detecção de staleness do workspace (hash da library no `build.json`) — diferido.
