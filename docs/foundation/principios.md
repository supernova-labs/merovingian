# Os 5 Princípios de Sistemas Híbridos

Se os primitivos são o que a infra **provê**, os princípios regem **como**
esses primitivos são organizados, evoluídos e auditados. São o critério de
qualidade de qualquer círculo operado por humanos + IA.

## 1. Conhecimento do mundo

O sistema precisa conhecer o mundo onde está inserido. É o primitivo de
Contexto num nível **organizacional**:
- Qual é a política de organização do contexto? Onde fica cada coisa?
- Que informação cabe aqui e qual precisa ir para outro lugar?
- Que ferramentas precisam estar disponíveis para o agente trabalhar (ex.:
  agente comercial acessa o CRM)?

## 2. Repetibilidade

Quem opera o círculo tem as **skills** necessárias para operá-lo
corretamente.
- As skills têm caminho claro para serem avaliadas e para reportar
  problemas? Com que frequência são revisadas?
- Quão prescritivo deve ser o **processo** e quão prescritivo o **output**?
  Geralmente o output é mais prescritivo que o processo — mas nem sempre.
- Quando esta organização, dentro deste círculo, com estes humanos, precisa
  executar algo: deve ser padronizado? Se sim, qual o padrão (do processo e
  da documentação)?

## 3. Evolutivo e antifrágil

Cada vez que o círculo é operado, ele registra as **próprias fricções**.
- Fricção → processo de **governança** → lições aprendidas viram melhorias
  em outros sistemas.
- Ao concluir o trabalho, o círculo gera um **log da sua atuação**.

## 4. Jurisprudência

Decisões devem caminhar para a jurisprudência, **liberando o humano** para
trabalhar em coisas maiores.
- Ao decidir, o círculo tem a **trilha de argumentos** que justifica?
- Tem onde **guardar o log** da decisão tomada?
- Existe um processo **contínuo** que revisa esses logs para ver se o
  processo decisório está funcionando?

## 5. Explicabilidade

Observabilidade no sentido técnico **e** conceitual.
- Rastreabilidade de decisões: que pedidos geraram que respostas? Que dados
  de contexto o agente recebeu para responder o que respondeu?
- Não só ter os logs, mas: os agentes (humanos ou IA) sabem **criar o
  rastro**? O sistema **evita** que alguém esconda o rastro?
- Existe revisão contínua do rastro — buscando oportunidades de melhoria e
  **falhas de segurança**?
