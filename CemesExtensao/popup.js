const $ = id => document.getElementById(id);
const DEFAULT_SERVER_URL = 'https://secsaudevalente.com.br/Cemes';

function send(type) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage({ type }, response => response?.ok ? resolve(response.data) : reject(new Error(response?.error || 'Falha na extensão.'))));
}

async function load() {
  const settings = await chrome.storage.local.get(['serverUrl','apiKey']);
  $('server-url').value = settings.serverUrl || DEFAULT_SERVER_URL;
  $('api-key').value = settings.apiKey || '';
  if (settings.serverUrl && settings.apiKey) test(); else setStatus('Informe o endereço e a chave fornecida pelo administrador.', '');
}

function setStatus(text, type) { $('status').textContent = text; $('status').className = `status ${type}`; }

async function test() {
  try {
    const context = await send('CMVR_TEST');
    setStatus('Conectada e pronta para registrar.', 'ok');
    $('summary').hidden = false; $('unit').textContent = context.device.unit_name;
    $('slots').textContent = `${context.slots.reduce((sum,item) => sum + item.remaining, 0)} vagas disponíveis`;
    $('message').textContent = '';
  } catch (error) { setStatus(error.message, 'error'); $('summary').hidden = true; }
}

$('save').addEventListener('click', async () => {
  const serverUrl = $('server-url').value.trim().replace(/\/$/, ''); const apiKey = $('api-key').value.trim();
  if (!serverUrl || !apiKey) return setStatus('Preencha o endereço e a chave.', 'error');
  try {
    const origin = new URL(serverUrl).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error('Autorize o acesso ao endereço do sistema.');
    await chrome.storage.local.set({ serverUrl, apiKey }); await test();
  } catch (error) { setStatus(error.message, 'error'); }
});
$('sync').addEventListener('click', async () => { try { const result = await send('CMVR_FLUSH'); $('message').textContent = `${result.sent} enviados; ${result.remaining} pendentes.`; await test(); } catch (error) { $('message').textContent = error.message; } });
load();
