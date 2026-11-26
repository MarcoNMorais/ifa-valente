import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('reprodução travada tenta vídeo direto uma só vez',async()=>{
 const nodes={},timers=[];const element=()=>({textContent:'',hidden:false,muted:false,currentTime:0,play(){return Promise.resolve()},pause(){}});
 const ctx={TVCaptionView:{attach(){}},document:{getElementById:id=>nodes[id]||(nodes[id]=element()),addEventListener(){},body:{classList:{add(){},remove(){}}}},navigator:{},indexedDB:{open(){return{}}},URL:{revokeObjectURL(){}},Date,setTimeout(fn,ms){if(ms===20000)timers.push(fn);return timers.length},clearTimeout(){},setInterval(){}};
 vm.createContext(ctx);vm.runInContext(await readFile(new URL('../public/player.js',import.meta.url),'utf8'),ctx);
 vm.runInContext("urls.set('id-1','blob:test');config.playlist=['id-1'];next()",ctx);assert.equal(nodes.video.src,'blob:test');await Promise.resolve();timers[0]();assert.equal(nodes.video.src,'/TV/media/id-1');assert.equal(vm.runInContext('directFallback',ctx),true);
});

