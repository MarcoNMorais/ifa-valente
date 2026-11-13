const channel=document.body.dataset?.channel||'hospital';
const $=id=>document.getElementById(id),video=$('video');
let config={playlist:[],messages:[],ticker:channel==='hospital'?'Bem-vindo ao Hospital Municipal José Mota Araújo.':'Secretaria da Saúde de Valente. Informação e cuidado para todos.',rotation:10,interval:5,duration:12,enabled:true},revision=-1,current=null,urls=new Map(),pending=false,notice=false,noticeEnd=0,deadline=Date.now()+300000,lastMessage=null,tickerIndex=0,tickerAt=0,db=null,needsInteraction=false,failures=new Set();
video.muted=false;
let soundBlocked=false,pauseUntil=0,messageAt=0;
function message(text){$('status').textContent=text;}
const openDB=new Promise((resolve,reject)=>{const r=indexedDB.open('tvhosp-player-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('media');r.result.createObjectStore('settings');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function store(mode,table,key,value){if(!db)throw Error('Armazenamento local indisponível.');return new Promise((resolve,reject)=>{const tx=db.transaction(table,mode),object=tx.objectStore(table);let r;if(mode==='readonly')r=object.get(key);else if(value===undefined)r=object.delete(key);else r=object.put(value,key);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Não foi possível salvar o vídeo neste aparelho.'));});}
function soundUI(){
  $('sound').textContent=video.muted?'Ativar som':'Silenciar';
  $('activatePlayback').hidden=!(soundBlocked||needsInteraction);
  $('activatePlayback').textContent=soundBlocked?'Ativar som — pressione OK ou clique aqui':'Iniciar exibição — pressione OK ou clique aqui';
}
async function play(){
  const source=video.src;
  try{await video.play();if(source!==video.src)return;needsInteraction=false;soundUI();message('');}
  catch(error){
    if(source!==video.src||error.name==='AbortError')return;
    if(error.name==='NotAllowedError'&&!video.muted){
      video.muted=true;soundBlocked=true;soundUI();
      try{await video.play();if(source!==video.src)return;needsInteraction=false;soundUI();return;}catch(inner){if(source!==video.src||inner.name==='AbortError')return;}
    }
    needsInteraction=true;soundUI();message('Use OK ou clique no aviso para iniciar.');
  }
}
function activatePlayback(){
  if(soundBlocked)video.muted=false;
  soundBlocked=false;needsInteraction=false;soundUI();
  if(current&&!notice)play();
}
function next(){pauseUntil=0;const available=config.playlist.filter(id=>urls.has(id)&&!failures.has(id));const index=available.indexOf(current);current=available[(index+1)%available.length]||null;if(!current){video.pause();video.hidden=true;welcome(true);return;}video.hidden=false;video.src=urls.get(current);play();cleanupURLs();}
async function discardUnusedMedia(id){if(!db)return;const other=await store('readonly','settings','published:'+(channel==='hospital'?'saude':'hospital'));if(!other?.config.playlist.includes(id))await store('readwrite','media',id);}
function cleanupURLs(){for(const [id,url]of urls)if(id!==current&&!config.playlist.includes(id)){URL.revokeObjectURL(url);urls.delete(id);discardUnusedMedia(id).catch(()=>{});}}
function active(){return config.enabled?config.messages.filter(m=>m.on):[];}
function welcome(force=false){
 const now=Date.now(),list=active();
 if(force||now>=messageAt){const m=list.length?list[(list.findIndex(m=>m.id===lastMessage)+1)%list.length]:null;if(m)lastMessage=m.id;$('welcomeTitle').textContent=m?m.text:(config.headline??"Mais perto.\nPara cuidar melhor.");messageAt=now+config.duration*1000;}
 $('welcomeCaption').textContent=config.caption??"Informação e acolhimento em todos os momentos.";
}
video.onended=()=>{const available=config.playlist.filter(id=>urls.has(id)&&!failures.has(id));if(available.indexOf(current)===available.length-1&&available.length&&config.cyclePause>0){current=null;video.hidden=true;pauseUntil=Date.now()+config.cyclePause*60000;welcome(true);}else next();};
video.onerror=()=>{if(current)failures.add(current);message('Um vídeo não pôde ser reproduzido neste aparelho.');setTimeout(next,500);};
function tick(){const now=Date.now();$('clock').textContent=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});$('tvDate').textContent=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long'});if(now-tickerAt>=config.rotation*1000){const texts=config.ticker.split('\n').map(s=>s.trim()).filter(Boolean);$('tickerText').textContent=texts.length?texts[tickerIndex++%texts.length]:'';tickerAt=now;}
if(pauseUntil&&now>=pauseUntil)next();
if(!current)welcome();}
function accept(state){config={headline:"Mais perto.\nPara cuidar melhor.",caption:"Informação e acolhimento em todos os momentos.",cyclePause:5,...state.config};revision=state.revision;tickerAt=0;failures.clear();if(!current&&!pauseUntil)next();if(!current)welcome(true);cleanupURLs();}
async function synchronize(){try{const response=await fetch('/TV/api/'+channel+'/state',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Servidor indisponível.');const state=await response.json();if(state.revision===revision&&state.config.playlist.every(id=>urls.has(id)))return;
  // Only a complete, locally saved playlist replaces the active one.
  for(const id of state.config.playlist){if(urls.has(id))continue;let blob=await store('readonly','media',id);if(!blob){const item=state.videos.find(v=>v.id===id);message('Preparando a programação neste aparelho…');const r=await fetch(item.url,{signal:AbortSignal.timeout(1800000)});if(r.status===429)throw Object.assign(Error('Transferência limitada.'),{transferLimited:true});if(!r.ok)throw Error('Não foi possível baixar um vídeo.');blob=await r.blob();if(blob.size!==item.size)throw Error('O download do vídeo ficou incompleto.');await store('readwrite','media',id,blob);}urls.set(id,URL.createObjectURL(blob));}
  await store('readwrite','settings','published:'+channel,state);accept(state);message(needsInteraction?'Clique na tela para iniciar a reprodução.':'');
}catch(e){if(e.transferLimited)message(current?'Novos vídeos aguardando liberação. A programação salva continua.':'Programação aguardando liberação. Contate o suporte.');else if(e.name==='QuotaExceededError')message('Espaço insuficiente neste aparelho para salvar a nova programação.');else if(!current)message('Aguardando conexão para carregar a programação.');}finally{setTimeout(synchronize,15000);}}
async function boot(){try{db=await openDB;const previous=await store('readonly','settings','published:'+channel)||(channel==='hospital'?await store('readonly','settings','published'):null);if(previous){for(const id of previous.config.playlist){const blob=await store('readonly','media',id);if(blob)urls.set(id,URL.createObjectURL(blob));}accept(previous);}}catch{message('Este navegador não permite salvar os vídeos. Use Chrome ou Edge com armazenamento disponível.');return;}synchronize();}
$('activatePlayback').onclick=activatePlayback;
$('screen').onclick=()=>{if(needsInteraction||soundBlocked)activatePlayback();};
$('sound').onclick=()=>{video.muted=!video.muted;soundBlocked=false;needsInteraction=false;soundUI();if(current&&!notice)play();if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});};
let wakeLock;async function keepAwake(){try{if(navigator.wakeLock)wakeLock=await navigator.wakeLock.request('screen');}catch{}}
$('expandTv').onclick=()=>{document.documentElement.requestFullscreen().catch(()=>{});keepAwake();};document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')keepAwake();});
let hide;function reveal(){document.body.classList.add('controls-visible');clearTimeout(hide);hide=setTimeout(()=>document.body.classList.remove('controls-visible'),3000);}document.addEventListener('pointermove',reveal);document.addEventListener('keydown',event=>{
  reveal();
  const buttons=[$('expandTv'),$('sound')];
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
    event.preventDefault();const index=buttons.indexOf(document.activeElement),delta=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;
    buttons[index<0?(delta>0?0:buttons.length-1):(index+delta+buttons.length)%buttons.length].focus();
  }else if(['Enter',' ','OK','Select'].includes(event.key)){
    if(document.activeElement?.tagName==='BUTTON'){
      if(['OK','Select'].includes(event.key)){event.preventDefault();document.activeElement.click();}
    }else{
      event.preventDefault();if(soundBlocked||needsInteraction)activatePlayback();else $('expandTv').focus();
    }
  }else if(event.key==='Escape'){
    if(buttons.includes(document.activeElement))document.activeElement.blur();document.body.classList.remove('controls-visible');
  }
});soundUI();reveal();tick();setInterval(tick,500);boot();
