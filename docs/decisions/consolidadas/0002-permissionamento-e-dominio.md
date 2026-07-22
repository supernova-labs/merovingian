# ADR 0002 — Permissionamento e domínio

**Status:** Consolidada (2026-06-30)
**Data:** 2026-06-24 · **Consolidada:** 2026-06-30
**Origem:** sparring de fundação (2026-06-24)
**Relacionado:** `0003-modelo-de-decisoes`, `0004-topologia-e-build-time`,
`0008` (owner/member refina), `context/fundacao/primitivos.md` (Contexto)

> **Consolidada:** permissão **no nível do usuário/token** (o círculo herda o acesso
> de quem opera) — provado no código (enforcement record-level + JWT scoped). Refinado
> por `0008` (owner/member). **Trava física por-círculo segue diferida** (compliance
> futura; o modelo lógico token + record-perms + gh-ACL é o piso).

## Contexto

Permissionamento é o nó central do primitivo de Contexto. Hoje, markdown no
repo = quem clona vê tudo — inviável por **obrigação contratual** (cliente
exige que só quem está no projeto veja o dado) e por **risco de vazamento**.
O caso que força o raciocínio é o de alguém **de fora** (freelancer) operando
num cliente específico dentro de um círculo que tem vários clientes,
contratos e valores misturados.

## O debate (circle-level vs. user-level)

O sparring problematizou a **dupla camada** (permissão por círculo *e* por
usuário): vira uma teia de aranha com complexidade exponencial a cada novo
círculo ("este círculo acessa esse, esse, esse…").

Luis defendeu a **trava física** (circle-level): um círculo de coach não
deveria *nem conseguir* dar um `select` na tabela de salário — porque se o
Claude lê (mesmo antes de um prompt injection), ele pode vazar ou agir sobre
contexto contaminado. Não depender só do bom senso do modelo. Análogo: o
círculo é um *usuário do banco* sem acesso àquela tabela.

Convergência: a trava física é **real, mas é problema da Supernova-do-futuro
/ compliance** (Itaú, ambientes regulados) — não de agora.

## Decisão (consolidada — era a inclinação, confirmada)

- **Permissão no nível do usuário/token.** O círculo **herda o acesso de
  quem o opera**. Se o Luis opera o Supernova-pai, tem todos os acessos; se
  outra pessoa opera, tem o acesso reduzido. Isso **elimina a teia de aranha**
  de acesso círculo-a-círculo.
- **Domínio (da holocracia) como camada separada de *modificação*.** Um
  domínio pertence a um círculo: só ele pode *modificar* aquele dado (ex.:
  branding é dono da logomarca; ninguém muda senão ele, nem de cima). Outros
  círculos podem *acessar*, mas para *mudar* pedem ao dono (que tem a skill de
  como mudar).
  → **Acesso = token do usuário. Modificação = domínio do círculo.**
- **Hierarquia/orquestrador** resolve o resto: falar com o círculo-pai (que
  tem acesso amplo) e deixá-lo despachar, em vez de o círculo-filho acessar o
  contexto de outro diretamente.
- **Trava física circle-level:** adiada (feature de compliance futura), não
  parte do primeiro corte.

## Perguntas em aberto

- Como o token do usuário carrega/expressa as permissões na prática (no
  banco? por claim?).
- Domínio precisa de uma malha que impeça **ping-pong alucinativo** entre
  círculos (human-in-the-loop, guardrails) — onde isso mora?
- ~~A trava física é mesmo adiável?~~ **Resolvido (2026-06-30): sim, diferida** até um
  cliente regulado exigir; o piso lógico (token + record-perms + gh) cobre o resto.
- Qual a **granularidade mínima** aceitável no primeiro corte? *(provado: record-level.)*

## Consequências (se a inclinação se confirmar)

- Mata o modelo de grafo de acesso círculo-a-círculo (simplicidade).
- Reforça que contexto **não pode** viver no working tree (precisa de fonte
  com permissionamento por token) — liga direto ao experimento de Contexto.
- Decisões herdam esse mesmo modelo (ver `0003`).
