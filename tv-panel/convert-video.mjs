import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const bundled=fileURLToPath(new URL('./tools/ffmpeg.exe',import.meta.url));
export const ffmpegPath=process.env.FFMPEG_PATH||(existsSync(bundled)?bundled:'ffmpeg');
export function progressReader(report,now=()=>Date.now()){
 const started=now();let duration=0,stderr='',stdout='',position=0,percent=0;
 return {duration(chunk){stderr=(stderr+chunk).slice(-4096);const m=/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);if(m)duration=Number(m[1])*3600+Number(m[2])*60+Number(m[3]);},progress(chunk){stdout+=chunk;let end;while((end=stdout.indexOf('\n'))>=0){const line=stdout.slice(0,end).trim();stdout=stdout.slice(end+1);if(line.startsWith('out_time_us=')){const value=Number(line.slice(12));if(Number.isFinite(value))position=Math.max(position,value/1e6);}if(line.startsWith('progress=')){if(duration>0)percent=Math.max(percent,Math.min(99,Math.floor(position/duration*100)));const elapsed=(now()-started)/1000;const eta=duration>0&&position>0&&elapsed>=2?Math.max(0,Math.ceil(elapsed*(duration-position)/position)):null;report({stage:line==='progress=end'||percent>=99?'finalizing':'converting',percent:duration>0?percent:null,etaSeconds:eta});}}}};
}
export function convertMov(input,output,signal,onProgress=()=>{}){return new Promise((resolve,reject)=>{
 const child=spawn(ffmpegPath,['-hide_banner','-loglevel','info','-nostats','-stats_period','1','-progress','pipe:1','-nostdin','-y','-protocol_whitelist','file,pipe','-i',input,'-map','0:v:0','-map','0:a:0?','-vf',"scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",'-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','128k','-movflags','+faststart','-f','mp4',output],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},50*60*1000);const cancel=()=>child.kill();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const reader=progressReader(onProgress);onProgress({stage:'converting',percent:null,etaSeconds:null});child.stderr.on('data',chunk=>reader.duration(chunk.toString()));child.stdout.on('data',chunk=>reader.progress(chunk.toString()));
 const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
 child.on('error',()=>{cleanup();reject(Object.assign(Error('Conversor indisponível. Use o pacote completo com a pasta tools.'),{code:503}));});
 child.on('close',code=>{cleanup();if(code===0&&!signal?.aborted)resolve();else reject(Object.assign(Error(signal?.aborted?'Conversão cancelada.':timedOut?'A conversão demorou demais.':'Não foi possível converter este MOV. Verifique se o vídeo abre normalmente.'),{code:422}));});
});}
