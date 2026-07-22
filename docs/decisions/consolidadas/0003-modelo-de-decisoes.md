# ADR 0003 — Modelo de decisões (Records vs. Logs)

**Status:** Superseded por `0009` (2026-06-30) — a taxonomia das 4 categorias de
"decisão". Mantida como **raiz conceitual** do Primitivo "Decisões" (→ tabela `decision`).
**Data:** 2026-06-24
**Origem:** sparring de fundação (2026-06-24)
**Relacionado:** `0002-permissionamento-e-dominio`,
`context/fundacao/primitivos.md` (Decisões, Jurisprudência)

## Contexto

Decisão é **só um tipo específico de contexto** (como cliente, contrato,
proposta). Logo, resolver a fonte de contexto resolve a fonte de decisões;
ela pode ter um ou dois MCPs pra facilitar, mas é a parte *simples*.

Mapeando a empresa em **hotspots**, chega-se a **decision types** (estratégia,
arquitetura, produto, comercial…). Cada hotspot é dono de um ou mais decision
types — ex.: o preço de uma proposta é decisão do círculo comercial, não dos
outros.

## O modelo (dois elementos por decision type)

1. **Decision Record (DR)** — jurisprudência **já formada**. É lei: não se
   decide de novo, segue-se. **Mantém o nome** (é padrão consagrado, estilo
   ADR/spec-layer).
2. **Decision Log** — o **insumo** para formar decisões, que não existe no
   spec-layer atual. Registra "neste cenário, com este racional, decidi X",
   linkando logs anteriores como jurisprudência.

Dois fluxos de consulta (ex.: "dou desconto pra esse cliente?"):
- Existe **DR** sobre desconto? Se sim, segue.
- Se não, **mostra os Decision Logs** passados → embasa a decisão atual →
  cria um novo log linkado aos anteriores.

## Governança fecha o ciclo

- No **journal**, o círculo pesquisa as decisões tomadas e gera os logs com o
  racional correto.
- Na **governança**, revisita-se os logs e marca-se **boa/má decisão** (com
  argumentos). Padrões recorrentes viram **DRs**.
- **Decisões inválidas também alimentam a jurisprudência** — a próxima sessão
  vê "no passado fiz isso, disseram que é ruim por X" e se corrige.
- Decisões herdam o **permissionamento** (ver `0002`): por decision type /
  domínio, nem todo mundo vê toda decisão (ex.: demissão só pra liderança).

## Pontos a resolver

- **Nome do "Decision Log".** "Log" remete a registro de algo confirmado; aqui
  é mais **racional pontual / candidato**, não-confirmado. Contraponto do sparring: DR é "lei"
  (legislativo cria a lei; a corte decide). Buscar um nome mais leve que deixe
  clara a hierarquia DR > log — **sem mexer** em "Decision Record".
- Como uma decisão **aparece no momento certo da ação** que o agente toma (o
  gatilho de "preciso decidir X agora").

## Inclinação atual (não decidido)

Adotar **DR (lei) + Decision Log (racional, nome a definir)**, com o ciclo de
consolidação rodando **dentro de journal + governança** (sem sistema novo
dedicado), e a fonte vivendo na mesma camada de contexto a ser escolhida no
experimento de Contexto. Hotspots → decision types como organização.

## Consequências (se confirmada)

- Não exige infra própria de decisões além de 1–2 MCPs sobre a fonte de
  contexto.
- Liga a autonomia ao crescimento da base de DRs (jurisprudência → mais
  autonomia, libera o humano).
- Encaixa decisão como gatilho determinístico em workflows (ver experimento
  de Ferramental: card muda de status → gera decision log).
