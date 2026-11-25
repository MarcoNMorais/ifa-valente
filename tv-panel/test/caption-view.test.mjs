import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
function element(){const classes=new Set();return {children:[],style:{setProperty(key,value){this[key]=value;}},dataset:{},hidden:false,clientHeight:400,scrollHeight:40,textContent:'',append(x){this.children.push(x)},remove(){},classList:{toggle(k,on){if(on)classes.add(k);else classes.delete(k)},remove(k){classes.delete(k)},contains:k=>classes.has(k)},getBoundingClientRect:()=>({left:0,top:0,width:1920,height:1080})};}
test('componente compartilha estilo, sincroniza por currentTime e limpa ao esconder',async()=>{
 const handlers={},screen=element(),video={videoWidth:1080,videoHeight:1920,getBoundingClientRect:()=>({left:0,top:160,width:1920,height:720}),hidden:false,currentTime:0,getAttribute:()=>'/video',addEventListener:(name,fn)=>handlers[name]=fn,removeEventListener:name=>delete handlers[name]};let snapshot={enabled:true,style:{size:42,font:'Verdana',color:'#ffffff',align:'center',position:'center'},segments:[{start:0,end:2,text:'Início'},{start:3,end:5,text:'Fim'}]};const context={document:{createElement:element},requestAnimationFrame:()=>1,cancelAnimationFrame(){},getComputedStyle:()=>({paddingTop:'12',paddingBottom:'12'})};vm.createContext(context);vm.runInContext(await readFile(new URL('../public/captions-view.js',import.meta.url),'utf8'),context);const view=context.TVCaptionView.attach(video,screen,()=>snapshot),box=screen.children[0],text=box.children[0];view.update();assert.equal(text.textContent,'Início');assert.equal(box.style.fontFamily,'Verdana');assert.equal(box.style.fontSize,'42px');assert(screen.classList.contains('has-captions'));assert.equal(box.style.left,'1162.5px');assert.equal(box.style.width,'757.5px');assert.equal(box.style.top,'160px');assert.equal(box.style.background,undefined);assert(screen.classList.contains('has-left-message'));assert.equal(screen.style['--message-left'],'0px');assert.equal(screen.style['--message-width'],'757.5px');
 video.currentTime=2.5;handlers.timeupdate();assert.equal(text.textContent,'');video.currentTime=3;handlers.seeking();assert.equal(text.textContent,'Fim');video.currentTime=0;handlers.loadedmetadata();assert.equal(text.textContent,'Início');video.hidden=true;view.update();assert.equal(box.hidden,true);assert.equal(text.textContent,'');assert(!screen.classList.contains('has-captions'));video.hidden=false;snapshot.enabled=false;view.update();assert.equal(box.hidden,true);assert(screen.classList.contains('has-left-message'));view.destroy();assert(!screen.classList.contains('has-left-message'));assert.equal(Object.keys(handlers).length,0);
});

test('publicação nova só troca legenda no próximo vídeo e permanece no cache da programação',async()=>{
 const nodes={};function node(){return {style:{},textContent:'',hidden:false,muted:false,play:()=>Promise.resolve(),pause(){}};}let getCaption;
 const context={document:{getElementById:id=>nodes[id]||(nodes[id]=node()),addEventListener(){},body:{classList:{add(){},remove(){}}}},TVCaptionView:{attach(v,s,get){getCaption=get;}},structuredClone,navigator:{},indexedDB:{open(){return{}}},URL:{revokeObjectURL(){}},Date,setTimeout(){},clearTimeout(){},setInterval(){}};vm.createContext(context);vm.runInContext(await readFile(new URL('../public/player.js',import.meta.url),'utf8'),context);
 const run=s=>vm.runInContext(s,context);run("urls.set('a','blob:a');accept({revision:1,videos:[{id:'a',captions:{version:1,enabled:true,segments:[{start:0,end:5,text:'Antiga'}]}}],config:{playlist:['a'],cyclePause:0,messages:[],ticker:'',rotation:10,duration:12,enabled:true}})");assert.equal(getCaption().version,1);
 run("accept({revision:2,videos:[{id:'a',captions:{version:2,enabled:true,segments:[{start:0,end:5,text:'Nova'}]}}],config:{...config}})");assert.equal(getCaption().version,1);nodes.video.onended();assert.equal(getCaption().version,2);assert.equal(getCaption().segments[0].text,'Nova');
});


test('legenda usa somente a faixa lateral natural sem reduzir o vídeo',async()=>{
 const context={};vm.createContext(context);vm.runInContext(await readFile(new URL('../public/captions-view.js',import.meta.url),'utf8'),context);
 const geometry=context.TVCaptionView.captionGeometry,screen={left:10,top:20,width:1920,height:1080},video={left:10,top:180,width:1920,height:720};
 const portrait=geometry(video,screen,1080,1920);assert.equal(portrait.left,1162.5);assert.equal(portrait.width,757.5);assert.equal(portrait.left+portrait.width,1920);assert.equal(portrait.top,160);
 assert.equal(geometry(video,screen,1920,720),null);assert.equal(geometry(video,screen,0,0),null);
 const css=await readFile(new URL('../public/captions.css',import.meta.url),'utf8');assert(!css.includes('width:66%'));assert(css.includes('background:transparent'));
});
