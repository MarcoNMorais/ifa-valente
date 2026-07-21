/* Portal Online Estoque Hospital - Valente */
const BASE = "/EstoqueHospital";
const LOGIN_KEY = "estoqueHospitalSessao";
const CAD_KEY = "estoqueHospitalCadastros";

const USERS = {
  "Admin": { senha: "Vitoria04", perfil: "ADM", nome: "Administrador" },
  "admin": { senha: "Vitoria04", perfil: "ADM", nome: "Administrador" },
  "Coordenador": { senha: "Vitoria04", perfil: "COORDENADOR", nome: "Coordenador" },
  "coordenador": { senha: "Vitoria04", perfil: "COORDENADOR", nome: "Coordenador" }
};

let DATA = { resumo:{}, itens:[], movimentacoes:[] };
let SESSION = null;
let CURRENT_PAGE = "VisaoGeral";

function money(n){ return Number(n || 0).toLocaleString("pt-BR"); }
function esc(v){
  return String(v ?? "").replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s]));
}
function totalItem(i){
  return Number(i.total ?? 0) || (Number(i.almoxarifado||0)+Number(i.farmacia||0)+Number(i.sala_medicacoes||0)+Number(i.internamento||0)+Number(i.sala_cirurgica||0)+Number(i.baixa||0)+Number(i.outro||0));
}
function statusItem(i){
  const t=totalItem(i), m=Number(i.minimo||0);
  if(t<=0) return ["zero","Zerado"];
  if(m>0 && t<=m) return ["warn","Perto de terminar"];
  return ["ok","Normal"];
}
function roleLabel(p){ return p === "ADM" ? "Administrador" : "Coordenador"; }
function isAdm(){ return SESSION && SESSION.perfil === "ADM"; }

