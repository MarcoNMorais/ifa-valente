const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { user: null, csrf: null, units: [], procedures: [], doctors: [], locations: [], page: 'dashboard', cache: {} };
const pathPrefix = window.location.pathname.match(/^\/[^/]+/)?.[0] || '';
const APP_BASE_PATH = pathPrefix.toLowerCase() === '/cemes' ? pathPrefix : '';
const appPath = path => `${APP_BASE_PATH}${path}`;

const pages = {
  dashboard: ['Visão geral', 'Painel de vagas'],
  vagas: ['Agenda operacional', 'Vagas por data e horário'],
  historico: ['Auditoria operacional', 'Histórico de agendamentos'],
  pendencias: ['Conferência necessária', 'Pendências da extensão'],
  relatorios: ['Informação gerencial', 'Relatórios e exportações'],
  cadastros: ['Bases do sistema', 'Cadastros e lançamentos'],
  administracao: ['Segurança e manutenção', 'Administração']
};

const roleNames = { admin: 'Administrador', regulacao: 'Regulação Central', unidade: 'Operador da Unidade', gestor: 'Gestor / Consulta' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function dateBr(value) {
  if (!value) return '—';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function dateTimeBr(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function toast(message, type = 'success') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.className = 'toast', 3400);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof ArrayBuffer) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (state.csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(appPath(url), { credentials: 'same-origin', ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(data?.error || 'Não foi possível concluir a operação.');
    error.status = response.status; error.data = data;
    throw error;
  }
  return data;
}

async function loadBaseData() {
  [state.units, state.procedures, state.doctors, state.locations] = await Promise.all([
    api('/api/units'), api('/api/procedures'), api('/api/doctors'), api('/api/locations')
  ]);
}

async function bootstrap() {
  try {
    const session = await api('/api/session');
    state.user = session.user; state.csrf = session.csrf_token;
    await loadBaseData();
    showApp();
    const route = location.hash.slice(1);
    await navigate(pages[route] ? route : 'dashboard', false);
    if (state.user.must_change_password) setTimeout(passwordDialog, 250);
  } catch {
    showLogin();
  }
}

function showLogin() {
  $('#login-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
}

function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-name').textContent = state.user.name;
  $('#user-role').textContent = state.user.unit_name || roleNames[state.user.role];
  $('#user-initials').textContent = state.user.name.split(' ').slice(0, 2).map(word => word[0]).join('').toUpperCase();
  $$('[data-roles]').forEach(el => el.classList.toggle('hidden', !el.dataset.roles.split(',').includes(state.user.role)));
}

async function navigate(page, updateHash = true) {
  if (!pages[page]) page = 'dashboard';
  state.page = page;
  if (updateHash) history.replaceState(null, '', `#${page}`);
  $$('#main-nav button').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
  $('#page-kicker').textContent = pages[page][0];
  $('#page-title').textContent = pages[page][1];
  $('#sidebar').classList.remove('open');
  $('#page-content').innerHTML = '<div class="empty"><b>Carregando informações…</b></div>';
  try {
    await renderers[page]();
    $('#page-content').focus({ preventScroll: true });
    updatePendingBadge();
  } catch (error) {
    if (error.status === 401) return showLogin();
    $('#page-content').innerHTML = `<div class="empty"><b>Não foi possível carregar esta página.</b>${escapeHtml(error.message)}</div>`;
  }
}

async function updatePendingBadge() {
  try {
    const rows = state.page === 'pendencias' && state.cache.pending ? state.cache.pending : await api('/api/pending');
    $('#pending-badge').textContent = rows.filter(row => row.status === 'open').length;
  } catch { /* sem interrupção */ }
}

function pageHead(title, description, actions = '') {
  return `<div class="page-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><div class="actions">${actions}</div></div>`;
}

function selectOptions(rows, selected = '', placeholder = 'Selecione') {
  return `<option value="">${placeholder}</option>${rows.map(row => `<option value="${row.id}" ${String(row.id) === String(selected) ? 'selected' : ''}>${escapeHtml(row.name)}</option>`).join('')}`;
}

function statusSlot(row) {
  const passed = new Date(`${row.service_date}T${row.service_time}:00`) < new Date();
  if (passed && row.remaining > 0) return ['expired', 'Vencida'];
  if (row.remaining <= 0) return ['full', 'Esgotada'];
  if (row.is_free_pool) return ['free', 'Livre'];
  if (row.used > 0) return ['partial', 'Parcial'];
  return ['available', 'Disponível'];
}

function manualBookingScope() {
  return state.user.permissions?.manual_booking_scope
    || (['admin', 'regulacao'].includes(state.user.role) ? 'all' : state.user.role === 'unidade' ? 'own' : 'none');
}

function canManuallyUseSlot(row) {
  const scope = manualBookingScope();
  if (scope === 'all') return true;
  if (scope === 'own') return Number(row.unit_id) === Number(state.user.unit_id);
  if (scope === 'own_and_secretaria') {
    return Number(row.unit_id) === Number(state.user.unit_id)
      || String(row.unit_name || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes('secretaria');
  }
  return false;
}

function openDialog({ title, kicker = 'Cadastro', body, submit = 'Salvar', onSubmit, wide = false }) {
  const dialog = $('#form-dialog');
  $('#dialog-title').textContent = title; $('#dialog-kicker').textContent = kicker;
  $('#dialog-body').innerHTML = body; $('#dialog-submit').textContent = submit;
  $('#dialog-error').textContent = '';
  dialog.classList.toggle('wide-dialog', wide);
  $('#dialog-close').onclick = () => dialog.close();
  $('#dialog-cancel').onclick = () => dialog.close();
  $('#dialog-form').onsubmit = async event => {
    event.preventDefault();
    const button = $('#dialog-submit'); button.disabled = true;
    try {
      await onSubmit(new FormData(event.currentTarget));
      dialog.close(); toast('Operação concluída com sucesso.'); await navigate(state.page, false);
    } catch (error) {
      $('#dialog-error').textContent = error.message;
    } finally { button.disabled = false; }
  };
  dialog.showModal();
}

async function renderDashboard() {
  const [data, slots] = await Promise.all([api('/api/dashboard'), api('/api/slots?available=1')]);
  const use = value => Number(value || 0);
  const upcoming = slots.slice(0, 6);
  $('#page-content').innerHTML = `
    ${pageHead(`Olá, ${escapeHtml(state.user.name.split(' ')[0])}`, 'Acompanhe a distribuição e o uso das vagas em tempo real.', state.user.role === 'admin' || state.user.role === 'regulacao' ? '<button class="primary" id="quick-slot">＋ Distribuir vagas</button>' : '')}
    <div class="stats">
      <article class="stat-card"><div class="stat-top"><span class="stat-label">Vagas cadastradas</span><span class="stat-icon">▦</span></div><div class="stat-number">${use(data.total)}</div><div class="stat-note">Total do período</div></article>
      <article class="stat-card green"><div class="stat-top"><span class="stat-label">Utilizadas</span><span class="stat-icon">✓</span></div><div class="stat-number">${use(data.used)}</div><div class="stat-note">${data.total ? Math.round(data.used / data.total * 100) : 0}% de aproveitamento</div></article>
      <article class="stat-card"><div class="stat-top"><span class="stat-label">Disponíveis</span><span class="stat-icon">＋</span></div><div class="stat-number">${use(data.remaining)}</div><div class="stat-note">${use(data.free)} em vagas livres</div></article>
      <article class="stat-card amber"><div class="stat-top"><span class="stat-label">Pendências</span><span class="stat-icon">!</span></div><div class="stat-number">${use(data.pending)}</div><div class="stat-note">Precisam de conferência</div></article>
      <article class="stat-card red"><div class="stat-top"><span class="stat-label">Vencidas</span><span class="stat-icon">×</span></div><div class="stat-number">${use(data.expired)}</div><div class="stat-note">Sem utilização</div></article>
    </div>
    <div class="dashboard-grid">
      <section class="panel"><header class="panel-header"><div><h3>Aproveitamento por procedimento</h3><p>Utilizadas em relação às vagas disponibilizadas</p></div><button class="table-action" data-go="relatorios">Ver relatórios</button></header><div class="panel-body">
        ${data.byProcedure.length ? data.byProcedure.map(row => { const percent = row.total ? Math.round(row.used / row.total * 100) : 0; return `<div class="progress-row"><div class="progress-meta"><span class="strong">${escapeHtml(row.name)}</span><span>${row.used} de ${row.total} • ${percent}%</span></div><div class="progress"><i style="width:${Math.min(percent,100)}%"></i></div></div>`; }).join('') : '<div class="empty"><b>Ainda não há vagas.</b>Cadastre a primeira agenda.</div>'}
      </div></section>
      <section class="panel"><header class="panel-header"><div><h3>Próximas vagas disponíveis</h3><p>Organizadas por data e horário</p></div><button class="table-action" data-go="vagas">Agenda completa</button></header><div class="panel-body upcoming-list">
        ${upcoming.length ? upcoming.map(row => { const [y,m,d] = row.service_date.split('-'); return `<div class="upcoming"><div class="date-block"><b>${d}</b><span>${new Date(`${y}-${m}-${d}T12:00`).toLocaleDateString('pt-BR',{month:'short'}).replace('.','')}</span></div><div><h4>${escapeHtml(row.procedure_name)}</h4><p>${escapeHtml(row.unit_name)} • ${row.service_time}</p></div><span class="balance">${row.remaining} vaga${row.remaining === 1 ? '' : 's'}</span></div>`; }).join('') : '<div class="empty"><b>Nenhuma vaga disponível.</b></div>'}
      </div></section>
    </div>`;
  $('#quick-slot')?.addEventListener('click', newSlotDialog);
  $$('[data-go]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.go)));
}

async function renderSlots() {
  const rows = await api('/api/slots'); state.cache.slots = rows;
  const canEdit = ['admin', 'regulacao'].includes(state.user.role);
  const canUse = manualBookingScope() !== 'none';
  const showActions = canEdit || canUse;
  const groupedView = canEdit;
  const viewAll = Boolean(state.user.permissions?.view_all_units) || state.user.role !== 'unidade';
  const pageTitle = viewAll ? 'Agenda de vagas' : `Vagas da ${state.user.unit_name}`;
  const pageDescription = state.user.role === 'unidade' && !viewAll
    ? 'Veja as vagas da sua unidade, pegue vagas livres e registre as que já foram marcadas no portal.'
    : state.user.role === 'unidade'
      ? 'O perfil CEMES visualiza todas as vagas, pode pegar vagas livres para CEMES ou Secretaria e registrar utilizações.'
      : 'Distribua vagas entre unidades, deixe saldo livre para retirada e acompanhe as utilizações confirmadas.';
  $('#page-content').innerHTML = `
    ${pageHead(pageTitle, pageDescription, canEdit ? '<button class="secondary" id="import-slots">⇧ Importar Excel</button><button class="primary" id="new-slot">＋ Distribuir vagas</button>' : '')}
    <div class="filter-bar"><div class="search-wrap"><input id="slot-search" placeholder="Buscar procedimento, unidade, médico ou local"></div><select id="slot-unit"><option value="">Todas as unidades</option><option value="free">Vagas livres</option>${state.units.map(row => `<option value="${row.id}">${escapeHtml(row.name)}</option>`).join('')}</select><input id="slot-date" type="date" aria-label="Filtrar por data"><select id="slot-status"><option value="">Todas as situações</option><option value="free">Livre</option><option value="available">Disponível</option><option value="partial">Parcial</option><option value="full">Esgotada</option><option value="expired">Vencida</option></select><button class="secondary" id="clear-slot-filter">Limpar</button></div>
    <div class="table-wrap"><table class="data-table ${groupedView ? 'grouped-slots-table' : ''}"><thead id="slots-head"></thead><tbody id="slots-body"></tbody></table></div>`;

  const timeLabel = row => row.service_time_max && row.service_time_max !== row.service_time
    ? `${row.service_time} até ${row.service_time_max}`
    : row.service_time;

  const actionButtons = row => {
    if (row.is_free_pool) {
      const claimAction = row.remaining > 0 && statusSlot(row)[0] !== 'expired' && state.user.role !== 'gestor'
        ? `<button class="table-action claim-free" data-id="${row.id}">✦ Pegar vaga</button>`
        : '';
      const cancelAction = canEdit
        ? `<button class="table-action cancel-slot" data-id="${row.id}">Cancelar saldo livre</button>`
        : '';
      return `${claimAction}${cancelAction}` || '—';
    }
    const useAction = row.remaining > 0 && canManuallyUseSlot(row)
      ? `<button class="table-action use-slot" data-id="${row.id}">✓ Marcar utilizada</button>`
      : '';
    const editActions = canEdit
      ? `<button class="table-action edit-slot" data-id="${row.id}">Editar</button>${row.used === 0 ? `<button class="table-action transfer-slot" data-id="${row.id}">Transferir</button><button class="table-action cancel-slot" data-id="${row.id}">Cancelar</button>` : ''}`
      : '';
    return `${useAction}${editActions}` || '—';
  };

  const bindSlotActions = () => {
    $$('.claim-free').forEach(btn => btn.addEventListener('click', () => claimFreeSlotDialog(rows.find(row => row.id === Number(btn.dataset.id)))));
    $$('.use-slot').forEach(btn => btn.addEventListener('click', () => manualSlotDialog(rows.find(row => row.id === Number(btn.dataset.id)))));
    $$('.transfer-slot').forEach(btn => btn.addEventListener('click', () => transferDialog(rows.find(row => row.id === Number(btn.dataset.id)))));
    $$('.edit-slot').forEach(btn => btn.addEventListener('click', () => editSlotDialog(rows.find(row => row.id === Number(btn.dataset.id)))));
    $$('.cancel-slot').forEach(btn => btn.addEventListener('click', () => cancelSlotDialog(rows.find(row => row.id === Number(btn.dataset.id)))));
  };

  const groupRows = filtered => {
    const groups = new Map();
    for (const row of filtered) {
      const key = JSON.stringify([
        row.service_date,
        row.service_time,
        row.service_time_max || row.service_time,
        row.procedure_id,
        row.doctor_id || row.doctor_name || row.provider || '',
        row.location || ''
      ]);
      if (!groups.has(key)) groups.set(key, {
        id: `distribution-${groups.size + 1}`,
        service_date: row.service_date,
        service_time: row.service_time,
        service_time_max: row.service_time_max,
        procedure_name: row.procedure_name,
        sigtap: row.sigtap,
        doctor_name: row.doctor_name || row.provider,
        location: row.location,
        quantity: 0,
        used: 0,
        remaining: 0,
        rows: []
      });
      const group = groups.get(key);
      group.quantity += Number(row.quantity || 0);
      group.used += Number(row.used || 0);
      group.remaining += Number(row.remaining || 0);
      group.rows.push(row);
    }
    return [...groups.values()];
  };

  const draw = () => {
    const search = $('#slot-search').value.toLowerCase(); const unit = $('#slot-unit').value; const date = $('#slot-date').value; const status = $('#slot-status').value;
    const filtered = rows.filter(row => {
      const st = statusSlot(row)[0];
      const unitMatches = !unit
        || (unit === 'free' && Boolean(row.is_free_pool))
        || (unit !== 'free' && !row.is_free_pool && String(row.unit_id) === unit);
      return (!search || `${row.procedure_name} ${row.unit_name} ${row.doctor_name || row.provider || ''} ${row.location || ''}`.toLowerCase().includes(search)) && unitMatches && (!date || row.service_date === date) && (!status || st === status);
    });
    if (groupedView) {
      $('#slots-head').innerHTML = '<tr><th>Data e horário</th><th>Procedimento</th><th>Local executante</th><th>Médico</th><th>Distribuição</th><th>Situação</th><th>Detalhes</th></tr>';
      const groups = groupRows(filtered);
      $('#slots-body').innerHTML = groups.length ? groups.map(group => {
        const [klass,label] = statusSlot(group);
        const regularRows = group.rows.filter(row => !row.is_free_pool);
        const unitCount = new Set(regularRows.map(row => row.unit_id)).size;
        const freeCount = group.rows.filter(row => row.is_free_pool).reduce((sum, row) => sum + Number(row.remaining || 0), 0);
        const distributionLabel = `${unitCount} unidade${unitCount === 1 ? '' : 's'}${freeCount ? ` • ${freeCount} livre${freeCount === 1 ? '' : 's'}` : ''}`;
        return `<tr class="distribution-summary-row">
          <td><span class="strong mono">${dateBr(group.service_date)}</span><br><span class="muted mono">${timeLabel(group)}</span></td>
          <td><span class="strong">${escapeHtml(group.procedure_name)}</span><br><span class="muted">${escapeHtml(group.sigtap || 'Sem SIGTAP')}</span></td>
          <td><span class="strong">${escapeHtml(group.location || '—')}</span></td>
          <td>${escapeHtml(group.doctor_name || '—')}</td>
          <td><span class="strong">${group.used} / ${group.quantity}</span><br><span class="muted">${distributionLabel} • ${group.remaining} restante${group.remaining === 1 ? '' : 's'}</span></td>
          <td><span class="badge ${klass}">${label}</span></td>
          <td><button class="table-action expand-distribution" data-target="${group.id}" aria-expanded="false">⌄ Ver distribuição (${group.rows.length})</button></td>
        </tr>
        <tr class="distribution-details-row" id="${group.id}" hidden><td colspan="7">
          <div class="distribution-details">
            <div class="distribution-details-title"><b>Distribuição por unidade e saldo livre</b><span>${group.quantity} vagas no total desta agenda</span></div>
            <div class="distribution-details-scroll"><table><thead><tr><th>Unidade</th><th>Vagas</th><th>Utilizadas</th><th>Restantes</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
              ${group.rows.map(row => {
                const [rowClass,rowLabel] = statusSlot(row);
                return `<tr class="${row.is_free_pool ? 'free-slot-row' : ''}"><td class="strong">${row.is_free_pool ? '✦ ' : ''}${escapeHtml(row.unit_name)}</td><td>${row.quantity}</td><td>${row.used}</td><td>${row.remaining}</td><td><span class="badge ${rowClass}">${rowLabel}</span></td><td><div class="actions">${actionButtons(row)}</div></td></tr>`;
              }).join('')}
            </tbody></table></div>
          </div>
        </td></tr>`;
      }).join('') : '<tr><td colspan="7"><div class="empty"><b>Nenhuma agenda encontrada.</b>Ajuste os filtros ou distribua novas vagas.</div></td></tr>';
      $$('.expand-distribution').forEach(button => {
        const toggleDetails = () => {
        const details = document.getElementById(button.dataset.target);
        details.hidden = !details.hidden;
        button.setAttribute('aria-expanded', String(!details.hidden));
        button.textContent = `${details.hidden ? '⌄' : '⌃'} ${details.hidden ? 'Ver' : 'Ocultar'} distribuição (${details.querySelectorAll('.distribution-details-scroll table > tbody > tr').length})`;
        };
        button.addEventListener('click', toggleDetails);
        button.closest('.distribution-summary-row').addEventListener('click', event => {
          if (!event.target.closest('button')) toggleDetails();
        });
      });
    } else {
      $('#slots-head').innerHTML = `<tr><th>Data e horário</th><th>Procedimento</th><th>Unidade</th><th>Local executante</th><th>Médico</th><th>Utilização</th><th>Situação</th>${showActions ? '<th>Ações</th>' : ''}</tr>`;
      $('#slots-body').innerHTML = filtered.length ? filtered.map(row => {
        const [klass,label] = statusSlot(row);
        return `<tr class="${row.is_free_pool ? 'free-slot-row' : ''}"><td><span class="strong mono">${dateBr(row.service_date)}</span><br><span class="muted mono">${timeLabel(row)}</span></td><td><span class="strong">${escapeHtml(row.procedure_name)}</span><br><span class="muted">${escapeHtml(row.sigtap || 'Sem SIGTAP')}</span></td><td>${row.is_free_pool ? '✦ ' : ''}${escapeHtml(row.unit_name)}</td><td>${escapeHtml(row.location || '—')}</td><td>${escapeHtml(row.doctor_name || row.provider || '—')}</td><td><span class="strong">${row.used} / ${row.quantity}</span><br><span class="muted">${row.remaining} restante${row.remaining === 1 ? '' : 's'}</span></td><td><span class="badge ${klass}">${label}</span></td>${showActions ? `<td><div class="actions">${actionButtons(row)}</div></td>` : ''}</tr>`;
      }).join('') : `<tr><td colspan="${showActions ? 8 : 7}"><div class="empty"><b>Nenhuma vaga encontrada.</b>Ajuste os filtros.</div></td></tr>`;
    }
    bindSlotActions();
  };
  ['slot-search','slot-unit','slot-date','slot-status'].forEach(id => $(`#${id}`).addEventListener('input', draw));
  $('#clear-slot-filter').addEventListener('click', () => { ['slot-search','slot-unit','slot-date','slot-status'].forEach(id => $(`#${id}`).value = ''); draw(); });
  draw();
  $('#new-slot')?.addEventListener('click', newSlotDialog); $('#import-slots')?.addEventListener('click', importDialog);
}

async function renderHistory() {
  const [rows, claims] = await Promise.all([api('/api/bookings'), api('/api/free-slot-claims')]);
  state.cache.bookings = rows; state.cache.freeClaims = claims;
  const canCancel = ['admin','regulacao'].includes(state.user.role);
  $('#page-content').innerHTML = `${pageHead('Histórico de agendamentos', 'Utilizações, cancelamentos, remarcações e retiradas de vagas livres permanecem registrados.')}
    <div class="filter-bar"><div class="search-wrap"><input id="history-search" placeholder="Buscar procedimento, unidade ou operador"></div><select id="history-unit">${selectOptions(state.units,'','Todas as unidades')}</select><input id="history-date" type="date"><select id="history-status"><option value="">Todos os status</option><option value="confirmed">Confirmado</option><option value="cancelled">Cancelado</option></select><button class="secondary" id="print-history">Imprimir</button></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Atendimento</th><th>Procedimento</th><th>Unidade</th><th>Operador</th><th>Registro</th><th>Status</th>${canCancel ? '<th>Ação</th>' : ''}</tr></thead><tbody id="history-body"></tbody></table></div>
    <section class="panel free-claims-history"><header class="panel-header"><div><h3>Retiradas de vagas livres</h3><p>Mostra quem pegou, para qual unidade e quando a retirada ocorreu.</p></div><span class="free-claims-count">${claims.length}</span></header>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Agenda</th><th>Procedimento</th><th>Unidade que recebeu</th><th>Retirada por</th><th>Confirmada em</th></tr></thead><tbody>
        ${claims.length ? claims.map(row => `<tr><td><span class="strong">${dateBr(row.service_date)}</span><br><span class="muted">${escapeHtml(row.service_time)}${row.service_time_max && row.service_time_max !== row.service_time ? ` até ${escapeHtml(row.service_time_max)}` : ''}</span></td><td><span class="strong">${escapeHtml(row.procedure_name)}</span><br><span class="muted">${escapeHtml(row.doctor_name || '—')}</span></td><td>${escapeHtml(row.unit_name)}</td><td>${escapeHtml(row.operator_name || 'Sistema')}</td><td>${dateTimeBr(row.created_at)}</td></tr>`).join('') : '<tr><td colspan="5"><div class="empty"><b>Nenhuma vaga livre foi retirada.</b></div></td></tr>'}
      </tbody></table></div>
    </section>`;
  const draw = () => {
    const search = $('#history-search').value.toLowerCase(), unit = $('#history-unit').value, date = $('#history-date').value, status = $('#history-status').value;
    const filtered = rows.filter(row => (!search || `${row.procedure_name} ${row.unit_name} ${row.operator_name || ''}`.toLowerCase().includes(search)) && (!unit || String(row.unit_id) === unit) && (!date || row.service_date === date) && (!status || row.status === status));
    $('#history-body').innerHTML = filtered.length ? filtered.map(row => `<tr><td><span class="strong">${dateBr(row.service_date)}</span><br><span class="muted">${row.service_time}</span></td><td>${escapeHtml(row.procedure_name)}</td><td>${escapeHtml(row.unit_name)}</td><td>${escapeHtml(row.operator_name || 'Dispositivo')}</td><td>${dateTimeBr(row.created_at)}<br><span class="muted">${row.source === 'manual' ? 'Baixa manual pelo site' : 'Registrada pela extensão'}</span></td><td><span class="badge ${row.status}">${row.status === 'confirmed' ? 'Confirmado' : row.status === 'cancelled' ? 'Cancelado' : 'Remarcado'}</span></td>${canCancel ? `<td>${row.status === 'confirmed' ? `<div class="actions"><button class="table-action reschedule-booking" data-id="${row.id}">Remarcar</button><button class="table-action cancel-booking" data-id="${row.id}">Cancelar</button></div>` : '—'}</td>` : ''}</tr>`).join('') : '<tr><td colspan="7"><div class="empty"><b>Nenhum registro encontrado.</b></div></td></tr>';
    $$('.cancel-booking').forEach(btn => btn.addEventListener('click', () => cancelDialog(Number(btn.dataset.id))));
    $$('.reschedule-booking').forEach(btn => btn.addEventListener('click', () => rescheduleDialog(rows.find(row => row.id === Number(btn.dataset.id)))));
  };
  ['history-search','history-unit','history-date','history-status'].forEach(id => $(`#${id}`).addEventListener('input', draw)); draw();
  $('#print-history').addEventListener('click', () => window.print());
}

async function renderPending() {
  const rows = await api('/api/pending'); state.cache.pending = rows;
  const canResolve = ['admin','regulacao'].includes(state.user.role);
  $('#page-content').innerHTML = `${pageHead('Pendências da extensão', 'Ocorrências sem correspondência exata ficam separadas para não alterar o saldo incorretamente.')}
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Data e horário</th><th>Procedimento</th><th>Unidade</th><th>Motivo</th><th>Registrada</th><th>Status</th>${canResolve ? '<th>Ação</th>' : ''}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr><td>${dateBr(row.service_date)}<br><span class="muted">${row.service_time || '—'}</span></td><td>${escapeHtml(row.procedure_name || 'Não identificado')}</td><td>${escapeHtml(row.unit_name || '—')}</td><td>${escapeHtml(row.reason)}</td><td>${dateTimeBr(row.created_at)}</td><td><span class="badge ${row.status}">${row.status === 'open' ? 'Pendente' : row.status === 'resolved' ? 'Resolvida' : 'Cancelada'}</span></td>${canResolve ? `<td>${row.status === 'open' ? `<button class="table-action resolve-pending" data-id="${row.id}">Conferir</button>` : '—'}</td>` : ''}</tr>`).join('') : '<tr><td colspan="7"><div class="empty"><b>Nenhuma pendência.</b>Todos os registros estão conciliados.</div></td></tr>'}</tbody></table></div>`;
  $$('.resolve-pending').forEach(btn => btn.addEventListener('click', () => resolveDialog(rows.find(row => row.id === Number(btn.dataset.id)))));
}

async function renderReports() {
  const data = await api('/api/dashboard');
  $('#page-content').innerHTML = `${pageHead('Relatórios e exportações', 'Os relatórios respeitam a unidade vinculada ao operador e registram a data da emissão.')}
    <div class="report-grid">
      <article class="report-card"><div class="report-icon">▤</div><h3>Utilização das vagas</h3><p>Vagas distribuídas, utilizadas e restantes por unidade, procedimento, data e horário.</p><div class="report-buttons"><a href="${appPath('/api/reports/utilization.pdf')}">PDF</a><a href="${appPath('/api/reports/utilization.xlsx')}">Excel</a><a href="${appPath('/api/reports/utilization.csv')}">CSV</a></div></article>
      <article class="report-card"><div class="report-icon">%</div><h3>Resumo de aproveitamento</h3><p>Visão rápida do desempenho atual do controle municipal.</p><div class="mini-list"><div class="mini-item">Aproveitamento <b>${data.total ? Math.round(data.used/data.total*100) : 0}%</b></div><div class="mini-item">Vagas utilizadas <b>${data.used}</b></div><div class="mini-item">Vagas restantes <b>${data.remaining}</b></div></div></article>
      <article class="report-card"><div class="report-icon">!</div><h3>Pendências e divergências</h3><p>Registros não conciliados automaticamente pela extensão.</p><div class="mini-list"><div class="mini-item">Aguardando conferência <b>${data.pending}</b></div><div class="mini-item">Vagas vencidas <b>${data.expired}</b></div></div><div class="report-buttons"><a href="#pendencias" id="go-pending-report">Conferir agora</a></div></article>
    </div>`;
  $('#go-pending-report').addEventListener('click', event => { event.preventDefault(); navigate('pendencias'); });
}

async function renderRegisters() {
  const [allDoctors, allProcedures, allUnits] = await Promise.all([
    api('/api/doctors?include_inactive=1'),
    api('/api/procedures?include_inactive=1'),
    api('/api/units?include_inactive=1')
  ]);
  const activeCount = rows => rows.filter(row => Boolean(row.active)).length;
  const inactiveCount = rows => rows.length - activeCount(rows);
  const canManageUnits = state.user.role === 'admin';
  $('#page-content').innerHTML = `${pageHead('Cadastros e lançamentos', 'Mantenha as bases padronizadas antes de distribuir novas vagas.')}
    <div class="register-grid">
      <article class="admin-card"><h3>Médicos</h3><p>${activeCount(allDoctors)} ativos${inactiveCount(allDoctors) ? ` e ${inactiveCount(allDoctors)} inativos` : ''}, vinculados aos procedimentos que atendem.</p><button class="primary" id="new-doctor">＋ Cadastrar médico</button></article>
      <article class="admin-card"><h3>Procedimentos</h3><p>${activeCount(allProcedures)} ativos${inactiveCount(allProcedures) ? ` e ${inactiveCount(allProcedures)} inativos` : ''}. Somente os ativos aparecem na extensão.</p><button class="primary" id="new-procedure">＋ Cadastrar procedimento</button></article>
      <article class="admin-card"><h3>Locais de atendimento</h3><p>${state.locations.length} locais ativos. CEMES é o local padrão.</p><button class="primary" id="new-location">＋ Cadastrar local</button></article>
      <article class="admin-card"><h3>Unidades de saúde</h3><p>${activeCount(allUnits)} ativas${inactiveCount(allUnits) ? ` e ${inactiveCount(allUnits)} inativas` : ''} no controle de vagas.</p>${canManageUnits ? '<button class="primary" id="new-unit">＋ Cadastrar unidade</button>' : '<button class="secondary" disabled>Somente administrador</button>'}</article>
      <article class="admin-card"><h3>Lançamento manual</h3><p>Use apenas para corrigir um registro que não veio pela extensão.</p><button class="secondary" id="manual-booking">Registrar utilização</button></article>
    </div>
    <section class="panel register-manager">
      <header class="panel-header"><div><h3>Gerenciar médicos</h3><p>Edite nome, CRM e todos os procedimentos realizados por cada profissional.</p></div></header>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Médico</th><th>Procedimentos vinculados</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
        ${allDoctors.map(doctor => `<tr><td><span class="strong">${escapeHtml(doctor.name)}</span><br><span class="muted">${escapeHtml(doctor.crm || 'CRM não informado')}</span></td><td><div class="catalog-tags">${doctor.procedure_names.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</div></td><td><span class="badge ${doctor.active ? 'available' : 'cancelled'}">${doctor.active ? 'Ativo' : 'Inativo'}</span></td><td><div class="actions"><button class="table-action edit-doctor" data-id="${doctor.id}">Editar</button><button class="table-action ${doctor.active ? 'deactivate' : 'activate'} toggle-doctor" data-id="${doctor.id}">${doctor.active ? 'Inativar' : 'Ativar'}</button></div></td></tr>`).join('')}
      </tbody></table></div>
    </section>
    <section class="panel register-manager">
      <header class="panel-header"><div><h3>Gerenciar procedimentos</h3><p>Edite a descrição, SIGTAP, especialidade e disponibilidade na extensão.</p></div></header>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Procedimento</th><th>SIGTAP</th><th>Especialidade</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
        ${allProcedures.map(procedure => `<tr><td class="strong">${escapeHtml(procedure.name)}</td><td>${escapeHtml(procedure.sigtap || 'Não informado')}</td><td>${escapeHtml(procedure.specialty || 'Não informada')}</td><td><span class="badge ${procedure.active ? 'available' : 'cancelled'}">${procedure.active ? 'Ativo' : 'Inativo'}</span></td><td><div class="actions"><button class="table-action edit-procedure" data-id="${procedure.id}">Editar</button><button class="table-action ${procedure.active ? 'deactivate' : 'activate'} toggle-procedure" data-id="${procedure.id}">${procedure.active ? 'Inativar' : 'Ativar'}</button></div></td></tr>`).join('')}
      </tbody></table></div>
    </section>
    <section class="panel register-manager">
      <header class="panel-header"><div><h3>Gerenciar unidades</h3><p>Unidades inativas saem das novas distribuições; o histórico e as vagas já registradas são preservados.</p></div></header>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Unidade ou setor</th><th>Nome abreviado</th><th>CNES</th><th>Situação</th>${canManageUnits ? '<th>Ações</th>' : ''}</tr></thead><tbody>
        ${allUnits.map(unit => `<tr><td class="strong">${escapeHtml(unit.name)}</td><td>${escapeHtml(unit.short_name || '—')}</td><td>${escapeHtml(unit.cnes || '—')}</td><td><span class="badge ${unit.active ? 'available' : 'cancelled'}">${unit.active ? 'Ativa' : 'Inativa'}</span></td>${canManageUnits ? `<td><div class="actions"><button class="table-action edit-unit" data-id="${unit.id}">Editar</button><button class="table-action ${unit.active ? 'deactivate' : 'activate'} toggle-unit" data-id="${unit.id}">${unit.active ? 'Inativar' : 'Ativar'}</button></div></td>` : ''}</tr>`).join('')}
      </tbody></table></div>
    </section>`;

  const changeStatus = async (type, row, active) => {
    const labels = { doctor: 'médico', procedure: 'procedimento', unit: 'unidade' };
    const warning = type === 'unit' && !active
      ? 'O perfil e as extensões desta unidade também serão desativados. As vagas e o histórico serão preservados.'
      : `O ${labels[type]} ficará ${active ? 'ativo' : 'inativo'} sem apagar o histórico.`;
    if (!confirm(`${warning}\n\nDeseja continuar?`)) return;
    try {
      const body = type === 'doctor'
        ? { name: row.name, crm: row.crm, procedure_ids: row.procedure_ids, active }
        : type === 'procedure'
          ? { name: row.name, sigtap: row.sigtap, specialty: row.specialty, active }
          : { name: row.name, short_name: row.short_name, cnes: row.cnes, active };
      await api(`/api/${type === 'doctor' ? 'doctors' : type === 'procedure' ? 'procedures' : 'units'}/${row.id}`, { method: 'PUT', body: JSON.stringify(body) });
      await loadBaseData();
      toast(`${labels[type][0].toUpperCase()}${labels[type].slice(1)} ${active ? 'ativado' : 'inativado'} com sucesso.`);
      await navigate('cadastros', false);
    } catch (error) { toast(error.message, 'error'); }
  };

  $('#new-doctor').addEventListener('click', () => doctorDialog(null, state.procedures));
  $('#new-procedure').addEventListener('click', () => procedureDialog());
  $('#new-location').addEventListener('click', locationDialog); $('#new-unit')?.addEventListener('click', unitDialog); $('#manual-booking').addEventListener('click', manualBookingDialog);
  $$('.edit-doctor').forEach(button => button.addEventListener('click', () => doctorDialog(allDoctors.find(item => item.id === Number(button.dataset.id)), allProcedures)));
  $$('.edit-procedure').forEach(button => button.addEventListener('click', () => procedureDialog(allProcedures.find(item => item.id === Number(button.dataset.id)))));
  $$('.edit-unit').forEach(button => button.addEventListener('click', () => unitDialog(allUnits.find(item => item.id === Number(button.dataset.id)))));
  $$('.toggle-doctor').forEach(button => button.addEventListener('click', () => {
    const row = allDoctors.find(item => item.id === Number(button.dataset.id));
    changeStatus('doctor', row, !Boolean(row.active));
  }));
  $$('.toggle-procedure').forEach(button => button.addEventListener('click', () => {
    const row = allProcedures.find(item => item.id === Number(button.dataset.id));
    changeStatus('procedure', row, !Boolean(row.active));
  }));
  $$('.toggle-unit').forEach(button => button.addEventListener('click', () => {
    const row = allUnits.find(item => item.id === Number(button.dataset.id));
    changeStatus('unit', row, !Boolean(row.active));
  }));
}

async function renderAdmin() {
  const [users, devices, backups, logs] = await Promise.all([api('/api/users'), api('/api/admin/devices'), api('/api/admin/backups'), api('/api/audit?limit=8')]);
  $('#page-content').innerHTML = `${pageHead('Administração do sistema', 'Usuários, extensão, logs e cópias de segurança em um único lugar.')}
    <div class="admin-grid">
      <article class="admin-card"><h3>Usuários e permissões</h3><p>${users.length} usuários cadastrados.</p><div class="mini-list">${users.slice(0,3).map(user => `<div class="mini-item"><div><b>${escapeHtml(user.name)}</b><br><span>${roleNames[user.role]}</span></div><span>${escapeHtml(user.unit_name || '')}</span></div>`).join('')}</div><button class="primary" id="new-user">＋ Novo usuário</button></article>
      <article class="admin-card"><h3>Extensões autorizadas</h3><p>Cada computador recebe uma chave vinculada à unidade.</p><div class="mini-list">${devices.slice(0,3).map(device => `<div class="mini-item"><div><b>${escapeHtml(device.name)}</b><br><span>${escapeHtml(device.unit_name)}</span></div><span>${device.last_seen_at ? 'Ativa' : 'Aguardando'}</span></div>`).join('') || '<span class="muted">Nenhum dispositivo.</span>'}</div><button class="primary" id="new-device">＋ Gerar chave</button></article>
      <article class="admin-card"><h3>Backups</h3><p>O sistema mantém as 10 cópias mais recentes.</p><div class="mini-list">${backups.slice(0,3).map(item => `<div class="mini-item"><div><b>${escapeHtml(item.name)}</b><br><span>${Math.ceil(item.size/1024)} KB</span></div><a href="${appPath(`/api/admin/backups/${encodeURIComponent(item.name)}/download`)}">Baixar</a></div>`).join('') || '<span class="muted">Nenhuma cópia criada.</span>'}</div><button class="secondary" id="new-backup">Criar backup agora</button></article>
    </div>
    <section class="panel" style="margin-top:18px"><header class="panel-header"><div><h3>Perfis exclusivos das unidades</h3><p>Cada unidade possui somente um perfil ativo. O CEMES tem visão geral e operação adicional sobre as vagas da Secretaria de Saúde.</p></div></header><div class="table-wrap" style="border:0;border-radius:0"><table class="data-table"><thead><tr><th>Unidade ou setor</th><th>Usuário de acesso</th><th>Nome do perfil</th><th>Situação</th></tr></thead><tbody>${users.filter(user => user.role === 'unidade').map(user => `<tr><td class="strong">${escapeHtml(user.unit_name)}</td><td class="mono">${escapeHtml(user.username)}</td><td>${escapeHtml(user.name)}</td><td><span class="badge ${user.active ? 'available' : 'cancelled'}">${user.active ? 'Ativo' : 'Inativo'}</span></td></tr>`).join('')}</tbody></table></div></section>
    <section class="panel" style="margin-top:18px"><header class="panel-header"><div><h3>Últimas ações registradas</h3><p>Auditoria de autoria, data e operação</p></div></header><div class="table-wrap" style="border:0;border-radius:0"><table class="data-table"><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Registro</th></tr></thead><tbody>${logs.map(log => `<tr><td>${dateTimeBr(log.created_at)}</td><td>${escapeHtml(log.user_name || 'Sistema')}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.entity)} ${escapeHtml(log.entity_id || '')}</td></tr>`).join('')}</tbody></table></div></section>`;
  $('#new-user').addEventListener('click', userDialog); $('#new-device').addEventListener('click', deviceDialog);
  $('#new-backup').addEventListener('click', async () => { try { await api('/api/admin/backups', { method: 'POST', body: '{}' }); toast('Backup criado com sucesso.'); navigate('administracao', false); } catch (error) { toast(error.message, 'error'); } });
}

function newSlotDialog() {
  const selectedSchedules = [];
  const today = new Date().toISOString().slice(0, 10);
  const defaultLocation = state.locations.find(item => item.name.toUpperCase() === 'CEMES')?.name || 'CEMES';
  openDialog({
    title: 'Distribuir novas vagas',
    kicker: 'Agenda de vagas',
    submit: 'Cadastrar distribuição',
    wide: true,
    body: `
      <div class="distribution-intro">O total pode ser dividido entre as ${state.units.length} unidades e também deixar um saldo de <b>vagas livres</b>. A primeira unidade que confirmar uma vaga livre passa a recebê-la.</div>
      <div class="form-grid">
        <label class="field">Procedimento<select name="procedure_id" required>${selectOptions(state.procedures)}</select></label>
        <label class="field">Total de vagas por data<input name="total_quantity" type="number" min="1" max="5000" placeholder="Ex.: 20" required></label>
        <label class="field">Médico<select name="doctor_id" required disabled><option value="">Escolha primeiro o procedimento</option></select></label>
        <label class="field">Local do atendimento<select name="location" required>${state.locations.map(item => `<option${item.name === defaultLocation ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
      </div>
      <div class="date-selector">
        <b class="schedule-title">Datas e horários</b><span class="muted">Cada data pode ter um horário diferente.</span>
        <div class="date-add-row schedule-row">
          <label class="field">Data<input id="distribution-date" type="date" min="${today}"></label>
          <label class="field">Horário<input id="distribution-time" type="time" value="08:00"></label>
          <label class="field">Horário máximo<input id="distribution-time-max" type="time" value="09:00"></label>
          <button type="button" class="secondary" id="add-distribution-date">＋ Adicionar</button>
        </div>
        <div id="distribution-dates" class="date-chips"><span class="muted">Nenhuma data e horário adicionados.</span></div>
      </div>
      <div class="distribution-header"><div><b>Divisão por unidade</b><span>A soma das unidades com as vagas livres deve fechar o total informado.</span></div><strong id="distribution-counter">0 de 0</strong></div>
      <div class="distribution-table-wrap">
        <table class="distribution-table"><thead><tr><th>Unidade ou setor</th><th>Quantidade por data</th></tr></thead><tbody>
          <tr class="free-allocation-row"><td><b>✦ Vagas livres</b><span>Ficam abertas; a primeira unidade que confirmar recebe a vaga.</span></td><td><input id="free-quantity" type="number" min="0" max="5000" value="0" aria-label="Quantidade de vagas livres"></td></tr>
          ${state.units.map(unit => `<tr><td><b>${escapeHtml(unit.name)}</b>${unit.cnes ? `<span>CNES ${escapeHtml(unit.cnes)}</span>` : ''}</td><td><input class="allocation-input" data-unit-id="${unit.id}" type="number" min="0" max="5000" value="0" aria-label="Quantidade para ${escapeHtml(unit.name)}"></td></tr>`).join('')}
        </tbody></table>
      </div>
      <div id="distribution-validation" class="distribution-validation neutral">Informe o total e distribua as vagas.</div>
      <label class="field">Observação<textarea name="notes" maxlength="500"></textarea></label>`,
    onSubmit: form => api('/api/slots/distribute', {
      method: 'POST',
      body: JSON.stringify({
        procedure_id: Number(form.get('procedure_id')),
        doctor_id: Number(form.get('doctor_id')),
        total_quantity: Number(form.get('total_quantity')),
        location: form.get('location'),
        notes: form.get('notes'),
        schedules: selectedSchedules,
        free_quantity: Number($('#free-quantity').value || 0),
        allocations: $$('.allocation-input', $('#dialog-body')).map(input => ({
          unit_id: Number(input.dataset.unitId),
          quantity: Number(input.value || 0)
        }))
      })
    })
  });

  const body = $('#dialog-body');
  const totalInput = $('[name="total_quantity"]', body);
  const procedureInput = $('[name="procedure_id"]', body);
  const doctorInput = $('[name="doctor_id"]', body);
  const dateInput = $('#distribution-date');
  const timeInput = $('#distribution-time');
  const timeMaxInput = $('#distribution-time-max');
  const validation = $('#distribution-validation');
  const counter = $('#distribution-counter');
  const submit = $('#dialog-submit');
  const freeInput = $('#free-quantity');

  const renderDates = () => {
    $('#distribution-dates').innerHTML = selectedSchedules.length
      ? selectedSchedules.map((item,index) => `<button type="button" class="date-chip" data-index="${index}">${dateBr(item.service_date)} • ${item.service_time} até ${item.service_time_max} <span>×</span></button>`).join('')
      : '<span class="muted">Nenhuma data e horário adicionados.</span>';
    $$('.date-chip', body).forEach(button => button.addEventListener('click', () => {
      selectedSchedules.splice(Number(button.dataset.index), 1);
      renderDates();
      validateDistribution();
    }));
  };

  const validateDistribution = () => {
    const total = Number(totalInput.value || 0);
    const freeQuantity = Number(freeInput.value || 0);
    const allocatedToUnits = $$('.allocation-input', body).reduce((sum, input) => sum + Number(input.value || 0), 0);
    const allocated = allocatedToUnits + freeQuantity;
    const difference = total - allocated;
    counter.textContent = `${allocated} de ${total || 0}`;
    validation.className = 'distribution-validation';
    if (!total) {
      validation.classList.add('neutral');
      validation.textContent = 'Informe o total de vagas que deverá ser distribuído em cada data.';
    } else if (difference > 0) {
      validation.classList.add('error');
      validation.textContent = `${difference === 1 ? 'Falta' : 'Faltam'} ${difference} vaga${difference === 1 ? '' : 's'} para completar o total de ${total}.`;
    } else if (difference < 0) {
      const excess = Math.abs(difference);
      validation.classList.add('error');
      validation.textContent = `${excess === 1 ? 'Foi informada' : 'Foram informadas'} ${excess} vaga${excess === 1 ? '' : 's'} a mais que o total de ${total}.`;
    } else if (!selectedSchedules.length) {
      validation.classList.add('error');
      validation.textContent = 'A distribuição está completa, mas falta adicionar pelo menos uma data.';
    } else {
      validation.classList.add('success');
      const grandTotal = total * selectedSchedules.length;
      validation.textContent = `Distribuição completa: ${allocatedToUnits} para unidades + ${freeQuantity} livre${freeQuantity === 1 ? '' : 's'} por data. Total geral: ${grandTotal} vagas.`;
    }
    submit.disabled = !(total > 0 && difference === 0 && selectedSchedules.length && procedureInput.value && doctorInput.value);
  };

  $('#add-distribution-date').addEventListener('click', () => {
    if (!dateInput.value || !timeInput.value || !timeMaxInput.value) {
      validation.className = 'distribution-validation error';
      validation.textContent = 'Preencha a data, o horário e o horário máximo.';
      return;
    }
    if (timeMaxInput.value < timeInput.value) {
      validation.className = 'distribution-validation error';
      validation.textContent = 'O horário máximo não pode ser anterior ao horário inicial.';
      return;
    }
    const item = { service_date: dateInput.value, service_time: timeInput.value, service_time_max: timeMaxInput.value };
    if (!selectedSchedules.some(row => JSON.stringify(row) === JSON.stringify(item))) selectedSchedules.push(item);
    selectedSchedules.sort((a,b) => `${a.service_date}${a.service_time}`.localeCompare(`${b.service_date}${b.service_time}`));
    dateInput.value = '';
    renderDates();
    validateDistribution();
  });
  [...$$('.allocation-input', body), freeInput].forEach(input => input.addEventListener('input', validateDistribution));
  const refreshDoctors = () => {
    const doctors = state.doctors.filter(doctor => doctor.procedure_ids.includes(Number(procedureInput.value)));
    doctorInput.innerHTML = `<option value="">${doctors.length ? 'Selecione' : 'Nenhum médico cadastrado para este procedimento'}</option>${doctors.map(doctor => `<option value="${doctor.id}">${escapeHtml(doctor.name)}${doctor.crm ? ` — ${escapeHtml(doctor.crm)}` : ''}</option>`).join('')}`;
    doctorInput.disabled = !doctors.length;
    validateDistribution();
  };
  [totalInput, doctorInput].forEach(input => input.addEventListener('input', validateDistribution));
  procedureInput.addEventListener('change', refreshDoctors);
  renderDates();
  validateDistribution();
}

function sequenceDialog() {
  openDialog({ title: 'Criar sequência de horários', kicker: 'Cadastro rápido', submit: 'Criar horários', body: `<div class="form-grid"><label class="field">Unidade<select name="unit_id" required>${selectOptions(state.units)}</select></label><label class="field">Procedimento<select name="procedure_id" required>${selectOptions(state.procedures)}</select></label><label class="field">Data<input name="service_date" type="date" required></label><label class="field">Quantidade por horário<input name="quantity" type="number" min="1" value="1" required></label><label class="field">Horário inicial<input name="start_time" type="time" required></label><label class="field">Horário final<input name="end_time" type="time" required></label><label class="field">Intervalo<select name="interval_minutes"><option value="15">15 minutos</option><option value="20">20 minutos</option><option value="30" selected>30 minutos</option><option value="60">60 minutos</option></select></label><label class="field">Médico<input name="provider"></label><label class="field full">Local<input name="location" value="CEMES"></label></div>`, onSubmit: form => api('/api/slots/sequence', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }) });
}

function claimFreeSlotDialog(row) {
  const normalizedUnit = String(state.user.unit_name || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  let targets = state.units;
  if (state.user.role === 'unidade' && normalizedUnit !== 'cemes') {
    targets = state.units.filter(unit => Number(unit.id) === Number(state.user.unit_id));
  } else if (state.user.role === 'unidade') {
    targets = state.units.filter(unit => Number(unit.id) === Number(state.user.unit_id)
      || String(unit.name).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes('secretaria'));
  }
  const maximum = row.service_time_max || row.service_time;
  const targetField = targets.length === 1
    ? `<input type="hidden" name="unit_id" value="${targets[0].id}"><div class="free-claim-target"><span>Unidade que receberá</span><b>${escapeHtml(targets[0].name)}</b></div>`
    : `<label class="field">Unidade que receberá a vaga<select name="unit_id" required>${selectOptions(targets)}</select></label>`;
  openDialog({
    title: 'Pegar vaga livre',
    kicker: 'Primeiro a confirmar recebe a vaga',
    submit: 'Confirmar retirada',
    body: `
      <div class="free-claim-alert"><b>Esta vaga está aberta para as unidades.</b><span>Ao confirmar, uma vaga será destinada à unidade escolhida. Ela ainda não será marcada como utilizada.</span></div>
      <div class="manual-slot-summary">
        <div><span>Procedimento</span><b>${escapeHtml(row.procedure_name)}</b></div>
        <div><span>Data</span><b>${dateBr(row.service_date)}</b></div>
        <div><span>Horário</span><b>${escapeHtml(row.service_time)}${maximum !== row.service_time ? ` até ${escapeHtml(maximum)}` : ''}</b></div>
        <div><span>Saldo livre</span><b>${row.remaining} vaga${row.remaining === 1 ? '' : 's'}</b></div>
        <div><span>Médico</span><b>${escapeHtml(row.doctor_name || row.provider || '—')}</b></div>
        <div><span>Local</span><b>${escapeHtml(row.location || 'CEMES')}</b></div>
      </div>
      ${targetField}`,
    onSubmit: form => api(`/api/free-slots/${row.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ unit_id: Number(form.get('unit_id')) })
    })
  });
}

function manualSlotDialog(row) {
  const maximum = row.service_time_max || row.service_time;
  const timeLabel = maximum === row.service_time ? row.service_time : `${row.service_time} até ${maximum}`;
  openDialog({
    title: 'Marcar vaga como utilizada',
    kicker: 'Agendamento sem extensão',
    submit: 'Confirmar vaga utilizada',
    body: `
      <div class="warning-box">Use esta opção somente quando o agendamento já tiver sido confirmado no portal da Regulação e não tiver sido registrado pela extensão.</div>
      <div class="manual-slot-summary">
        <div><span>Unidade</span><b>${escapeHtml(row.unit_name)}</b></div>
        <div><span>Procedimento</span><b>${escapeHtml(row.procedure_name)}</b></div>
        <div><span>Data</span><b>${dateBr(row.service_date)}</b></div>
        <div><span>Agenda</span><b>${escapeHtml(timeLabel)}</b></div>
        <div><span>Saldo antes da baixa</span><b>${row.remaining} vaga${row.remaining === 1 ? '' : 's'}</b></div>
      </div>
      <label class="field">Horário confirmado no agendamento
        <input name="service_time" type="time" value="${escapeHtml(row.service_time)}" min="${escapeHtml(row.service_time)}" max="${escapeHtml(maximum)}" required>
      </label>
      <label class="field">Observação (opcional)
        <textarea name="notes" maxlength="400" placeholder="Ex.: Agendamento realizado antes da instalação da extensão."></textarea>
      </label>`,
    onSubmit: form => api(`/api/slots/${row.id}/use`, {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form))
    })
  });
}

function transferDialog(row) {
  openDialog({ title: 'Transferir vaga', kicker: `${row.procedure_name} • ${dateBr(row.service_date)} ${row.service_time}`, submit: 'Confirmar transferência', body: `<div class="warning-box">A vaga será retirada de <b>${escapeHtml(row.unit_name)}</b> e destinada à nova unidade. O histórico da transferência será preservado.</div><label class="field">Unidade de destino<select name="unit_id" required>${selectOptions(state.units.filter(unit => unit.id !== row.unit_id))}</select></label><label class="field">Justificativa<textarea name="reason" required maxlength="300"></textarea></label>`, onSubmit: form => api(`/api/slots/${row.id}/transfer`, { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }) });
}

function editSlotDialog(row) {
  const doctors = state.doctors.filter(doctor => doctor.procedure_ids.includes(row.procedure_id));
  openDialog({ title: 'Editar vaga', kicker: `${row.procedure_name} • ${dateBr(row.service_date)} ${row.service_time}`, submit: 'Salvar alterações', body: `<div class="form-grid"><label class="field">Unidade<select name="unit_id" required>${selectOptions(state.units,row.unit_id)}</select></label><label class="field">Procedimento<select name="procedure_id" required>${selectOptions(state.procedures,row.procedure_id)}</select></label><label class="field">Data<input name="service_date" type="date" value="${row.service_date}" required></label><label class="field">Horário<input name="service_time" type="time" value="${row.service_time}" required></label><label class="field">Horário máximo<input name="service_time_max" type="time" value="${row.service_time_max || row.service_time}" required></label><label class="field">Quantidade<input name="quantity" type="number" min="${Math.max(1,row.used)}" value="${row.quantity}" required></label><label class="field">Médico<select name="doctor_id"><option value="">Sem vínculo</option>${doctors.map(doctor => `<option value="${doctor.id}"${doctor.id === row.doctor_id ? ' selected' : ''}>${escapeHtml(doctor.name)}</option>`).join('')}</select></label><label class="field">Local<select name="location">${state.locations.map(item => `<option${item.name === row.location ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><label class="field full">Observação<textarea name="notes">${escapeHtml(row.notes || '')}</textarea></label></div>`, onSubmit: form => api(`/api/slots/${row.id}`, { method: 'PUT', body: JSON.stringify(Object.fromEntries(form)) }) });
}

function cancelSlotDialog(row) {
  openDialog({ title: 'Cancelar vaga', kicker: `${row.procedure_name} • ${dateBr(row.service_date)} ${row.service_time}`, submit: 'Cancelar vaga', body: `<div class="warning-box">A vaga sairá da agenda disponível, mas continuará registrada no log.</div><label class="field">Justificativa<textarea name="reason" required maxlength="300"></textarea></label>`, onSubmit: form => api(`/api/slots/${row.id}/cancel`, { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }) });
}

function importDialog() {
  openDialog({ title: 'Importar vagas por Excel', kicker: 'Importação segura', submit: 'Validar e importar', body: `<div class="warning-box">Colunas obrigatórias: <b>Unidade, Procedimento, Data, Horário e Quantidade</b>. Nomes devem corresponder aos cadastros do sistema.</div><div class="file-drop">Selecione uma planilha .xlsx<input name="file" type="file" accept=".xlsx" required></div>`, onSubmit: async form => { const file = form.get('file'); const buffer = await file.arrayBuffer(); return api('/api/slots/import-xlsx', { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: buffer }); } });
}

function cancelDialog(id) {
  openDialog({ title: 'Cancelar utilização', kicker: 'Correção registrada em log', submit: 'Confirmar cancelamento', body: `<div class="warning-box">A vaga retornará ao saldo disponível. O registro original não será apagado.</div><label class="field">Motivo do cancelamento<textarea name="reason" required maxlength="300"></textarea></label>`, onSubmit: form => api(`/api/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }) });
}

function rescheduleDialog(row) {
  openDialog({ title: 'Remarcar agendamento', kicker: `${row.procedure_name} • ${dateBr(row.service_date)} ${row.service_time}`, submit: 'Confirmar remarcação', body: `<div class="warning-box">A vaga anterior será devolvida e a nova vaga será utilizada em uma única operação.</div><div class="form-grid"><label class="field full">Procedimento<select name="procedure_id" required>${selectOptions(state.procedures,row.procedure_id)}</select></label><label class="field">Nova data<input name="service_date" type="date" required></label><label class="field">Novo horário<input name="service_time" type="time" required></label><label class="field full">Justificativa<textarea name="reason" required maxlength="300"></textarea></label></div>`, onSubmit: form => api(`/api/bookings/${row.id}/reschedule`, { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }) });
}

function resolveDialog(row) {
  openDialog({ title: 'Conferir pendência', kicker: row.reason, submit: 'Finalizar conferência', body: `<div class="form-grid"><label class="field">Ação<select name="action"><option value="link">Vincular à vaga</option><option value="cancel">Cancelar pendência</option></select></label><label class="field">Procedimento<select name="procedure_id">${selectOptions(state.procedures,row.procedure_id)}</select></label><label class="field">Data<input name="service_date" type="date" value="${escapeHtml(row.service_date || '')}"></label><label class="field">Horário<input name="service_time" type="time" value="${escapeHtml(row.service_time || '')}"></label><label class="field full">Conclusão<textarea name="resolution" required maxlength="400"></textarea></label></div>`, onSubmit: form => api(`/api/pending/${row.id}/resolve`, { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }) });
}

function procedureDialog(procedure = null) {
  openDialog({
    title: procedure ? 'Editar procedimento' : 'Cadastrar procedimento',
    kicker: 'Base padronizada',
    submit: procedure ? 'Salvar alterações' : 'Cadastrar',
    body: `<label class="field">Nome do procedimento<input name="name" value="${escapeHtml(procedure?.name || '')}" required maxlength="180"></label><div class="form-grid"><label class="field">Código SIGTAP<input name="sigtap" value="${escapeHtml(procedure?.sigtap || '')}" maxlength="20"></label><label class="field">Especialidade<input name="specialty" value="${escapeHtml(procedure?.specialty || '')}" maxlength="100"></label></div>`,
    onSubmit: async form => {
      const body = { ...Object.fromEntries(form), active: procedure ? Boolean(procedure.active) : true };
      await api(procedure ? `/api/procedures/${procedure.id}` : '/api/procedures', { method: procedure ? 'PUT' : 'POST', body: JSON.stringify(body) });
      await loadBaseData();
    }
  });
}

function doctorDialog(doctor = null, procedures = state.procedures) {
  openDialog({
    title: doctor ? 'Editar médico' : 'Cadastrar médico',
    kicker: 'Profissionais e procedimentos',
    submit: doctor ? 'Salvar alterações' : 'Cadastrar médico',
    body: `<div class="form-grid">
      <label class="field">Nome do médico<input name="name" value="${escapeHtml(doctor?.name || '')}" required maxlength="180" placeholder="Ex.: Dra. Ana Souza"></label>
      <label class="field">CRM (opcional)<input name="crm" value="${escapeHtml(doctor?.crm || '')}" maxlength="40" placeholder="Ex.: CRM-BA 12345"></label>
      <fieldset class="procedure-fieldset full"><legend>Procedimentos atendidos</legend><span>Marque um ou mais procedimentos.</span>
        <div class="procedure-checks">${procedures.map(item => `<label class="${item.active ? '' : 'inactive-option'}"><input type="checkbox" name="procedure_ids" value="${item.id}"${doctor?.procedure_ids?.includes(item.id) ? ' checked' : ''}> ${escapeHtml(item.name)}${item.active ? '' : ' (inativo)'}</label>`).join('')}</div>
      </fieldset>
    </div>`,
    onSubmit: async form => {
      const procedureIds = form.getAll('procedure_ids').map(Number);
      if (!procedureIds.length) throw new Error('Selecione ao menos um procedimento para o médico.');
      await api(doctor ? `/api/doctors/${doctor.id}` : '/api/doctors', {
        method: doctor ? 'PUT' : 'POST',
        body: JSON.stringify({ name: form.get('name'), crm: form.get('crm'), procedure_ids: procedureIds, active: doctor ? Boolean(doctor.active) : true })
      });
      await loadBaseData();
    }
  });
}

function locationDialog() {
  openDialog({
    title: 'Cadastrar local de atendimento',
    kicker: 'Locais da agenda',
    submit: 'Cadastrar local',
    body: `<label class="field">Nome do local<input name="name" required maxlength="180" placeholder="Ex.: Hospital Municipal"></label>`,
    onSubmit: async form => {
      await api('/api/locations', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
      state.locations = await api('/api/locations');
    }
  });
}

function unitDialog(unit = null) {
  openDialog({
    title: unit ? 'Editar unidade' : 'Cadastrar unidade',
    kicker: 'Unidades de saúde',
    submit: unit ? 'Salvar alterações' : 'Cadastrar',
    body: `<label class="field">Nome oficial<input name="name" value="${escapeHtml(unit?.name || '')}" required maxlength="160"></label><div class="form-grid"><label class="field">Nome abreviado<input name="short_name" value="${escapeHtml(unit?.short_name || '')}" maxlength="80"></label><label class="field">CNES<input name="cnes" value="${escapeHtml(unit?.cnes || '')}" maxlength="20"></label></div>`,
    onSubmit: async form => {
      const body = { ...Object.fromEntries(form), active: unit ? Boolean(unit.active) : true };
      await api(unit ? `/api/units/${unit.id}` : '/api/units', { method: unit ? 'PUT' : 'POST', body: JSON.stringify(body) });
      await loadBaseData();
    }
  });
}

function manualBookingDialog() {
  openDialog({ title: 'Registrar utilização manual', kicker: 'Correção operacional', submit: 'Registrar utilização', body: `<div class="warning-box">Use somente quando o agendamento tiver sido confirmado no portal e não registrado pela extensão.</div><div class="form-grid"><label class="field">Unidade<select name="unit_id" required>${selectOptions(state.units)}</select></label><label class="field">Procedimento<select name="procedure_id" required>${selectOptions(state.procedures)}</select></label><label class="field">Data<input name="service_date" type="date" required></label><label class="field">Horário<input name="service_time" type="time" required></label><label class="field full">Justificativa<textarea name="notes" required></textarea></label></div>`, onSubmit: form => api('/api/bookings/manual', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }) });
}

function userDialog() {
  openDialog({ title: 'Cadastrar usuário', kicker: 'Perfis e permissões', submit: 'Criar usuário', body: `<div class="form-grid"><label class="field">Nome completo<input name="name" required></label><label class="field">Usuário<input name="username" required></label><label class="field">Perfil<select name="role" id="new-user-role"><option value="unidade">Unidade</option><option value="regulacao">Regulação Central</option><option value="gestor">Gestor / Consulta</option><option value="admin">Administrador</option></select></label><label class="field">Unidade<select name="unit_id" id="new-user-unit">${selectOptions(state.units)}</select></label><label class="field full">Senha inicial<input name="password" type="password" minlength="8" required></label></div>`, onSubmit: form => api('/api/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }) });
}

function deviceDialog() {
  openDialog({ title: 'Autorizar computador', kicker: 'Extensão Chrome / Edge', submit: 'Gerar chave', body: `<div class="warning-box">A chave será exibida uma única vez. Copie e cole na configuração da extensão instalada na unidade.</div><label class="field">Identificação do computador<input name="name" placeholder="Ex.: Recepção 01" required></label><label class="field">Unidade vinculada<select name="unit_id" required>${selectOptions(state.units)}</select></label>`, onSubmit: async form => { const result = await api('/api/admin/devices', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }); await navigator.clipboard?.writeText(result.token); alert(`Chave gerada e copiada:\n\n${result.token}\n\nEla não será exibida novamente.`); } });
}

function passwordDialog() {
  openDialog({ title: 'Trocar minha senha', kicker: state.user.must_change_password ? 'Troca obrigatória no primeiro acesso' : 'Segurança da conta', submit: 'Atualizar senha', body: `<label class="field">Senha atual<input name="current_password" type="password" autocomplete="current-password" required></label><label class="field">Nova senha<input name="new_password" type="password" autocomplete="new-password" minlength="8" required></label><label class="field">Confirmar nova senha<input name="confirmation" type="password" autocomplete="new-password" minlength="8" required></label>`, onSubmit: async form => { const values = Object.fromEntries(form); if (values.new_password !== values.confirmation) throw new Error('A confirmação não corresponde à nova senha.'); await api('/api/users/change-password', { method: 'POST', body: JSON.stringify(values) }); state.user.must_change_password = false; } });
}

const renderers = { dashboard: renderDashboard, vagas: renderSlots, historico: renderHistory, pendencias: renderPending, relatorios: renderReports, cadastros: renderRegisters, administracao: renderAdmin };

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#login-error').textContent = '';
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await bootstrap(); }
  catch (error) { $('#login-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } finally { state.user = null; state.csrf = null; showLogin(); } });
$('#user-menu').addEventListener('click', passwordDialog);
$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#main-nav').addEventListener('click', event => { const button = event.target.closest('[data-page]'); if (button) navigate(button.dataset.page); });
window.addEventListener('hashchange', () => { const page = location.hash.slice(1); if (state.user && pages[page] && page !== state.page) navigate(page, false); });
bootstrap();
