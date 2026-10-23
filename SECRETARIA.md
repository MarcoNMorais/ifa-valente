# Secretaria — Atendimento Especial

Entrada independente: `/secretaria` (também aceita `/Secretaria`). Após o login:
`/secretaria/AtendimentoEspecial/Principal`, `/Relatorios` e `/Cadastro`.
O cookie de sessão é exclusivo deste módulo, HttpOnly, SameSite=Strict e Secure
em produção. Todas as consultas, anexos, notas e backups exigem autenticação.

O middleware encaminha qualquer caminho fora de `/secretaria` para o aplicativo
original sem alterar o processamento. Não modifica os bancos de IFA, CIS, CEMES
ou EstoqueHospital. Não é necessário alterar o comando de execução do Render.

## Dados persistentes

Banco, anexos e backups ficam em `${IFA_DATA_DIR}/secretaria` (no Render,
`/var/data/secretaria`). Pode-se definir `SECRETARIA_DATA_DIR` separadamente.
Não hospedar sem disco persistente. A aplicação reutiliza o banco existente,
sem substituí-lo durante publicações ou reinícios.

## Apresentação

O banco e os anexos não fazem parte do repositório, nem mesmo criptografados.
O administrador inicial é copiado uma única vez do banco IFA existente, aberto
em modo somente leitura. Depois disso, os acessos e sessões são independentes.
Em instalações separadas, `SECRETARIA_INITIAL_PASSWORD` pode definir o acesso
inicial sem incluir credenciais no código.

Uma cópia AES-256-GCM é transferida diretamente ao servidor por administrador
autenticado via `POST /secretaria/api/import-presentation`, com CSRF e confirmação
da senha. O pacote usa PBKDF2-SHA256 com 600.000 iterações e fica fora do GitHub.
A importação só funciona no banco vazio, registra um marcador persistente
e nunca substitui registros existentes ou se repete após reinícios.
Os dados de apresentação continuam disponíveis para a reunião; não há rotina
automática para apagá-los. Antes de zerar futuramente, gerar backup completo e
preservar o marcador `secretaria_meta.presentation_imported`.

O login permanece independente do IFA. Para usar: entrar em `/secretaria` com
o acesso administrativo já utilizado na versão local.

Os anexos enviados pela versão online ficam no disco persistente do servidor.
Os arquivos e a base da versão offline original permanecem no computador.
