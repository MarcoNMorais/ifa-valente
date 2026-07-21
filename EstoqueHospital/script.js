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
function onlyDateIsoFromMovement(m){
  const raw = String(m.data || m.created_at || m.atualizado_em || m.date || "").trim();
  if(!raw) return "";
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if(match) return `${match[3]}-${match[2]}-${match[1]}`;
  match = raw.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if(match) return `${match[3]}-${match[2]}-${match[1]}`;
  return "";
}
function produtoMov(m){ return String(m.item || m.produto_nome || m.nome || m.produto || "").trim(); }
function operadorMov(m){ return String(m.usuario || m.responsavel || m.operador || m.criado_por || "").trim(); }
function qtdMov(m){ return Number(m.quantidade || m.qtd || m.qtde || m.total || 0) || 0; }
function tipoMovRaw(m){ return String(m.tipo || m.operacao || m.movimento || m.acao || "").trim(); }
function classificarMov(m){
  const texto = `${tipoMovRaw(m)} ${m.origem || ""} ${m.destino || ""} ${m.descricao || ""}`.toLowerCase();
  if(texto.includes("saída") || texto.includes("saida") || texto.includes("retirada") || texto.includes("baixa") || texto.includes("consumo")) return "saida";
  if(texto.includes("entrada") || texto.includes("compra") || texto.includes("recebimento") || texto.includes("adicao") || texto.includes("adição")) return "entrada";
  if(texto.includes("transfer")) return "transferencia";
  return "outro";
}
function tipoMovLabel(tipo){
  return {entrada:"Entrada", saida:"Saída", transferencia:"Transferência", outro:"Outros"}[tipo] || "Outros";
}
function uniq(arr){ return [...new Set(arr.filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR")); }

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
          <h2>Acesso restrito</h2>
          <p class="sub">Sistema online de consulta e acompanhamento do estoque hospitalar.</p>
          <div id="loginAlert"></div>
          <form id="loginForm">
            <div class="field">
              <label>Usuário</label>
              <input id="loginUser" autocomplete="username" required>
            </div>
            <div class="field">
              <label>Senha</label>
              <input id="loginPass" type="password" autocomplete="current-password" required>
            </div>
            <button class="btn btn-primary btn-full" type="submit">Entrar</button>
          </form>
        </div>
      </section>
      <section class="login-right">
        <div class="hero-content">
          <span class="hero-badge">🏥 Estoque Hospitalar</span>
          <h2>Hospital Municipal José Mota Araújo</h2>
          <p>Portal integrado para acompanhamento dos saldos, movimentações e indicadores de estoque.</p>
          <div class="hero-grid">
            <div class="hero-mini"><strong>${money(DATA.resumo?.itens)}</strong><span>itens cadastrados</span></div>
            <div class="hero-mini"><strong>${money(DATA.resumo?.total_geral)}</strong><span>saldo total</span></div>
            <div class="hero-mini"><strong>${money(DATA.resumo?.perto_de_terminar)}</strong><span>itens em alerta</span></div>
            <div class="hero-mini"><strong>${DATA.atualizado_em || "-"}</strong><span>atualização</span></div>
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
      document.getElementById("loginAlert").innerHTML = `<div class="alert">Usuário ou senha inválidos.</div>`;
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
        <div class="footer-note">Última atualização: ${DATA.atualizado_em || "-"}</div>
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
        ${tableItens(alertas)}
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

function tableItens(rows){
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
  const tipos = uniq((DATA.itens||[]).map(i=>i.tipo||"Sem tipo"));
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

function filtrosRelatorioHtml(){
  const movs = DATA.movimentacoes || [];
  const produtos = uniq(movs.map(produtoMov));
  const operadores = uniq(movs.map(operadorMov));
  return `
    <div class="filters-card">
      <div class="field"><label>Data inicial</label><input id="relInicio" type="date" onchange="aplicarRelatorios()"></div>
      <div class="field"><label>Data final</label><input id="relFim" type="date" onchange="aplicarRelatorios()"></div>
      <div class="field"><label>Produto</label><select id="relProduto" onchange="aplicarRelatorios()"><option value="">Todos</option>${produtos.map(p=>`<option>${esc(p)}</option>`).join("")}</select></div>
      <div class="field"><label>Operador</label><select id="relOperador" onchange="aplicarRelatorios()"><option value="">Todos</option>${operadores.map(o=>`<option>${esc(o)}</option>`).join("")}</select></div>
      <div class="field"><label>Movimento</label><select id="relTipo" onchange="aplicarRelatorios()"><option value="">Todos</option><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="transferencia">Transferência</option><option value="outro">Outros</option></select></div>
      <div class="field action-field"><label>&nbsp;</label><button class="btn btn-light" onclick="limparRelatorios()">Limpar filtros</button></div>
    </div>`;
}
function movimentosFiltradosRel(){
  const ini = document.getElementById("relInicio")?.value || "";
  const fim = document.getElementById("relFim")?.value || "";
  const prod = document.getElementById("relProduto")?.value || "";
  const op = document.getElementById("relOperador")?.value || "";
  const tipo = document.getElementById("relTipo")?.value || "";
  return (DATA.movimentacoes || []).filter(m=>{
    const d = onlyDateIsoFromMovement(m);
    const p = produtoMov(m);
    const o = operadorMov(m);
    const t = classificarMov(m);
    return (!ini || (d && d >= ini)) &&
           (!fim || (d && d <= fim)) &&
           (!prod || p === prod) &&
           (!op || o === op) &&
           (!tipo || t === tipo);
  });
}
function resumirMovimentos(rows){
  const totals = {entrada:0, saida:0, transferencia:0, outro:0};
  rows.forEach(m=>totals[classificarMov(m)] += qtdMov(m));
  return totals;
}
function resumoPorProduto(rows){
  const map = {};
  rows.forEach(m=>{
    const p = produtoMov(m) || "Não informado";
    if(!map[p]) map[p] = {produto:p, entrada:0, saida:0, transferencia:0, outro:0, total:0};
    const t = classificarMov(m), q = qtdMov(m);
    map[p][t] += q;
    map[p].total += q;
  });
  return Object.values(map).sort((a,b)=>b.total-a.total);
}
function resumoPorOperador(rows){
  const map = {};
  rows.forEach(m=>{
    const p = operadorMov(m) || "Não informado";
    if(!map[p]) map[p] = {operador:p, entrada:0, saida:0, transferencia:0, outro:0, total:0, registros:0};
    const t = classificarMov(m), q = qtdMov(m);
    map[p][t] += q;
    map[p].total += q;
    map[p].registros += 1;
  });
  return Object.values(map).sort((a,b)=>b.total-a.total);
}
function renderRelatorios(){
  renderShell(`
    ${pageHeader("Relatórios", "Consulta gerencial das movimentações e saldos publicados.")}
    <section class="card">
      <div class="section-head"><div><h2>Filtros</h2><p>Selecione o período, produto, operador ou tipo de movimentação.</p></div></div>
      ${filtrosRelatorioHtml()}
    </section>
    <section id="relatorioResultado"></section>
  `);
  aplicarRelatorios();
}
function aplicarRelatorios(){
  const rows = movimentosFiltradosRel();
  const totals = resumirMovimentos(rows);
  const porProduto = resumoPorProduto(rows);
  const porOperador = resumoPorOperador(rows);
  const detalhes = rows.slice(0,500);

  const html = `
    <section class="grid cards section">
      <div class="card metric"><div class="label">Registros</div><div class="value">${money(rows.length)}</div><div class="hint">movimentações filtradas</div></div>
      <div class="card metric"><div class="label">Entradas</div><div class="value">${money(totals.entrada)}</div><div class="hint">quantidade total</div></div>
      <div class="card metric"><div class="label">Saídas</div><div class="value">${money(totals.saida)}</div><div class="hint">quantidade total</div></div>
      <div class="card metric"><div class="label">Transferências</div><div class="value">${money(totals.transferencia)}</div><div class="hint">quantidade total</div></div>
    </section>
    <section class="grid two-col section">
      <div class="card">
        <div class="section-head">
          <div><h2>Quantidade por produto</h2><p>Entradas, saídas e transferências por item.</p></div>
          <button class="btn btn-light" onclick="exportarRelatorioCSV()">Exportar CSV</button>
        </div>
        ${tabelaPorProduto(porProduto)}
      </div>
      <div class="card">
        <div class="section-head"><div><h2>Quantidade por operador</h2><p>Total movimentado por responsável.</p></div></div>
        ${tabelaPorOperador(porOperador)}
      </div>
    </section>
    <section class="card section">
      <div class="section-head"><div><h2>Movimentações detalhadas</h2><p>Histórico conforme filtros selecionados.</p></div></div>
      ${tabelaMovDetalhada(detalhes)}
    </section>`;
  const el = document.getElementById("relatorioResultado");
  if(el) el.innerHTML = html;
}
function tabelaPorProduto(rows){
  if(!rows.length) return `<div class="empty">Nenhum resultado encontrado.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Produto</th><th>Entrada</th><th>Saída</th><th>Transferência</th><th>Outros</th><th>Total</th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td><strong>${esc(r.produto)}</strong></td>
      <td>${money(r.entrada)}</td><td>${money(r.saida)}</td><td>${money(r.transferencia)}</td><td>${money(r.outro)}</td><td><strong>${money(r.total)}</strong></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}
function tabelaPorOperador(rows){
  if(!rows.length) return `<div class="empty">Nenhum resultado encontrado.</div>`;
  return `<div class="table-wrap"><table style="min-width:620px">
    <thead><tr><th>Operador</th><th>Registros</th><th>Entrada</th><th>Saída</th><th>Total</th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td><strong>${esc(r.operador)}</strong></td>
      <td>${money(r.registros)}</td><td>${money(r.entrada)}</td><td>${money(r.saida)}</td><td><strong>${money(r.total)}</strong></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}
function tabelaMovDetalhada(rows){
  if(!rows.length) return `<div class="empty">Nenhuma movimentação encontrada.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Data</th><th>Produto</th><th>Movimento</th><th>Origem</th><th>Destino</th><th>Qtd.</th><th>Operador</th></tr></thead>
    <tbody>${rows.map(m=>`<tr>
      <td>${esc(m.data || m.created_at || "")}</td>
      <td><strong>${esc(produtoMov(m))}</strong></td>
      <td>${tipoMovLabel(classificarMov(m))}</td>
      <td>${esc(m.origem || "")}</td>
      <td>${esc(m.destino || "")}</td>
      <td>${money(qtdMov(m))}</td>
      <td>${esc(operadorMov(m))}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}
function limparRelatorios(){
  ["relInicio","relFim","relProduto","relOperador","relTipo"].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=""; });
  aplicarRelatorios();
}
function exportarRelatorioCSV(){
  const rows = movimentosFiltradosRel();
  const linhas = [["Data","Produto","Movimento","Origem","Destino","Quantidade","Operador"]];
  rows.forEach(m=>linhas.push([
    m.data || m.created_at || "",
    produtoMov(m),
    tipoMovLabel(classificarMov(m)),
    m.origem || "",
    m.destino || "",
    qtdMov(m),
    operadorMov(m)
  ]));
  const csv = linhas.map(l=>l.map(v=>`"${String(v).replaceAll('"','""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`relatorio_movimentacoes_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderMovimentacoes(){
  const movs = DATA.movimentacoes || [];
  const produtos = uniq(movs.map(produtoMov));
  const operadores = uniq(movs.map(operadorMov));
  renderShell(`
    ${pageHeader("Movimentações", "Histórico de entradas, saídas e transferências publicadas.")}
    <section class="card">
      <div class="filters-card compact">
        <div class="field"><label>Data inicial</label><input id="movInicio" type="date" oninput="filtrarMov()"></div>
        <div class="field"><label>Data final</label><input id="movFim" type="date" oninput="filtrarMov()"></div>
        <div class="field"><label>Produto</label><select id="movProduto" onchange="filtrarMov()"><option value="">Todos</option>${produtos.map(p=>`<option>${esc(p)}</option>`).join("")}</select></div>
        <div class="field"><label>Operador</label><select id="movOperador" onchange="filtrarMov()"><option value="">Todos</option>${operadores.map(o=>`<option>${esc(o)}</option>`).join("")}</select></div>
        <div class="field"><label>Busca</label><input id="movBusca" placeholder="Pesquisar..." oninput="filtrarMov()"></div>
      </div>
      <div id="movTabela"></div>
    </section>
  `);
  filtrarMov();
}
function filtrarMov(){
  const q = (document.getElementById("movBusca")?.value || "").toLowerCase();
  const ini = document.getElementById("movInicio")?.value || "";
  const fim = document.getElementById("movFim")?.value || "";
  const prod = document.getElementById("movProduto")?.value || "";
  const op = document.getElementById("movOperador")?.value || "";
  const rows = (DATA.movimentacoes||[]).filter(m=>{
    const d = onlyDateIsoFromMovement(m);
    return (!q || JSON.stringify(m).toLowerCase().includes(q)) &&
           (!ini || (d && d >= ini)) &&
           (!fim || (d && d <= fim)) &&
           (!prod || produtoMov(m) === prod) &&
           (!op || operadorMov(m) === op);
  }).slice(0,500);
  document.getElementById("movTabela").innerHTML = tabelaMovDetalhada(rows);
}

function getCadastros(){
  try{return JSON.parse(localStorage.getItem(CAD_KEY)||"[]");}catch{return[]}
}
function saveCadastros(v){ localStorage.setItem(CAD_KEY, JSON.stringify(v)); }
function renderCadastro(){
  if(!isAdm()){ go("VisaoGeral"); return; }
  const cad = getCadastros();
  renderShell(`
    ${pageHeader("Cadastro", "Registros administrativos do portal.")}
    <section class="grid two-col">
      <div class="card">
        <div class="section-head"><div><h2>Novo registro</h2><p>Cadastro complementar para acompanhamento administrativo.</p></div></div>
        <form id="cadForm">
          <div class="form-grid">
            <div class="field"><label>Item / assunto</label><input id="cadNome" required></div>
            <div class="field"><label>Tipo</label><input id="cadTipo"></div>
            <div class="field"><label>Quantidade</label><input id="cadQtd" type="number" min="0"></div>
            <div class="field"><label>Setor</label><input id="cadSetor"></div>
          </div>
          <div class="field"><label>Observação</label><textarea id="cadObs" rows="4"></textarea></div>
          <div class="form-actions"><button class="btn btn-primary">Salvar</button></div>
        </form>
      </div>
      <div class="card">
        <div class="section-head"><div><h2>Registros</h2><p>Acompanhamento complementar.</p></div></div>
        <div id="cadLista">${cad.map((c,idx)=>`<div class="kpi-note" style="margin-bottom:10px">
          <strong>${esc(c.nome)}</strong><br>${esc(c.tipo)} • Qtd: ${esc(c.qtd)} • ${esc(c.setor)}<br>
          <span>${esc(c.obs)}</span><br>
          <button class="btn btn-danger" style="margin-top:8px" onclick="delCad(${idx})">Excluir</button>
        </div>`).join("") || `<div class="empty">Nenhum registro encontrado.</div>`}</div>
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
    ${pageHeader("Backup", "Exportação dos dados publicados.")}
    <section class="grid two-col">
      <div class="card">
        <h2>Arquivo de dados</h2>
        <div class="kpi-note">
          <strong>Atualização:</strong> ${DATA.atualizado_em || "-"}<br>
          <strong>Itens:</strong> ${money(DATA.resumo?.itens)}<br>
          <strong>Movimentações:</strong> ${money((DATA.movimentacoes||[]).length)}
        </div>
        <div class="form-actions" style="justify-content:flex-start;margin-top:16px">
          <button class="btn btn-primary" onclick="baixarBackup()">Baixar JSON</button>
          <button class="btn btn-light" onclick="loadData().then(renderBackup)">Atualizar</button>
        </div>
      </div>
      <div class="card">
        <h2>Resumo</h2>
        <section class="grid" style="gap:10px">
          <div class="kpi-note"><strong>Total geral:</strong> ${money(DATA.resumo?.total_geral)}</div>
          <div class="kpi-note"><strong>Almoxarifado:</strong> ${money(DATA.resumo?.total_almoxarifado)}</div>
          <div class="kpi-note"><strong>Farmácia:</strong> ${money(DATA.resumo?.total_farmacia)}</div>
        </section>
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
