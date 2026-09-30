# CIS v15

Mudanças limitadas ao módulo CIS. IFA, Estoque, CEMES e seus bancos não são alterados.

## Acesso e persistência

O login passa a ser validado no servidor. Senhas legadas são migradas para hash no primeiro login, mantendo a mesma credencial. As respostas de dados não contêm senhas nem hashes. Backups, status e administração exigem administrador; requisições de gravação exigem sessão e token CSRF.

Cada gravação compara a revisão carregada. Se outro computador tiver alterado o banco, a gravação é recusada e a tela permite exportar alterações pendentes. Recarregue e reaplique as alterações necessárias. Falhas de leitura não inicializam uma base vazia. O backup anterior precisa ser criado antes da gravação atômica. Há bloqueio entre threads e processos.

Em banco novo, configure `CIS_INITIAL_ADMIN_PASSWORD` com pelo menos oito caracteres. Bancos existentes conservam os operadores. Não há senha padrão.

## Sistemas e importação

Cada cadastro admite Policlínica, IDS, SRA e Lista Única, com seleção múltipla e filtro na fila. Campos históricos desconhecidos permanecem vazios. `Não informado` é usado quando a fonte não indica situação do atendimento.

Administração aceita lote JSON `cis-importacao-v1`, com a lista `pacientes`. Registros precisam de `id`, `nome` e `importKey`; uma chave já presente não é incluída novamente. A importação acrescenta pacientes e não substitui usuários ou cadastros existentes. A origem da planilha e linha é mostrada no cadastro quando disponível. Possíveis relações por nome e SUS são sinalizadas para conferência, sem decidir se pedidos diferentes são duplicados.

Dados reais, planilhas, lotes e credenciais nunca devem ser adicionados ao GitHub.

## Documentos no computador principal

No cadastro, use **Selecionar pasta dos documentos** no Chrome ou Edge, em HTTPS. Depois de salvar um paciente, reabra-o pela fila, selecione os arquivos e use **Salvar arquivos na pasta**. A pasta escolhida fica lembrada neste navegador, sujeito à renovação da permissão.

Os arquivos são gravados diretamente na pasta selecionada, numa subpasta por identificador do cadastro. Cada nome recebe um identificador único para impedir sobrescritas. O conteúdo dos documentos não é enviado à hospedagem e não integra o backup do banco CIS. Faça backup separado da pasta.

Nos outros computadores, selecione a mesma pasta de rede, já compartilhada pelo administrador do Windows. O computador principal deve permanecer ligado e acessível. Uma pasta local diferente em outro computador não contém os anexos do principal. Esta versão não cria compartilhamentos nem abre portas automaticamente. A primeira escolha da pasta exige interação do usuário no seletor do navegador.

## Validação

`python -m unittest discover -s tests -p test_cis.py`

Os testes usam bancos temporários e verificam autenticação, CSRF, proteção de backups, preservação de corrupção, migração das senhas, impedimento de remoção do último administrador e conflito de gravações. O cadastro, seleção múltipla, filtro e reabertura também foram exercitados em navegador com paciente sintético.
