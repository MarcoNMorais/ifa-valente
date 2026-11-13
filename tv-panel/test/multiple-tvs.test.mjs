import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createTVHospHandler} from '../tvhosp.mjs';
import {requestFor} from './request-helper.mjs';
test('duas TVs independentes, biblioteca única, migração e exclusão protegida',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'tv-multiple-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const oldConfig={playlist:[],messages:[{id:'old',text:'Mensagem particular do Hospital',on:true}],ticker:'Rodapé original do Hospital',rotation:10,enabled:true,interval:5,duration:12};
 await writeFile(path.join(dir,'state.json'),JSON.stringify({revision:7,config:oldConfig,videos:[],uploadHistory:[]}));
 const password='multiple-tv-test-password';let request=requestFor(await createTVHospHandler({dataDir:dir,password,secureCookies:false}));
 assert.equal((await request('/')).text(),'SITE PRINCIPAL');
 assert.equal((await request('/TV')).status,200);
 for(const route of ['/TV/Admin','/TV/Admin/TVHosp','/TV/Admin/TVSaude','/TV/Admin/video']){const r=await request(route);assert.equal(r.status,302);assert.equal(r.headers.get('Location'),'/TV');}
 const healthPage=(await request('/TV/TVsaude')).text();assert(!healthPage.includes('Hospital'));assert(!healthPage.includes('José Mota'));assert(!healthPage.includes('brand.png'));assert(healthPage.includes('data-channel="saude"'));
 assert.equal((await request('/TV/TVHosp')).status,200);
 let r=await request('/TVHosp');assert.equal(r.status,308);assert.equal(r.headers.get('location'),'/TV/TVHosp');
 r=await request('/tv/admin/tvsaude');assert.equal(r.status,308);assert.equal(r.headers.get('location'),'/TV/Admin/TVSaude');
 r=await request('/TV/api/login',{method:'POST',headers:{'X-TVHosp-Request':'1'},body:JSON.stringify({password})});const cookie=r.headers.get('set-cookie');assert(cookie.includes('Path=/TV;'));const headers={'X-TVHosp-Request':'1',Cookie:cookie.split(';')[0]};
 for(const route of ['/TV/Admin','/TV/Admin/TVHosp','/TV/Admin/TVSaude','/TV/Admin/video']){r=await request(route,{headers});assert.equal(r.status,200);assert(r.text().includes('TV Hospital'));assert(r.text().includes('TV Saúde'));assert(!r.text().includes('{{VIDEO_LIBRARY}}'));}
 const healthAdmin=(await request('/TV/Admin/TVSaude',{headers})).text();assert(healthAdmin.includes('Configuração da<br><span>TV Saúde'));assert(!healthAdmin.includes('José Mota'));assert(!healthAdmin.includes('class="logo"'));
 let hospital=(await request('/TV/api/hospital/admin',{headers})).json();let saude=(await request('/TV/api/saude/admin',{headers})).json();for(const key of Object.keys(oldConfig))assert.deepEqual(hospital.config[key],oldConfig[key]);assert.equal(hospital.config.cyclePause,5);assert.equal(saude.config.messages.length,0);assert(!saude.config.ticker.includes('Hospital'));
 const backup=JSON.parse(await readFile(path.join(dir,'state-before-multiple-tvs.json'),'utf8'));assert.deepEqual(backup.config,oldConfig);
 const bytes=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex');const ids=[];
 for(const name of ['primeiro.mp4','segundo.mp4']){r=await request('/TV/api/upload?name='+name,{method:'POST',headers:{...headers,'Content-Type':'video/mp4'},body:bytes});assert.equal(r.status,201);ids.push(r.json().video.id);}
 for(const channel of ['hospital','saude']){const data=(await request('/TV/api/'+channel+'/admin',{headers})).json();assert.equal(data.videos.length,2);assert.equal(data.config.playlist.length,0);}
 hospital.config.playlist=[ids[0]];hospital.config.interval=2;
 saude.config.playlist=[ids[1],ids[0]];saude.config.messages=[{id:'saude',text:'Mensagem geral da Secretaria',on:true}];saude.config.interval=10;
 r=await request('/TV/api/hospital/config',{method:'PUT',headers,body:JSON.stringify(hospital)});assert.equal(r.status,200);hospital.revision=r.json().revision;
 r=await request('/TV/api/saude/config',{method:'PUT',headers,body:JSON.stringify(saude)});assert.equal(r.status,200);saude.revision=r.json().revision;
 const hp=(await request('/TV/api/hospital/state')).json(),sp=(await request('/TV/api/saude/state')).json();assert.deepEqual(hp.config.playlist,[ids[0]]);assert.deepEqual(sp.config.playlist,[ids[1],ids[0]]);assert.equal(hp.config.interval,2);assert.equal(sp.config.interval,10);assert.equal(hp.config.messages[0].text,'Mensagem particular do Hospital');assert.equal(sp.config.messages[0].text,'Mensagem geral da Secretaria');assert.equal(hp.videos[0].url,sp.videos.find(v=>v.id===ids[0]).url);
 let library=(await request('/TV/api/library',{headers})).json();let accounting=(await request('/TV/api/usage',{headers})).json();assert.equal(accounting.uploadHistory.length,2);assert.equal(accounting.uploadUsage.uploadedBytes,bytes.length*2);assert.deepEqual(library.videos[0].usedBy,['TV Hospital','TV Saúde']);assert.equal((await readdir(path.join(dir,'media'))).length,2);
 r=await request('/TV/api/videos/'+ids[0],{method:'DELETE',headers});assert.equal(r.status,409);assert(r.json().error.includes('TV Hospital e TV Saúde'));
 hospital.config.playlist=[];r=await request('/TV/api/hospital/config',{method:'PUT',headers,body:JSON.stringify(hospital)});assert.equal(r.status,200);
 r=await request('/TV/api/videos/'+ids[0],{method:'DELETE',headers});assert.equal(r.status,409);assert(r.json().error.includes('TV Saúde'));
 saude.config.playlist=[ids[1]];r=await request('/TV/api/saude/config',{method:'PUT',headers,body:JSON.stringify(saude)});assert.equal(r.status,200);
 r=await request('/TV/api/videos/'+ids[0],{method:'DELETE',headers});assert.equal(r.status,200);library=(await request('/TV/api/library',{headers})).json();assert.equal(library.videos.length,1);assert.equal((await request('/TV/api/usage',{headers})).json().uploadHistory.length,2);
 request=requestFor(await createTVHospHandler({dataDir:dir,password,secureCookies:false}));assert.deepEqual((await request('/TV/api/saude/state')).json().config.playlist,[ids[1]]);assert.deepEqual((await request('/TV/api/hospital/state')).json().config.playlist,[]);
});
