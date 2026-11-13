(()=>{
const $=id=>document.getElementById(id);let isBusy=()=>false,uploading=false,request=null,cancelled=false,selected=[];
async function api(url,options={}){const r=await fetch('/TV/api/'+url,{...options,headers:{'X-TVHosp-Request':'1',...options.headers}});const data=await r.json();if(r.status===401){location.href='/TV';throw Error('Sessão encerrada.');}if(!r.ok)throw Error(data.error||'Não foi possível salvar.');return data;}
function syncUploadControls(){const blocked=isBusy()||uploading;$('files').disabled=blocked;}
function update(){syncUploadControls();}
function sendFile(file){
 return new Promise((resolve,reject)=>{
  const token=Date.now().toString(36)+Math.random().toString(36).slice(2),mov=/\.mov$/i.test(file.name);let stopped=false,pollTimer=null,pollStarted=false;
  const stop=()=>{stopped=true;if(pollTimer!==null)clearTimeout(pollTimer);};
  async function poll(){try{const progress=await api('upload-progress?token='+encodeURIComponent(token),{signal:AbortSignal.timeout(5000)});if(stopped)return;if(['converting','finalizing'].includes(progress.stage)){if(progress.percent===null)$('sendingProgress').removeAttribute('value');else $('sendingProgress').value=progress.percent;const eta=progress.etaSeconds;const time=eta===null?'Calculando tempo…':eta<60?'Menos de 1 minuto restante':'Cerca de '+Math.ceil(eta/60)+' min restantes';$('sendingLabel').textContent=progress.stage==='finalizing'?'Finalizando o MP4…':'Convertendo '+file.name+(progress.percent===null?'':' — '+progress.percent+'%')+' · '+time;}}catch{}finally{if(!stopped)pollTimer=setTimeout(poll,1000);}}
  const xhr=new XMLHttpRequest();request=xhr;xhr.open('POST','/TV/api/upload?name='+encodeURIComponent(file.name)+'&token='+encodeURIComponent(token));xhr.setRequestHeader('X-TVHosp-Request','1');xhr.setRequestHeader('Content-Type',/\.mov$/i.test(file.name)?'video/quicktime':file.type||(/\.webm$/i.test(file.name)?'video/webm':'video/mp4'));xhr.timeout=60*60*1000;
  xhr.upload.onprogress=event=>{if(event.lengthComputable){const percent=Math.floor(event.loaded/event.total*100);$('sendingProgress').value=percent;$('sendingLabel').textContent=percent===100?(/\.mov$/i.test(file.name)?'Preparando vídeo MOV para MP4…':'Concluindo o envio de '+file.name+'…'):'Enviando '+file.name+' — '+percent+'%';if(percent===100&&mov&&!pollStarted){pollStarted=true;$('sendingProgress').removeAttribute('value');$('sendingLabel').textContent='Preparando vídeo… Calculando tempo…';poll();}}};
  xhr.onload=()=>{stop();request=null;let data;try{data=JSON.parse(xhr.responseText);}catch{reject(Error('O servidor não concluiu o envio. Tente novamente.'));return;}if(xhr.status===401){location.href='/TV';reject(Error('Sessão encerrada.'));return;}if(xhr.status<200||xhr.status>=300){reject(Error(data.error||'Não foi possível enviar o vídeo.'));return;}resolve(data);};
  xhr.onerror=()=>{stop();request=null;reject(Error('Falha de conexão durante o envio. Tente novamente.'));};
  xhr.ontimeout=()=>{stop();request=null;reject(Error('O envio demorou demais. Verifique a conexão e tente novamente.'));};
  xhr.onabort=()=>{stop();request=null;reject(Error('Envio cancelado.'));};
  xhr.send(file);
 });
}
function mount(options){
 isBusy=options.isBusy;
 $('cancelUpload').onclick=()=>{cancelled=true;request?.abort();};
 $('files').onchange=event=>{
  if(uploading||isBusy())return;
  selected=Array.from(event.target.files);
  $('selectedFiles').textContent=selected.length?selected.map(file=>file.name).join(' • '):'Nenhum vídeo selecionado.';
  return uploadSelected();
 };
 async function uploadSelected(){
  if(!selected.length||uploading||isBusy())return;
  const files=[...selected];
  uploading=true;cancelled=false;syncUploadControls();$('sendingBox').hidden=false;
  try{
   for(const file of files){
    if(cancelled)throw Error('Envio cancelado.');
    if(!/\.(mp4|webm|mov)$/i.test(file.name))throw Error('Escolha um vídeo MP4, WebM ou MOV.');
    if(!file.size)throw Error('O arquivo está vazio.');
    $('sendingProgress').value=0;$('sendingLabel').textContent='Enviando '+file.name+'…';
    await new Promise(resolve=>setTimeout(resolve,50));
    if(cancelled)throw Error('Envio cancelado.');
    const result=await sendFile(file);
    selected=selected.filter(item=>item!==file);
    await options.onUploaded(result.video);
    options.onDone?.();
   }
   $('videoStatus').textContent='Envio concluído. Selecione os vídeos e aplique a programação.';
  }catch(e){$('videoStatus').textContent=e.message;if($('feedback'))$('feedback').textContent=e.message;}
  finally{$('files').value='';$('selectedFiles').textContent=selected.length?selected.map(file=>file.name).join(' • '):'Nenhum vídeo selecionado.';uploading=false;request=null;$('sendingBox').hidden=true;syncUploadControls();}
 };
 syncUploadControls();
 setInterval(async()=>{if(isBusy()||uploading)return;try{const data=await api('library');if(isBusy()||uploading)return;options.onRefresh?.(data.videos);}catch{}},30000);
}
globalThis.TVLibrary={api,update,mount,syncUploadControls};
})();
