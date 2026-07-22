# ADR 0004 — Topologia de círculos e build-time

**Status:** Consolidada (2026-06-30) — mono-repo / launch≠build / governança-PR; provado
no launch. Refinada por `0009` (split plataforma↔tenant).
**Data:** 2026-06-24
**Origem:** sparring de fundação (2026-06-24)
**Relacionado:** `0001-modelo-de-uso-deploy`,
`0002-permissionamento-e-dominio`, `context/fundacao/primitivos.md`

## Contexto

Tirando o contexto do repo (ADR 0002 + experimento de Contexto), o **círculo
fica leve**: é basicamente *definição de agente* — propósito, decisões que
cabem a ele, skills e tools. O círculo de eventos, sem contexto, é "um
CLAUDE.md + um MCP + um script".

Isso reabre a pergunta de topologia que estava em aberto no primitivo de
Propósito: **um círculo com subagentes vs. círculos separados?**

## A virada de topologia

- **Círculo = propósito; subagente = subpropósito** (já bem resolvido). Se o
  círculo é leve, o que impede ele de ser **um subagente do agente
  Supernova-pai**?
- **Pai como orquestrador:** opero o **Supernova-pai** e ele despacha
  ("fecha meu dia": lê Fireflies, agenda, planilha, dispara proposta…). Mas
  posso **chamar o subagente direto** (`supernova customers`) pra não pagar o
  **pedágio da delegação** quando não preciso que conversem.
- **Permissão** segue o token do usuário (ADR 0002): o pai herda os acessos de
  quem opera; subagentes idem.

## Execução: launch ≠ build *(refinado 2026-06-24)*

**Correção (sparring + verificação do Claude Agent SDK):** não há
build dinâmico. Os artefatos (subagents, skills, CLAUDE.md, .mcp.json) já vivem
no repo, produzidos em **tempo de governança** via PR. `git pull` = atualizado.

- `claude` na pasta (ou `query({ cwd, settingSources: ["project"] })`) =
  Supernova-mãe, com todos os subagents/skills nativos.
- `merovingian launch supernova customers` = wrapper fino que **promove** o
  propósito `customers` à thread principal (systemPrompt/allowedTools/model/
  mcpServers/skills via SDK), irmãos como subagents. (O SDK não deixa "entrar"
  direto num subagent; promover é trivial.)
- O **grafo de propósitos vive no front-matter** (`parent:` + arestas de
  composição); projetado por `merovingian graph`. As arestas são funcionais (=
  constraints do SDK no launch), não só metadado.
- A única "compilação" é a **governança** (governance-time): valida o grafo e
  muta-o via PR, disparada por frictions. A mutação-assinatura é *promover skill
  a agente* (verbo ganhando domínio).

→ Sem contexto no repo + launch≠build, a razão de clonar some; o "build" do
Merovingian encolhe para **o wrapper de launch + a governança**. Git fica, no
máximo, para a evolução do próprio grafo (via PR de governança).

## Opções

1. **v1 atual** — cada círculo é um repo, cada um clona. ❌ não escala em time.
2. **Círculo-único com subagentes + build-time** — um Supernova com N
   subagentes, montado por CLI a partir de manifesto. ✅ leve, sempre
   atualizado, chamada direta ao subagente. ⚠️ depende de contexto fora do
   repo e do modelo de permissão por token.
3. **Híbrido** — build-time para o uso comum; clone local só para trabalho
   pesado (ex.: Gil codando o dia inteiro), como o Omnigent permite (runner
   local vs. servidor — ver `0001`).

## Inclinação atual (não decidido)

Caminhar para a **opção 2/3**: **mono-repo Supernova** com propósitos lógicos
(subagents/skills no `.claude/`), **instanciados no launch** (SDK) — o repo é o
"build" de governança —, com escape para local quando o trabalho exige. É
**tema do experimento de Topologia** — validar antes de fechar.

## Perguntas em aberto

- Subagente do Claude dá conta do que hoje é um círculo (limites de
  ferramentas, contexto, autonomia)?
- O manifesto de acesso vive onde? (mesma fonte do permissionamento — ADR 0002)
- Como o build-time convive com o modelo de deploy do `0001` (runner local vs.
  servidor)?
- Comunicação entre subagentes vs. entre círculos: o pedágio da delegação vale
  a pena quando precisam conversar de verdade?

## Consequências (se confirmada)

- Reduz drasticamente a fricção de manter N círculos clonados e sincronizados.
- Acopla topologia a contexto e permissionamento — os três experimentos se
  amarram (Contexto destrava Topologia).
