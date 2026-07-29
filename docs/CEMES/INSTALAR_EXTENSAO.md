# Instalação da extensão CMVR

## Google Chrome

1. Abra `chrome://extensions`;
2. Ative **Modo do desenvolvedor** no canto superior direito;
3. Clique em **Carregar sem compactação**;
4. Selecione a pasta `CemesExtensao` deste pacote;
5. Fixe o ícone **CMVR — Registro de Vagas** na barra do navegador;
6. Clique no ícone;
7. Informe o endereço do sistema e a chave entregue pelo administrador;
8. Clique em **Salvar e testar** e autorize o acesso ao endereço do sistema.

No ambiente publicado, informe exatamente:

`https://secsaudevalente.com.br/Cemes`

## Microsoft Edge

1. Abra `edge://extensions`;
2. Ative **Modo de desenvolvedor**;
3. Clique em **Carregar sem compactação**;
4. Selecione a pasta `CemesExtensao`;
5. Abra o ícone da extensão, informe o endereço e a chave e clique em **Salvar e testar**.

## Teste antes do portal real

Com o sistema local aberto, acesse:

`http://localhost:5000/Cemes/simulador.html`

Clique em **Simular agendamento com sucesso**. A extensão deverá:

1. Identificar a mensagem verde;
2. Mostrar a unidade vinculada;
3. Perguntar o procedimento, a data e o horário realizado;
4. Informar se encontrou saldo dentro da janela cadastrada, entre o horário inicial e o horário máximo;
5. Registrar a utilização ou criar uma pendência.

Como os dados demonstrativos estão desativados, gere primeiro uma chave individual em **Administração → Extensões autorizadas**. Para testar o fluxo completo, cadastre também uma pequena agenda para a unidade piloto.

## Funcionamento sem conexão

Se o sistema ficar temporariamente indisponível, o lançamento permanece guardado na extensão e o ícone mostra a quantidade pendente. A extensão tenta novamente a cada dois minutos. Também é possível clicar em **Sincronizar registros pendentes**.

Erros de preenchimento e chaves inválidas não entram nessa fila; são mostrados imediatamente para correção.
