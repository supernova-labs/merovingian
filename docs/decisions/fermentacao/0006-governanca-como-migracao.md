# ADR 0006 — Governança como migração (PR atômico)

**Status:** Fermentação
**Data:** 2026-06-25
**Origem:** sparring Luis × Claude (2026-06-25)
**Relacionado:** `0004` (governança = build), `0005` (deploy/distribuição),
`0002` (permissionamento), `MODELO-v3.md`

## Contexto

A governança muta a definição global por **3 canais** (marketplace de plugins,
kb repos, estrutura no Surreal). Marketplace e kb são git/PR nativos — faltava
**como a mudança do Surreal entra sem perder a auditabilidade/PR** (a maior
fraqueza do caminho Surreal).

## Proposta (fermentação)

A governança **não muta o Surreal ao vivo**. Em vez disso:

1. Produz um **script de migração** (forward + rollback) da estrutura.
2. **Valida contra um mirror** — um snapshot recente do prod (dry-run).
3. Deixa o **script dentro do PR**.

Com isso, o PR de governança vira **atômico**: *bump de plugin* (marketplace) +
*edição de kb* + *script de migração Surreal* = **uma mutação estrutural só**,
revisada, mergeada e aplicada junta.

**Apply-on-merge:** ao mergear, a pipeline aplica a migração no prod — **como
parte do gate de merge** (não fire-and-forget).

É **migrations-as-code** aplicado ao grafo — o **caminho B concretizado**: git
autora+revisa, mirror valida, Surreal é runtime, apply-on-merge projeta.

## Benefícios

- **Resolve a tensão git-audit × Surreal-enforcement:** a mudança estrutural
  inteira é um PR **revisável + validado + atômico**.
- **O histórico de migrações no git É a trilha de auditoria** (replayável),
  complementando o event-log nativo do Surreal → **mata parte** do item
  parqueado de auditabilidade.
- Dá ao **serviço de build/auth** sua primeira função concreta: aplicar a
  migração no prod (creds Surreal server-side, fora do runtime de qualquer um).
- O artefato de governança fica o mais limpo possível: **um PR = uma mutação no
  grafo, atravessando os 3 backends.**

## Cuidados / em aberto

1. **Estrutura vs. dado de runtime.** A migração toca **tabelas estruturais**
   (propósitos, atribuições, schema), **nunca** o dado vivo (clientes/propostas,
   que evolui por write normal do app). Mundos separados — confundir é perigoso.
2. **Frescor do mirror.** Snapshot recente do prod, senão o dry-run mente.
   (Spinar sob demanda a partir do prod, ou snapshot periódico.)
3. **Ordem do apply.** Parte do **gate de merge** (apply falha → merge
   reverte/falha), com monitoramento. Risco baixo por já ter passado no mirror.
4. **Forward + rollback** por migração.
5. **Quem aplica** = o serviço de build/auth (`0005`), server-side.

## Consequências

- O fluxo de governança: *friction → PR atômico (plugin + kb + migração) →
  valida no mirror → apply-on-merge*.
- Surreal fica auditável por **git (migrações) + event-log nativo**.
