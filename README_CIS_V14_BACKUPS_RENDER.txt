CIS v14 - Render persistente + últimos 10 backups automáticos

Arquivos para subir na raiz do mesmo repositório do IFA:
- pasta CIS/
- cis_routes.py
- server.py
- Procfile

Não precisa alterar o app.py.

IMPORTANTE NO RENDER:
O Start Command deve continuar:

gunicorn server:app --bind 0.0.0.0:$PORT --workers 1 --threads 8

Armazenamento:
- Banco principal do CIS: /var/data/cis/cis_database.json
- Backups automáticos: /var/data/cis/backups/

Rotas principais:
- /CIS
- /CIS/DashBord
- /CIS/Filas
- /CIS/Cadastros
- /CIS/Bases
- /CIS/Administracao

Rotas de API:
- /api/cis/status
- /api/cis/dados
- /api/cis/salvar
- /api/cis/backup
- /api/cis/backups
- /api/cis/backup/<nome_do_arquivo>

Novidade da v14:
- O sistema salva automaticamente no persistente do Render.
- Antes de sobrescrever o banco principal, cria backup automático.
- Mantém os últimos 10 backups automáticos no Render.
- Na aba Administração, o Admin vê os últimos 10 backups e pode baixar cada um.
- Botão "Gerar backup agora" cria backup manual no Render e baixa o arquivo.
