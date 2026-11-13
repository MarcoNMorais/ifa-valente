// Decimal GB: the same unit displayed by the administration page.
export const MAX_VIDEO_BYTES=1_000_000_000;
export const MAX_UPLOAD_BYTES=10_000_000_000;
export const UPLOAD_WINDOW_MS=30*24*60*60*1000;
export const LIMIT_MESSAGE='Máximo de dados atingido. Contate o suporte.';
export function uploadUsage(history,now=Date.now(),migrationAt=null){
  const cutoff=now-UPLOAD_WINDOW_MS;
  const recent=history.filter(record=>{const timestamp=Date.parse(record.uploadedAt||migrationAt);return !Number.isFinite(timestamp)||timestamp>cutoff;});
  const uploadedBytes=recent.reduce((sum,record)=>sum+record.size,0);
  const expiries=recent.map(record=>Date.parse(record.uploadedAt||migrationAt)+UPLOAD_WINDOW_MS).filter(Number.isFinite);
  return {uploadedBytes,maxUploadBytes:MAX_UPLOAD_BYTES,maxVideoBytes:MAX_VIDEO_BYTES,remainingBytes:Math.max(0,MAX_UPLOAD_BYTES-uploadedBytes),blocked:uploadedBytes>=MAX_UPLOAD_BYTES,windowStart:new Date(cutoff).toISOString(),windowEnd:new Date(now).toISOString(),nextReleaseAt:expiries.length?new Date(Math.min(...expiries)).toISOString():null};
}
export function checkUploadSize(size,history,now=Date.now(),migrationAt=null){
  if(!Number.isSafeInteger(size)||size<=0)return 'Tamanho de arquivo inválido.';
  if(size>MAX_VIDEO_BYTES)return 'Cada vídeo pode ter no máximo 1 GB.';
  if(size>uploadUsage(history,now,migrationAt).remainingBytes)return LIMIT_MESSAGE;
  return null;
}
