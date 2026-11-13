import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {transferUsage,MAX_TRANSFER_BYTES,TRANSFER_LIMIT_MESSAGE} from '../transfer-policy.mjs';
import {MAX_UPLOAD_BYTES,UPLOAD_WINDOW_MS} from '../upload-policy.mjs';
import {createTVHospHandler} from '../tvhosp.mjs';
import {requestFor} from './request-helper.mjs';
test('limites são independentes: 10 GB de envio e 100 GB de transferência',()=>{
 assert.equal(MAX_UPLOAD_BYTES,10_000_000_000);assert.equal(MAX_TRANSFER_BYTES,100_000_000_000);
 const now=Date.parse('2026-11-11T13:00:00Z');const history=[{size:MAX_TRANSFER_BYTES,createdAt:new Date(now-UPLOAD_WINDOW_MS).toISOString()}];
 assert.equal(transferUsage(history,now-1).blocked,true);assert.equal(transferUsage(history,now).transferredBytes,0);
});
test('downloads, HEAD, Range, bloqueio, liberação, persistência e concorrência',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'tv-transfer-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const now=Date.parse('2026-11-11T13:00:00Z');let time=now;const password='transfer-test-password';const bytes=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex');
 await mkdir(path.join(dir,'media'));await writeFile(path.join(dir,'media','test-video'),bytes);
 const config={playlist:['test-video'],messages:[],ticker:'Teste',rotation:10,enabled:true,interval:5,duration:12};
 const original={revision:0,config,videos:[{id:'test-video',size:bytes.length,name:'teste.mp4',type:'video/mp4'}],uploadHistory:[],transferHistory:[{id:'old',size:MAX_TRANSFER_BYTES-bytes.length,createdAt:new Date(now-10*86400000).toISOString(),complete:true}]};
 await writeFile(path.join(dir,'state.json'),JSON.stringify(original));
 const options={dataDir:dir,password,secureCookies:false,clock:()=>time};let request=requestFor(await createTVHospHandler(options));
 let r=await request('/TV/media/test-video',{method:'HEAD'});assert.equal(r.status,200);let state=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));assert.equal(state.transferHistory.length,1);
 r=await request('/TV/media/test-video');assert.equal(r.status,200);state=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));assert.equal(state.transferHistory.length,2);assert.equal(state.transferHistory[1].size,bytes.length);assert.equal(state.transferHistory[1].complete,true);assert.equal(state.uploadHistory.length,0);
 r=await request('/TV/media/test-video');assert.equal(r.status,429);assert.equal(r.json().error,TRANSFER_LIMIT_MESSAGE);
 assert.equal((await request('/TV/api/hospital/state')).status,200);assert.equal((await request('/TV')).status,200);
 request=requestFor(await createTVHospHandler(options));assert.equal((await request('/TV/media/test-video')).status,429);
 time+=20*86400000;r=await request('/TV/media/test-video',{headers:{Range:'bytes=0-3'}});assert.equal(r.status,206);assert.equal(r.headers.get('Content-Length'),4);
 state=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));assert.equal(state.transferHistory.at(-1).size,4);assert.equal(transferUsage(state.transferHistory,time).transferredBytes,bytes.length+4);
 // Re-seed close to the limit to check two simultaneous TVs cannot both reserve the last bytes.
 state.transferHistory=[{id:'reserve-test',size:MAX_TRANSFER_BYTES-36,createdAt:new Date(time).toISOString(),complete:true}];await writeFile(path.join(dir,'state.json'),JSON.stringify(state));request=requestFor(await createTVHospHandler(options));
 const results=await Promise.all([request('/TV/media/test-video'),request('/TV/media/test-video')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,429]);
 state=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));assert.equal(transferUsage(state.transferHistory,time).transferredBytes,MAX_TRANSFER_BYTES-12);
});
