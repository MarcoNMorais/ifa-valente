let DADOS={itens:[],movimentacoes:[],resumo:{},atualizado_em:""};
let paginaEstoque=1;
const porPagina=30;

async function carregar(){
  try{
    const r=await fetch("dados.json?ts="+Date.now());
    DADOS=await r.json();
  }catch(e){
    DADOS={itens:[],movimentacoes:[],resumo:{},atualizado_em:""};
  }
  renderTudo();
}
function n(v){return Number(v||0)}
function totalItem(i){return i.total!==undefined?n(i.total):(n(i.almoxarifado)+n(i.farmacia)+n(i.sala_medicacoes)+n(i.internamento)+n(i.sala_cirurgica)+n(i.baixa)+n(i.outro))}
function statusItem(i){
  const total=totalItem(i), min=n(i.minimo);
  if(total<=0) return ["Zerado","status-zero"];
  if(min>0 && total<=min) return ["Perto do mínimo","status-alerta"];
  return ["OK","status-ok"];
}
function mostrar(id){
  document.querySelectorAll(".pagina").forEach(p=>p.classList.remove("ativa"));
  document.getElementById(id).classList.add("ativa");
  document.querySelectorAll(".nav button").forEach(b=>b.classList.remove("ativo"));
  event?.target?.classList.add("ativo");
}
function renderTudo(){
  document.getElementById("dataAtualizacao").textContent = DADOS.atualizado_em ? "Atualizado: "+DADOS.atualizado_em : "Aguardando atualização";

  const itens=DADOS.itens||[];
  const movs=DADOS.movimentacoes||[];
  const totalAlmox=itens.reduce((a,i)=>a+n(i.almoxarifado),0);
  const totalFarm=itens.reduce((a,i)=>a+n(i.farmacia),0);
  const perto=itens.filter(i=>n(i.minimo)>0 && totalItem(i)<=n(i.minimo));
  const zerados=itens.filter(i=>totalItem(i)<=0);
  const mesAtual=(new Date()).toISOString().slice(0,7);
  const saidasMes=movs.filter(m=>String(m.data||"").slice(0,7)===mesAtual && String(m.tipo||"").toLowerCase().includes("sa")).length;

  kpiItens.textContent=itens.length;
  kpiAlmox.textContent=totalAlmox;
  kpiFarmacia.textContent=totalFarm;
  kpiPerto.textContent=perto.length;
  kpiZerados.textContent=zerados.length;
  kpiSaidas.textContent=saidasMes;
  relAlmox.textContent=totalAlmox;
  relFarmacia.textContent=totalFarm;

  tbodyPerto.innerHTML = perto.slice(0,12).map(i=>`<tr><td>${i.nome}</td><td>${totalItem(i)}</td><td>${n(i.minimo)}</td><td>${n(i.almoxarifado)?"Almox: "+n(i.almoxarifado):""}${n(i.farmacia)?" Farmácia: "+n(i.farmacia):""}</td></tr>`).join("") || `<tr><td colspan="4">Nenhum item perto do mínimo.</td></tr>`;

  const menores=[...itens].sort((a,b)=>totalItem(a)-totalItem(b)).slice(0,12);
  tbodyMenores.innerHTML = menores.map(i=>`<tr><td>${i.nome}</td><td>${totalItem(i)}</td><td>${n(i.minimo)}</td></tr>`).join("") || `<tr><td colspan="3">Sem itens cadastrados.</td></tr>`;

  const tipos={};
  itens.forEach(i=>{tipos[i.tipo||"Sem tipo"]=(tipos[i.tipo||"Sem tipo"]||0)+totalItem(i)});
  tbodyTipo.innerHTML=Object.entries(tipos).sort((a,b)=>b[1]-a[1]).map(([t,q])=>`<tr><td>${t}</td><td>${q}</td></tr>`).join("") || `<tr><td colspan="2">Sem dados.</td></tr>`;

  renderEstoque();
  renderMovimentacoes();
}
function renderEstoque(){
  const busca=(buscaEstoque?.value||"").toLowerCase();
  const filtrados=(DADOS.itens||[]).filter(i=>String(i.nome||"").toLowerCase().includes(busca) || String(i.tipo||"").toLowerCase().includes(busca));
  const totalPag=Math.max(1,Math.ceil(filtrados.length/porPagina));
  if(paginaEstoque>totalPag) paginaEstoque=totalPag;
  const ini=(paginaEstoque-1)*porPagina;
  const lista=filtrados.slice(ini,ini+porPagina);
  tbodyEstoque.innerHTML=lista.map(i=>{
    const [st,cl]=statusItem(i);
    return `<tr><td>${i.nome||""}</td><td>${i.tipo||""}</td><td>${i.unidade||""}</td><td>${n(i.almoxarifado)}</td><td>${n(i.farmacia)}</td><td>${totalItem(i)}</td><td>${n(i.minimo)}</td><td class="${cl}">${st}</td></tr>`;
  }).join("") || `<tr><td colspan="8">Nenhum item encontrado.</td></tr>`;
  infoEstoque.textContent=`Página ${paginaEstoque} de ${totalPag} • ${filtrados.length} itens`;
}
function renderMovimentacoes(){
  const busca=(buscaMov?.value||"").toLowerCase();
  const lista=(DADOS.movimentacoes||[]).filter(m=>JSON.stringify(m).toLowerCase().includes(busca)).slice(-300).reverse();
  tbodyMov.innerHTML=lista.map(m=>`<tr><td>${m.data||""}</td><td>${m.item||m.nome||m.produto_nome||""}</td><td>${m.tipo||""}</td><td>${m.origem||""}</td><td>${m.destino||""}</td><td>${m.quantidade||m.qtd||""}</td><td>${m.usuario||m.responsavel||""}</td></tr>`).join("") || `<tr><td colspan="7">Sem movimentações.</td></tr>`;
}
carregar();
setInterval(carregar, 60000);
