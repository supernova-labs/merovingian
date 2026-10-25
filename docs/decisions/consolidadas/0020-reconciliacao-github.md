# ADR 0020 — Reconciliação administrativa do GitHub

**Status:** Implementação inicial; bypass manual via PR aprovado pelo humano.
**Relacionado:** 0008, 0009, 0019.

## Contrato

O deploy GitHub é uma etapa administrativa explícita, separada da conexão Surreal.
Usa a autenticação do `gh` para github.com; credenciais administrativas não entram
no catálogo, nos plugins nem nas máquinas dos membros.

`github.repositories` delimita os repositórios que podem sofrer alterações.
Acesso vem do mesmo resolvedor do catálogo: união das subárvores, `owns` concede
escrita e `reads` leitura, independentemente do papel owner/member. Consumir um
plugin concede leitura do marketplace inteiro. Para atribuir donos a esse
repositório, ele também é declarado como bucket e referenciado em `owns`.
Isso mantém uma única origem para ownership e evidencia a fronteira de privacidade
por repositório. Fontes fora da lista administrativa não são modificadas.

Identificadores externos são únicos e administrados. Exceções administrativas são
IDs de usuários em `github.administrators`, resolvidos pelo mesmo vínculo GitHub.
Não se presume que o executor ou um owner do propósito seja administrador GitHub.

## Plano e aplicação

O plano contém inventário, diferenças, bloqueios e revisão SHA-256. Apply recebe
essa revisão e refaz a leitura de todos os alvos antes da primeira escrita. Mudança
no grafo ou estado remoto invalida a aprovação. Não é uma transação distribuída:
falhas parciais relatam operações realizadas e impedem operações posteriores.
A corrida entre leitura e escrita continua possível; uma auditoria final verifica
a convergência. Convites pendentes não equivalem a acesso efetivo.

O primeiro adaptador opera repositórios privados de organizações, existentes.
Concessões diretas excessivas são revogadas ou reduzidas independentemente de quem
as criou. Acesso herdado excessivo bloqueia a aplicação: não remover membros de
organizações/equipes implicitamente. O baseline da organização precisa ser `none`;
seus owners precisam de exceções administrativas explícitas. Isso é uma limitação
operacional visível, não uma alegação de que remover uma concessão direta revoga
acesso herdado. Recursos, papéis e atores não compreendidos falham fechados.

## Proteções

Dois rulesets protegem a branch padrão: `merovingian-reviewed-changes` exige PR
revisada; `merovingian-branch-integrity` impede deleção e force push sem bypass.
A integridade é instalada e verificada primeiro, inclusive ao substituir o ruleset
combinado anterior. Não altera rulesets alheios ou herdados. Equipe de review
existente precisa corresponder exatamente às pessoas cujo recorte possui o
repositório. O aprovador obrigatório acrescenta equipe individual; as exigências
são cumulativas. Equipes não são modificadas automaticamente porque sua composição
pode afetar outros repositórios. Rejeição ou ausência da regra na releitura impede
concessões posteriores.

O humano aprovou `allowApproverPullRequestBypass`: bypass manual da regra de review
para a equipe individual do aprovador obrigatório, somente no modo `pull_request`.
Pode ser usado também em PRs de terceiros. Usá-lo apenas para a própria autoria é
convenção operacional aceita, não condição imposta pelo motor. Não haverá check
próprio. A integridade continua sem bypass, e a permissão não é concedida a todos
os administradores. Mudar a composição da equipe fora do deploy pode alterar quem
recebe o bypass; o próximo plano detecta composição divergente e bloqueia apply.
