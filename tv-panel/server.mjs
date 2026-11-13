import http from 'node:http';
import { createTVHospHandler } from './tvhosp.mjs';
const handle = await createTVHospHandler({dataDir:process.env.TVHOSP_DATA_DIR||'./data',password:process.env.TVHOSP_ADMIN_PASSWORD,secureCookies:process.env.NODE_ENV==='production'});
const server=http.createServer(async(req,res)=>{if(!await handle(req,res)){res.writeHead(404);res.end('Not found');}});
server.requestTimeout=60*60*1000;
server.headersTimeout=60000;
server.listen(Number(process.env.PORT)||3000,process.env.HOST||(process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1'),()=>console.log('TVHosp disponível. Rotas: /TV, /TV/Admin, /TV/TVHosp e /TV/TVsaude'));
