import {UPLOAD_WINDOW_MS} from './upload-policy.mjs';
export const MAX_TRANSFER_BYTES=100_000_000_000;
export const TRANSFER_LIMIT_MESSAGE='Limite de transferência de vídeos atingido. Contate o suporte.';
export function transferUsage(history,now=Date.now()){
  const recent=history.filter(r=>Date.parse(r.createdAt)>now-UPLOAD_WINDOW_MS);
  const transferredBytes=recent.reduce((sum,r)=>sum+r.size,0);
  const next=recent.reduce((min,r)=>Math.min(min,Date.parse(r.createdAt)+UPLOAD_WINDOW_MS),Infinity);
  return {transferredBytes,maxTransferBytes:MAX_TRANSFER_BYTES,remainingBytes:Math.max(0,MAX_TRANSFER_BYTES-transferredBytes),blocked:transferredBytes>=MAX_TRANSFER_BYTES,windowStart:new Date(now-UPLOAD_WINDOW_MS).toISOString(),windowEnd:new Date(now).toISOString(),nextReleaseAt:Number.isFinite(next)?new Date(next).toISOString():null};
}
