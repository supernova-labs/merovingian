# ADR 0017 — Projeção multi-harness a partir de um manifest neutro

**Status:** Consolidada — implementação entregue em 2026-07-26 na issue #17: manifest
neutro, emitters Claude/Codex, inventário transacional, plugin sync, compatibilidade de
frontmatter e goldens multi-harness.
**Data:** 2026-07-26
**Origem:** design da issue #17 para oficializar Codex sem transformar o modelo do
Merovingian num mínimo denominador comum entre harnesses.
**Relacionado:** `0004` (sessão principal + subagentes), `0005` (build como projeção e
segredos como dado local), `0010` (governança distribuída como plugin), `0012` (library
do tenant como fonte do conteúdo comportamental) e `0016` (paridade da fatia projetada).

## Contexto

O `build` atual materializa diretamente o manifest de uma identidade nas convenções do
Claude Code: `CLAUDE.md`, `.mcp.json`, `.claude/settings.local.json`,
`.claude/skills/` e `.claude/agents/`. A fatia do grafo já é independente do runtime,
mas o emitter mistura três responsabilidades:

1. resolver a intenção da projeção;
2. adaptá-la às capacidades de um harness;
3. escrever e limpar os arquivos desse harness.

Adicionar Codex copiando essa implementação nivelaria os dois destinos pelo formato que
eles compartilham hoje. Isso impediria cada protocolo de evoluir no seu formato nativo e
espalharia condicionais de vendor pelo resolver.

O workspace normalmente é uma pasta local gerada, não o repositório do tenant. Uma única
sessão principal abre nessa pasta, lê o arquivo de instruções raiz e chama os agentes dos
propósitos visíveis como subagentes quando necessário. Nenhum agente de propósito é
promovido automaticamente à sessão principal.

## Opções consideradas

1. **Formato comum já serializado.** Gerar Markdown/configuração no menor denominador
   comum e copiá-lo para Claude e Codex. Simples no curto prazo, mas acopla a evolução de
   um harness ao outro.
2. **Manifest neutro + emitters nativos.** O grafo e o resolver carregam intenção,
   metadados e conteúdo estruturado; cada emitter produz o formato correto do seu
   destino.
3. **Builds ou workspaces separados por harness.** Reduz colisões, mas duplica a fatia,
   cria drift operacional e quebra a ideia de um workspace por identidade.

## Decisão

### 1. Um manifest neutro, dois emitters

O resolver produz uma representação intermediária sem arquivos ou campos específicos de
Claude/Codex. Conteúdo comum — propósitos visíveis, agentes, skills, tools, MCPs, OKF,
decisões, plugins e identidade — aparece uma vez. Emitters independentes serializam essa
intenção:

- Claude Code: `CLAUDE.md`, `.mcp.json`, `.claude/**`;
- Codex: `AGENTS.md`, `.agents/skills/**`, agentes e configuração nativos em `.codex/**`.

Todo `merovingian build` emite os dois destinos no mesmo workspace, sem opt-in por tenant
ou flag de CLI. A aplicação é **transacional**: ambos são preparados e validados antes de
qualquer troca; uma falha preserva integralmente a projeção anterior.

A sessão principal continua neutra em relação aos propósitos: abre somente com o arquivo
raiz do harness e as capacidades da projeção. Os agentes dos propósitos visíveis são
subagentes. O arquivo raiz contém uma regra curta para delegar trabalho claramente
pertencente a um propósito; o método detalhado permanece na skill `route`.

### 2. Agentes e skills são autorados fora dos formatos de harness

Cada propósito continua tendo **um único agente principal** (`purpose.agent`). Ele define
o prompt inicial daquele propósito quando é chamado como subagente. Se no futuro houver
especialistas auxiliares, serão outro conceito — não uma pluralização silenciosa desse
campo.

Metadados neutros do agente, começando por `description`, passam a um catálogo `agents:`
no `graph.yaml`; as instruções longas permanecem em `library/agents/<nome>.md`. O emitter
Claude gera seu frontmatter e o emitter Codex gera sua configuração nativa. Durante a
migração, a ausência do metadado no catálogo faz o loader aceitar o frontmatter atual com
warning de depreciação; o catálogo prevalece quando ambos existem.

Skills locais adotam o formato aberto Agent Skills (`SKILL.md` mais
`scripts/`, `references/` e `assets/` quando existirem). A leitura é permissiva:
frontmatter legado recuperável não bloqueia o tenant, mas o fluxo de autoria emite
warnings de lint; `name` e `description` precisam continuar semanticamente legíveis. O
loader produz uma entidade neutra e preserva os arquivos para os emitters. Enquanto os
destinos forem compatíveis, ambos materializam a mesma skill. Divergências futuras ficam
nos adapters, sem empobrecer a fonte.

