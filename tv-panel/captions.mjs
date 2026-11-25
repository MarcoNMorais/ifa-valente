import {readFile,writeFile,rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
export const statusLabels={queued:'Aguardando processamento',processing:'Gerando legendas',review:'Aguardando revisão',approved:'Legendas aprovadas',published:'Legendas aprovadas',error:'Erro no processamento'};
export const defaultStyle={font:'Arial',size:42,color:'#ffffff',align:'center',position:'center'};
const fail=(code,message)=>Object.assign(new Error(message),{code});
export function validateDraft(data,duration=null){
 if(!data||typeof data.enabled!=='boolean'||!Array.isArray(data.segments)||data.segments.length>10000)throw fail(400,'Legendas inválidas.');
 let previousEnd=0;const segments=data.segments.map((s,i)=>{if(!s||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||(i&&s.start<previousEnd)||(duration!==null&&s.end>duration+.25)||typeof s.text!=='string'||!s.text.trim()||s.text.length>1000)throw fail(400,'Confira texto e tempos do trecho '+(i+1)+'. Os trechos não podem se sobrepor.');previousEnd=s.end;return {start:s.start,end:s.end,text:s.text.trim()};});
 const style={...defaultStyle,...data.style};if(!['Arial','Verdana','Georgia','Tahoma'].includes(style.font)||!Number.isFinite(style.size)||style.size<20||style.size>80||!/^#[0-9a-f]{6}$/i.test(style.color)||!['left','center','right'].includes(style.align)||!['top','center','bottom'].includes(style.position))throw fail(400,'Aparência da legenda inválida.');
 return {enabled:data.enabled,segments,style};
}
export async function createCaptions({dir,onPublish=async()=>{},token=process.env.TVHOSP_CAPTION_TOKEN||'',tokenHash=process.env.TVHOSP_CAPTION_TOKEN_SHA256||'',clock=()=>Date.now()}){
 const file=path.join(dir,'captions.json');let state;try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={schemaVersion:1,records:{},jobs:{}};}
 let queue=Promise.resolve();const change=fn=>{const result=queue.then(async()=>{const next=structuredClone(state),out=await fn(next);await writeFile(file+'.tmp',JSON.stringify(next));await rename(file+'.tmp',file);state=next;return out;});queue=result.catch(()=>{});return result;};
 const get=id=>{const r=state.records[id];if(!r)throw fail(404,'Legendas não encontradas.');return structuredClone(r);};
 const check=(r,revision)=>{if(r.revision!==revision)throw fail(409,'As legendas foram alteradas. Recarregue antes de salvar.');};
 function summary(id){const r=state.records[id];return r?{stage:r.stage,label:statusLabels[r.stage],revision:r.revision,enabled:r.draft.enabled,hasPublished:!!r.published,error:r.error||null}:null;}
 async function register(id,mediaPath,{legacy=false}={}){
  if(state.records[id])return;
  const hash=createHash('sha256');try{for await(const chunk of createReadStream(mediaPath))hash.update(chunk);}catch(e){if(!legacy||e.code!=='ENOENT')throw e;hash.update('legacy-missing:'+id);}const fingerprint=hash.digest('hex');
  await change(s=>{if(s.records[id])return;let job=s.jobs[fingerprint];if(!job)job=s.jobs[fingerprint]={fingerprint,stage:legacy?'dormant':'queued',attempts:0};else if(!legacy&&job.stage==='dormant')job.stage='queued';
   const draft={enabled:!legacy,style:{...defaultStyle},segments:structuredClone(job.result?.segments||[])};
   s.records[id]={fingerprint,stage:job.result?'review':legacy?'review':job.stage==='error'?'error':job.stage==='processing'?'processing':'queued',revision:0,draft,duration:job.result?.duration??null,published:null,approved:false,legacy,error:job.error||null};});
 }
 if(tokenHash&&!/^[0-9a-f]{64}$/i.test(tokenHash))throw Error('TVHOSP_CAPTION_TOKEN_SHA256 deve conter um SHA-256 hexadecimal.');
 const expectedHash=tokenHash?Buffer.from(tokenHash,'hex'):token.length>=32?createHash('sha256').update(token).digest():null;
 token=null;
 const auth=req=>{const header=String(req.headers.authorization||'');if(!expectedHash||!header.startsWith('Bearer '))return false;const supplied=header.slice(7);return supplied.length>=32&&supplied.length<=512&&timingSafeEqual(createHash('sha256').update(supplied).digest(),expectedHash);};
 const canDownload=(id,lease)=>{const record=state.records[id],job=record&&state.jobs[record.fingerprint];return !!(job&&job.stage==='processing'&&job.leaseUntil>=clock()&&typeof lease==='string'&&lease===job.lease);};
 function candidates(s,validIds,includeUnqueued=false){
  return Object.values(s.jobs).filter(j=>!j.result&&(j.stage==='queued'||(j.stage==='processing'&&j.leaseUntil<clock())||(includeUnqueued&&['dormant','error'].includes(j.stage))))
   .filter(j=>validIds.some(id=>{const r=s.records[id];return r?.fingerprint===j.fingerprint&&!r.published&&!r.draft.segments.length;}));
 }
 function pending(validIds){return {jobs:candidates(state,validIds,true).map(j=>({fingerprint:j.fingerprint,id:validIds.find(id=>state.records[id]?.fingerprint===j.fingerprint),stage:j.stage})),busy:Object.values(state.jobs).filter(j=>j.stage==='processing'&&j.leaseUntil>=clock()).length};}
 async function claim(validIds,{fingerprints=null,includeUnqueued=false}={}){
  if(fingerprints!==null&&(!Array.isArray(fingerprints)||fingerprints.length>10000||fingerprints.some(x=>typeof x!=='string'||!/^[0-9a-f]{64}$/.test(x))))throw fail(400,'Seleção de tarefas inválida.');
  const choose=s=>candidates(s,validIds,includeUnqueued).find(j=>fingerprints===null||fingerprints.includes(j.fingerprint));
  if(!choose(state))return null;
  return change(s=>{const job=choose(s);if(!job)return null;const id=validIds.find(id=>s.records[id]?.fingerprint===job.fingerprint);job.stage='processing';job.lease=randomUUID();job.leaseUntil=clock()+180000;job.attempts++;
   for(const r of Object.values(s.records))if(r.fingerprint===job.fingerprint&&!r.published&&!r.draft.segments.length){r.stage='processing';r.draft.enabled=true;r.error=null;r.revision++;}
   return {id,fingerprint:job.fingerprint,lease:job.lease,mediaUrl:'/TV/api/caption-worker/media/'+id};});
 }
 async function worker(action,data){return change(s=>{const j=s.jobs[data.fingerprint];if(!j||j.stage!=='processing'||j.lease!==data.lease||j.leaseUntil<clock())throw fail(409,'Tarefa expirada ou já concluída.');if(action==='heartbeat'){j.leaseUntil=clock()+180000;return {ok:true};}
  if(action==='complete'){
   if(!Number.isFinite(data.duration)||data.duration<0)throw fail(400,'Duração inválida.');const validated=validateDraft({enabled:true,segments:data.segments},data.duration);j.result={segments:validated.segments,duration:data.duration,model:String(data.model||'').slice(0,100)};j.stage='done';delete j.error;
   for(const r of Object.values(s.records))if(r.fingerprint===j.fingerprint&&!r.published&&['queued','processing','error'].includes(r.stage)){r.draft.segments=structuredClone(j.result.segments);r.duration=data.duration;r.stage='review';r.approved=false;r.error=null;r.revision++;}
  }else if(action==='fail'){j.stage='error';j.error=String(data.error||'Falha na transcrição.').slice(0,500);for(const r of Object.values(s.records))if(r.fingerprint===j.fingerprint&&['queued','processing'].includes(r.stage)){r.stage='error';r.error=j.error;r.revision++;}}
  else throw fail(404,'Operação não encontrada.');delete j.lease;delete j.leaseUntil;return {ok:true};});}
 async function edit(id,revision,data){return change(s=>{const r=s.records[id];if(!r)throw fail(404,'Legendas não encontradas.');check(r,revision);if(['queued','processing'].includes(r.stage))throw fail(409,'Aguarde o processamento terminar.');r.draft=validateDraft(data,r.duration);r.approved=false;r.stage='review';r.error=null;r.revision++;return structuredClone(r);});}
 async function approve(id,revision){return change(s=>{const r=s.records[id];if(!r)throw fail(404,'Legendas não encontradas.');check(r,revision);if(!['review','approved','published'].includes(r.stage))throw fail(409,'Conclua a geração e a revisão primeiro.');validateDraft(r.draft,r.duration);if(r.draft.enabled&&!r.draft.segments.length)throw fail(400,'Vídeo sem fala: desative as legendas antes de aprovar.');r.approved=true;r.stage='approved';r.revision++;return structuredClone(r);});}
 async function publish(id,revision){const result=await change(s=>{const r=s.records[id];if(!r)throw fail(404,'Legendas não encontradas.');check(r,revision);if(!r.approved)throw fail(409,'Aprove a revisão antes de publicar.');r.published={...structuredClone(r.draft),version:(r.published?.version||0)+1};r.stage='published';r.revision++;return structuredClone(r);});try{await onPublish(id);}catch{console.warn('Legenda aprovada: a notificação será recuperada pela sincronização das TVs.');}return result;}
 async function approveAndPublish(id,revision,data){
  const result=await change(s=>{const r=s.records[id];if(!r)throw fail(404,'Legendas não encontradas.');check(r,revision);
   if(!['review','approved','published'].includes(r.stage))throw fail(409,'Conclua a geração das legendas primeiro.');
   const draft=validateDraft(data,r.duration);if(draft.enabled&&!draft.segments.length)throw fail(400,'Vídeo sem fala: desative as legendas antes de aprovar.');
   r.draft=draft;r.approved=true;r.stage='published';r.error=null;r.published={...structuredClone(draft),version:(r.published?.version||0)+1};r.revision++;return structuredClone(r);});
  try{await onPublish(id);}catch{console.warn('Legenda aprovada: a notificação será recuperada pela sincronização das TVs.');}return result;
 }
 async function retry(id,revision){return change(s=>{const r=s.records[id];if(!r)throw fail(404,'Legendas não encontradas.');check(r,revision);const j=s.jobs[r.fingerprint];if(j.result)throw fail(409,'Este vídeo já foi transcrito. Edite as legendas existentes.');if(!['dormant','error'].includes(j.stage))throw fail(409,'Já existe uma tarefa para este vídeo.');j.stage='queued';delete j.error;for(const item of Object.values(s.records))if(item.fingerprint===r.fingerprint&&!item.published){item.stage='queued';item.draft.enabled=true;item.error=null;item.revision++;}return structuredClone(s.records[id]);});}
 async function remove(id){await change(s=>{delete s.records[id];const active=new Set(Object.values(s.records).map(r=>r.fingerprint));for(const key of Object.keys(s.jobs))if(!active.has(key))delete s.jobs[key];});}
 return {register,get,summary,auth,canDownload,pending,claim,worker,edit,approve,publish,approveAndPublish,retry,remove,published:id=>structuredClone(state.records[id]?.published||null),publishedRevision:ids=>ids.map(id=>id+':'+(state.records[id]?.published?.version||0)).join('|'),canSchedule:id=>{const r=state.records[id];return !!r&&(r.legacy||!!r.published);}};
}
