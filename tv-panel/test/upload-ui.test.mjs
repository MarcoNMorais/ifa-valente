import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/media-library.js',import.meta.url),'utf8');
function setup(progress){
 const nodes={},requests=[],saved=[];const document={getElementById(id){return nodes[id]||(nodes[id]={hidden:false,disabled:false,value:'',textContent:'',setAttribute(){},removeAttribute(){}});}};
 class XHR{constructor(){this.upload={};requests.push(this);}open(method,url){this.url=url;}setRequestHeader(){}send(file){this.file=file;}abort(){this.onabort();}}
 const ctx={document,XMLHttpRequest:XHR,location:{},setTimeout,clearTimeout,AbortSignal,setInterval(){},fetch(){if(progress)return Promise.resolve({status:200,ok:true,json:async()=>progress});throw Error('O envio não deve consultar o histórico ou usar fetch para o arquivo.');}};vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.TVLibrary.mount({isBusy:()=>false,run(){throw Error('O envio não deve travar o editor.');},onUploaded:v=>saved.push(v),onDone(){}});return{nodes,requests,saved};
}
test('arquivo grande envia diretamente, mostra progresso e mantém editor disponível',async()=>{
 const p=setup(),file={name:'grande.mp4',size:1_500_000_000,type:'video/mp4'};
 const target={files:[file],value:'file'};const pending=p.nodes.files.onchange({target});
 assert.equal(p.requests.length,0);assert.equal(target.value,'file');assert.match(p.nodes.selectedFiles.textContent,/grande.mp4/);
 assert.equal(p.requests.length,0);assert.equal(p.nodes.sendingBox.hidden,false);await new Promise(r=>setTimeout(r,70));
 assert.equal(p.requests.length,1);assert.equal(p.requests[0].file,file);assert.equal(p.nodes.files.disabled,true);assert.equal(p.nodes.sendingBox.hidden,false);
 p.requests[0].upload.onprogress({lengthComputable:true,loaded:500,total:1000});assert.equal(p.nodes.sendingProgress.value,50);assert.match(p.nodes.sendingLabel.textContent,/50%/);
 p.requests[0].status=201;p.requests[0].responseText=JSON.stringify({video:{id:'v',name:file.name}});p.requests[0].onload();await pending;
 assert.equal(p.saved.length,1);assert.equal(p.nodes.files.disabled,false);assert.equal(p.nodes.sendingBox.hidden,true);
});
test('cancelamento interrompe lote e libera novo envio',async()=>{
 const p=setup(),file={name:'a.mp4',size:100,type:'video/mp4'};const pending=p.nodes.files.onchange({target:{files:[file,file],value:'a'}});await new Promise(r=>setTimeout(r,70));
 p.nodes.cancelUpload.onclick();await pending;assert.equal(p.requests.length,1);assert.equal(p.saved.length,0);assert.equal(p.nodes.files.disabled,false);assert.match(p.nodes.videoStatus.textContent,/cancelado/);
 const retry=p.nodes.files.onchange({target:{files:[file],value:'a'}});await new Promise(r=>setTimeout(r,70));p.requests[1].onerror();await retry;assert.equal(p.nodes.files.disabled,false);assert.match(p.nodes.videoStatus.textContent,/conexão/);
});


test('MOV mostra avanço e estimativa e encerra consulta ao terminar',async()=>{
 const p=setup({stage:'converting',percent:45,etaSeconds:80}),file={name:'teste.mov',size:100,type:'video/quicktime'};
 const pending=p.nodes.files.onchange({target:{files:[file],value:'a'}});await new Promise(r=>setTimeout(r,70));const xhr=p.requests[0];xhr.upload.onprogress({lengthComputable:true,loaded:100,total:100});await new Promise(r=>setImmediate(r));assert.equal(p.nodes.sendingProgress.value,45);assert.match(p.nodes.sendingLabel.textContent,/45%/);assert.match(p.nodes.sendingLabel.textContent,/2 min/);xhr.status=201;xhr.responseText=JSON.stringify({video:{id:'mov',name:'teste.mp4'}});xhr.onload();await pending;assert.equal(p.nodes.sendingBox.hidden,true);
});
