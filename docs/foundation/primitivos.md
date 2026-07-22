# Os 5 Primitivos da Supernova

A lente para avaliar qualquer decisão de arquitetura. São o que a
infraestrutura **provê** às equipes. Cada um carrega uma camada implícita
de permissionamento que precisa ser resolvida.

## 1. Propósito

Sistemas distintos para áreas de responsabilidade distintas — aqui chamados
**círculos** (outras empresas chamam de projetos, agentes, etc.). O círculo
do financeiro não deve ser o mesmo da saúde pessoal.

Duas razões:
- **Controle do que está disponível** — ferramentas e acessos alinhados ao
  propósito.
- **Clareza de autonomia** e prevenção de **contaminação de contexto**.

Resolvido se as definições de círculos viverem num lugar **centralizado**
(GitHub ou ferramenta externa).

## 2. Contexto

Onde mora a real complexidade. Dois sub-problemas:

### Granularidade (permissão)
Nem todo mundo que usa um círculo deveria acessar os mesmos dados (ex.:
clientes). Markdown no repo = qualquer um que clona vê tudo. Mesmo
deployado, um prompt elaborado pode forçar o sistema a imprimir o que não
devia.

Modelo ideal — **filtragem dupla/tripla**:
1. Este círculo pode consumir conteúdo deste local?
2. Este usuário pode acessar este círculo?
3. Este usuário, dentro deste círculo, pode consumir **este tipo** de
   conteúdo?

É o maior desafio de ferramenta — é onde o permissionamento entra de fato.
Alternativa: usar sistema externo com permissionamento embutido (Google
Drive, Notion). **Design-chave: ser plugável** — uma empresa usa Drive,
outra Notion, outra uma solução proprietária baseada em banco de grafos
para controle mais fino.

### Compartilhamento entre círculos
Círculos com propósitos diferentes (financeiro, projetos, comercial)
provavelmente precisam compartilhar informação: o que é a empresa, seus
produtos, a lista de clientes. Se a informação vive só no repositório, ela
fragmenta — ou vira réplica, ou vira gambiarra de acesso.

## 3. Skills

Codificam o procedimento — o que precisa ser executado dentro do negócio.
A **distribuição já é resolvida** (plugins na Claude Cloud; outros têm
manifesto/repositório próprios). O desafio real não é distribuir, e sim **o
sistema perceber se e como** as skills estão sendo usadas.

## 4. Decisões

Inspirado nos **ADRs** (Architecture Decision Records) da engenharia: texto
que abarcou uma discussão e, ao consolidar, vira o **lastro** da decisão —
que não precisa mais ser tomada individualmente.

Componentes:
- **Fermentação vs. consolidação** — decisões em discussão vs. já prontas.
- **Aparecer conforme a ação** — o sistema precisa saber qual decisão está
  sendo tomada e trazer os Decision Records que a embasam.
- **Decision Logs** — "estava neste cenário, fui confrontado com esta
  decisão, me baseei nestes registros, decidi X". Rastro revisitado com
  frequência para saber se a decisão certa foi tomada e que informação nova
  precisa entrar no sistema decisório para decidir melhor no futuro.

## 5. Ferramentas ("Tubos")

Todas as formas do sistema interagir com sistemas externos (Drive, banco,
logs de servidor, etc.). Variação no permissionamento:
- Tubo aberta a todos, com deploy central.
- Tubo aberta a todos, mas com **quotas** diferentes (ex.: geração de
  imagens com limite diário por pessoa).
- Controle no nível do **servidor** ou no nível da **API key** (cada
  colaborador usa a própria chave; o registro de quota fica na chave).

A necessidade de permissionamento da Tubo é parecida com a do Contexto e —
por incrível que pareça — com a das Decisões (ex.: lastros sobre demissão
só para a liderança).

---

**Conclusão transversal:** em praticamente todos os primitivos existe uma
**camada implícita de permissionamento** que cada um precisa levar a cabo.
