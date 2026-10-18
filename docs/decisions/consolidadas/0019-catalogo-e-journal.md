# ADR 0019 — Catálogo autenticado e Journal pessoal na próxima major

**Status:** Decisão de direção consolidada; implementação parcial nesta branch.
**Data:** 2026-10-17
**Relacionado:** 0015/0016 (identidade e permissões), 0012/0017/0018 (distribuição),
0013/0014 (histórico e governança).

## Decisão

A próxima major substitui a distribuição via build por catálogo autenticado e setup
orientado por skill. Propósitos levam a plugins, ferramentas e repositórios; o
marketplace decorre do plugin. O grafo define acesso, marketplaces definem conteúdo e
versões, e a máquina informa o estado instalado. Não haverá trilha de legado.

O catálogo usa SIGNIN individual, sem credencial administrativa ou chave de emissão
na máquina do membro. GitHub, email e Slack ID são vínculos mantidos pela administração,
não alternativas ao login. A projeção pública usa uma lista explícita de campos;
nunca serializa o Manifest completo nem valores de ferramentas. Instruções gerais
continuam no banco e são oferecidas por MCP, sem prometer injeção automática em prompts.

A revisão determinística descreve o recorte público consultado; não é versão dos
plugins nem evidência de acesso efetivo no GitHub. Falha de consulta não equivale a
catálogo vazio ou autorização para remoção. Verificação de novidades começa sob demanda.

O novo Journal é texto livre, imutável, com autoria e horário carimbados pelo banco.
Cada pessoa lê o próprio; `journalAdmin` explícito no usuário permite ler todo o tenant.
Esse flag é administrado pelo deploy e não deriva de ser owner de um propósito.
Administradores do Journal também não editam nem apagam. Correções e continuidade são
novas entradas referenciando anteriores. O MCP valida visibilidade da referência;
a referência não participa da autorização. Root operacional continua fora desse
contrato de identidade e exige proteção própria.

## Relação com decisões anteriores

0015 e 0016 continuam sustentando autenticação e recorte. Para a próxima major,
esta decisão substitui a distribuição de library/build de 0012/0017 e a geração
obrigatória de instruções nos arquivos raiz de 0018. A persistência das instruções é
mantida. O domínio antigo de decisões e a fila de frictions de 0013/0014 serão retirados,
com exportação administrativa do histórico. Não se remove nem reescreve este acervo
de ADRs arquiteturais.

## Etapas e evidência

Implementados: catálogo MCP sem build, vínculos administrativos, revisão do catálogo,
Journal append/list e permissões de autor/admin com testes em SurrealDB 3.0.1.
Retirados: emitters, servidor HTTP de build, comandos build/library/plugins sync,
MCPs e comandos de inbox/decisões, e inbox do console. Init não semeia library.
O grafo recebe instruções em ambient.instructions e referências explícitas a plugins.
Deploy preserva tabelas históricas existentes, bloqueia identidades do produto e
não volta a reconciliar decisões nem alterar frictions. Exportação administrativa
nativa e restauração isolada têm cobertura de integração.

Também implementados: reconciliação GitHub e proteções (ADR 0020), revisão das skills
administrativas e documentação do corte. As evidências operacionais privadas ficam no
tenant, sem incorporar seus dados ao Source público.

Pendentes para release: fechar a matriz de aceitação nos quatro clientes em macOS,
confirmar versões/distribuição de plugins, snapshot final após parar escritores antigos,
validar o candidato à release e aprovar publicação/corte em produção. Exportação e
retirada dos mecanismos antigos já existem; não são mais trabalho de implementação.

A política de review por repositório exigirá outra pessoa vinculada a um propósito
dono, com exceções administrativas explícitas no tenant. Nenhum nome de operador deve
ser codificado no motor. Aprovação de release e ações em produção continuam separadas.
