import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ffmpegPath} from '../convert-video.mjs';
import {createTVHospHandler} from '../tvhosp.mjs';
import {requestFor} from './request-helper.mjs';
test('MOV real converte para MP4 com áudio; inválido não entra na biblioteca',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'tv-mov-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const input=path.join(dir,'sample.mov');execFileSync(ffmpegPath,['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','mpeg4','-c:a','pcm_s16le',input],{windowsHide:true});
 const bytes=await readFile(input),request=requestFor(await createTVHospHandler({dataDir:dir,password:'test-password-long',secureCookies:false}));let r=await request('/TV/api/login',{method:'POST',headers:{'X-TVHosp-Request':'1'},body:JSON.stringify({password:'test-password-long'})});const headers={'X-TVHosp-Request':'1',Cookie:r.headers.get('set-cookie').split(';')[0],'Content-Type':'video/quicktime'};
 r=await request('/TV/api/upload?name=teste.MOV',{method:'POST',headers,body:bytes});assert.equal(r.status,201);const v=r.json().video;assert.equal(v.name,'teste.mp4');assert.equal(v.type,'video/mp4');const output=path.join(dir,'media',v.id);assert.equal((await readFile(output)).length,v.size);execFileSync(ffmpegPath,['-v','error','-i',output,'-map','0:v:0','-map','0:a:0','-f','null','-'],{windowsHide:true});assert.equal(r.json().uploadRecord.size,bytes.length);
 r=await request('/TV/api/upload?name=quebrado.mov',{method:'POST',headers,body:'invalid video'});assert.equal(r.status,422);assert.deepEqual(await readdir(path.join(dir,'media')),[v.id]);
});
