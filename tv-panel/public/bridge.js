const channel=document.body.dataset.channel;
const channelTitle=channel==='hospital'?'TV Hospital':'TV Saúde';
let remoteRevision=0,remoteConfig=null,busy=false;
const controls=['applyVideos','apply','publishPreview','start','files'];
const api=TVLibrary.api;
async function task(fn){if(busy)return;busy=true;controls.forEach(id=>$(id).disabled=true);try{await fn();}catch(e){$('feedback').textContent=e.message;$('videoStatus').textContent=e.message;}finally{busy=false;controls.forEach(id=>$(id).disabled=false);TVLibrary.syncUploadControls();}}
function mergeCatalog(videos){
  const byId=new Map(videos.map(v=>[v.id,v]));
  clips=clips.filter(c=>byId.has(c.id));for(const c of clips)Object.assign(c,byId.get(c.id));
  const existing=new Set(clips.map(c=>c.id));for(const v of videos)if(!existing.has(v.id))clips.push({...v,url:'/TV/media/'+v.id,on:false});
  render();
}
async function loadRemote(){const data=await api(channel+'/admin');remoteRevision=data.revision;remoteConfig=data.config;TVLibrary.update(data);const selected=data.config.playlist;clips=[...selected.map(id=>data.videos.find(v=>v.id===id)).filter(Boolean),...data.videos.filter(v=>!selected.includes(v.id))].map(v=>({...v,url:'/TV/media/'+v.id,on:selected.includes(v.id)}));for(const key of keys)$(key)[$(key).type==='checkbox'?'checked':'value']=data.config[key];messageBank=data.config.messages;tickerBank=data.config.tickerMessages??data.config.ticker.split(/\r?\n/).filter(text=>text.trim()).map((text,i)=>({id:"ticker-"+i,text,on:true}));renderTicker();apply();applyPlaylist();render();renderMessages();}
function renderDeleteButtons(){[...$('library').children].forEach((row,i)=>{const c=clips[i],label=document.createElement('small');label.className='usage-label';label.textContent=c.usedBy?.length?'Em uso: '+c.usedBy.join(' • '):'Ainda não publicado';row.querySelector('span').append(label);const b=document.createElement('button');b.textContent='Excluir';b.onclick=()=>task(async()=>{await api('videos/'+c.id,{method:'DELETE'});const data=await api('library');TVLibrary.update(data);mergeCatalog(data.videos);$('videoStatus').textContent='Vídeo excluído da biblioteca compartilhada.';});row.append(b);});}
const baseRender=render;render=function(){baseRender();renderDeleteButtons();};
async function publish(config){const result=await api(channel+'/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:remoteRevision,config})});remoteRevision=result.revision;remoteConfig=structuredClone(config);}
function publishDraft(){return task(async()=>{apply();await publish({...remoteConfig,...cfg,playlist:clips.filter(v=>v.on).map(v=>v.id),messages:structuredClone(messageBank),tickerMessages:structuredClone(tickerBank)});$('videoStatus').textContent='Programação completa publicada na '+channelTitle+'.';$('feedback').textContent='Publicado. A TV termina o vídeo atual antes de trocar.';});}
$('applyVideos').onclick=publishDraft;$('apply').onclick=publishDraft;$('publishPreview').onclick=publishDraft;
TVLibrary.mount({isBusy:()=>busy,run:task,onUploaded:video=>{clips.push({...video,url:'/TV/media/'+video.id,on:true,usedBy:[]});render();},onDone:markPlaylistDirty,onRefresh:mergeCatalog});
const baseSaveMessages=saveMessages;saveMessages=function(){baseSaveMessages();$('feedback').textContent='Mensagens alteradas. Use Assistir prévia ou Aplicar programação.';};
$('logout').onclick=async()=>{await api('logout',{method:'POST'});location.href='/TV';};
task(loadRemote);
