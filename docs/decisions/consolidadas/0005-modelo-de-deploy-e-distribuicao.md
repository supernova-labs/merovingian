# ADR 0005 — Modelo de deploy e distribuição

**Status:** Consolidada (2026-06-30) — build=projeção + *secret-is-data* + 4 camadas;
construído. Abertos resolvidos: A/B→`0009`, granularidade→Fase 2.5, auditabilidade→`0009`.
**Data:** 2026-06-25
**Origem:** sparring Luis × Claude (2026-06-25)
**Relacionado:** `0001` (uso/deploy), `0002` (permissionamento), `0004`
(topologia/execução), `MODELO-v2.md`, `MVP.md`,
`context/pesquisa/omnigent.md`

## Contexto

Como a v2 é deployada e distribuída entre várias pessoas e serviços **sem que
todo mundo clone o repo principal** — e como a governança chega no dia a dia
sem passar pelo repo do usuário.

## Inclinações (fermentação)

1. **Build = projeção da definição global num alvo escopado.** Não existe
   build *do círculo*; existe build do **ambiente escopado do alvo**. A CLI
   autentica o H, consulta a definição global, e materializa
   `CLAUDE.md`/`.mcp.json`/plugins/contexto **escopados por permissão**. O
   `launch` é rodar o Claude nesse build. **O build é online** (precisa do
   servidor pra computar a fatia); o trabalho depois é local/offline.

2. **Dois alvos, mesmo mecanismo:**
   - **Workspace parceira** — pasta da pessoa, leve, dela (temp files, análises,
     **agentes pessoais não-governados**).
   - **Executor headless** — serviço com funções específicas, deployado isolado,
     baixa só o que precisa (ex.: gerador de propostas).

3. **Governança propaga por 3 canais, nunca pelo repo do user:**
   marketplace de plugins (agents/skills), kb repos (contexto), Surreal
   (estrutura/permissão/scope). O próximo `build` sincroniza.

4. **Os 4 lugares (esqueleto / carne / contexto / sensível):**
   - **Surreal** — estrutura+permissões **e** dado sensível: consultado,
     escopado, **nunca clonado inteiro**.
   - **Marketplace git** — a carne (agents+skills+commands): **plugins
     versionados**.
   - **okf/git** — contexto: **clone escopado** em `./context`.

5. **Distribuição:** **marketplace = fronteira física/segurança** (repo;
   multi-marketplace para separação real); **plugin = lógica/organização**
   (não-segurança — o user lê tudo do marketplace que possui). Princípio:
   **segredo é dado (kb/surreal), não procedimento (skill)** — skills ficam
   genéricas e legíveis; o sensível é buscado em runtime atrás de permissão.

6. **Identidade: user humano OU service account.** Executores headless são
   cidadãos de primeira classe no grafo de identidade. Volta no accountable
   loop (`0002`).

7. **Versão: build pega sempre o latest**, sem pinning estrutura↔plugin. A
   coerência é garantida pela **governança** (princípio da **Repetibilidade**),
   não por versão travada. Tradeoff aceito: publish ruim atinge todos na hora;
   a rede é disciplina de governança, não complexidade de versionamento.

8. **Permissionamento (defense in depth):** o `.mcp.json` e o install de plugin
   são **conveniência/UX**, não segurança. Quem **barra** é o `gh` (ACL de repo)
   + o Surreal (scope de linha/tabela), keyed na identidade. Build bugado ou
   prompt malicioso não fura.

## Em aberto / parqueado

- **Auditabilidade do Surreal** (event-log/versionamento) — requisito conhecido
  (princípio Explicabilidade), não resolvido.
- **Serviço de build/auth** — quem autentica e devolve o manifesto escopado;
  componente novo a desenhar.
- **Granularidade de plugin** — começar **por galho**, quebrar por folha onde
  permissão/versão pedir.
- **Bifurcação A/B** (Surreal-nativo vs. git-autora→projeta-Surreal) — inclina
  pra **B**, não fechada.

## Consequências

- Deploy vira **um primitivo só** (`build → alvo`). Local vs. servidor = *onde*
  aponta; workspace vs. executor = *quanto* projeta.
- Reforça o Surreal como store da estrutura+permissão (caminho B).
- Reaproveita o **marketplace que a Supernova Labs já tem**
  (`snl-skills-marketplace`).