async function loadData(){
  try{
    const r = await fetch(`${BASE}/dados.json?v=${Date.now()}`, {cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    DATA = await r.json();
  }catch(e){
    DATA = { resumo:{}, itens:[], movimentacoes:[], erro:String(e) };
  }
}

function loadSession(){
  try{ SESSION = JSON.parse(localStorage.getItem(LOGIN_KEY) || "null"); }catch{ SESSION=null; }
}
function saveSession(s){
  SESSION = s;
  localStorage.setItem(LOGIN_KEY, JSON.stringify(s));
}
function logout(){
  localStorage.removeItem(LOGIN_KEY);
  SESSION = null;
  history.pushState({}, "", BASE);
  render();
}
function routeFromPath(){
  const path = location.pathname.replace(BASE, "").replace(/^\/+|\/+$/g,"");
  if(!path) return "VisaoGeral";
  const p = path.toLowerCase();
  if(p.includes("relatorios")) return "Relatorios";
  if(p.includes("estoque")) return "Estoque";
  if(p.includes("movimentacoes")) return "Movimentacoes";
  if(p.includes("cadastro")) return "Cadastro";
  if(p.includes("backup")) return "Backup";
  return "VisaoGeral";
}
function go(page){
  const url = page === "VisaoGeral" ? BASE : `${BASE}/${page}`;
  history.pushState({}, "", url);
  CURRENT_PAGE = page;
  render();
}

function renderLogin(){
  document.getElementById("app").innerHTML = `
    <div class="login-page">
      <section class="login-left">
        <div class="login-card">
          <div class="brand">
            <div class="logo">+</div>
            <div>
              <h1>Estoque Hospital</h1>
              <p>Secretaria Municipal de Saúde de Valente</p>
            </div>
          </div>
          <h2>Acesso ao portal</h2>
          <p class="sub">Entre para consultar os relatórios online do estoque hospitalar.</p>
          <div id="loginAlert"></div>
          <form id="loginForm">
            <div class="field">
              <label>Login</label>
              <input id="loginUser" autocomplete="username" placeholder="Admin ou Coordenador" required>
            </div>
            <div class="field">
              <label>Senha</label>
              <input id="loginPass" type="password" autocomplete="current-password" placeholder="Digite a senha" required>
            </div>
            <button class="btn btn-primary btn-full" type="submit">Entrar no sistema</button>
          </form>
          <div class="kpi-note" style="margin-top:18px">
            <strong>Perfis:</strong><br>
            Administrador vê tudo, cadastro e backup.<br>
            Coordenador visualiza relatórios e consultas.
          </div>
        </div>
      </section>
      <section class="login-right">
        <div class="hero-content">
          <span class="hero-badge">🏥 Portal Online</span>
          <h2>Controle moderno do estoque hospitalar</h2>
          <p>Consulta rápida dos saldos, itens críticos, movimentações e indicadores, alimentada automaticamente pelo sistema local.</p>
          <div class="hero-grid">
            <div class="hero-mini"><strong>${money(DATA.resumo?.itens)}</strong><span>itens cadastrados</span></div>
            <div class="hero-mini"><strong>${money(DATA.resumo?.total_geral)}</strong><span>saldo total</span></div>
            <div class="hero-mini"><strong>${money(DATA.resumo?.perto_de_terminar)}</strong><span>itens em alerta</span></div>
            <div class="hero-mini"><strong>${DATA.atualizado_em || "-"}</strong><span>última atualização</span></div>
          </div>
        </div>
      </section>
    </div>`;
  document.getElementById("loginForm").addEventListener("submit", e=>{
    e.preventDefault();
    const u = document.getElementById("loginUser").value.trim();
    const p = document.getElementById("loginPass").value;
    const found = USERS[u];
    if(found && found.senha === p){
      saveSession({ usuario:u, nome:found.nome, perfil:found.perfil, entrada:new Date().toISOString() });
      go("VisaoGeral");
    }else{
      document.getElementById("loginAlert").innerHTML = `<div class="alert">Login ou senha inválidos.</div>`;
    }
  });
}

function menuButton(page, icon, label){
  const active = CURRENT_PAGE === page ? "active" : "";
  return `<button class="${active}" onclick="go('${page}')"><span class="ico">${icon}</span>${label}</button>`;
}

function renderShell(content){
  const adminMenus = isAdm() ? `
    ${menuButton("Cadastro","📝","Cadastro")}
    ${menuButton("Backup","💾","Backup")}
  ` : "";
  document.getElementById("app").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="side-brand">
          <div class="logo">+</div>
          <div>
            <h2>Estoque Hospital</h2>
            <p>Valente • Bahia</p>
          </div>
        </div>
        <nav class="menu">
          ${menuButton("VisaoGeral","📊","Visão geral")}
          ${menuButton("Estoque","📦","Estoque")}
          ${menuButton("Relatorios","📋","Relatórios")}
          ${menuButton("Movimentacoes","🔁","Movimentações")}
          ${adminMenus}
        </nav>
        <div class="side-footer">
          <div class="user-box">
            <strong>${esc(SESSION.nome)}</strong>
            <span>${roleLabel(SESSION.perfil)}</span>
          </div>
          <button class="btn btn-light" onclick="logout()">Sair</button>
        </div>
      </aside>
      <main class="main">${content}
        <div class="footer-note">Portal alimentado automaticamente pelo sistema local. Última atualização: ${DATA.atualizado_em || "-"}</div>
      </main>
    </div>`;
}

function pageHeader(title, subtitle){
  return `<div class="topbar">
    <div class="title"><h1>${title}</h1><p>${subtitle}</p></div>
    <div class="top-actions"><span class="badge">● Online</span><button class="btn btn-light" onclick="loadData().then(render)">Atualizar</button></div>
  </div>`;
}

function renderVisaoGeral(){
  const resumo = DATA.resumo || {};
  const itens = DATA.itens || [];
  const alertas = itens.filter(i => statusItem(i)[0] !== "ok").slice(0,8);
  const menores = [...itens].sort((a,b)=>totalItem(a)-totalItem(b)).slice(0,8);
  renderShell(`
    ${pageHeader("Visão geral", "Resumo do estoque do Hospital Municipal José Mota Araújo.")}
    <section class="grid cards">
      <div class="card metric"><div class="label">Itens cadastrados</div><div class="value">${money(resumo.itens)}</div><div class="hint">produtos no controle</div></div>
      <div class="card metric"><div class="label">Total Almoxarifado</div><div class="value">${money(resumo.total_almoxarifado)}</div><div class="hint">saldo principal</div></div>
      <div class="card metric"><div class="label">Total Farmácia</div><div class="value">${money(resumo.total_farmacia)}</div><div class="hint">saldo na farmácia</div></div>
      <div class="card metric"><div class="label">Alertas</div><div class="value">${money(resumo.perto_de_terminar)}</div><div class="hint">perto de terminar</div></div>
    </section>
    <section class="grid two-col section">
      <div class="card">
        <div class="section-head"><div><h2>Itens críticos</h2><p>Produtos zerados ou abaixo do mínimo.</p></div></div>
        ${tableItens(alertas, true)}
      </div>
      <div class="card">
        <div class="section-head"><div><h2>Menores saldos</h2><p>Ranking por total geral.</p></div></div>
        ${miniTable(menores)}
      </div>
    </section>
    <section class="card section">
      <div class="section-head"><div><h2>Quantidade por tipo</h2><p>Agrupamento pelo tipo do produto.</p></div></div>
      ${chartTipos()}
    </section>
  `);
}

function tableItens(rows, compact=false){
  if(!rows || rows.length===0) return `<div class="empty">Nenhum item encontrado.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Item</th><th>Tipo</th><th>Unidade</th><th>Almox.</th><th>Farmácia</th><th>Total</th><th>Mínimo</th><th>Status</th>
    </tr></thead>
    <tbody>${rows.map(i=>{
      const [cls,txt]=statusItem(i);
      return `<tr>
        <td><strong>${esc(i.nome)}</strong></td>
        <td>${esc(i.tipo)}</td>
        <td>${esc(i.unidade)}</td>
        <td>${money(i.almoxarifado)}</td>
        <td>${money(i.farmacia)}</td>
        <td><strong>${money(totalItem(i))}</strong></td>
        <td>${money(i.minimo)}</td>
        <td><span class="status ${cls}">${txt}</span></td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}
function miniTable(rows){
  if(!rows || rows.length===0) return `<div class="empty">Nenhum item encontrado.</div>`;
  return `<div class="table-wrap"><table style="min-width:430px">
    <thead><tr><th>Item</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>${rows.map(i=>{
      const [cls,txt]=statusItem(i);
      return `<tr><td><strong>${esc(i.nome)}</strong></td><td>${money(totalItem(i))}</td><td><span class="status ${cls}">${txt}</span></td></tr>`;
    }).join("")}</tbody>
  </table></div>`;
}
function chartTipos(){
  const itens = DATA.itens || [];
  const totals = {};
  itens.forEach(i=>{
    const tipo = i.tipo || "Sem tipo";
    totals[tipo] = (totals[tipo] || 0) + totalItem(i);
  });
  const rows = Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const max = Math.max(...rows.map(r=>r[1]),1);
  return `<div class="chart-list">
    ${rows.map(([tipo,total])=>`<div class="bar-row">
      <strong>${esc(tipo)}</strong>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,total/max*100)}%"></div></div>
      <span>${money(total)}</span>
    </div>`).join("") || `<div class="empty">Sem dados.</div>`}
  </div>`;
}

function renderEstoque(){
  const tipos = [...new Set((DATA.itens||[]).map(i=>i.tipo||"Sem tipo"))].sort();
  renderShell(`
    ${pageHeader("Estoque", "Consulta completa dos itens publicados.")}
    <section class="card">
      <div class="toolbar">
        <input id="busca" placeholder="Pesquisar item..." oninput="filtrarEstoque()">
        <select id="filtroTipo" onchange="filtrarEstoque()">
          <option value="">Todos os tipos</option>
          ${tipos.map(t=>`<option>${esc(t)}</option>`).join("")}
        </select>
        <select id="filtroStatus" onchange="filtrarEstoque()">
          <option value="">Todos os status</option>
          <option value="ok">Normal</option>
          <option value="warn">Perto de terminar</option>
          <option value="zero">Zerado</option>
        </select>
      </div>
      <div id="estoqueTabela"></div>
    </section>
  `);
  filtrarEstoque();
}
function filtrarEstoque(){
  const q = (document.getElementById("busca")?.value || "").toLowerCase();
  const tipo = document.getElementById("filtroTipo")?.value || "";
  const st = document.getElementById("filtroStatus")?.value || "";
  let rows = DATA.itens || [];
  rows = rows.filter(i=>{
    const [cls] = statusItem(i);
    return (!q || String(i.nome||"").toLowerCase().includes(q)) &&
           (!tipo || (i.tipo||"Sem tipo") === tipo) &&
           (!st || cls === st);
  });
  document.getElementById("estoqueTabela").innerHTML = tableItens(rows.slice(0,300));
}

function renderRelatorios(){
  const itens = DATA.itens || [];
  const criticos = itens.filter(i=>statusItem(i)[0]!=="ok");
  renderShell(`
    ${pageHeader("Relatórios", "Indicadores consolidados para acompanhamento gerencial.")}
    <section class="grid cards">
      <div class="card metric"><div class="label">Saldo total</div><div class="value">${money(DATA.resumo?.total_geral)}</div><div class="hint">todos os setores</div></div>
      <div class="card metric"><div class="label">Críticos</div><div class="value">${money(criticos.length)}</div><div class="hint">zerados ou no mínimo</div></div>
      <div class="card metric"><div class="label">Movimentações</div><div class="value">${money((DATA.movimentacoes||[]).length)}</div><div class="hint">últimos registros</div></div>
      <div class="card metric"><div class="label">Atualizado</div><div class="value" style="font-size:18px">${DATA.atualizado_em || "-"}</div><div class="hint">dados.json</div></div>
    </section>
    <section class="grid two-col section">
      <div class="card"><div class="section-head"><div><h2>Relatório de itens críticos</h2><p>Lista para reposição e acompanhamento.</p></div></div>${tableItens(criticos)}</div>
      <div class="card"><div class="section-head"><div><h2>Saldo por tipo</h2><p>Maiores grupos em estoque.</p></div></div>${chartTipos()}</div>
    </section>
  `);
}

function renderMovimentacoes(){
  const rows = DATA.movimentacoes || [];
  renderShell(`
    ${pageHeader("Movimentações", "Últimas entradas, saídas e transferências publicadas.")}
    <section class="card">
      <div class="toolbar"><input id="movBusca" placeholder="Pesquisar movimentação..." oninput="filtrarMov()"></div>
      <div id="movTabela"></div>
    </section>
  `);
  filtrarMov();
}
function filtrarMov(){
  const q = (document.getElementById("movBusca")?.value || "").toLowerCase();
  const rows = (DATA.movimentacoes||[]).filter(m=>JSON.stringify(m).toLowerCase().includes(q)).slice(0,300);
  document.getElementById("movTabela").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Data</th><th>Item</th><th>Tipo</th><th>Origem</th><th>Destino</th><th>Qtd.</th><th>Responsável</th></tr></thead>
    <tbody>${rows.map(m=>`<tr>
      <td>${esc(m.data || m.created_at || "")}</td>
      <td><strong>${esc(m.item || m.produto_nome || m.nome || "")}</strong></td>
      <td>${esc(m.tipo || m.operacao || "")}</td>
      <td>${esc(m.origem || "")}</td>
      <td>${esc(m.destino || "")}</td>
      <td>${money(m.quantidade || m.qtd || "")}</td>
      <td>${esc(m.usuario || m.responsavel || "")}</td>
    </tr>`).join("") || `<tr><td colspan="7">Nenhuma movimentação encontrada.</td></tr>`}</tbody>
  </table></div>`;
}

function getCadastros(){
  try{return JSON.parse(localStorage.getItem(CAD_KEY)||"[]");}catch{return[]}
}
function saveCadastros(v){ localStorage.setItem(CAD_KEY, JSON.stringify(v)); }
function renderCadastro(){
  if(!isAdm()){ go("VisaoGeral"); return; }
  const cad = getCadastros();
  renderShell(`
    ${pageHeader("Cadastro", "Área administrativa para registrar solicitações e anotações online.")}
    <section class="grid two-col">
      <div class="card">
        <div class="section-head"><div><h2>Novo cadastro/anotação</h2><p>Uso administrativo do portal online.</p></div></div>
        <form id="cadForm">
          <div class="form-grid">
            <div class="field"><label>Nome do item / assunto</label><input id="cadNome" required></div>
            <div class="field"><label>Tipo</label><input id="cadTipo" placeholder="Medicamento, material, solicitação..."></div>
            <div class="field"><label>Quantidade</label><input id="cadQtd" type="number" min="0"></div>
            <div class="field"><label>Setor</label><input id="cadSetor"></div>
          </div>
          <div class="field"><label>Observação</label><textarea id="cadObs" rows="4"></textarea></div>
          <div class="form-actions"><button class="btn btn-primary">Salvar cadastro</button></div>
        </form>
      </div>
      <div class="card">
        <div class="section-head"><div><h2>Registros locais</h2><p>Salvos no navegador do administrador.</p></div></div>
        <div id="cadLista">${cad.map((c,idx)=>`<div class="kpi-note" style="margin-bottom:10px">
          <strong>${esc(c.nome)}</strong><br>${esc(c.tipo)} • Qtd: ${esc(c.qtd)} • ${esc(c.setor)}<br>
          <span>${esc(c.obs)}</span><br>
          <button class="btn btn-danger" style="margin-top:8px" onclick="delCad(${idx})">Excluir</button>
        </div>`).join("") || `<div class="empty">Nenhum cadastro local.</div>`}</div>
      </div>
    </section>
  `);
  document.getElementById("cadForm").addEventListener("submit",e=>{
    e.preventDefault();
    const cad = getCadastros();
    cad.unshift({nome:cadNome.value,tipo:cadTipo.value,qtd:cadQtd.value,setor:cadSetor.value,obs:cadObs.value,data:new Date().toLocaleString("pt-BR")});
    saveCadastros(cad);
    renderCadastro();
  });
}
function delCad(i){ const c=getCadastros(); c.splice(i,1); saveCadastros(c); renderCadastro(); }

function renderBackup(){
  if(!isAdm()){ go("VisaoGeral"); return; }
  renderShell(`
    ${pageHeader("Backup", "Exportação dos dados publicados no portal.")}
    <section class="grid two-col">
      <div class="card">
        <h2>Backup do dados.json</h2>
        <p class="sub">Baixe uma cópia do arquivo publicado atualmente no site.</p>
        <div class="kpi-note">
          <strong>Última atualização:</strong> ${DATA.atualizado_em || "-"}<br>
          <strong>Itens:</strong> ${money(DATA.resumo?.itens)}<br>
          <strong>Movimentações:</strong> ${money((DATA.movimentacoes||[]).length)}
        </div>
        <div class="form-actions" style="justify-content:flex-start;margin-top:16px">
          <button class="btn btn-primary" onclick="baixarBackup()">Baixar backup JSON</button>
          <button class="btn btn-light" onclick="loadData().then(renderBackup)">Recarregar dados</button>
        </div>
      </div>
      <div class="card">
        <h2>Observação importante</h2>
        <p>Este backup é do portal online. O backup oficial do sistema local continua sendo feito na tela de backup do sistema de estoque.</p>
      </div>
    </section>
  `);
}
function baixarBackup(){
  const blob = new Blob([JSON.stringify(DATA,null,2)], {type:"application/json;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`backup_estoque_hospital_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function render(){
  loadSession();
  if(!SESSION){ renderLogin(); return; }
  CURRENT_PAGE = routeFromPath();
  if((CURRENT_PAGE==="Cadastro" || CURRENT_PAGE==="Backup") && !isAdm()) CURRENT_PAGE="VisaoGeral";
  if(CURRENT_PAGE==="Estoque") return renderEstoque();
  if(CURRENT_PAGE==="Relatorios") return renderRelatorios();
  if(CURRENT_PAGE==="Movimentacoes") return renderMovimentacoes();
  if(CURRENT_PAGE==="Cadastro") return renderCadastro();
  if(CURRENT_PAGE==="Backup") return renderBackup();
  return renderVisaoGeral();
}

window.addEventListener("popstate", render);
loadData().then(render);
