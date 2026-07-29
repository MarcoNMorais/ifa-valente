(function () {
  if (window.__CMVR_LOADED__) return;
  window.__CMVR_LOADED__ = true;
  const processed = new WeakSet();
  let promptOpen = false;
  let lastCompletedAt = 0;
  let scanTimer = null;

  function message(type, payload) {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage({ type, payload }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      response?.ok ? resolve(response.data) : reject(new Error(response?.error || 'A extensão não respondeu.'));
    }));
  }

  function createHost() {
    document.getElementById('cmvr-extension-host')?.remove();
    const host = document.createElement('div'); host.id = 'cmvr-extension-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    document.documentElement.appendChild(host);
    return host.attachShadow({ mode: 'open' });
  }

  async function showPrompt() {
    if (promptOpen) return;
    promptOpen = true;
    const root = createHost();
    root.innerHTML = `<style>
      *{box-sizing:border-box}.shade{position:fixed;inset:0;background:rgba(3,28,45,.5);display:grid;place-items:center;padding:18px;pointer-events:auto;font-family:Inter,Arial,sans-serif}.card{width:min(520px,100%);background:#fff;border-radius:20px;box-shadow:0 25px 90px rgba(0,0,0,.3);overflow:hidden;color:#10243e}.head{background:linear-gradient(135deg,#075985,#0e7490);color:white;padding:20px 22px}.head b{font-size:18px;display:block}.head span{font-size:12px;opacity:.85}.body{padding:20px 22px}.unit{background:#e0f2fe;color:#075985;border-radius:10px;padding:10px;font-size:12px;font-weight:700;margin-bottom:15px}label{display:grid;gap:6px;font-size:12px;font-weight:700;margin-bottom:13px}select,input,textarea{border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:inherit}textarea{min-height:65px;resize:vertical}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.balance{font-size:11px;color:#64748b;margin:-5px 0 15px}.error{color:#b91c1c;font-size:12px;min-height:16px}.foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px;border-top:1px solid #e2e8f0}button{border:0;border-radius:10px;padding:10px 15px;font-weight:700;cursor:pointer}.cancel{background:#e2e8f0;color:#334155}.save{background:#075985;color:#fff}.pending{position:fixed;right:18px;bottom:18px;background:#b45309;color:#fff;border-radius:14px;padding:12px 16px;pointer-events:auto;box-shadow:0 12px 35px rgba(0,0,0,.25)}@media(max-width:520px){.grid{grid-template-columns:1fr}}
    </style><div class="shade"><form class="card"><div class="head"><b>Agendamento confirmado</b><span>Informe os dados para atualizar o saldo municipal.</span></div><div class="body"><div class="unit">Carregando unidade e vagas disponíveis…</div><label>Procedimento<select name="procedure_id" required><option value="">Carregando…</option></select></label><div class="grid"><label>Data do atendimento<input name="service_date" type="date" required></label><label>Horário<input name="service_time" type="time" required></label></div><div class="balance">Selecione os dados para consultar o saldo.</div><label>Observação (opcional)<textarea name="notes" maxlength="400"></textarea></label><div class="error"></div></div><div class="foot"><button type="button" class="cancel">Registrar depois</button><button class="save">Confirmar registro</button></div></form></div>`;
    const form = root.querySelector('form'); const errorEl = root.querySelector('.error');
    let context;
    try {
      context = await message('CMVR_CONTEXT');
      root.querySelector('.unit').textContent = `${context.device.unit_name} • ${context.device.name}`;
      const procedures = [...new Map(context.procedures.map(item => [item.id, item])).values()];
      form.procedure_id.innerHTML = '<option value="">Selecione o procedimento</option>' + procedures.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
    } catch (error) {
      errorEl.textContent = error.message;
      root.querySelector('.unit').textContent = 'Extensão ainda não configurada';
      form.querySelector('.save').disabled = true;
    }

    function updateBalance() {
      if (!context) return;
      const slot = context.slots.find(item => String(item.procedure_id) === form.procedure_id.value
        && item.service_date === form.service_date.value
        && item.service_time <= form.service_time.value
        && (item.service_time_max || item.service_time) >= form.service_time.value);
      root.querySelector('.balance').textContent = slot ? `Saldo encontrado: ${slot.remaining} vaga${slot.remaining === 1 ? '' : 's'} ${slot.remaining === 1 ? 'disponível' : 'disponíveis'}.` : 'Não há correspondência exata; o registro será enviado para pendência.';
    }
    ['procedure_id','service_date','service_time'].forEach(name => form[name].addEventListener('input', updateBalance));
    root.querySelector('.cancel').addEventListener('click', () => {
      root.innerHTML = `<style>.pending{position:fixed;right:18px;bottom:18px;background:#b45309;color:#fff;border:0;border-radius:14px;padding:12px 16px;pointer-events:auto;box-shadow:0 12px 35px rgba(0,0,0,.25);font:700 12px Arial;cursor:pointer}</style><button class="pending">⚠ Agendamento pendente — preencher agora</button>`;
      root.querySelector('button').addEventListener('click', () => { promptOpen = false; showPrompt(); });
    });
    form.addEventListener('submit', async event => {
      event.preventDefault(); errorEl.textContent = '';
      const button = form.querySelector('.save'); button.disabled = true;
      const values = Object.fromEntries(new FormData(form));
      values.dedupe_key = `cmvr-${crypto.randomUUID()}`;
      try {
        const response = await message('CMVR_BOOKING', values);
        const result = response.result;
        const success = response.queued ? response.message : result.message;
        root.innerHTML = `<style>.done{position:fixed;right:18px;bottom:18px;background:${response.queued ? '#b45309' : '#166534'};color:#fff;border-radius:14px;padding:13px 17px;pointer-events:auto;box-shadow:0 12px 35px rgba(0,0,0,.25);font:700 12px Arial}</style><div class="done">${success}</div>`;
        lastCompletedAt = Date.now();
        setTimeout(() => { document.getElementById('cmvr-extension-host')?.remove(); promptOpen = false; }, 4500);
      } catch (error) { errorEl.textContent = error.message; button.disabled = false; }
    });
  }

  function scan() {
    const matches = window.CMVRDetector.findSuccessElements(document);
    const current = new Set(matches);
    document.querySelectorAll('[data-cmvr-observed]').forEach(element => {
      if (!current.has(element) && !window.CMVRDetector.isSuccessText(element.textContent)) {
        processed.delete(element); element.removeAttribute('data-cmvr-observed');
      }
    });
    for (const element of matches) {
      element.setAttribute('data-cmvr-observed', 'true');
      if (!processed.has(element)) {
        processed.add(element);
        if (Date.now() - lastCompletedAt > 5000) showPrompt();
        break;
      }
    }
  }

  const observer = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 120); });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
  scan();
})();
