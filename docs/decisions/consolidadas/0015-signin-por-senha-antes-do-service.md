# ADR 0015 — Auth por SIGNIN do SurrealDB antes do build/auth service

**Status:** Consolidada — implementação entregue em 2026-07-24 (mesmo dia do design: cláusula
SIGNIN no `auth.surql` coexistindo com `WITH JWT`, tabela runtime `credential` (argon2,
PERMISSIONS NONE), comando `passwd`, caminho senha em `login`/`data`/token-source dos MCPs,
`connectSurreal` com cadeia de signin root→ns→db).
**Data:** 2026-07-24
**Origem:** sparring Luis × Claude na véspera do onboarding da segunda pessoa. A pergunta
detonadora foi do Luis: *"por que a pessoa não guarda na máquina dela só o próprio login e
senha, que eu dou quando criar o usuário?"* — e a resposta honesta era: feita direito, essa
ideia funciona e adia o service inteiro.
**Relacionado:** assume o gate de chave privada do PR #14 (issue #5) — a KEY do
`DEFINE ACCESS` nunca mais é pública; o service (issue #6) vira o **sucessor natural** desta
decisão, não o pré-requisito do rollout. Mantém os invariantes de `0002`/`0011` (o banco
decide; mount ≠ authority).

## Contexto

Com o gate do #5, um tenant real só confia em tokens assinados com uma chave privada. Isso
fechou o furo do dev-mint, mas criou a pergunta operacional: **como a segunda pessoa se
autentica?** As opções na mesa:

1. **Dev-mint com a chave compartilhada** — a chave-mestra na máquina de cada pessoa.
   Inaceitável: quem tem a chave forja o crachá de QUALQUER identidade; o scoping
   por-pessoa (o coração do produto) morre.
2. **O build/auth service (issue #6)** — gh-auth → o service minta. O desenho-alvo, mas
   exige subir, blindar e manter um serviço HTTP **antes** de onboardar alguém.
3. **SIGNIN nativo do SurrealDB** — cada pessoa com a própria senha (hash argon2 num record),
   o próprio banco valida e **ele mesmo emite** o token scoped, assinado com a KEY que nunca
   sai do banco.

## Decisão

**SIGNIN por senha é o caminho de autenticação do rollout inicial.** O service continua
sendo o alvo de médio prazo (identidade GitHub, banco fora do alcance das máquinas), mas
deixa de bloquear a segunda pessoa.

Mecânica:

- `DEFINE ACCESS identity ... TYPE RECORD SIGNIN (...) WITH JWT ...` — as duas portas
  coexistem: senha para humanos; JWT externo continua valendo para dev/test (mint) e para o
  service futuro. Migrar para o service = registrar o namespace como `remote`; **zero
  mudança de schema**.
- O hash mora na tabela runtime **`credential`** (`data.surql`), keyed pelo id plano do user
  (`credential:<uid>`, sem record link): o `apply` faz full-content replace dos records
  estruturais e o `reset` os apaga — senha é runtime como o inbox, **nunca** estrutura. Um
  credential órfão é inerte (o SIGNIN devolve o record `user`; user deletado → signin falha).
- `PERMISSIONS NONE` na tabela: nenhuma identidade record lê hash; só o caminho operador
  escreve (`merovingian passwd <ns> <user>`, argon2 server-side).
- Na máquina da pessoa: `MEROVINGIAN_USER` + `MEROVINGIAN_PASS` (o `.env` do workspace).
  **A chave de assinatura sai de TODAS as máquinas** — blast radius de um laptop comprometido
  = aquela identidade, revogável com `passwd` (rotação).

## O trade-off (× service), como discutido

| Eixo | SIGNIN (agora) | Service (depois) |
|---|---|---|
| Identidade | senha por pessoa (operador gerencia) | GitHub (`gh` token, zero senha) |
| Chave de assinatura | dentro do banco, nunca sai | no service, nunca sai |
| Chave-mestra na máquina | não | não |
| Exposição | **toda máquina alcança o banco** | só o service alcança o banco |
| Infra a manter | nenhuma nova | um HTTP blindado no ar |
| Código | pequeno (entregue nesta ADR) | pronto (#5), falta deploy/hardening |

O eixo decisivo é a **exposição do banco**: o SIGNIN só é "sem compromisso de segurança" se
o SurrealDB durável **não** ficar pelado na internet.

## Condições (o preço do SIGNIN)

1. **Banco atrás de rede privada** (VPN/Tailscale/firewall) — toda máquina do time conecta
   direto nele; a porta do banco não pode ser pública. *(Pendência operacional registrada:
   a instância atual está em IP público.)*
2. **Gatilho de migração pro service:** quando o time crescer além do punhado, quando
   gerenciar senha virar toil, ou quando se quiser o banco inalcançável pelas máquinas —
   o que vier primeiro. A coexistência SIGNIN + JWT torna a migração aditiva.

## Consequências

- Onboarding da 2ª pessoa: `deploy apply` (cria o user no grafo) → `passwd <ns> <user>` →
  a pessoa põe `MEROVINGIAN_PASS` no `.env` do workspace dela → `login` + `build`. Sem
  chave-mestra, sem service.
- `login`/`data`/MCPs com senha presente autenticam **como a pessoa** (sem credencial de
  sistema na máquina); a ordem do token-source é service > senha > dev-mint.
- Operador pode usar um system user **escopado no db** (least privilege) — a cadeia de
  signin root→ns→db no `connectSurreal` foi entregue junto.
- O dev-mint segue existindo e segue inofensivo: só o banco dev confia no que ele assina
  (invariante do #5, inalterado).
