self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function readVideo(id) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('tvhosp-player-v1', 1);
    open.onupgradeneeded = () => open.transaction.abort();
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction('media', 'readonly');
        const read = tx.objectStore('media').get(id);
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      } catch (error) {
        reject(error);
      } finally {
        db.close();
      }
    };
  });
}

function mediaResponse(blob, request) {
  const size = blob.size;
  const headers = new Headers({'Content-Type': blob.type || 'video/mp4', 'Accept-Ranges': 'bytes'});
  let start = 0, end = size - 1, status = 200;
  const range = request.headers.get('Range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
    } else {
      start = size;
    }
    if (start > end) return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + size}});
    status = 206;
    headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
  }
  headers.set('Content-Length', String(end - start + 1));
  const body = request.method === 'HEAD' ? null : blob.slice(start, end + 1);
  return new Response(body, {status, headers});
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search !== '?local=1' ||
      !url.pathname.startsWith('/TV/media/') || !['GET', 'HEAD'].includes(request.method)) return;
  event.respondWith((async () => {
    const id = decodeURIComponent(url.pathname.slice('/TV/media/'.length));
    const blob = await readVideo(id).catch(() => null);
    return blob ? mediaResponse(blob, request) : fetch(request);
  })());
});
