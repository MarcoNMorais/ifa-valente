import {PassThrough,Writable} from 'node:stream';
export function requestFor(handle){return async function request(url,options={}){
 const req=new PassThrough();req.url=url;req.method=options.method||'GET';req.headers=Object.fromEntries(Object.entries(options.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
 const body=options.body===undefined?null:Buffer.from(options.body);if(body&&!req.headers['content-length'])req.headers['content-length']=String(body.length);
 let status=200;const headers=new Map(),chunks=[];const res=new Writable({write(chunk,encoding,cb){chunks.push(Buffer.from(chunk));cb();}});res.headersSent=false;
 res.setHeader=(k,v)=>headers.set(k.toLowerCase(),v);res.writeHead=(code,h={})=>{status=code;for(const[k,v]of Object.entries(h))res.setHeader(k,v);res.headersSent=true;};
 const done=new Promise((resolve,reject)=>{res.on('finish',resolve);res.on('error',reject);});req.end(body);if(!await handle(req,res))res.end('SITE PRINCIPAL');await done;const out=Buffer.concat(chunks);
 return{status,headers:{get:k=>headers.get(k.toLowerCase())||null},text:()=>out.toString(),json:()=>JSON.parse(out)};
};}
