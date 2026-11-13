import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createTVHospHandler} from './tvhosp.mjs';

if(Number(process.versions.node.split('.')[0])<22){
  console.error('Este teste precisa do Node.js 22 ou superior.');process.exitCode=1;
}else{
  let handler;
  const server=http.createServer(async(req,res)=>{
    if(!handler){res.writeHead(503);res.end('Preparando o painel. Aguarde alguns segundos.');return;}
    if(!await handler(req,res)){res.writeHead(302,{Location:'/TV/Admin'});res.end();}
  });
  server.on('error',error=>{
    console.error(error.code==='EADDRINUSE'?'A porta 3000 esta ocupada. Feche outro teste deste painel e tente novamente.':'Nao foi possivel iniciar o teste: '+error.message);
    process.exitCode=1;
  });
  server.listen(3000,'127.0.0.1',async()=>{
    try{
      const password=randomBytes(12).toString('base64url');
      handler=await createTVHospHandler({dataDir:fileURLToPath(new URL('./data-teste/',import.meta.url)),password,secureCookies:false});
      console.log('\n=====================================================');
      console.log(' TVs DA SAUDE - TESTE LOCAL');
      console.log('=====================================================\n');
      console.log('Administracao: http://127.0.0.1:3000/TV/Admin');
      console.log('Login:        http://127.0.0.1:3000/TV');
      console.log('TV Hospital:  http://127.0.0.1:3000/TV/TVHosp');
      console.log('TV Saude:     http://127.0.0.1:3000/TV/TVsaude\n');
      console.log('Senha desta sessao de teste: '+password+'\n');
      console.log('Abra os enderecos acima no Chrome ou Edge.');
      console.log('Mantenha esta janela aberta enquanto testa.');
      console.log('Para encerrar, feche a janela ou pressione Ctrl+C.\n');
      console.log('Este teste funciona somente neste computador.');
      console.log('Videos, mensagens e historico ficam na pasta data-teste.');
      console.log('A senha muda ao reiniciar; os dados continuam salvos.');
      console.log('Nada sera enviado ao site principal.\n');
    }catch(error){console.error('Nao foi possivel preparar o painel: '+error.message);server.close();process.exitCode=1;}
  });
}
