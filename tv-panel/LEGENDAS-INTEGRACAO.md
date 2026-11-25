# Integração do site — Valente TV • Legendas 0.5.0

## Base e limites desta entrega

Preparada a partir de `codigo-tv-ffacc692.zip` e do relatório técnico fornecido, com base identificada como `ffacc692e62437bc22d7eed0bcf9d011005a0de9`, branch main de MarcoNMorais/ifa-valente.

O conteúdo funcional dos arquivos TV fornecidos coincide com a base do teste local original. Foram incorporados o layout aprovado, as legendas, a revisão simplificada, a logo IG transparente no tamanho aprovado e a API do processador.

Este documento descreve o contrato e a operação da integração. Não é um backup dos dados nem uma confirmação do estado Live; confira o histórico de deploys e a configuração efetiva do serviço ao publicar.

## O que aplicar

Esta pasta contém somente `tv-panel/` e documentos de integração. Aplique a atualização à pasta `tv-panel` do repositório, após comparar com o HEAD atual. Não substitua o repositório inteiro por este ZIP.

**Não alterar server.py nem render.yaml do IFA.** A TV já é um serviço Node independente; os redirecionamentos existentes continuam suficientes. O Dockerfile e o .dockerignore são os mesmos da base recebida. O Docker continua copiando os arquivos Node e public; não instala Python, Faster-Whisper nem modelos no Render.

Os arquivos centrais são `captions.mjs`, `tvhosp.mjs`, `public/captions-editor.*`, `public/captions-view.js`, `public/player.js` e seus testes. As alterações ficam restritas à pasta tv-panel.

## Origem correta

O aplicativo deve acessar `https://tv-valente.onrender.com` diretamente. As rotas de `secsaudevalente.com.br/TV` apenas redirecionam para esse serviço; não são um proxy de API. Credenciais não devem ser enviadas através de redirecionamentos entre origens.

## Preparação da conexão, uma vez

1. No computador principal, atualize o aplicativo para 0.5.0. Se usar EXE, gere-o ou gere o instalador atualizado.
2. Feche o aplicativo principal e abra **CONECTAR-AO-SITE.vbs** na pasta do teste portátil. Se usar o EXE, use **CONECTAR-EXE-AO-SITE.vbs** após gerar/instalar o EXE 0.5.0, ou execute esse EXE com `--setup-connection` na conta Windows que usará o aplicativo. Configure a mesma forma de execução que será usada no dia a dia.
3. Clique em **Preparar conexão neste computador**. A chave privada fica protegida por Windows DPAPI; a janela exibe somente o SHA-256 para configuração do servidor.
4. Copie esse valor para a variável **TVHOSP_CAPTION_TOKEN_SHA256** no serviço **tv-valente**, preservando todas as variáveis já existentes, inclusive a senha administrativa e o diretório de dados. Não use a chave do GitHub.
5. Depois da publicação autorizada do código, clique em **Testar conexão com o site**. A confirmação deve indicar conexão com a API versão 1.
6. Feche a configuração e abra o aplicativo normalmente. O botão Verificar legendas passa a usar o site real.

O aplicativo não modifica o Render por conta própria. A primeira configuração permanece em modo local até o administrador preparar a conexão. Caso a chave já esteja configurada, não gere outra desnecessariamente: a nova chave exige atualizar o hash no servidor. Para revogar o computador, remova ou substitua o hash do serviço.

## Persistência e preservação dos dados

Antes de aplicar, conferir o serviço correto, o commit Live, as variáveis efetivas e o disco. O relatório registra historicamente disco TV separado, 10 GB em `/var/tv-data`; isso deve ser confirmado na conta atual. Não usar nem mover o disco do IFA `/var/data`.

Faça backup consistente do diretório de dados da TV e valide a restauração antes da atualização. Não copiar pastas de teste local para o disco de produção.

- `state.json`: continua com a estrutura e os IDs dos vídeos existentes.
- `media/`: vídeos continuam nos mesmos caminhos e com os mesmos IDs.
- `captions.json`: novo arquivo persistente com fila, rascunhos e versões aprovadas.
- `originals/`: preserva o MOV original nos novos envios; os originais que a versão antiga já descartou não podem ser recuperados pelo código.

Na primeira inicialização, a biblioteca existente recebe registros de legenda sem retirar vídeos já programados. Na primeira adoção, o índice anterior também é guardado uma única vez em `state-before-captions.json`; isso não é um backup completo da mídia. A gravação dos dois arquivos JSON é serializada por módulo e usa arquivo temporário/rename. Apenas uma instância Node pode escrever no mesmo diretório.

O hash da chave é configuração do processo e não é gravado nos arquivos de dados. O segredo privado não vai para Git, instalador ou logs.

## Funcionamento depois de conectar

