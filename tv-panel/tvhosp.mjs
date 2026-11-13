import {convertMov} from './convert-video.mjs';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, unlink, readdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadUsage } from './upload-policy.mjs';
import { transferUsage, TRANSFER_LIMIT_MESSAGE } from './transfer-policy.mjs';
const base='/TV', assetDir=fileURLToPath(new URL('./public/',import.meta.url));
const channels={
  hospital:{title:'TV Hospital',publicRoute:'/TVHosp',adminRoute:'/Admin/TVHosp',filename:'tv-hospital.html',adminFile:'admin-hospital.html'},
  saude:{title:'TV Saúde',publicRoute:'/TVsaude',adminRoute:'/Admin/TVSaude',filename:'tv-saude.html',adminFile:'admin-saude.html'}
};
const defaults={headline:"Mais perto.\nPara cuidar melhor.",caption:"Informação e acolhimento em todos os momentos.",cyclePause:5,playlist:[],ticker:'Bem-vindo ao Hospital Municipal José Mota Araújo.',rotation:10,enabled:true,interval:5,duration:12,messages:[]};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
const fail=(code,message)=>Object.assign(new Error(message),{code});
async function jsonBody(req){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw fail(413,'Conteúdo muito grande.');parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw fail(400,'Dados inválidos.');}}
export async function createTVHospHandler({dataDir,password,secureCookies=true,maxStorageBytes=Infinity,clock=()=>Date.now()}={}){
  if(typeof password!=='string'||password.length<12)throw Error('Defina TVHOSP_ADMIN_PASSWORD com pelo menos 12 caracteres. Não há senha padrão.');
  const dir=path.resolve(dataDir||'data'),media=path.join(dir,'media'),statePath=path.join(dir,'state.json');
  await mkdir(media,{recursive:true});for(const file of await readdir(media))if(file.endsWith('.part')||file.endsWith('.convert.mp4'))await unlink(path.join(media,file));
  let state;try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={revision:0,config:structuredClone(defaults),videos:[],uploadHistory:[]};}
  // Legacy files count once; an unknown original date must not be invented.
  const migrateHistory=!Object.hasOwn(state,'uploadHistory');
  if(migrateHistory)state.uploadHistory=state.videos.map(v=>({size:v.size,uploadedAt:v.uploadedAt||null}));
  const dateMigration=state.uploadHistory.some(r=>r.uploadedAt===null)&&!state.historyMigrationAt;
  if(dateMigration)state.historyMigrationAt=new Date(clock()).toISOString();
  if(!Array.isArray(state.uploadHistory)||state.uploadHistory.some(r=>!Number.isSafeInteger(r.size)||r.size<=0||(r.uploadedAt!==null&&(typeof r.uploadedAt!=='string'||!Number.isFinite(Date.parse(r.uploadedAt))))))throw Error('Histórico de uploads inválido; restaure o registro antes de iniciar.');
  const migrateChannels=!state.channels;
  if(migrateChannels){
    if(state.config)await writeFile(path.join(dir,'state-before-multiple-tvs.json'),JSON.stringify(state),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    state.channels={hospital:{revision:state.revision,config:{...structuredClone(defaults),...(state.config||{})}},saude:{revision:0,config:{...structuredClone(defaults),ticker:'Secretaria da Saúde de Valente. Informação e cuidado para todos.'}}};
    delete state.config;state.schemaVersion=2;
  }
  for(const channel of Object.values(state.channels))channel.config={...structuredClone(defaults),...channel.config};
  const migrateTransfers=!Object.hasOwn(state,'transferHistory');
  if(migrateTransfers)state.transferHistory=[];
  if(!Array.isArray(state.transferHistory)||state.transferHistory.some(r=>!Number.isSafeInteger(r.size)||r.size<0||!Number.isFinite(Date.parse(r.createdAt))))throw Error('Histórico de transferência inválido; restaure o registro antes de iniciar.');
  const salt=randomBytes(16),hash=scryptSync(password,salt,32),sessions=new Map();password=null;
  let uploadProgress=null;
  let uploadBusy=false,loginFailures=0,loginWindow=Date.now();
  const save=async(next)=>{const temp=statePath+'.tmp';await writeFile(temp,JSON.stringify(next));await rename(temp,statePath);state=next;};
  if(migrateHistory||dateMigration||migrateChannels||migrateTransfers)await save(state);
  const usage=()=>({...uploadUsage(state.uploadHistory,clock(),state.historyMigrationAt),blocked:false,limitsEnforced:false});
  const transfers=()=>transferUsage(state.transferHistory,clock());
  let writeQueue=Promise.resolve();const transact=fn=>{const task=writeQueue.then(fn);writeQueue=task.catch(()=>{});return task;};
  function json(res,code,body){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
  function authenticated(req){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('tvhosp_session='))?.slice(15);return token&&sessions.get(token)>Date.now();}
  function cookie(value,maxAge){return `tvhosp_session=${value}; Path=/TV; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies?'; Secure':''}`;}
  function catalog(){return state.videos.map(v=>({...v,usedBy:Object.entries(state.channels).filter(([,c])=>c.config.playlist.includes(v.id)).map(([key])=>channels[key].title)}));}
  function validateConfig(c){
    if(!c||!Array.isArray(c.playlist)||!Array.isArray(c.messages)||typeof c.ticker!=='string'||c.ticker.length>20000||typeof c.enabled!=='boolean')throw fail(400,'Programação inválida.');
    if(c.playlist.some(id=>!state.videos.some(v=>v.id===id))||new Set(c.playlist).size!==c.playlist.length)throw fail(400,'Seleção de vídeos inválida.');
    for(const [key,min,max] of [['rotation',3,3600],['interval',.1,1440],['duration',3,300]])if(!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw fail(400,`Valor inválido: ${key}`);
    if(c.messages.some(m=>!m||typeof m.id!=='string'||m.id.length>100||typeof m.text!=='string'||!m.text.trim()||m.text.length>2000||typeof m.on!=='boolean')||new Set(c.messages.map(m=>m.id)).size!==c.messages.length)throw fail(400,'Mensagem inválida.');
    const headline=c.headline??defaults.headline,caption=c.caption??defaults.caption,cyclePause=c.cyclePause??defaults.cyclePause;
    if(typeof headline!=='string'||headline.length>200||typeof caption!=='string'||caption.length>300||!Number.isFinite(cyclePause)||cyclePause<0||cyclePause>1440)throw fail(400,'Confira os textos e o tempo de pausa.');
    const tickerMessages=c.tickerMessages??c.ticker.split(/\r?\n/).filter(text=>text.trim()).map((text,i)=>({id:'ticker-'+i,text,on:true}));
    if(!Array.isArray(tickerMessages)||tickerMessages.some(m=>!m||typeof m.id!=='string'||m.id.length>100||typeof m.text!=='string'||!m.text.trim()||m.text.length>2000||typeof m.on!=='boolean')||new Set(tickerMessages.map(m=>m.id)).size!==tickerMessages.length)throw fail(400,'Mensagem do rodapé inválida.');
    return {tickerMessages:tickerMessages.map(({id,text,on})=>({id,text,on})),headline,caption,cyclePause,playlist:c.playlist.slice(),ticker:tickerMessages.filter(m=>m.on).map(m=>m.text).join("\n"),rotation:c.rotation,enabled:c.enabled,interval:c.interval,duration:c.duration,messages:c.messages.map(({id,text,on})=>({id,text,on}))};
  }
  return async function handle(req,res){
    const url=new URL(req.url,'http://localhost'),p=url.pathname;
    if(/^\/tvhosp(?:\/|$)/i.test(p)){
      const tail=p.slice(7).replace(/\/$/,'');let target=base+'/TVHosp';
      if(tail.toLowerCase()==='/admin')target=base+'/Admin/TVHosp';
      else if(tail.startsWith('/api/')){const api=tail.slice(5);target=base+'/api/'+(['state','admin','config'].includes(api)?'hospital/':'')+api;}
      else if(tail.startsWith('/media/'))target=base+tail;
      else if(tail)target=base+'/assets'+tail;
      res.writeHead(308,{Location:target+url.search});res.end();return true;
    }
    if(!/^\/tv(?:\/|$)/i.test(p))return false;
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
    try{
      const canonical=new Map([['/tv','/TV'],['/tv/admin','/TV/Admin'],['/tv/tvhosp','/TV/TVHosp'],['/tv/tvsaude','/TV/TVsaude'],['/tv/admin/tvhosp','/TV/Admin/TVHosp'],['/tv/admin/tvsaude','/TV/Admin/TVSaude'],['/tv/admin/video','/TV/Admin/video']]);
      const canonicalPath=canonical.get(p.replace(/\/$/,'').toLowerCase());
      if(canonicalPath&&p!==canonicalPath){res.writeHead(308,{Location:canonicalPath+url.search});res.end();return true;}
      if(p.slice(0,3)!==base){res.writeHead(308,{Location:base+p.slice(3)+url.search});res.end();return true;}
      const route=p.slice(base.length).replace(/\/$/,'');
      const channelMatch=/^\/api\/(hospital|saude)\/(state|admin|config)$/.exec(route);
      const channel=channelMatch?.[1],operation=channelMatch?.[2];
      if(!['GET','HEAD'].includes(req.method)&&req.headers['x-tvhosp-request']!=='1')throw fail(403,'Requisição não autorizada.');
      if(route==='/api/login'&&req.method==='POST'){
        if(Date.now()-loginWindow>60000){loginWindow=Date.now();loginFailures=0;}
        if(loginFailures>=8)throw fail(429,'Aguarde um minuto antes de tentar novamente.');
        const body=await jsonBody(req);const candidate=String(body.password||'');if(candidate.length>256)throw fail(400,'Senha inválida.');
        if(!timingSafeEqual(scryptSync(candidate,salt,32),hash)){loginFailures++;throw fail(401,'Senha incorreta.');}
        for(const [token,until]of sessions)if(until<Date.now())sessions.delete(token);
        const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+8*3600000);res.setHeader('Set-Cookie',cookie(token,8*3600));json(res,200,{ok:true});return true;
      }
      if(route==='/api/logout'&&req.method==='POST'){for(const token of sessions.keys())if((req.headers.cookie||'').includes(token))sessions.delete(token);res.setHeader('Set-Cookie',cookie('',0));json(res,200,{ok:true});return true;}
      if(operation==='state'&&req.method==='GET'){
        const {config,revision}=state.channels[channel];const selected=new Set(config.playlist);json(res,200,{revision,config:{...config,messages:config.messages.filter(m=>m.on)},videos:state.videos.filter(v=>selected.has(v.id)).map(({id,name,size,type})=>({id,name,size,type,url:`${base}/media/${id}`}))});return true;
      }
      if(route.startsWith('/api/')){
        if(!authenticated(req))throw fail(401,'Entre na administração.');
        if(operation==='admin'&&req.method==='GET'){json(res,200,{...state.channels[channel],channel,videos:catalog()});return true;}
        if(route==='/api/upload-progress'&&req.method==='GET'){json(res,200,uploadProgress?.token===url.searchParams.get('token')?uploadProgress:{stage:'waiting'});return true;}
        if(route==='/api/library'&&req.method==='GET'){json(res,200,{videos:catalog()});return true;}
        if(route==='/api/usage'&&req.method==='GET'){json(res,200,{uploadHistory:state.uploadHistory,uploadUsage:usage(),transferUsage:transfers()});return true;}
        if(operation==='config'&&req.method==='PUT'){
          const body=await jsonBody(req);await transact(async()=>{if(body.revision!==state.channels[channel].revision)throw fail(409,'Outra alteração foi salva. Recarregue a página antes de aplicar.');const config=validateConfig(body.config);await save({...state,revision:state.revision+1,channels:{...state.channels,[channel]:{revision:state.channels[channel].revision+1,config}}});});json(res,200,{revision:state.channels[channel].revision});return true;
        }
        if(route==='/api/upload'&&req.method==='POST'){
          if(uploadBusy)throw fail(409,'Aguarde o envio atual terminar.');
          const name=String(url.searchParams.get('name')||'video').slice(0,200),type=String(req.headers['content-type']||'');
          const isMov=/\.mov$/i.test(name)||type==='video/quicktime';
          if(!isMov&&!['video/mp4','video/webm'].includes(type))throw fail(400,'Envie um vídeo MP4, WebM ou MOV.');
          const size=Number(req.headers['content-length']);if(!Number.isSafeInteger(size)||size<=0)throw fail(400,'Tamanho de arquivo inválido.');
          if(state.videos.reduce((n,v)=>n+v.size,0)+size>maxStorageBytes)throw fail(413,'Armazenamento cheio. Exclua vídeos antigos.');
          const id=randomUUID(),temp=path.join(media,id+'.part'),converted=path.join(media,id+'.convert.mp4');uploadBusy=true;const progressToken=String(url.searchParams.get('token')||id).slice(0,100);uploadProgress={token:progressToken,stage:'uploading',percent:0,etaSeconds:null};let received=0,signature=Buffer.alloc(0);
          try{
            await pipeline(req,new Transform({transform(chunk,encoding,cb){received+=chunk.length;if(signature.length<32)signature=Buffer.concat([signature,chunk.subarray(0,32-signature.length)]);cb(received>size?fail(413,'Arquivo maior que o declarado.'):null,chunk);}}),createWriteStream(temp,{flags:'wx'}));
            if(received!==size)throw fail(400,'Envio incompleto.');
            if(!isMov&&(type==='video/mp4'?signature.subarray(4,8).toString()!=='ftyp':signature.subarray(0,4).toString('hex')!=='1a45dfa3'))throw fail(400,'O arquivo não corresponde ao formato de vídeo informado.');
            let savedSize=size,savedName=name,savedType=type;
            if(isMov){const controller=new AbortController(),cancel=()=>controller.abort();res.once('close',cancel);try{await convertMov(temp,converted,controller.signal,progress=>{uploadProgress={token:progressToken,...progress};});}finally{res.off('close',cancel);}savedSize=(await stat(converted)).size;savedName=name.replace(/\.mov$/i,'')+'.mp4';savedType='video/mp4';await unlink(temp);await rename(converted,path.join(media,id));}else await rename(temp,path.join(media,id));const video={id,name:savedName,size:savedSize,type:savedType};const record={size:received,uploadedAt:new Date(clock()).toISOString()};
            await transact(()=>save({...state,revision:state.revision+1,videos:[...state.videos,video],uploadHistory:[...state.uploadHistory,record]}));
            json(res,201,{video,revision:state.revision,uploadRecord:record,uploadUsage:usage()});
          }catch(e){await unlink(converted).catch(()=>{});await unlink(temp).catch(()=>{});if(!state.videos.some(v=>v.id===id))await unlink(path.join(media,id)).catch(()=>{});throw e;}finally{uploadBusy=false;uploadProgress=null;}return true;
        }
        if(route.startsWith('/api/videos/')&&req.method==='DELETE'){
          const id=route.slice('/api/videos/'.length);await transact(async()=>{const usedBy=Object.entries(state.channels).filter(([,c])=>c.config.playlist.includes(id)).map(([key])=>channels[key].title);if(usedBy.length)throw fail(409,'Este vídeo está em uso em '+usedBy.join(' e ')+'. Desmarque e aplique nessas TVs antes de excluir.');if(!state.videos.some(v=>v.id===id))throw fail(404,'Vídeo não encontrado.');await save({...state,revision:state.revision+1,videos:state.videos.filter(v=>v.id!==id)});await unlink(path.join(media,id)).catch(()=>{});});json(res,200,{revision:state.revision});return true;
        }
        throw fail(404,'Recurso não encontrado.');
      }
      if(route.startsWith('/media/')&&['GET','HEAD'].includes(req.method)){
        const id=route.slice(7),v=state.videos.find(v=>v.id===id);if(!v||(!Object.values(state.channels).some(c=>c.config.playlist.includes(id))&&!authenticated(req)))throw fail(404,'Vídeo indisponível.');
        const headers={'Content-Type':v.type,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=86400'},file=path.join(media,id);let start=0,end=v.size-1,status=200;
        if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':`bytes */${v.size}`});res.end();return true;}
          if(!match[1])start=Math.max(0,v.size-Number(match[2]));else start=Number(match[1]);if(match[1]&&match[2])end=Math.min(end,Number(match[2]));if(start>end||start>=v.size){res.writeHead(416,{'Content-Range':`bytes */${v.size}`});res.end();return true;}status=206;headers['Content-Range']=`bytes ${start}-${end}/${v.size}`;}
        headers['Content-Length']=end-start+1;await stat(file);
        if(req.method==='HEAD'){res.writeHead(status,headers);res.end();return true;}
        // Reserve the full requested response before starting, so concurrent TVs cannot exceed the limit.
        const transferId=randomUUID();
        await transact(async()=>{if(headers['Content-Length']>transfers().remainingBytes)throw fail(429,TRANSFER_LIMIT_MESSAGE);await save({...state,transferHistory:[...state.transferHistory,{id:transferId,size:headers['Content-Length'],createdAt:new Date(clock()).toISOString(),complete:false}]});});
        let sent=0;
        try{res.writeHead(status,headers);await pipeline(createReadStream(file,{start,end}),new Transform({transform(chunk,encoding,cb){sent+=chunk.length;cb(null,chunk);}}),res);}
        finally{await transact(()=>save({...state,transferHistory:state.transferHistory.map(r=>r.id===transferId?{...r,size:sent,complete:true}:r)}));}
        return true;
      }
      const assets=new Set(['style.css','player.js','admin.js','app.js','bridge.js','secretaria.png','brand.png','media-library.js','library-page.js','navigation.js']);
      let file=null;
      if(route==='')file='login.html';
      else if(route==='/Admin')file='choose.html';
      else if(route==='/Admin/video')file='library.html';
      else{for(const info of Object.values(channels)){if(route===info.publicRoute)file=info.filename;if(route===info.adminRoute)file=info.adminFile;}
        if(route.startsWith('/assets/')&&assets.has(route.slice(8)))file=route.slice(8);}
      if(!file||!['GET','HEAD'].includes(req.method))throw fail(404,'Página não encontrada.');
      if(route.startsWith('/Admin')&&!authenticated(req)){res.writeHead(302,{Location:base});res.end();return true;}
      let bytes=await readFile(path.join(assetDir,file));
      if(file.endsWith('.html')&&bytes.includes(Buffer.from('{{VIDEO_LIBRARY}}'))){const fragment=await readFile(path.join(assetDir,'video-library.fragment.html'),'utf8');bytes=Buffer.from(bytes.toString().replace('{{VIDEO_LIBRARY}}',fragment));}
      res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);return true;
    }catch(e){if(!res.headersSent&&!res.destroyed)json(res,e.code&&Number.isInteger(e.code)?e.code:500,{error:e.code&&Number.isInteger(e.code)?e.message:'Não foi possível concluir a operação.'});else if(!res.destroyed)res.end();return true;}
  };
}
