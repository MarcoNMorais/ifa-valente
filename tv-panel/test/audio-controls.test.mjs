import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/player.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup({allowed=true,blockAll=false}={}){
 const nodes={},listeners={},classes=new Set();let policyAllowed=allowed;
 const document={getElementById(id){return nodes[id]||(nodes[id]=element());},addEventListener(name,fn){listeners[name]=fn;},body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}}};document.activeElement=document.body;
 function element(){return{style:{},textContent:'',hidden:false,ended:false,muted:false,tagName:'BUTTON',focus(){document.activeElement=this;},blur(){document.activeElement=document.body;},click(){return this.onclick?.();},play(){this.plays=(this.plays||0)+1;if(!policyAllowed&&(blockAll||!this.muted))return Promise.reject(Object.assign(Error('Autoplay blocked'),{name:'NotAllowedError'}));return Promise.resolve();},pause(){}};}
 const ctx={document,navigator:{},indexedDB:{open(){return{}}},URL:{revokeObjectURL(){}},Date,setInterval(){},setTimeout(){},clearTimeout(){}};vm.createContext(ctx);vm.runInContext(source,ctx);const run=s=>vm.runInContext(s,ctx);
 return{nodes,document,classes,listeners,run,allow(){policyAllowed=true;},start(){run("urls.set('a','blob:a');urls.set('b','blob:b');config.playlist=['a','b'];next()");},key(key){let prevented=false;listeners.keydown({key,preventDefault(){prevented=true;}});return prevented;}};
}
test('som vem ligado e continua ligado no próximo vídeo',async()=>{
 const p=setup();assert.equal(p.nodes.video.muted,false);p.start();await flush();assert.equal(p.nodes.video.muted,false);assert.equal(p.nodes.activatePlayback.hidden,true);assert.equal(p.nodes.sound.textContent,'Silenciar');p.run('next()');await flush();assert.equal(p.nodes.video.muted,false);
});
test('bloqueio de áudio mostra aviso e OK ativa som sem reiniciar o vídeo',async()=>{
 const p=setup({allowed:false});p.start();await flush();assert.equal(p.nodes.video.muted,true);assert.equal(p.nodes.activatePlayback.hidden,false);assert.match(p.nodes.activatePlayback.textContent,/Ativar som/);const original=p.nodes.video.src;
 p.allow();p.key('Enter');await flush();assert.equal(p.nodes.video.muted,false);assert.equal(p.nodes.video.src,original);assert.equal(p.nodes.activatePlayback.hidden,true);
 p.nodes.sound.click();await flush();assert.equal(p.nodes.video.muted,true);p.run('next()');await flush();assert.equal(p.nodes.video.muted,true);assert.equal(p.nodes.activatePlayback.hidden,true);
});
test('setas mostram e selecionam controles; OK aciona e Escape dispensa',async()=>{
 const p=setup();p.start();await flush();p.classes.clear();assert.equal(p.key('ArrowRight'),true);assert(p.classes.has('controls-visible'));assert.equal(p.document.activeElement,p.nodes.expandTv);
 p.key('ArrowRight');assert.equal(p.document.activeElement,p.nodes.sound);p.key('OK');await flush();assert.equal(p.nodes.video.muted,true);p.key('Escape');assert.equal(p.document.activeElement,p.document.body);assert(!p.classes.has('controls-visible'));
});
test('bloqueio de toda reprodução permite retomada por interação',async()=>{
 const p=setup({allowed:false,blockAll:true});p.start();await flush();assert.equal(p.run('needsInteraction'),true);p.allow();p.nodes.activatePlayback.click();await flush();assert.equal(p.run('needsInteraction'),false);assert.equal(p.nodes.video.muted,false);assert.equal(p.nodes.activatePlayback.hidden,true);
});
