SISTEMA CIS V13 - PERSISTENTE NO MESMO DISCO DO IFA

O que vem neste pacote:

1) Pasta CIS/
   - Sistema visual do CIS.
   - Sem botão de resetar Admin.
   - Login padrão da versão limpa: admin / 1234 e regulador / 1234.

2) cis_routes.py
   - API do CIS.
   - Salva os dados em arquivo JSON no disco persistente.
   - Se no Render existir IFA_DATA_DIR=/var/data, o CIS salva em:
     /var/data/cis/cis_database.json
   - Se você criar CIS_DATA_DIR, ele usa esse caminho diretamente.

3) server.py
   - Importa o app.py original do IFA e adiciona o CIS.
   - Assim você NÃO precisa mexer no app.py.

4) Procfile
   - Troca o start command para iniciar pelo server.py:
     web: gunicorn server:app --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 120

COMO COLOCAR NO GITHUB

1. Extraia este ZIP.
2. No GitHub, na raiz do projeto ifa-valente, envie/substitua:
   - a pasta CIS
   - o arquivo cis_routes.py
   - o arquivo server.py
   - o arquivo Procfile
3. Faça Commit changes.
4. No Render, aguarde o deploy automático ou clique em Manual Deploy > Deploy latest commit.

NÃO precisa editar o app.py.

COMO TESTAR

Abra:
https://secsaudevalente.com.br/CIS

Teste se a API persistente está funcionando:
https://secsaudevalente.com.br/api/cis/status

Se aparecer cis_data_file apontando para /var/data/cis/cis_database.json, está usando o mesmo disco persistente do IFA.

OBSERVAÇÃO IMPORTANTE

O IFA usa a variável IFA_DATA_DIR para apontar para o disco persistente. Se ela estiver como /var/data, o CIS vai aproveitar automaticamente esse mesmo disco e separar os arquivos na subpasta /var/data/cis.