Configurações operacionais específicas de agente — modelo, reasoning, sandbox e
equivalentes — não passam pelo Merovingian nesta versão. Os emitters geram somente o
mínimo necessário para identidade, descrição e instruções; tuning continua no próprio
harness.

### 3. Propriedade e limpeza são explícitas

`AGENTS.md` e `.codex/config.toml` são integralmente gerenciados pelo Merovingian. Um
arquivo preexistente sem marca de propriedade causa erro antes de qualquer escrita; não
há merge de blocos nem overwrite silencioso. Preferências pessoais ficam na configuração
global do Codex, e conteúdo operacional do workspace vive em arquivos próprios de
contexto.

O build stamp registra, por emitter e versão, o inventário dos arquivos gerados. Num
rebuild, cada emitter pode remover somente os artefatos que ele registrou anteriormente.
Diretórios inteiros como `.claude/`, `.codex/` ou `.agents/` nunca são apagados como
atalho. O stamp não carrega segredos nem estado mutável de instalações externas.

### 4. Diferenças de capacidade degradam de forma visível

O contrato de acesso ao grafo é idêntico nos dois destinos, mas um harness pode não
implementar uma capacidade. A degradação nunca é silenciosa:

- MCPs `stdio` e Streamable HTTP são adaptados ao formato nativo do Codex;
- MCPs legados `SSE` são omitidos somente do Codex nesta versão, com warning no CLI,
  registro da capacidade indisponível no build stamp e nota no `AGENTS.md`;
- não há heurística que converta `/sse` em `/mcp`;
- uma alternativa de transporte será modelada no grafo quando houver um caso concreto.

O emitter Codex cria um perfil de permissões `merovingian` que estende o workspace e
adiciona regras por path absoluto para os bundles OKF daquela projeção: `write` quando um
propósito visível possui o bucket e `read` quando a projeção apenas o consome. Esses paths
não são adicionados aos writable roots globais; o acesso continua limitado ao perfil e à
fatia projetada. No primeiro uso, o humano precisa confiar aquele workspace no Codex; até
esse gate nativo ser aceito, o Codex ignora deliberadamente `.codex/config.toml`, incluindo
MCPs e esse perfil.

O suporte oficial inicial cobre Codex CLI e Codex no app desktop. A extensão de IDE não
faz parte desse contrato.

### 5. Segredos locais seguem o contrato do workspace gerado

O Codex não depende de um `.env` dentro do workspace. Segredos de companhia já resolvidos
podem ser escritos diretamente no `.codex/config.toml` totalmente gerenciado, com modo
`0600`, sem aparecer em logs, `AGENTS.md` ou stamps. Um rebuild remove valores obsoletos.

Se houver segredos de companhia e o destino estiver dentro de um repositório Git, o build
falha no preflight antes de escrever. A exceção existe porque o workspace normal é uma
pasta local descartável; nenhum arquivo destinado a commit pode conter esses valores.

### 6. Plugins têm identidade lógica e bindings por harness

Uma dependência externa mantém uma identidade lógica no grafo, mas o catálogo pode
declarar bindings diferentes para Claude e Codex. Não se exige que os dois mecanismos de
distribuição usem o mesmo repositório ou o mesmo formato de pacote.

O `build` não instala plugins nem altera implicitamente o estado global do Codex. Ele
consulta a instalação atual, conclui o workspace com warning quando falta um plugin e
registra somente o requisito determinístico da projeção. O comando explícito
`merovingian plugins sync` consulta novamente o estado atual e instala os bindings
ausentes; conflitos de source falham explicitamente. Não há `plugins.json` local nem
outro cache de estado.

## Consequências

- Claude e Codex projetam a mesma fatia de identidade e acesso, mas usam seus formatos
  nativos e podem evoluir independentemente.
- A regressão do Claude passa a ser protegida junto dos goldens do Codex; qualquer
  diferença de conteúdo comum é uma falha do manifest, não liberdade do emitter.
- A propriedade por arquivo e a aplicação transacional tornam rebuilds mais seguros que
  o wipe atual de `.claude/skills` e `.claude/agents`.
- O primeiro build pode terminar com warnings corrigíveis (`plugins sync`) ou limitações
  auditáveis (SSE), sem cair em ciclos de bootstrap.
- A materialização de OKF isola falhas por repositório: um checkout limpo cuja branch divergiu
  do upstream permanece montado como stale e é reportado; checkouts sujos ou inacessíveis não
  são montados, preservando a fronteira fail-closed.
- O catálogo de agentes e os bindings de plugins ampliam o schema do grafo; a migração de
  frontmatter é compatível, mas deliberadamente temporária.
- Configuração avançada por agente, extensão de IDE e transporte alternativo para SSE
  ficam fora desta entrega até existir incompatibilidade concreta que justifique o
  contrato.
