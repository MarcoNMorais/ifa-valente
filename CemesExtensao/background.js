const QUEUE_KEY = 'cmvrPendingQueue';

async function getSettings() {
  const data = await chrome.storage.local.get(['serverUrl', 'apiKey']);
  return { serverUrl: String(data.serverUrl || '').replace(/\/$/, ''), apiKey: data.apiKey || '' };
}

async function api(path, options = {}) {
  const settings = await getSettings();
  if (!settings.serverUrl || !settings.apiKey) throw new Error('Configure o endereço do sistema e a chave da unidade.');
  const response = await fetch(`${settings.serverUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}`, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Falha de comunicação (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function queueBooking(payload) {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : [];
  if (!queue.some(item => item.dedupe_key === payload.dedupe_key)) queue.push({ ...payload, queued_at: new Date().toISOString(), attempts: 0 });
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  await updateBadge();
}

async function flushQueue() {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : [];
  if (!queue.length) return { sent: 0, remaining: 0 };
  const remaining = []; let sent = 0;
  for (const item of queue) {
    try {
      const payload = { ...item }; delete payload.queued_at; delete payload.attempts;
      await api('/api/extension/bookings', { method: 'POST', body: JSON.stringify(payload) }); sent++;
    } catch {
      remaining.push({ ...item, attempts: (item.attempts || 0) + 1 });
    }
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
  await updateBadge();
  return { sent, remaining: remaining.length };
}

async function updateBadge() {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const count = Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY].length : 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
  await chrome.action.setBadgeText({ text: count ? String(Math.min(count, 99)) : '' });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('cmvr-sync', { periodInMinutes: 2 });
  updateBadge();
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'cmvr-sync') flushQueue(); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'CMVR_CONTEXT') return api('/api/extension/context');
    if (message.type === 'CMVR_BOOKING') {
      try {
        const result = await api('/api/extension/bookings', { method: 'POST', body: JSON.stringify(message.payload) });
        await flushQueue();
        return { online: true, result };
      } catch (error) {
        if ((error.status && error.status < 500 && ![408, 429].includes(error.status)) || /Configure|chave.*inválida|desativada/i.test(error.message)) throw error;
        await queueBooking(message.payload);
        return { online: false, queued: true, message: 'Sem comunicação. O registro ficou salvo e será enviado automaticamente.' };
      }
    }
    if (message.type === 'CMVR_TEST') return api('/api/extension/context');
    if (message.type === 'CMVR_FLUSH') return flushQueue();
    if (message.type === 'CMVR_QUEUE') {
      const stored = await chrome.storage.local.get(QUEUE_KEY); return stored[QUEUE_KEY] || [];
    }
    throw new Error('Comando desconhecido.');
  })().then(result => sendResponse({ ok: true, data: result })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
