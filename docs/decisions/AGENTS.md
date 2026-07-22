# Decisões — ADRs da v2

O primitivo "Decisões" aplicado ao próprio círculo. Decisões de arquitetura
viram **lastro** (jurisprudência): uma vez consolidadas, não se rediscutem —
embasam as próximas.

- **`INDEX.md`** — o estado de **todas** as ADRs num lugar só (status, pasta, uma linha).
  Comece por aqui.
- `fermentacao/` — decisões **em discussão**, ainda abertas. Não são lastro.
- `consolidadas/` — ADRs **fechados**: *consolidados* (lastro — respeite, não rediscuta)
  **ou** *superseded* (substituídos por um sucessor; ficam como history, com o ponteiro no
  header). O status preciso está no header de cada um e no `INDEX.md`.

## Fluxo

1. Uma questão de arquitetura surge → cria-se um ADR em `fermentacao/`.
2. Discute-se (com o humano), registrando a trilha de argumentos.
3. Ao consolidar, o ADR move para `consolidadas/` com a decisão e o porquê.
4. Decision logs ("decidi X com base em Y") referenciam o ADR.

## Convenção

- Arquivo: `NNNN-titulo-curto.md` (numeração sequencial).
- Conteúdo mínimo: contexto, opções consideradas, decisão, consequências.
- Consolidar um ADR de peso **deve ser consultado** com o humano
  (ver `PURPOSE.md` → Autonomia).
