Sistema CIS - Regulação e Marcação - v12

Como abrir:
1. Extraia o ZIP.
2. Abra o arquivo index.html no Google Chrome.
3. Use o login criado para Admin ou Regulador. As informações de acesso não aparecem na tela inicial.

O que mudou na v12:
- Administração ganhou gestão completa de operadores.
- Agora mostra todos os operadores cadastrados em tabela.
- Admin pode adicionar novo operador.
- Admin pode editar nome, login, senha, perfil Admin/Regulador e status Ativo/Inativo de cada operador.
- Admin pode excluir operador, com proteção para não deixar o sistema sem Admin ativo.
- Backup completo agora leva a nova lista de operadores.
- Importação de backup antigo converte automaticamente o modelo antigo de usuário Admin/Regulador para a nova lista de operadores.

Regras mantidas:
- Apenas Admin visualiza Administração, backup, importações oficiais, usuários e log.
- Regulador acessa Dashboard, Filas, Cadastro e Bases e configurações.
- Na fila aparece apenas o primeiro nome/login de quem colocou o paciente no sistema.
- Log registra login, logout, inclusão, edição, exclusão, backup, importações, alterações de usuários e movimentações de bases.

Importar bases oficiais:
Entre como Admin > Administração > Importações oficiais.

CID-10:
- Use o CID-10-SUBCATEGORIAS.CSV do DATASUS/CBCD.

SIGTAP:
- Use o arquivo tb_procedimento.txt da competência do SIGTAP.
- Ao importar SIGTAP, ele alimenta o campo de Procedimento e o campo CID/SIGTAP/CIAP/Motivo.

CIAP-2:
- Use arquivo CSV/TXT com código e descrição da CIAP-2.

Backup:
- Entre como Admin > Administração > Backup e internet.
- Faça backup diário se o uso for local.

Para colocar na internet:
- Para página pública somente com números/estatísticas, use o botão Gerar arquivo para internet.
- Para vários usuários cadastrando pela internet, o correto é usar banco de dados com login, permissões e backup, por exemplo PostgreSQL/Supabase/Firebase ou backend próprio.


ALTERAÇÕES ANTERIORES:
- Login passou a ignorar letras maiúsculas/minúsculas. Exemplo: Irla, irla ou IRLA entram no mesmo operador.
- Senha continua diferenciando maiúsculas/minúsculas.


ALTERAÇÕES ANTERIORES:
- Corrigido o botão Excluir no cadastro: agora o ID interno é carregado corretamente ao abrir pela fila.
- Incluída segurança extra para localizar cadastros antigos pelo conteúdo do formulário caso o ID esteja vazio.


Versão v12:
- Removido botão de reset do Admin da tela de login.
- Preparado para salvar no backend Flask em /api/cis quando publicado online.
- Mantém funcionamento local pelo navegador se aberto direto no computador.

V13 Render persistente:
No Render, usando server.py + cis_routes.py, os dados do CIS são salvos em /var/data/cis/cis_database.json quando a variável IFA_DATA_DIR=/var/data estiver configurada.
