import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createTVHospHandler} from '../tvhosp.mjs';
import {createCaptions,validateDraft} from '../captions.mjs';
import {requestFor} from './request-helper.mjs';
const token='worker-test-abcdefghijklmnopqrstuvwxyz123456789';
const bytes=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex');
async function setup(t){const dir=await mkdtemp(path.join(os.tmpdir(),'tv-captions-'));t.after(()=>rm(dir,{recursive:true,force:true}));const password='caption-password-test-123';const options={dataDir:dir,password,secureCookies:false,captionToken:token};const request=requestFor(await createTVHospHandler(options));const login=await request('/TV/api/login',{method:'POST',headers:{'X-TVHosp-Request':'1'},body:JSON.stringify({password})});const admin={'X-TVHosp-Request':'1',Cookie:login.headers.get('set-cookie').split(';')[0]};const worker={'X-TVHosp-Request':'1',Authorization:'Bearer '+token};const call=(url,method='GET',body,headers=admin)=>request(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const upload=async(name='video.mp4')=>{const r=await request('/TV/api/upload?name='+name,{method:'POST',headers:{...admin,'Content-Type':'video/mp4'},body:bytes});assert.equal(r.status,201);return r.json().video.id;};return {dir,options,request,admin,worker,call,upload};}

test('fila única, autenticação, revisão obrigatória, versões publicadas e persistência',async t=>{
 const {dir,options,request,admin,worker,call,upload}=await setup(t);const id=await upload(),id2=await upload('duplicado.mp4');const endpoint='/TV/api/videos/'+id+'/captions';
 assert.equal((await request(endpoint)).status,401);
 assert.equal((await call('/TV/api/caption-worker/claim','POST',{})).status,401);
 assert.equal((await request('/TV/media/'+id)).status,404);
 let data=(await call(endpoint)).json();assert.equal(data.stage,'queued');
 let channel=(await call('/TV/api/saude/admin')).json();channel.config.playlist=[id];assert.equal((await call('/TV/api/saude/config','PUT',channel)).status,409);
 assert.equal((await call(endpoint+'/publish','POST',{revision:data.revision})).status,409);
 const job=(await call('/TV/api/caption-worker/claim','POST',{},worker)).json().job;assert.equal(job.id,id);assert.equal((await call('/TV/api/caption-worker/claim','POST',{},worker)).json().job,null);
 assert.equal((await request('/TV/media/'+id,{headers:worker})).status,404);assert.equal((await request(job.mediaUrl,{headers:{...worker,'X-TVHosp-Job-Lease':job.lease}})).status,200);
 assert.equal((await call('/TV/api/caption-worker/complete','POST',{...job,lease:'wrong',duration:5,segments:[]},worker)).status,409);
 assert.equal((await call('/TV/api/caption-worker/heartbeat','POST',job,worker)).status,200);
 const segments=[{start:0,end:1.5,text:'Saúde em Valente.'},{start:2,end:4,text:'Cuide de você.'}];
 assert.equal((await call('/TV/api/caption-worker/complete','POST',{...job,duration:5,segments,model:'small'},worker)).status,200);
 assert.equal((await call('/TV/api/caption-worker/complete','POST',{...job,duration:5,segments},worker)).status,409);
 data=(await call(endpoint)).json();assert.equal(data.stage,'review');assert.deepEqual(data.draft.segments,segments);
 assert.equal((await call('/TV/api/videos/'+id2+'/captions')).json().stage,'review');
 assert.equal((await call(endpoint,'PUT',{revision:0,draft:data.draft})).status,409);
 const invalid=structuredClone(data.draft);invalid.segments[1].start=1;assert.equal((await call(endpoint,'PUT',{revision:data.revision,draft:invalid})).status,400);
 data=(await call(endpoint+'/approve','POST',{revision:data.revision})).json();assert.equal(data.stage,'approved');
 data=(await call(endpoint+'/publish','POST',{revision:data.revision})).json();assert.equal(data.stage,'published');
 assert.equal((await call('/TV/api/saude/config','PUT',channel)).status,200);
 let publicState=(await request('/TV/api/saude/state')).json();assert.deepEqual(publicState.videos[0].captions.segments,segments);const oldRevision=publicState.revision;
 const draft=structuredClone(data.draft);draft.segments[0].text='Texto corrigido.';draft.segments.push({start:4,end:5,text:'Novo trecho.'});
 data=(await call(endpoint,'PUT',{revision:data.revision,draft})).json();assert.equal(data.stage,'review');assert.equal(data.approved,false);
 publicState=(await request('/TV/api/saude/state')).json();assert.equal(publicState.videos[0].captions.segments[0].text,'Saúde em Valente.');
 assert.equal((await call(endpoint+'/publish','POST',{revision:data.revision})).status,409);
 data=(await call(endpoint+'/approve','POST',{revision:data.revision})).json();data=(await call(endpoint+'/publish','POST',{revision:data.revision})).json();
 publicState=(await request('/TV/api/saude/state')).json();assert(publicState.revision>oldRevision);assert.equal(publicState.videos[0].captions.segments[0].text,'Texto corrigido.');assert.equal(publicState.videos[0].captions.version,2);
 assert.equal((await call('/TV/api/caption-worker/claim','POST',{},worker)).json().job,null);
 const restarted=requestFor(await createTVHospHandler(options));assert.equal((await restarted('/TV/api/saude/state')).json().videos[0].captions.version,2);
 const saved=JSON.parse(await readFile(path.join(dir,'captions.json'),'utf8'));assert.equal(Object.keys(saved.jobs).length,1);assert.equal(saved.records[id2].draft.segments[0].text,'Saúde em Valente.');
 assert.equal((await request('/TV/Admin/legendas?id='+id,{headers:admin})).status,200);
});

test('falha, retomada após reinício, lease expirado e vídeo sem fala',async t=>{
 let now=100;const dir=await mkdtemp(path.join(os.tmpdir(),'caption-leases-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'clip');await writeFile(file,bytes);
 let service=await createCaptions({dir,token,clock:()=>now});await service.register('a',file);let job=await service.claim(['a']);
 service=await createCaptions({dir,token,clock:()=>now});assert.equal(await service.claim(['a']),null);now+=180001;const renewed=await service.claim(['a']);assert.notEqual(renewed.lease,job.lease);
 await assert.rejects(service.worker('complete',{...job,duration:2,segments:[]}),e=>e.code===409);
 await service.worker('fail',{...renewed,error:'Modelo indisponível.'});let r=service.get('a');assert.equal(r.stage,'error');await service.retry('a',r.revision);job=await service.claim(['a']);await service.worker('complete',{...job,duration:2,segments:[]});r=service.get('a');await assert.rejects(service.approve('a',r.revision),e=>e.code===400);
 r=await service.edit('a',r.revision,{...r.draft,enabled:false});r=await service.approve('a',r.revision);r=await service.publish('a',r.revision);assert.equal(service.published('a').enabled,false);
 await assert.rejects(service.retry('a',r.revision),e=>e.code===409);
});

test('temporização usa intervalos, limpa em lacunas e reinicia no começo',async()=>{
 const context={};vm.createContext(context);vm.runInContext(await readFile(new URL('../public/captions-view.js',import.meta.url),'utf8'),context);const active=context.TVCaptionView.activeCue;const cues=[{start:0,end:1,text:'Primeira'},{start:2,end:3,text:'Segunda'}];assert.equal(active(cues,0).text,'Primeira');assert.equal(active(cues,1),null);assert.equal(active(cues,2).text,'Segunda');assert.equal(active(cues,3),null);assert.equal(active(cues,0).text,'Primeira');assert.equal(active([],0),null);
 assert.throws(()=>validateDraft({enabled:true,segments:[{start:2,end:1,text:'Inválida'}]}));assert.throws(()=>validateDraft({enabled:true,segments:[],style:{color:'red;display:none'}}));
});

test('aplicativo manual conta pendências únicas, limita a seleção e não repete concluídos',async t=>{
 const {call,worker,upload}=await setup(t);const id=await upload(),alias=await upload('duplicado.mp4');
 let pending=await call('/TV/api/caption-worker/pending','GET',undefined,worker);assert.equal(pending.status,200);assert.equal(pending.json().jobs.length,1);const fingerprint=pending.json().jobs[0].fingerprint;assert(pending.json().jobs[0].name);
 assert.equal((await call('/TV/api/caption-worker/pending')).status,401);
 assert.equal((await call('/TV/api/caption-worker/claim','POST',{fingerprints:['inválido']},worker)).status,400);
 assert.equal((await call('/TV/api/caption-worker/claim','POST',{fingerprints:[]},worker)).json().job,null);
 let job=(await call('/TV/api/caption-worker/claim','POST',{fingerprints:[fingerprint],includeUnqueued:true},worker)).json().job;assert.equal(job.id,id);
 pending=(await call('/TV/api/caption-worker/pending','GET',undefined,worker)).json();assert.equal(pending.jobs.length,0);assert.equal(pending.busy,1);
 await call('/TV/api/caption-worker/fail','POST',{...job,error:'Teste de falha.'},worker);
 pending=(await call('/TV/api/caption-worker/pending','GET',undefined,worker)).json();assert.equal(pending.jobs.length,1);assert.equal(pending.jobs[0].stage,'error');
 job=(await call('/TV/api/caption-worker/claim','POST',{fingerprints:[fingerprint],includeUnqueued:true},worker)).json().job;
 await call('/TV/api/caption-worker/complete','POST',{...job,duration:3,segments:[{start:0,end:2,text:'Teste concluído.'}]},worker);
 pending=(await call('/TV/api/caption-worker/pending','GET',undefined,worker)).json();assert.equal(pending.jobs.length,0);
 assert.equal((await call('/TV/api/videos/'+alias+'/captions')).json().stage,'review');
});

test('aprovação única salva, aprova e aplica; erro não altera a versão publicada',async t=>{
 const {request,worker,call,upload}=await setup(t);const id=await upload();const endpoint='/TV/api/videos/'+id+'/captions';
 const job=(await call('/TV/api/caption-worker/claim','POST',{},worker)).json().job;
 await call('/TV/api/caption-worker/complete','POST',{...job,duration:5,segments:[{start:0,end:4,text:'Transcrição original.'}]},worker);
 let data=(await call(endpoint)).json();const draft=structuredClone(data.draft);draft.segments[0].text='Correção em um único clique.';
 assert.equal((await call(endpoint+'/approve-publish','POST',{revision:data.revision,draft},worker)).status,401);
 let response=await call(endpoint+'/approve-publish','POST',{revision:data.revision,draft});assert.equal(response.status,200);data=response.json();assert.equal(data.approved,true);assert.equal(data.stage,'published');assert.equal(data.published.segments[0].text,draft.segments[0].text);assert.equal(data.draft.segments[0].text,draft.segments[0].text);
 let channel=(await call('/TV/api/saude/admin')).json();channel.config.playlist=[id];assert.equal((await call('/TV/api/saude/config','PUT',channel)).status,200);
 const before=(await request('/TV/api/saude/state')).json();const bad=structuredClone(data.draft);bad.segments[0].end=-1;
 assert.equal((await call(endpoint+'/approve-publish','POST',{revision:data.revision,draft:bad})).status,400);
 assert.deepEqual((await call(endpoint)).json().published,data.published);
 assert.equal((await call(endpoint+'/approve-publish','POST',{revision:data.revision-1,draft})).status,409);
 const next=structuredClone(data.draft);next.segments[0].text='Nova correção.';
 data=(await call(endpoint+'/approve-publish','POST',{revision:data.revision,draft:next})).json();const after=(await request('/TV/api/saude/state')).json();assert(after.revision>before.revision);assert.equal(after.videos[0].captions.segments[0].text,'Nova correção.');assert.equal(after.videos[0].captions.version,2);
 data=(await call(endpoint+'/approve-publish','POST',{revision:data.revision,draft:{...data.draft,enabled:false}})).json();assert.equal((await request('/TV/api/saude/state')).json().videos[0].captions.enabled,false);
 const html=(await request('/TV/Admin/legendas?id='+id,{headers:{}})).status;assert.equal(html,302);
});

test('credencial SHA-256 e download restrito à tarefa, sem acesso administrativo',async t=>{
 const {createHash}=await import('node:crypto');const digest=createHash('sha256').update(token).digest('hex');
 const dir=await mkdtemp(path.join(os.tmpdir(),'tv-hashed-worker-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const request=requestFor(await createTVHospHandler({dataDir:dir,password:'hash-admin-password-1234',secureCookies:false,captionTokenHash:digest}));
 const login=await request('/TV/api/login',{method:'POST',headers:{'X-TVHosp-Request':'1'},body:JSON.stringify({password:'hash-admin-password-1234'})});const admin={'X-TVHosp-Request':'1',Cookie:login.headers.get('set-cookie').split(';')[0]};const worker={'X-TVHosp-Request':'1',Authorization:'Bearer '+token};
 const upload=await request('/TV/api/upload?name=privado.mp4',{method:'POST',headers:{...admin,'Content-Type':'video/mp4'},body:bytes});const id=upload.json().video.id;
 assert.equal((await request('/TV/api/caption-worker/pending',{headers:{Authorization:'Bearer '+digest}})).status,401);
 assert.equal((await request('/TV/api/caption-worker/pending',{headers:worker})).json().apiVersion,1);
 assert.equal((await request('/TV/api/caption-worker/media/'+id,{headers:worker})).status,403);
 const claim=()=>request('/TV/api/caption-worker/claim',{method:'POST',headers:worker,body:'{}'});
 const claims=await Promise.all([claim(),claim()]);const jobs=claims.map(r=>r.json().job).filter(Boolean);assert.equal(jobs.length,1);const job=jobs[0];
 assert.equal((await request(job.mediaUrl,{headers:worker})).status,403);
 assert.equal((await request(job.mediaUrl,{headers:{...worker,'X-TVHosp-Job-Lease':'wrong'}})).status,403);
 assert.equal((await request(job.mediaUrl,{headers:{...worker,'X-TVHosp-Job-Lease':job.lease}})).status,200);
 assert.equal((await request('/TV/media/'+id,{headers:worker})).status,404);
 for(const [route,method]of [[`/TV/api/videos/${id}`,'DELETE'],['/TV/api/saude/config','PUT'],[`/TV/api/videos/${id}/captions/approve-publish`,'POST']])assert.equal((await request(route,{method,headers:worker,body:'{}'})).status,401);
 assert.equal((await request('/TV/api/caption-worker/complete',{method:'POST',headers:worker,body:JSON.stringify({...job,duration:2,segments:[{start:0,end:1,text:'Somente revisão.'}]})})).status,200);
 assert.equal((await request(job.mediaUrl,{headers:{...worker,'X-TVHosp-Job-Lease':job.lease}})).status,403);
 const state=JSON.parse(await readFile(path.join(dir,'captions.json'),'utf8'));assert(!JSON.stringify(state).includes(token));assert(!JSON.stringify(state).includes(digest));
});

test('versão publicada persiste mesmo se a notificação do canal falhar',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'caption-notify-'));t.after(()=>rm(dir,{recursive:true,force:true}));const clip=path.join(dir,'clip');await writeFile(clip,bytes);
 const service=await createCaptions({dir,token,onPublish:async()=>{throw Error('Falha simulada de notificação.');}});await service.register('a',clip);const job=await service.claim(['a']);await service.worker('complete',{...job,duration:2,segments:[{start:0,end:1,text:'Conteúdo aprovado.'}]});const record=service.get('a');
 const before=service.publishedRevision(['a']);const published=await service.approveAndPublish('a',record.revision,record.draft);assert.equal(published.stage,'published');assert.notEqual(service.publishedRevision(['a']),before);
 const restarted=await createCaptions({dir,token});assert.equal(restarted.published('a').segments[0].text,'Conteúdo aprovado.');
});
