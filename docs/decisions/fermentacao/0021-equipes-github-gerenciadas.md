# ADR 0021 — Gestão explícita das equipes de revisão do GitHub

**Status:** Em revisão; implementada na PR #46, aguardando consolidação humana.
**Data:** 2026-10-25.
**Relacionado:** ADR 0020; issue #44.

## Contexto

O grafo já determina revisores e acesso aos repositórios, mas o adaptador da ADR
0020 exige que um operador ajuste as equipes manualmente. Onboarding e revogação
ficam bloqueados mesmo com um plano de permissões aprovado. O pedido de implementação
inicia esta proposta; a ADR 0020 permanece como lastro, sem consolidação implícita.

## Opções consideradas

- Manter somente validação: preserva a fronteira atual, mas não resolve onboarding.
- Gerenciar qualquer equipe citada: mais simples, mas pode alterar acesso externo.
- Adotar explicitamente equipes existentes e comprovar seu escopo: escolhida para
  implementação nesta PR; mantém configurações anteriores e bloqueia efeitos incertos.

## Decisão proposta e consequências

O pedido de implementação de 2026-10-25 estende o adaptador com
`github.managedTeams`, lista opcional de `organização/slug`. Adoção é explícita;
configurações anteriores continuam somente validando as equipes. Não se criam equipes
nem convites para a organização. Exige-se executor owner ativo da organização para
estabelecer o inventário completo, inclusive repositórios privados fora do alvo.
O adaptador exige também credencial classic/OAuth com escopo `repo` e de organização
comprovados nos headers; tokens restritos ou sem essa evidência são recusados para
gestão de equipes. Ser owner com token restrito não prova visibilidade completa.

Cada equipe gerenciada deriva sua composição das políticas que a referenciam. Pode
ser compartilhada apenas quando todos os seus grants pertencem a repositórios
selecionados que a referenciam e todas as políticas concordam sobre a composição.
Equipes pai/filha, efeitos externos, permissões desconhecidas e acesso efetivo sem
origem identificável bloqueiam apply. Não se infere ownership a partir de um prefixo.

O plano inclui inventário de equipes, papéis, grants, hierarquia e convites; tudo
participa da revisão aprovada. A equipe recebe exatamente escrita em cada alvo.
Pessoas novas precisam ser membros ativos da organização e entram como `member`;
papéis de membros existentes são preservados. Convites pendentes exigem aceitação
ou cancelamento explícito antes de reconciliar; não equivalem a acesso ativo.

Alterações exigem scope `all`. Remoções de membros obsoletos são verificadas antes
de habilitar qualquer novo bypass; proteções precedem grants e adições. Grants
excessivos são reduzidos antes de adicionar pessoas. Cada mutação de equipe é relida
e o plano final audita convergência. Falha interrompe as próximas operações e pede
novo plano, sem rollback distribuído. Mudança só de membros não recria rulesets.
A equipe individual do aprovador e o bypass explícito continuam distintos dos
revisores derivados de propósitos donos; integridade continua sem bypass.
