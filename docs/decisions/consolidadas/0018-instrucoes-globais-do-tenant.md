# ADR 0018 — Instruções globais do tenant como conteúdo ambiente da library

**Status:** Consolidada — implementação entregue em 2026-08-01: autoria em
`library/workspace.md`, persistência no `config`, Manifest neutro e composição comum nos
arquivos raiz de Claude e Codex.
**Data:** 2026-08-01
**Origem:** necessidade de tenant admins distribuírem contexto e instruções operacionais
padrão a todas as máquinas sem editar artefatos gerados.
**Relacionado:** `0005` (build como projeção), `0012` (library do tenant), `0016` (leitura
estrutural escopada) e `0017` (Manifest neutro e emitters multi-harness).

## Contexto

O `build` gera `CLAUDE.md` e `AGENTS.md` a partir de um renderer compartilhado. Esse
conteúdo descreve identidade, delegação e capacidades calculadas pela Source, mas o tenant
não possuía um ponto de autoria para contexto e padrões que deveriam alcançar todas as
identidades.

Editar os arquivos raiz localmente não serve: eles são artefatos integralmente gerenciados,
recusam ownership estrangeiro e são substituídos no rebuild. Modelar o texto num propósito
raiz também seria incorreto, porque projeções iniciadas em propósitos descendentes não veem
ancestrais e instrução global não é uma capacidade ou persona de propósito.

## Opções consideradas

1. **Texto inline no `graph.yaml`.** Explícito, mas ruim para revisar Markdown longo e mistura
   topologia com conteúdo comportamental.
2. **Arquivo explícito apontado pelo YAML.** Flexível, mas adiciona schema, resolução segura de
   paths e estados inválidos sem benefício enquanto existe um único documento global.
3. **`library/workspace.md` por convenção.** Mantém o conteúdo no domínio já tenant-owned,
   permite revisão normal em Git e não introduz representação específica de harness.
4. **Skill ou arquivo complementar materializado.** Reutiliza distribuição existente, mas
   depende de descoberta/invocação e não garante presença no prompt raiz de toda operação.

## Decisão

### 1. Um fragmento Markdown comum, por convenção

`library/workspace.md` é o único ponto de autoria para contexto e instruções operacionais
tenant-wide. Ele é um fragmento Markdown neutro: não há variantes por harness, propósito,
usuário ou máquina.

Arquivo ausente, vazio ou apenas com whitespace significa “sem instruções globais”. Ao
carregar conteúdo não vazio, o loader remove somente whitespace externo e preserva o corpo
Markdown interno.

### 2. Conteúdo ambiente atravessa deploy e Manifest

O loader dobra o fragmento em `Definition.ambient.instructions`. `deploy plan` compara apenas
hashes curtos, nunca imprime o texto, e `deploy apply` persiste o conteúdo no campo opcional
`config.instructions`.

O registro `config` já é legível por qualquer identidade autenticada porque carrega os skills
ambient. A instrução segue deliberadamente a mesma régua: todo membro do tenant recebe o mesmo
conteúdo, inclusive em builds estreitados por `--purposes`. Por isso o arquivo não pode conter
segredos nem informação com audiência menor que o tenant inteiro.

O resolver publica o campo opcional `tenantInstructions` no Manifest. A opcionalidade mantém
compatibilidade com bancos, tenants e serviços anteriores que não carregam o campo.

### 3. Os dois arquivos raiz recebem a mesma seção

O renderer semântico compartilhado insere `## Tenant-wide operating instructions` depois de
`Delegation` e antes do inventário de `Purposes`. Uma nota gerada pela Source registra a
precedência: o conteúdo do tenant não amplia acesso projetado nem substitui identidade ou
decisões ratificadas.

Claude e Codex recebem o mesmo fragmento. Diferenças futuras de harness devem permanecer nos
adapters da `0017`, não bifurcar esta política comum.

### 4. O tenant é dono; a Source só cria a primeira versão

`merovingian init` cria um `library/workspace.md` ativo com o nome do tenant e guardrails
genéricos sobre acesso, decisões, segredos, revisão e ambiguidade de autoridade.

O arquivo é criado fora de `src/init/templates/library/`. Portanto, não faz parte do catálogo
administrado por `merovingian library update`, mesmo com `--yes`. Evoluções futuras dos defaults
da Source não sobrescrevem tenants existentes; a cópia inicial passa a ser integralmente deles.

Não existe limite de tamanho nesta versão, em linha com outros prompts da library. A
documentação recomenda conteúdo conciso; limites só serão adicionados diante de um problema
operacional concreto.

## Consequências

- Tenant admins ganham um caminho versionado e auditável para distribuir contexto e padrões a
  todas as máquinas.
- Uma edição só chega aos membros depois de `deploy apply` e do próximo `build` de cada
  workspace; não há push automático nem overlay local.
- O Manifest continua neutro e os emitters permanecem semanticamente alinhados.
- Tenants existentes não precisam criar o arquivo nem migrar conteúdo; o novo campo de banco é
  opcional e a seção é omitida quando não há texto.
- O alcance tenant-wide é uma propriedade forte: qualquer conteúdo sensível ou específico de
  propósito deve permanecer em buckets, skills ou agentes com a projeção apropriada.
