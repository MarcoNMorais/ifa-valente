import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {uploadUsage} from '../upload-policy.mjs';
const sources=await Promise.all(['media-library.js','app.js','bridge.js'].map(name=>readFile(new URL('../public/'+name,import.meta.url),'utf8')));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('admin Saúde carrega biblioteca compartilhada e publica somente sua seleção',async()=>{
 const config={playlist:['a'],messages:[],ticker:'Saúde geral',rotation:10,enabled:true,interval:5,duration:12},videos=[{id:'a',name:'A.mp4',size:24,type:'video/mp4',usedBy:['TV Saúde']},{id:'b',name:'B.mp4',size:24,type:'video/mp4',usedBy:['TV Hospital']}];
 const calls=[],nodes={},timers=[];function element(tag='div'){return {tagName:tag.toUpperCase(),value:'',checked:true,type:'',style:{},children:[],textContent:'',append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(){},removeAttribute(){},querySelector(selector){return this.children.find(c=>c.tagName===selector.toUpperCase());},pause(){},play(){return Promise.resolve();}};}
 const document={body:{dataset:{channel:'saude'}},getElementById(id){return nodes[id]||(nodes[id]=element());},createElement:element};for(const [key,value]of Object.entries(config)){const el=document.getElementById(key);el.value=String(value);if(key==='enabled'){el.type='checkbox';el.checked=value;}}
 const ctx={document,localStorage:{setItem(){}},Date,crypto:{randomUUID:()=>String(Math.random())},URL:{},structuredClone,setInterval(fn,ms){timers.push({fn,ms});},location:{},fetch:async(url,options={})=>{
   calls.push({url,options});let data;
   if(url==='/TV/api/saude/admin')data={revision:0,config,videos,uploadHistory:[],uploadUsage:uploadUsage([])};
   else if(url==='/TV/api/library')data={videos,uploadHistory:[],uploadUsage:uploadUsage([])};
   else if(url==='/TV/api/saude/config')data={revision:1};
   else throw Error('Rota inesperada: '+url);
   return{status:200,ok:true,json:async()=>structuredClone(data)};
 }};
 vm.createContext(ctx);for(const source of sources)vm.runInContext(source,ctx);await flush();
 assert.equal(nodes.library.children.length,2);assert.equal(nodes.files.disabled,false);assert.equal(vm.runInContext('clips[0].on',ctx),true);assert.equal(vm.runInContext('clips[1].on',ctx),false);
 vm.runInContext("clips[0].on=false;clips[1].on=true;tickerBank.push({id:'off',text:'Oculta',on:false});tickerBank.push({id:'new',text:'Nova mensagem',on:true})",ctx);
 nodes.headline.value='Frase revisada';nodes.cyclePause.value='8';nodes.start.onclick();await flush();
 assert(!calls.some(c=>c.url.endsWith('/config')));assert.equal(nodes.video.src,'/TV/media/b');assert.equal(vm.runInContext('cfg.headline',ctx),'Frase revisada');assert.equal(vm.runInContext('cfg.ticker',ctx),'Saúde geral\nNova mensagem');
 await nodes.publishPreview.onclick();
 const request=calls.find(c=>c.url==='/TV/api/saude/config');assert(request);assert.deepEqual(JSON.parse(request.options.body).config.playlist,['b']);assert(!calls.some(c=>c.url.includes('/hospital/config')));const published=JSON.parse(request.options.body).config;assert.equal(published.tickerMessages.length,3);assert.equal(published.tickerMessages[1].on,false);assert.equal(published.headline,'Frase revisada');assert.equal(published.cyclePause,8);
 videos.push({id:'c',name:'C.mp4',usedBy:[]});await timers.find(t=>t.ms===30000).fn();assert.equal(vm.runInContext('clips.length',ctx),3);assert.equal(vm.runInContext('clips[1].on',ctx),true);assert.equal(vm.runInContext('clips[2].on',ctx),false);
});
