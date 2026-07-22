# ADR 0001 — Modelo de uso/deploy da v2

**Status:** Superseded por `0004`/`0005`/`0009` (2026-06-30) — semente do modelo de
deploy (padrão Omnigent); as decisões migraram pra esses ADRs. Mantida como history.
**Data:** 2026-06-24
**Relacionado:** `context/fundacao/visao-v2.md` (deploy híbrido),
`context/pesquisa/omnigent.md`

## Contexto

A visão da v2 exige um **deploy híbrido** com dois inegociáveis (do briefing
em áudio): (a) trabalhar em **arquivos locais de rascunho** no terminal, e
(b) cada colaborador usando a **própria assinatura/chave** de LLM.

A pesquisa do Omnigent (meta-harness da Databricks) trouxe um padrão de
arquitetura que resolve exatamente isso e revelou uma restrição estrutural
que vale como ponto de partida — não como decisão fechada.

## A descoberta que ancora a decisão

No Omnigent, **o servidor é só coordenador** (UI, persistência de metadados,
auth); nenhum código de agente roda nele. O **Runner** — lançado por cada
pessoa na própria máquina — executa o agente, as tools e segura os arquivos.
Verificado em código:

- O servidor **nunca** guarda o conteúdo do working tree; a UI é um **proxy
  ao vivo** ao runner.
- **Não existe** "runner local + arquivos no servidor como fonte de verdade".
- Edição pela UI é possível, mas escreve direto no disco do runner do dono.

**Restrição central:** **arquivos e chave seguem o runner — inseparáveis.**
Só o acesso de visualização/edição é destacável (proxy). Colaboração real é
por **fork** (runner próprio, cópia própria, chave própria), não por
diretório compartilhado.

## Opções consideradas

1. **Servidor-coordenador + runner-por-pessoa + fork** (padrão Omnigent).
   - ✅ Satisfaz (a) e (b): arquivos locais + assinatura individual.
   - ✅ Servidor dá visibilidade/persistência/mobile sem segurar chave.
   - ⚠️ Não há working tree compartilhado de verdade; colaboração = fork.
2. **Tudo centralizado no servidor/sandbox.**
   - ✅ Colaboração simples, ambiente uniforme.
   - ❌ Quebra (a) e (b): arquivos remotos efêmeros + chave compartilhada,
     custo de API explode.
3. **Construir um modelo próprio de workspace compartilhado** (vários runners
   no mesmo working tree, cada um com a própria chave).
   - ✅ Seria o ideal teórico do "mix".
   - ❌ Ninguém implementa; é pesquisa/engenharia nova e cara. Possível
     escopo futuro, não fundação.

## Inclinação atual (não decidido)

Adotar o padrão da **opção 1** como modelo de uso/deploy de referência da v2:
**servidor-coordenador + runner-por-pessoa + colaboração por fork**, com a
restrição "arquivos+chave seguem o runner" assumida como dada. As camadas
diferenciadoras do Merovingian (Contexto permissionado + Decisões) entram
**por cima** dessa base de infra.

## Perguntas em aberto (para consolidar)

- O "mix produtivo" que a visão pede sobrevive bem só com fork, ou
  precisamos de algo entre a opção 1 e a 3?
- Onde mora o **contexto compartilhado** (empresa, produtos, clientes) nesse
  modelo, já que o working tree não é compartilhado? (Liga ao primitivo de
  Contexto — provavelmente fora do working tree, numa fonte plugável.)
- Construímos sobre o Omnigent (Apache-2.0, mas Alpha) ou só herdamos o
  padrão? (Vira ADR próprio — ver `0002` quando existir.)

## Consequências (se consolidada como inclinação)

- A v2 trata o servidor como plano de controle, nunca como dono dos arquivos.
- Contexto compartilhado **não** pode depender do working tree — precisa de
  fonte própria (reforça a aposta "schema/permissionamento plugável").
- Colaboração simultânea fina vira tema de pesquisa separado, não bloqueia a
  fundação.