- Envio pelo celular continua no painel habitual.
- Vídeos novos ficam aguardando processamento.
- O computador consulta a fila somente ao clicar em Verificar legendas.
- Vídeos com o mesmo conteúdo compartilham uma tarefa de transcrição. Resultados já gerados não são repetidos.
- Falhas podem ser tentadas novamente numa nova verificação; reservas interrompidas expiram em até três minutos.
- O retorno do processador fica Aguardando revisão e não aparece automaticamente nas TVs.
- **Aprovar legendas** salva a revisão e disponibiliza a versão aprovada em um clique, respeitando Ativar legendas neste vídeo.
- Vídeos novos ainda precisam ser selecionados na programação de cada TV; vídeos já selecionados recebem a nova legenda sem reaplicar a programação.
- As TVs mantêm a legenda da reprodução atual e usam a atualização no início de uma reprodução após sincronizarem.

Após a primeira implantação deste novo player, recarregue cada TV uma vez em uma janela de manutenção para carregar o JavaScript atualizado. O cache de vídeos permanece por ID na mesma origem. Depois disso, mudanças nas legendas são recebidas pelo polling normal. Uma recarga de página pode interromper momentaneamente a reprodução; isso deve ser planejado.

## API do processador — versão 1

Todas as rotas abaixo exigem `Authorization: Bearer <chave privada>`, sob HTTPS. Métodos POST exigem também `X-TVHosp-Request: 1` e JSON.

- `GET /TV/api/caption-worker/pending`: `{apiVersion:1,jobs:[{id,name,fingerprint,stage}],busy}`. Não altera a fila.
- `POST /TV/api/caption-worker/claim`: pode receber `{fingerprints:[...],includeUnqueued:true}`; devolve `{job}` ou `{job:null}`. A reserva é serializada e tem prazo.
- `GET /TV/api/caption-worker/media/<id>`: exige também `X-TVHosp-Job-Lease: <lease>` válido para essa tarefa. Usa o mesmo mecanismo de transferência de vídeo e respectiva quota.
- `POST /TV/api/caption-worker/heartbeat`: `{fingerprint,lease}` renova a reserva.
- `POST /TV/api/caption-worker/complete`: `{fingerprint,lease,duration,model,segments:[{start,end,text}]}` grava o rascunho para revisão.
- `POST /TV/api/caption-worker/fail`: `{fingerprint,lease,error}` registra uma falha.

A chave do processador não autoriza configurações administrativas, exclusão de vídeo ou aprovação. URLs não contêm a chave nem a reserva. Vídeos publicados continuam acessíveis pelas URLs públicas originais, como já ocorria; a restrição de reserva se aplica ao endpoint privado de processamento.

A revisão exige a sessão administrativa existente:

- `GET /TV/api/videos/<id>/captions`: revisão e vídeo.
- `POST /TV/api/videos/<id>/captions/approve-publish`: `{revision,draft:{enabled,style,segments}}`. Valida os dados e grava a nova versão aprovada em uma operação. Revisões antigas retornam 409; dados inválidos não substituem a versão anterior.

As rotas antigas de revisão foram mantidas para compatibilidade, mas a interface usa apenas o botão Aprovar legendas.

O estado público dos canais inclui `captionRevision` e apenas o snapshot aprovado de cada vídeo. A revisão de legendas é persistida separadamente da revisão de programação para que uma notificação interrompida não impeça a sincronização posterior.

## Limites mantidos

- Sem API paga de transcrição.
- Uploads sem reativar os bloqueios de 1 GB/arquivo ou 10 GB/mês.
- Transferência interna de vídeos limitada a 100 GB/30 dias; downloads do processador também entram nessa conta.
- Conversão MOV ainda segue o mecanismo anterior, mantendo a requisição aberta. Não foi transformada em fila nesta entrega.
- A senha administrativa continua compartilhada, como na base.
- Uma chave de processador principal; gestão individual de vários computadores não foi implementada.

## Validação e publicação

Foram aprovados 29 testes Node e 13 testes Python, além de integração real isolada com Faster-Whisper, servidor configurado somente com hash e aprovação em um clique. O teste incluiu 3 uploads, 2 conteúdos únicos, progresso e nenhuma repetição na segunda verificação.

Esses testes locais não substituem a verificação do deploy real nem a validação do instalador em Windows. Consulte os resultados da publicação correspondente e valide a conexão do computador principal após configurar sua credencial.

Antes de publicar, testar em homologação separada com dados sintéticos: upload, retorno do processador, aprovação, cache, reinício, persistência e reprodução no aparelho. Conferir se o serviço TV publica automaticamente ao enviar uma branch ou main; o relatório não confirma a configuração atual. Preservar discos e segredos.

Para rollback, primeiro parar a gravação e guardar backup pós-atualização. A estrutura principal de state.json e os IDs de mídia permanecem compatíveis; a versão antiga simplesmente não conhece legendas. A compatibilidade operacional precisa ser conferida no serviço antes de reverter. Não excluir disco nem substituir dados com um ZIP de código.
