# TV independente da IFA

Este módulo é adicionado ao repositório IFA, mas executa em um processo e serviço próprios. Não importa Flask, não acessa os bancos da IFA e não exige alterações em server.py, render.yaml, Procfile ou nos sistemas existentes. Todos os arquivos desta entrega estão em tv-panel/.

O Dockerfile combinado do ZIP não foi adotado: ele exigiria trocar o runtime da IFA. Esta versão usa somente Node e FFmpeg, com contexto de build limitado a tv-panel. Não montar o disco da IFA neste container. A TV grava programação e vídeos exclusivamente em TVHOSP_DATA_DIR.

## Testar localmente

Requer Node >=22 e FFmpeg no PATH (ou FFMPEG_PATH apontando para o executável). No PowerShell, a partir de tv-panel:

```powershell
$env:TVHOSP_ADMIN_PASSWORD = Read-Host 'Senha da TV (mínimo 12 caracteres)'
$env:TVHOSP_DATA_DIR = Join-Path $env:TEMP 'tv-valente-local'
$env:NODE_ENV = 'development'
node server.mjs
```

Abra http://127.0.0.1:3000/TV. Não use development em hospedagem pública. O arquivo .env.example é referência; as variáveis devem ser injetadas no processo.

## Container exclusivo

Na raiz do repositório:

```sh
docker build -t tv-valente ./tv-panel
docker run --rm -p 127.0.0.1:3000:3000 -e TVHOSP_ADMIN_PASSWORD -e NODE_ENV=development -v tv-valente-data:/var/tv-data tv-valente
```

O exemplo de execução é apenas local, via HTTP. Para produção, manter NODE_ENV=production e publicar por HTTPS, necessário para o cookie Secure. Fornecer TVHOSP_ADMIN_PASSWORD como segredo, nunca como arquivo versionado.

## Serviço separado no Render

Criar somente quando a hospedagem e seu custo forem aprovados. Usar um novo Web Service Docker apontado para este repositório e branch, Root Directory tv-panel, Dockerfile Path ./Dockerfile e contexto dessa mesma pasta. Não modificar o serviço ifa-valente nem aplicar seu render.yaml a este serviço novo.

- Definir TVHOSP_ADMIN_PASSWORD com pelo menos 12 caracteres.
- Manter NODE_ENV=production, HOST=0.0.0.0, FFMPEG_PATH=/usr/bin/ffmpeg e TVHOSP_DATA_DIR=/var/tv-data. PORT é fornecida pelo provedor.
- Usar armazenamento persistente exclusivo em /var/tv-data, com permissão de escrita para o usuário node (UID 1000). Dimensionar para os vídeos e espaço temporário de conversão; não reutilizar o disco da IFA.
- Executar uma única instância. Health check HTTP: /TV/TVHosp.
- Usar a URL HTTPS do novo serviço. A rota /TV não passa a existir automaticamente no domínio atual da IFA.

Rotas: /TV (login), /TV/Admin (escolha), /TV/Admin/TVHosp, /TV/Admin/TVSaude, /TV/Admin/video, /TV/TVHosp e /TV/TVsaude. As duas TVs têm programação independente e biblioteca compartilhada dentro deste módulo.

## Validação e limites

Em 12/11/2026, os 19 testes do pacote passaram com FFmpeg, incluindo conversão MOV com áudio, login, isolamento de canais, persistência, upload, reprodução e transferência. Comando a partir de tv-panel: node --test test/*.test.mjs.

Base conferida: 5afb601a3131573298073c852f91e3873d669e2b. Nenhum arquivo preexistente foi alterado. Não foram executados os sistemas Python nem testes que acessem seus bancos.

Docker não está instalado no ambiente de preparação; a imagem Linux e a hospedagem ainda precisam de homologação. Antes do uso real, testar reinício com persistência, vídeo MOV longo sob os limites do provedor, HTTPS, áudio e reprodução por 24 horas no aparelho. Upload/conversão mantém a requisição aberta e pode exceder o timeout do provedor. O bloqueio de upload permanece desativado; o limite interno de transferência permanece em 100 GB/30 dias e não representa teto da fatura.

Não foram criados serviços, discos pagos, domínios ou segredos. Não houve mudança ou migração dos bancos existentes. Para reverter o painel, parar somente seu serviço; preservar seu volume se houver dados a conservar.
