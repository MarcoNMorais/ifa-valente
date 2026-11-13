import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('TV completa ciclo, alterna mensagens na pausa e retoma sem interromper atualizações',async()=>{
 let now=100000;const nodes={};function node(){return {style:{},textContent:'',hidden:false,ended:false,muted:false,play(){this.plays=(this.plays||0)+1;return Promise.resolve();},pause(){this.pauses=(this.pauses||0)+1;}};}
 const ctx={document:{getElementById:id=>nodes[id]||(nodes[id]=node()),addEventListener(){},body:{classList:{add(){},remove(){}}}},navigator:{},indexedDB:{open(){return {}}},URL:{revokeObjectURL(){}},Date:class extends Date{constructor(){super(now)}static now(){return now}},setTimeout(){},clearTimeout(){},setInterval(){}};vm.createContext(ctx);vm.runInContext(await readFile(new URL('../public/player.js',import.meta.url),'utf8'),ctx);const run=s=>vm.runInContext(s,ctx);
 run("urls.set('a','blob:a');urls.set('b','blob:b');urls.set('c','blob:c');accept({revision:1,config:{playlist:['a','b'],messages:[{id:'1',text:'Um',on:true},{id:'2',text:'Dois',on:false},{id:'3',text:'Três',on:true}],ticker:'Rodapé',rotation:10,enabled:true,interval:5,duration:12}})");

 assert.equal(nodes.video.src,'blob:a');now+=300001;run('tick()');assert.equal(nodes.video.src,'blob:a');assert.equal(nodes.video.hidden,false);
 nodes.video.onended();assert.equal(nodes.video.src,'blob:b');nodes.video.onended();assert.equal(nodes.video.hidden,true);assert.equal(nodes.welcomeTitle.textContent,'Um');
 now+=12001;run('tick()');assert.equal(nodes.welcomeTitle.textContent,'Três');assert.equal(nodes.video.hidden,true);
 run("urls.set('c','blob:c');accept({revision:2,config:{...config,playlist:['c'],headline:'Minha frase',caption:'Apoio'}})");assert.equal(nodes.video.hidden,true);assert.equal(nodes.welcomeCaption.textContent,'Apoio');
 now+=300000;run('tick()');assert.equal(nodes.video.src,'blob:c');assert.equal(nodes.video.hidden,false);
 run("urls.set('a','blob:a');accept({revision:3,config:{...config,playlist:['a','c'],cyclePause:0}})");assert.equal(nodes.video.src,'blob:c');nodes.video.onended();assert.equal(nodes.video.src,'blob:a');assert.equal(nodes.video.hidden,false);
 run("accept({revision:4,config:{...config,playlist:[],enabled:false}})");assert.equal(nodes.video.src,'blob:a');nodes.video.onended();run('tick()');assert.equal(nodes.video.hidden,true);assert.equal(nodes.welcomeTitle.textContent,'Minha frase');
});
