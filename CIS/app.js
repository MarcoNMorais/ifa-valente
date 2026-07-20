const STORAGE_KEY='cis_regulacao_pacientes_v4';
const PROC_KEY='cis_regulacao_procedimentos_v4';
const CODES_KEY='cis_regulacao_codigos_v4';
const USERS_KEY='cis_regulacao_users_v4';
const LOC_KEY='cis_regulacao_locais_v4';
const SESSION_KEY='cis_regulacao_session_v4';
const LOGS_KEY='cis_regulacao_logs_v5';
const OLD_STORAGE_KEY='cis_regulacao_pacientes_v3';
const OLD_PROC_KEY='cis_regulacao_procedimentos_v3';
const OLD_CODES_KEY='cis_regulacao_codigos_v3';
const OLD_CID_KEY='cis_regulacao_cids_v2';
const OLD_USERS_KEY='cis_regulacao_users_v3';
const OLD_SESSION_KEY='cis_regulacao_session_v3';
const OLD_LOC_KEY='cis_regulacao_locais_v3';
const OLD_LOGS_KEY='cis_regulacao_logs_v4';

// Integração online: quando publicado em /CIS, o sistema tenta salvar no backend Flask.
// Quando aberto direto no computador, continua funcionando no navegador/localStorage.
const CIS_API_BASE='/api/cis';
const SERVER_SYNC_ENABLED=location.protocol!=='file:';
let serverSyncReady=false;
let serverSaveTimer=null;
let serverStatus='local';

const $=sel=>document.querySelector(sel);
const $$=sel=>Array.from(document.querySelectorAll(sel));
const today=()=>new Date().toISOString().slice(0,10);
const nowBR=()=>new Date().toLocaleString('pt-BR');
const norm=s=>(s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const compact=s=>norm(s).replace(/\s+/g,'');
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);

const prioridades=[
 'Prioridade 0 - Muito alto risco e/ou vulnerabilidade',
 'Prioridade 1 - Alto risco e/ou vulnerabilidade',
 'Prioridade 2 - Moderado risco e/ou vulnerabilidade',
 'Prioridade 3 - Baixo risco e/ou vulnerabilidade',
 'Não Classificado'
];
const prioridadesClasses=['p0','p1','p2','p3','pn'];

const unidadesValente=[
 'USF Casas Populares',
 'USF Centro',
 'USF Cidade Nova',
 'USF Juazeiro Petrolina',
 'USF Queimada do Curral',
 'USF Santa Rita de Cássia',
 'USF Tanquinho',
 'USF Valilândia',
 'USF Junco',
 'USF Dr. Antônio Delfino Mota Simões'
];

const defaultLocais=[
 'CIS - Central Integrada da Saúde',
 'CEMES',
 'Hospital Municipal de Valente',
 'Policlínica / Referência',
 'Clínica credenciada',
 ...unidadesValente
];

const defaultProcedimentos=[
 '0301100152 - Retirada de pontos de cirurgias - CDS',
 '0205020038 - Ultrassonografia de abdômen total',
 '0205020054 - Ultrassonografia de aparelho urinário',
 '0205020070 - Ultrassonografia de próstata por via abdominal',
 '0205020097 - Ultrassonografia mamária bilateral',
 '0205020100 - Ultrassonografia pélvica ginecológica',
 '0205020143 - Ultrassonografia obstétrica',
 '0205020151 - Ultrassonografia obstétrica com doppler colorido e pulsado',
 '0209010037 - Endoscopia digestiva alta',
 '0211060015 - Eletrocardiograma',
 '0205010032 - Ecocardiografia transtorácica',
 '0211020030 - Colposcopia',
 '0301010072 - Consulta médica em atenção especializada',
 '0301010048 - Consulta de profissionais de nível superior na atenção especializada exceto médico',
 '0301010064 - Consulta médica em atenção básica',
 '0301050074 - Excisão e sutura simples de pequenas lesões de pele/mucosa',
 '0301060037 - Atendimento de urgência com observação até 24 horas em atenção especializada',
 '0401010015 - Curativo grau II com ou sem debridamento',
 'OCI Avaliação Diagnóstica em Ortopedia com Recursos de Radiologia e Ultrassonografia',
 'Exame OCI Cardiológica',
 'OCI Avaliação Diagnóstica de Câncer Gástrico',
 'OCI Investigação Diagnóstica de Câncer de Colo de Útero',
 'Consulta em Angiologia',
 'Consulta em Cardiologia',
 'Consulta em Ortopedia e Traumatologia',
 'Consulta em Dermatologia',
 'Consulta em Gastroenterologia',
 'Consulta em Ginecologia',
 'Consulta em Neurologia',
 'Consulta em Oftalmologia',
 'Consulta em Otorrinolaringologia',
 'Consulta em Pediatria',
 'Consulta em Urologia',
 'Retorno',
 'Avaliação'
];

const defaultCodigos=[
 ['CID-10','A09','Diarreia e gastroenterite de origem infecciosa presumível'],
 ['CID-10','B34','Doença por vírus, de localização não especificada'],
 ['CID-10','C16','Neoplasia maligna do estômago'],
 ['CID-10','C53','Neoplasia maligna do colo do útero'],
 ['CID-10','D25','Leiomioma do útero'],
 ['CID-10','E10','Diabetes mellitus insulinodependente'],
 ['CID-10','E11','Diabetes mellitus não-insulinodependente'],
 ['CID-10','E66','Obesidade'],
 ['CID-10','F32','Episódios depressivos'],
 ['CID-10','G43','Enxaqueca'],
 ['CID-10','H90','Perda de audição por transtorno de condução e/ou neurossensorial'],
 ['CID-10','I10','Hipertensão essencial primária'],
 ['CID-10','I20','Angina pectoris'],
 ['CID-10','I25','Doença isquêmica crônica do coração'],
 ['CID-10','I48','Flutter e fibrilação atrial'],
 ['CID-10','I50','Insuficiência cardíaca'],
 ['CID-10','I83','Varizes dos membros inferiores'],
 ['CID-10','J00','Nasofaringite aguda'],
 ['CID-10','J06','Infecções agudas das vias aéreas superiores'],
 ['CID-10','J45','Asma'],
 ['CID-10','K21','Doença de refluxo gastroesofágico'],
 ['CID-10','K29','Gastrite e duodenite'],
 ['CID-10','K80','Colelitíase'],
 ['CID-10','L97','Úlcera dos membros inferiores não classificada em outra parte'],
 ['CID-10','M17','Gonartrose'],
 ['CID-10','M25','Outros transtornos articulares não classificados em outra parte'],
 ['CID-10','M54','Dorsalgia'],
 ['CID-10','M79','Outros transtornos dos tecidos moles'],
 ['CID-10','N39','Outros transtornos do trato urinário'],
 ['CID-10','N81','Prolapso genital feminino'],
 ['CID-10','R10','Dor abdominal e pélvica'],
 ['CID-10','R51','Cefaleia'],
 ['CID-10','R60','Edema não classificado em outra parte'],
 ['CID-10','S82','Fratura da perna, incluindo tornozelo'],
 ['CID-10','Z00','Exame geral e investigação de pessoas sem queixas ou diagnóstico relatado'],
 ['CID-10','Z01','Outros exames e investigações especiais de pessoas sem queixa ou diagnóstico relatado'],
 ['CID-10','Z12','Exame especial de rastreamento de neoplasias'],
 ['CID-10','Z48','Outro seguimento cirúrgico'],
 ['CID-10','Z76','Pessoas em contato com serviços de saúde em outras circunstâncias'],
 ['CIAP-2','A97','Sem doença'],
 ['CIAP-2','A98','Medicina preventiva/manutenção da saúde'],
 ['CIAP-2','K86','Hipertensão sem complicações'],
 ['CIAP-2','K87','Hipertensão com complicações'],
 ['CIAP-2','T89','Diabetes insulinodependente'],
 ['CIAP-2','T90','Diabetes não insulinodependente'],
 ['CIAP-2','L03','Sinais/sintomas lombares'],
 ['CIAP-2','L15','Sinais/sintomas do joelho'],
 ['CIAP-2','S97','Úlcera crônica da pele'],
 ['SIGTAP','0301100152','Retirada de pontos de cirurgias - CDS'],
 ['SIGTAP','0209010037','Endoscopia digestiva alta'],
 ['SIGTAP','0211060015','Eletrocardiograma'],
 ['SIGTAP','0205010032','Ecocardiografia transtorácica'],
 ['SIGTAP','0211020030','Colposcopia'],
 ['SIGTAP','0205020038','Ultrassonografia de abdômen total'],
 ['SIGTAP','0205020100','Ultrassonografia pélvica ginecológica'],
 ['Motivo','VARIZES','Varizes'],
 ['Motivo','AVALIACAO','Avaliação'],
 ['Motivo','RETORNO','Retorno'],
 ['Motivo','ULCERA','Úlcera']
].map(([tipo,codigo,descricao])=>({tipo,codigo,descricao}));

const defaultUsers=[
 {id:'admin-default',user:'admin',pass:'1234',role:'admin',name:'admin',active:true,createdAt:new Date().toISOString()},
 {id:'regulador-default',user:'regulador',pass:'1234',role:'regulador',name:'regulador',active:true,createdAt:new Date().toISOString()}
];

function loadRaw(key){try{return JSON.parse(localStorage.getItem(key))}catch{return null}}
function load(key, fallback, oldKey=null){const now=loadRaw(key); if(now!==null) return now; if(oldKey){const old=loadRaw(oldKey); if(old!==null) return old;} return fallback;}

function normalizeUserRecord(u, fallbackRole='regulador'){
 if(!u) return null;
 const user=(u.user||u.login||u.usuario||'').toString().trim();
 const pass=(u.pass||u.senha||'').toString();
 if(!user || !pass) return null;
 const role=(u.role||u.perfil||fallbackRole||'regulador').toString().toLowerCase()==='admin'?'admin':'regulador';
 return {id:(u.id||uid()).toString(),user,pass,role,name:(u.name||u.nome||user).toString().trim()||user,active:u.active!==false && u.ativo!==false,createdAt:u.createdAt||u.criadoEm||new Date().toISOString(),updatedAt:u.updatedAt||u.atualizadoEm||''};
}
function normalizeUsers(data){
 let arr=[];
 if(Array.isArray(data)) arr=data.map(u=>normalizeUserRecord(u)).filter(Boolean);
 else if(data && typeof data==='object'){
  if(Array.isArray(data.operadores)) arr=data.operadores.map(u=>normalizeUserRecord(u)).filter(Boolean);
  else {
   if(data.admin) arr.push(normalizeUserRecord(data.admin,'admin'));
   if(data.regulador) arr.push(normalizeUserRecord(data.regulador,'regulador'));
   Object.keys(data).forEach(k=>{if(!['admin','regulador'].includes(k) && data[k] && typeof data[k]==='object') arr.push(normalizeUserRecord(data[k],data[k].role||'regulador'));});
  }
 }
 if(!arr.length) arr=defaultUsers.map(u=>({...u}));
 const unique=[]; const seen=new Set();
 arr.forEach(u=>{const key=compact(u.user); if(!key || seen.has(key)) return; seen.add(key); unique.push(u);});
 if(!unique.some(u=>u.role==='admin' && u.active!==false)) unique.unshift({...defaultUsers[0],id:uid()});
 return unique;
}

function normalizePacienteRecord(p){
 if(!p || typeof p!=='object') return null;
 const id=(p.id!==undefined && p.id!==null && p.id!=='') ? String(p.id) : uid();
 return {...p,id};
}
function normalizePacientes(data){
 if(!Array.isArray(data)) return [];
 return data.map(normalizePacienteRecord).filter(Boolean);
}
function allUsers(){return Array.isArray(users)?users:normalizeUsers(users)}
function migrateOldCids(){const old=loadRaw(OLD_CID_KEY); if(!old || !Array.isArray(old)) return defaultCodigos; const migrated=old.map(c=>({tipo:'CID-10',codigo:(c.codigo||'').toString(),descricao:(c.descricao||'').toString()})); return mergeCodes(defaultCodigos.concat(migrated));}

let pacientes=normalizePacientes(load(STORAGE_KEY,[],OLD_STORAGE_KEY));
let procedimentos=load(PROC_KEY,defaultProcedimentos,OLD_PROC_KEY);
let codigos=load(CODES_KEY,null,OLD_CODES_KEY) || migrateOldCids();
let users=normalizeUsers(load(USERS_KEY,defaultUsers,OLD_USERS_KEY));
let locais=load(LOC_KEY,defaultLocais,OLD_LOC_KEY);
let logs=load(LOGS_KEY,[],OLD_LOGS_KEY);
let currentUser=null;


// Rotas profissionais quando publicado em https://secsaudevalente.com.br/CIS
// Login: /CIS
// Abas internas: /CIS/DashBord, /CIS/Filas, /CIS/Cadastros, /CIS/Bases, /CIS/Administracao
const ROUTE_BASE='/CIS';
const ROUTE_SLUGS={dashboard:'DashBord',filas:'Filas',cadastro:'Cadastros',bases:'Bases',admin:'Administracao'};
const ROUTE_TITLES={dashboard:'Dashboard',filas:'Filas',cadastro:'Cadastros',bases:'Bases e configurações',admin:'Administração'};
const ROUTE_ALIASES={
 'dashboard':'dashboard','dashbord':'dashboard','dash-board':'dashboard',
 'filas':'filas','fila':'filas',
 'cadastros':'cadastro','cadastro':'cadastro',
 'bases':'bases','base':'bases','bases-e-configuracoes':'bases','bases-configuracoes':'bases',
 'administracao':'admin','admin':'admin','administração':'admin'
};
function routeTabFromLocation(){
 if(location.protocol==='file:'){
  const hash=(location.hash||'').replace('#','').trim().toLowerCase();
  return ROUTE_ALIASES[hash]||null;
 }
 const parts=location.pathname.split('/').filter(Boolean);
 const cisIndex=parts.findIndex(x=>x.toLowerCase()==='cis');
 if(cisIndex<0) return null;
 const slug=(parts[cisIndex+1]||'').toLowerCase();
 return ROUTE_ALIASES[slug]||null;
}
function routePathFor(tab){
 if(!tab) return ROUTE_BASE;
 return `${ROUTE_BASE}/${ROUTE_SLUGS[tab]||ROUTE_SLUGS.dashboard}`;
}
function setAppRoute(tab, replace=false){
 if(location.protocol==='file:'){
  const hash=tab?`#${tab}`:'';
  if(location.hash!==hash) history[replace?'replaceState':'pushState']({tab},'',hash||location.pathname);
  return;
 }
 const target=routePathFor(tab);
 if(location.pathname!==target){
  history[replace?'replaceState':'pushState']({tab},'',target);
 }
}
function showTab(tab='dashboard', pushRoute=true){
 if(tab==='admin' && !isAdmin()) tab='dashboard';
 if(!ROUTE_SLUGS[tab]) tab='dashboard';
 const btn=document.querySelector(`.tab[data-tab="${tab}"]`);
 const view=document.getElementById(tab);
 if(!btn || !view) return;
 $$('.tab').forEach(x=>x.classList.remove('active'));
 $$('.view').forEach(x=>x.classList.remove('active'));
 btn.classList.add('active');
 view.classList.add('active');
 document.title=`CIS · ${ROUTE_TITLES[tab]||'Sistema de Regulação'}`;
 if(pushRoute) setAppRoute(tab,false);
 renderAll();
 if(tab==='admin') carregarBackupsRender();
}
function routeToLogin(replace=true){
 document.title='CIS · Login';
 setAppRoute(null,replace);
}

function statePayload(){
 return {
  versao:14,
  atualizadoEm:new Date().toISOString(),
  pacientes:normalizePacientes(pacientes),
  procedimentos:Array.isArray(procedimentos)?procedimentos:defaultProcedimentos,
  codigos:Array.isArray(codigos)?codigos:defaultCodigos,
  locais:Array.isArray(locais)?locais:defaultLocais,
  users:normalizeUsers(users),
  logs:Array.isArray(logs)?logs:[]
 };
}
function applyStatePayload(data){
 if(!data || typeof data!=='object') return;
 pacientes=normalizePacientes(data.pacientes||[]);
 procedimentos=Array.isArray(data.procedimentos)?data.procedimentos:defaultProcedimentos;
 codigos=Array.isArray(data.codigos)?data.codigos:defaultCodigos;
 locais=Array.isArray(data.locais)?data.locais:defaultLocais;
 users=normalizeUsers(data.users||defaultUsers);
 logs=Array.isArray(data.logs)?data.logs:[];
}
function persistLocalOnly(){
 const payload=statePayload();
 pacientes=payload.pacientes; procedimentos=payload.procedimentos; codigos=payload.codigos; locais=payload.locais; users=payload.users; logs=payload.logs;
 localStorage.setItem(STORAGE_KEY,JSON.stringify(pacientes));
 localStorage.setItem(PROC_KEY,JSON.stringify(procedimentos));
 localStorage.setItem(CODES_KEY,JSON.stringify(codigos));
 localStorage.setItem(USERS_KEY,JSON.stringify(users));
 localStorage.setItem(LOC_KEY,JSON.stringify(locais));
 localStorage.setItem(LOGS_KEY,JSON.stringify(logs));
}
function scheduleServerSave(){
 if(!SERVER_SYNC_ENABLED || !serverSyncReady) return;
 clearTimeout(serverSaveTimer);
 serverSaveTimer=setTimeout(saveStateToServer,450);
}
async function saveStateToServer(){
 if(!SERVER_SYNC_ENABLED || !serverSyncReady) return;
 try{
  const res=await fetch(`${CIS_API_BASE}/salvar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(statePayload())});
  if(!res.ok) throw new Error('HTTP '+res.status);
  serverStatus='online';
  if(isAdmin()) setTimeout(carregarBackupsRender,700);
 }catch(err){
  serverStatus='local';
  console.warn('CIS: não foi possível salvar no backend. Mantido localmente no navegador.',err);
 }
}
async function initDataStorage(){
 const localPayload=statePayload();
 const localHasData=(localPayload.pacientes?.length||0) || (localPayload.logs?.length||0) || (localPayload.procedimentos?.length||0) || (localPayload.codigos?.length||0);
 persistLocalOnly();
 if(SERVER_SYNC_ENABLED){
  try{
   const res=await fetch(`${CIS_API_BASE}/dados`,{cache:'no-store'});
   if(res.ok){
    const payload=await res.json();
    if(payload && payload.ok && payload.data){
     const serverData=payload.data;
     const serverHasData=(serverData.pacientes?.length||0) || (serverData.logs?.length||0) || (serverData.procedimentos?.length||0) || (serverData.codigos?.length||0);
     serverStatus='online';
     if(!serverHasData && localHasData){
      // Primeiro acesso online: se o navegador já tinha dados locais, envia para o Render
      // em vez de apagar tudo com uma base nova vazia do servidor.
      serverSyncReady=true;
      await saveStateToServer();
      renderAll();
      return;
     }
     applyStatePayload(serverData);
     persistLocalOnly();
    }
   }
  }catch(err){
   serverStatus='local';
   console.warn('CIS: backend não respondeu. Usando armazenamento local do navegador.',err);
  }
 }
 serverSyncReady=true;
 renderAll();
 if(SERVER_SYNC_ENABLED) scheduleServerSave();
}
function persistAll(){persistLocalOnly();scheduleServerSave()}
function save(){persistAll();renderAll()}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
function download(name, content, type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function isAdmin(){return currentUser?.role==='admin'}
function firstName(v){return (v||'').toString().trim().split(/\s+/)[0]||''}
function actorName(){return currentUser?.user || currentUser?.name || 'Não identificado'}
function addLog(acao, detalhes='', paciente=''){
 const registro={id:uid(),quando:new Date().toISOString(),usuario:actorName(),perfil:currentUser?.role||'',acao,paciente:paciente||'',detalhes:detalhes||''};
 logs.unshift(registro);
 if(logs.length>5000) logs=logs.slice(0,5000);
 persistAll();
 renderLog();
}

function login(user, pass){
 users=normalizeUsers(users);
 const loginDigitado=compact(user);
 const found=allUsers().find(u=>u.active!==false && compact(u.user)===loginDigitado && u.pass===pass);
 if(!found){toast('Usuário ou senha inválidos.');return}
 currentUser={id:found.id,user:found.user,role:found.role,name:found.name||found.user};
 sessionStorage.setItem(SESSION_KEY,JSON.stringify(currentUser));
 addLog('Login','Entrou no sistema');
 applyLogin();
}
function applyLogin(){
 $('#loginScreen').classList.add('hidden');
 $('#appShell').classList.remove('hidden');
 $('#userBadge').textContent=`${currentUser.name} · ${currentUser.role==='admin'?'Admin':'Regulador'}`;
 $$('.adminOnly').forEach(el=>el.style.display=isAdmin()?'':'none');
 $$('.adminOnlyCell').forEach(el=>el.style.display=isAdmin()?'':'none');
 renderUsersAdmin();
 showTab(routeTabFromLocation() || 'dashboard', true);
}
function logout(){if(currentUser) addLog('Logout','Saiu do sistema'); sessionStorage.removeItem(SESSION_KEY);currentUser=null;$('#appShell').classList.add('hidden');$('#loginScreen').classList.remove('hidden');$('#loginPass').value='';routeToLogin(true);}
$('#loginForm').onsubmit=e=>{e.preventDefault();login($('#loginUser').value.trim(),$('#loginPass').value)};

$('#btnLogout').onclick=logout;
const savedSession=loadRaw(SESSION_KEY)||loadRaw(OLD_SESSION_KEY); if(savedSession){currentUser=savedSession; setTimeout(applyLogin,0)}

$$('.tab').forEach(b=>b.onclick=()=>showTab(b.dataset.tab,true));
window.addEventListener('popstate',()=>{ if(currentUser) showTab(routeTabFromLocation() || 'dashboard', false); else routeToLogin(true); });
if(!currentUser) routeToLogin(false);

function initPriorityOptions(){
 const f=$('#fPrioridade');
 prioridades.forEach(p=>{const opt=document.createElement('option'); opt.value=p; opt.textContent=p; f.appendChild(opt);});
 const box=$('#prioridadeRadios');
 box.innerHTML=prioridades.map((p,i)=>`<label class="priorityItem ${prioridadesClasses[i]}"><input type="radio" name="prioridade" value="${esc(p)}" ${i===4?'checked':''}><span></span>${esc(p)}</label>`).join('');
}
initPriorityOptions();

function textItem(it){
 if(typeof it==='string') return it;
 return `${it.tipo} • ${it.codigo} - ${it.descricao}`;
}
function codeSearchText(c){return `${c.tipo} ${c.codigo} ${c.codigo?.replace(/\./g,'')} ${c.descricao}`;}
function setupAutocomplete(inputSel, sugSel, getItems, onPick, onAdd){
 const input=$(inputSel), box=$(sugSel);
 if(!input || !box) return;
 input.addEventListener('input',()=>{
  const q=norm(input.value), qc=compact(input.value); box.innerHTML='';
  if(!q && !qc){box.style.display='none';return}
  const items=getItems().filter(it=>{
   const text=typeof it==='string'?it:codeSearchText(it);
   return norm(text).includes(q) || compact(text).includes(qc);
  }).slice(0,50);
  items.forEach(it=>{const btn=document.createElement('button');btn.type='button';btn.textContent=textItem(it);btn.onclick=()=>{onPick(it);box.style.display='none'};box.appendChild(btn)});
  if(onAdd && input.value.trim()){const add=document.createElement('button');add.type='button';add.innerHTML=`➕ Cadastrar novo: <b>${esc(input.value.trim())}</b>`;add.onclick=()=>{onAdd(input.value.trim());box.style.display='none'};box.appendChild(add)}
  box.style.display=box.children.length?'block':'none';
 });
 document.addEventListener('click',e=>{if(!box.contains(e.target)&&e.target!==input)box.style.display='none'});
}
setupAutocomplete('#procedimento','#procSug',()=>procedimentos,v=>$('#procedimento').value=v,v=>{if(!procedimentos.some(p=>norm(p)===norm(v))){procedimentos.push(v);addLog('Base','Procedimento cadastrado pelo campo de busca: '+v);save();toast('Procedimento cadastrado.')}});
setupAutocomplete('#cid','#cidSug',()=>codigos,v=>$('#cid').value=textItem(v),null);
setupAutocomplete('#psf','#psfSug',()=>unidadesValente,v=>$('#psf').value=v,null);
setupAutocomplete('#fPsf','#fPsfSug',()=>unidadesValente,v=>{ $('#fPsf').value=v; renderFilas(); },null);
setupAutocomplete('#localMarcacao','#localSug',()=>locais,v=>$('#localMarcacao').value=v,v=>{if(!locais.some(l=>norm(l)===norm(v))){locais.push(v);addLog('Base','Local cadastrado pelo campo de busca: '+v);save();toast('Local cadastrado.')}});

function getPrioridade(){return document.querySelector('input[name="prioridade"]:checked')?.value || 'Não Classificado';}
function setPrioridade(value){
 const val=value||'Não Classificado';
 const radio=$$('[name="prioridade"]').find(r=>r.value===val) || $$('[name="prioridade"]').find(r=>r.value==='Não Classificado');
 if(radio) radio.checked=true;
}
function shouldShowStatusDetails(){return ['Marcado','Atendido'].includes($('#status')?.value)}
function toggleStatusDetails(){
 const box=$('#statusDetails'); if(!box) return;
 box.classList.toggle('hidden',!shouldShowStatusDetails());
 if(shouldShowStatusDetails() && !$('#dataMarcacao').value) $('#dataMarcacao').value=today();
 if(!shouldShowStatusDetails()){ $('#localMarcacao').value=''; $('#dataMarcacao').value=''; }
}
$('#status').addEventListener('change',toggleStatusDetails);

$('#pacienteForm').onsubmit=e=>{
 e.preventDefault();
 const id=$('#pacienteId').value || uid();
 const base={id,nome:$('#nome').value.trim(),cpf:$('#cpf').value.trim(),sus:$('#sus').value.trim(),nascimento:$('#nascimento').value,contato:$('#contato').value.trim(),procedimento:$('#procedimento').value.trim(),cid:$('#cid').value.trim(),acs:$('#acs').value.trim(),psf:$('#psf').value.trim(),dataSolicitacao:$('#dataSolicitacao').value||today(),localMarcacao:$('#localMarcacao').value.trim(),dataMarcacao:$('#dataMarcacao').value,prioridade:getPrioridade(),status:$('#status').value,obs:$('#obs').value.trim()};
 if(!base.nome) return toast('O nome é obrigatório.');
 pacientes=normalizePacientes(pacientes);
 const i=pacientes.findIndex(x=>String(x.id)===String(id));
 if(i>=0){
  const anterior=pacientes[i];
  pacientes[i]={...anterior,...base,atualizadoEm:new Date().toISOString(),operadorAtualizacao:actorName()};
  addLog('Edição',`Cadastro editado. Status: ${base.status || ''}. Procedimento: ${base.procedimento || ''}.`, anterior.nome || base.nome);
 }else{
  pacientes.push({...base,criadoEm:new Date().toISOString(),operadorCadastro:actorName()});
  addLog('Inclusão',`Cadastro incluído. Status: ${base.status || ''}. Procedimento: ${base.procedimento || ''}.`, base.nome);
 }
 save(); clearForm(); toast('Cadastro salvo com sucesso.'); $('.tab[data-tab="filas"]').click();
};$('#novoCadastro').onclick=clearForm;
function excluirPacienteAtual(){
 let id=String($('#pacienteId').value||'').trim();
 pacientes=normalizePacientes(pacientes);
 let idx=id ? pacientes.findIndex(p=>String(p.id)===id) : -1;

 // Segurança extra para cadastros abertos por versões antigas: tenta localizar pelo conteúdo exibido no formulário.
 if(idx<0){
  const nome=$('#nome').value.trim();
  const data=$('#dataSolicitacao').value;
  const sus=$('#sus').value.trim();
  const cpf=$('#cpf').value.trim();
  const proc=$('#procedimento').value.trim();
  idx=pacientes.findIndex(p=>
   nome && p.nome===nome &&
   (!data || p.dataSolicitacao===data) &&
   (!sus || p.sus===sus) &&
   (!cpf || p.cpf===cpf) &&
   (!proc || p.procedimento===proc)
  );
 }

 if(idx<0){toast('Cadastro não encontrado para excluir. Volte na fila, clique em Editar e tente novamente.'); return;}
 const alvo=pacientes[idx];
 if(confirm(`Excluir o cadastro de ${alvo?.nome||'paciente'}?`)){
  pacientes.splice(idx,1);
  addLog('Exclusão','Cadastro excluído pelo botão do cadastro.',alvo?.nome||'');
  save();
  clearForm();
  toast('Cadastro excluído.');
  $('.tab[data-tab="filas"]').click();
 }
}
$('#excluirCadastro').onclick=excluirPacienteAtual;
function clearForm(){['pacienteId','nome','cpf','sus','nascimento','contato','procedimento','cid','acs','psf','dataSolicitacao','localMarcacao','dataMarcacao','obs'].forEach(id=>$('#'+id).value='');setPrioridade('Não Classificado');$('#status').value='Aguardando';toggleStatusDetails();$('#excluirCadastro').disabled=true;$('#formTitle').textContent='Cadastro de paciente'}
function editPaciente(id){
 pacientes=normalizePacientes(pacientes);
 const p=pacientes.find(x=>String(x.id)===String(id));
 if(!p){toast('Cadastro não encontrado. Atualize a fila e tente novamente.'); return;}
 $('#pacienteId').value=String(p.id||id);
 ['nome','cpf','sus','nascimento','contato','procedimento','cid','acs','psf','dataSolicitacao','status','localMarcacao','dataMarcacao','obs'].forEach(k=>$('#'+k).value=p[k]||'');
 setPrioridade(p.prioridade);
 toggleStatusDetails();
 $('#excluirCadastro').disabled=false;
 $('#formTitle').textContent='Editar cadastro';
 $('.tab[data-tab="cadastro"]').click();
}
window.editPaciente=editPaciente;

function filtered(){
 const f={busca:norm($('#fBusca').value),proc:norm($('#fProc').value),cid:norm($('#fCid').value),psf:norm($('#fPsf').value),acs:norm($('#fAcs').value),pri:$('#fPrioridade').value,status:$('#fStatus').value};
 return pacientes.filter(p=>(!f.busca||norm([p.nome,p.sus,p.cpf,p.contato].join(' ')).includes(f.busca))&&(!f.proc||norm(p.procedimento).includes(f.proc))&&(!f.cid||norm(p.cid).includes(f.cid))&&(!f.psf||norm(p.psf).includes(f.psf))&&(!f.acs||norm(p.acs).includes(f.acs))&&(!f.pri||p.prioridade===f.pri)&&(!f.status||p.status===f.status)).sort((a,b)=>(a.dataSolicitacao||'').localeCompare(b.dataSolicitacao||''));
}
$$('#filas input,#filas select').forEach(el=>el.addEventListener('input',renderFilas));
$('#limparFiltros').onclick=()=>{$$('#filas input,#filas select').forEach(el=>el.value='');renderFilas()};
function priorityClass(p){
 if((p||'').includes('Prioridade 0')) return 'p0';
 if((p||'').includes('Prioridade 1')) return 'p1';
 if((p||'').includes('Prioridade 2')) return 'p2';
 if((p||'').includes('Prioridade 3')) return 'p3';
 return 'pn';
}
function renderFilas(){
 const tb=$('#filaTable tbody'); const rows=filtered(); const colspan=16;
 tb.innerHTML=rows.map((p,i)=>`<tr><td>${i+1}</td><td><b>${esc(p.nome)}</b></td><td>${esc(p.cpf)}</td><td>${esc(p.sus)}</td><td>${fmtDate(p.nascimento)}</td><td>${esc(p.contato)}</td><td>${esc(p.procedimento)}</td><td>${esc(p.cid)}</td><td>${esc(p.acs)}</td><td>${esc(p.psf)}</td><td>${fmtDate(p.dataSolicitacao)}</td><td>${esc(firstName(p.operadorCadastro||p.operadorCadastroNome||p.operadorAtualizacao))}</td><td>${esc(p.localMarcacao)}</td><td>${fmtDate(p.dataMarcacao)}</td><td><span class="tag ${priorityClass(p.prioridade)}">${esc(p.status||'')}</span><br><small>${esc(p.prioridade||'Não Classificado')}</small></td><td><button class="btn secondary" onclick="editPaciente('${p.id}')">Editar</button></td></tr>`).join('') || `<tr><td colspan="${colspan}">Nenhum cadastro encontrado.</td></tr>`;
}
function esc(s){return (s||'').toString().replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function escAttr(s){return esc(s).replace(/'/g,'&#39;')}
function fmtDate(d){if(!d)return''; const [y,m,day]=d.split('-'); return y&&m&&day?`${day}/${m}/${y}`:d}
function countBy(arr, key){return arr.reduce((acc,x)=>{const k=(x[key]||'Não informado').trim()||'Não informado';acc[k]=(acc[k]||0)+1;return acc},{})}
function renderBar(sel,obj){const el=$(sel); const entries=Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,8); if(!entries.length){el.textContent='Sem dados ainda.'; el.className='barList empty'; return} const max=Math.max(...entries.map(e=>e[1])); el.className='barList'; el.innerHTML=entries.map(([k,v])=>`<div class="barItem"><b title="${esc(k)}">${esc(k.slice(0,34))}</b><span class="bar"><i style="width:${(v/max)*100}%"></i></span><strong>${v}</strong></div>`).join('')}
function renderDashboard(){const ativos=pacientes.filter(p=>p.status!=='Cancelado'); $('#statTotal').textContent=ativos.length; $('#statAguardando').textContent=ativos.filter(p=>p.status==='Aguardando').length; $('#statUrgente').textContent=ativos.filter(p=>(p.prioridade||'').includes('Prioridade 0')||(p.prioridade||'').includes('Prioridade 1')||(p.prioridade||'')==='Urgente').length; $('#statHoje').textContent=ativos.filter(p=>p.dataSolicitacao===today()).length; renderBar('#chartProcedimentos',countBy(ativos,'procedimento')); renderBar('#chartPsf',countBy(ativos,'psf')); const st=countBy(ativos,'status'); $('#statusResumo').innerHTML=Object.entries(st).map(([k,v])=>`<span class="chip">${esc(k)}: ${v}</span>`).join('')||'<span class="chip">Sem dados</span>'}

function renderBases(){
 $('#unidadeCount').textContent=`Unidades cadastradas: ${unidadesValente.length}`;
 $('#unidadeList').innerHTML=unidadesValente.map(u=>`<li><span>${esc(u)}</span></li>`).join('');
 $('#procCount').textContent=`Procedimentos cadastrados: ${procedimentos.length}`;
 $('#procList').innerHTML=procedimentos.slice().sort((a,b)=>a.localeCompare(b,'pt-BR')).slice(0,220).map(p=>`<li><span>${esc(p)}</span><button class="btn ghost" onclick="removeProc('${encodeURIComponent(p)}')">Remover</button></li>`).join('')+(procedimentos.length>220?`<li>Mostrando 220 de ${procedimentos.length}. A busca usa todos.</li>`:'');
 const counts=codigos.reduce((acc,c)=>{acc[c.tipo]=(acc[c.tipo]||0)+1; return acc;},{});
 const resumo=Object.entries(counts).map(([k,v])=>`${k}: ${v}`).join(' · ');
 $('#cidCount').textContent=`Registros cadastrados: ${codigos.length}${resumo?' · '+resumo:''}`;
 $('#cidList').innerHTML=codigos.slice().sort((a,b)=>(a.tipo+a.codigo).localeCompare(b.tipo+b.codigo,'pt-BR')).slice(0,250).map(c=>`<li><span><b>${esc(c.tipo)} ${esc(c.codigo)}</b> - ${esc(c.descricao)}</span></li>`).join('')+(codigos.length>250?`<li>Mostrando 250 de ${codigos.length}. A busca usa todos.</li>`:'');
 $('#localCount').textContent=`Locais cadastrados: ${locais.length}`;
 $('#localList').innerHTML=locais.slice().sort((a,b)=>a.localeCompare(b,'pt-BR')).map(l=>`<li><span>${esc(l)}</span><button class="btn ghost" onclick="removeLocal('${encodeURIComponent(l)}')">Remover</button></li>`).join('');
}
window.removeProc=encoded=>{const item=decodeURIComponent(encoded); procedimentos=procedimentos.filter(p=>p!==item);addLog('Base','Procedimento removido: '+item);save()}
window.removeLocal=encoded=>{const item=decodeURIComponent(encoded); locais=locais.filter(l=>l!==item);addLog('Base','Local removido: '+item);save()}
$('#addProc').onclick=()=>{const v=$('#novoProcNome').value.trim(); if(v&&!procedimentos.some(p=>norm(p)===norm(v))){procedimentos.push(v);$('#novoProcNome').value='';addLog('Base','Procedimento adicionado: '+v);save();toast('Procedimento adicionado.')}};
$('#addCid').onclick=()=>{const tipo=$('#novoCodTipo').value; const codigo=$('#novoCidCod').value.trim().toUpperCase(); const descricao=$('#novoCidDesc').value.trim(); if(codigo&&descricao){addCodes([{tipo,codigo,descricao}]);$('#novoCidCod').value='';$('#novoCidDesc').value='';addLog('Base',`${tipo} adicionado: ${codigo} - ${descricao}`);save();toast('Registro adicionado.')}};
$('#addLocal').onclick=()=>{const v=$('#novoLocalNome').value.trim(); if(v&&!locais.some(l=>norm(l)===norm(v))){locais.push(v);$('#novoLocalNome').value='';addLog('Base','Local adicionado: '+v);save();toast('Local adicionado.')}};

function normalizeCode(c){return (c||'').toString().trim().toUpperCase().replace(/\s+/g,'').replace(/\.$/,'')}
function mergeCodes(arr){
 const map=new Map();
 arr.forEach(c=>{
  if(!c) return;
  const tipo=(c.tipo||'Motivo').toString().trim()||'Motivo';
  const codigo=normalizeCode(c.codigo);
  const descricao=(c.descricao||'').toString().trim();
  if(!codigo || !descricao) return;
  const key=tipo+'|'+compact(codigo);
  if(!map.has(key)) map.set(key,{tipo,codigo,descricao});
 });
 return Array.from(map.values());
}
function addCodes(newCodes){codigos=mergeCodes(codigos.concat(newCodes));}
function addProcedures(newProcs){
 const map=new Map(procedimentos.map(p=>[norm(p),p]));
 newProcs.forEach(p=>{p=(p||'').toString().trim(); if(p && !map.has(norm(p))) map.set(norm(p),p);});
 procedimentos=Array.from(map.values());
}
function splitLine(line){
 const sep=line.includes(';')?';':line.includes('\t')?'\t':line.includes('|')?'|':',';
 const out=[]; let cur='', inQuotes=false;
 for(let i=0;i<line.length;i++){
  const ch=line[i];
  if(ch==='"'){inQuotes=!inQuotes; continue;}
  if(ch===sep && !inQuotes){out.push(cur.trim()); cur=''; continue;}
  cur+=ch;
 }
 out.push(cur.trim()); return out;
}
function parseGenericCodes(text,tipo){
 const res=[];
 text.split(/\r?\n/).forEach(line=>{
  const clean=line.trim(); if(!clean) return;
  const parts=splitLine(clean).map(x=>x.replace(/^"|"$/g,'').trim());
  let code='', desc='';
  for(let i=0;i<Math.min(parts.length,4);i++){
   const p=parts[i].trim();
   if(!code && looksLikeCode(p,tipo)){code=p; desc=parts.slice(i+1).join(' ').trim(); break;}
  }
  if(!code){
   const m=clean.match(/^(?:"?)([A-Z][0-9]{2}[0-9A-Z.]?|[0-9]{10}|-[0-9]{2})(?:"?)[;\t,|\s]+(.+)$/i);
   if(m){code=m[1]; desc=m[2].replace(/^"|"$/g,'').trim();}
  }
  if(code && desc && !/descri|nome|codigo|c[oó]digo/i.test(code+desc.slice(0,20))) res.push({tipo,codigo:normalizeCode(code),descricao:desc});
 });
 return res;
}
function looksLikeCode(s,tipo){
 s=(s||'').trim().replace(/^"|"$/g,'');
 if(tipo==='SIGTAP') return /^[0-9]{10}$/.test(s);
 if(tipo==='CIAP-2') return /^[A-Z][0-9]{2}$/i.test(s) || /^-[0-9]{2}$/.test(s);
 if(tipo==='CID-10') return /^[A-Z][0-9]{2}[0-9A-Z.]?$/i.test(s);
 return !!s;
}
function parseSigtap(text){
 const codes=[], procs=[];
 text.split(/\r?\n/).forEach(line=>{
  if(!line.trim()) return;
  let codigo='', descricao='';
  const fixed=line.match(/^([0-9]{10})(.{3,260})/);
  if(fixed){codigo=fixed[1]; descricao=line.slice(10,260).trim();}
  if(!codigo){
   const parts=splitLine(line).map(x=>x.replace(/^"|"$/g,'').trim());
   const idx=parts.findIndex(p=>/^[0-9]{10}$/.test(p));
   if(idx>=0){codigo=parts[idx]; descricao=parts.slice(idx+1).join(' ').trim();}
  }
  if(codigo && descricao && !/CO_PROCEDIMENTO|NO_PROCEDIMENTO|PROCEDIMENTO/i.test(descricao)){
   const desc=descricao.replace(/\s+/g,' ').trim();
   codes.push({tipo:'SIGTAP',codigo,descricao:desc});
   procs.push(`${codigo} - ${desc}`);
  }
 });
 return {codes,procs};
}
function readFileText(file, cb){const r=new FileReader(); r.onload=()=>cb(r.result); r.readAsText(file,'ISO-8859-1');}
$('#importCidCsv').onchange=e=>{if(!isAdmin())return; const file=e.target.files[0]; if(!file)return; readFileText(file,text=>{const parsed=parseGenericCodes(text,'CID-10'); addCodes(parsed); addLog('Importação',`${parsed.length} CID-10 importado(s) do arquivo ${file.name}.`); save(); toast(`${parsed.length} CID-10 importado(s).`); e.target.value='';});};
function importSigtapFile(file, alsoProcedures=true){readFileText(file,text=>{const parsed=parseSigtap(text); addCodes(parsed.codes); if(alsoProcedures) addProcedures(parsed.procs); addLog('Importação',`${parsed.codes.length} SIGTAP importado(s) e ${parsed.procs.length} procedimento(s) do arquivo ${file.name}.`); save(); toast(`${parsed.codes.length} SIGTAP importado(s)${alsoProcedures?' e '+parsed.procs.length+' procedimento(s) adicionados':''}.`);});}
$('#importSigtap').onchange=e=>{if(!isAdmin())return; const file=e.target.files[0]; if(!file)return; importSigtapFile(file,true); e.target.value='';};
$('#importSigtapCodigos').onchange=e=>{if(!isAdmin())return; const file=e.target.files[0]; if(!file)return; importSigtapFile(file,true); e.target.value='';};
$('#importCiap').onchange=e=>{if(!isAdmin())return; const file=e.target.files[0]; if(!file)return; readFileText(file,text=>{const parsed=parseGenericCodes(text,'CIAP-2'); addCodes(parsed); addLog('Importação',`${parsed.length} CIAP-2 importado(s) do arquivo ${file.name}.`); save(); toast(`${parsed.length} CIAP-2 importado(s).`); e.target.value='';});};


function formatBytes(bytes){
 bytes=Number(bytes||0);
 if(bytes<1024) return bytes+' B';
 if(bytes<1024*1024) return (bytes/1024).toFixed(1).replace('.',',')+' KB';
 return (bytes/1024/1024).toFixed(1).replace('.',',')+' MB';
}
async function carregarBackupsRender(){
 if(!isAdmin() || !$('#backupTable')) return;
 const status=$('#backupRenderStatus');
 const tb=$('#backupTable tbody');
 if(!SERVER_SYNC_ENABLED){
  if(status) status.textContent='Backups do Render aparecem somente quando o sistema está publicado online.';
  tb.innerHTML='<tr><td colspan="5" class="mutedCell">Sistema aberto localmente. Sem consulta ao Render.</td></tr>';
  return;
 }
 try{
  if(status) status.textContent='Consultando backups salvos no Render...';
  const res=await fetch(`${CIS_API_BASE}/backups?limit=10`,{cache:'no-store'});
  if(!res.ok) throw new Error('HTTP '+res.status);
  const payload=await res.json();
  const backups=payload.backups||[];
  if(status) status.textContent=`${backups.length} backup(s) encontrado(s) no Render. Pasta: ${payload.pasta||''}`;
  tb.innerHTML=backups.length?backups.map(b=>`<tr><td>${esc(logTime(b.criadoEm))}</td><td><span class="tag">${esc(b.tipo)}</span></td><td class="logDetail">${esc(b.nome)}</td><td>${esc(formatBytes(b.tamanho))}</td><td><button class="btn secondary" type="button" onclick="baixarBackupRender('${escAttr(b.download_url||'')}')">Baixar</button></td></tr>`).join(''):'<tr><td colspan="5" class="mutedCell">Ainda não existe backup automático. Salve ou edite um cadastro para o sistema criar a primeira cópia.</td></tr>';
 }catch(err){
  console.warn('CIS: não foi possível carregar backups do Render.',err);
  if(status) status.textContent='Não foi possível consultar os backups do Render. Confira se o deploy atualizou o cis_routes.py.';
  tb.innerHTML='<tr><td colspan="5" class="mutedCell">Erro ao carregar backups do Render.</td></tr>';
 }
}
function baixarBackupRender(url){
 if(!url) return toast('Backup sem link de download.');
 window.open(url,'_blank');
}
window.baixarBackupRender=baixarBackupRender;
async function gerarBackupRender(){
 if(!isAdmin()) return;
 if(!SERVER_SYNC_ENABLED){toast('Backup no Render só funciona com o sistema publicado online.');return;}
 try{
  await saveStateToServer();
  window.open(`${CIS_API_BASE}/backup`,'_blank');
  addLog('Backup','Backup manual gerado no Render.');
  setTimeout(carregarBackupsRender,1200);
 }catch(err){
  toast('Não foi possível gerar backup no Render.');
 }
}
if($('#btnAtualizarBackups')) $('#btnAtualizarBackups').onclick=carregarBackupsRender;
if($('#btnBackupRender')) $('#btnBackupRender').onclick=gerarBackupRender;

$('#btnExportJson').onclick=()=>{if(!isAdmin())return; addLog('Backup','Backup completo exportado.'); download(`backup_cis_regulacao_${today()}.json`,JSON.stringify({versao:14,pacientes,procedimentos,codigos,locais,users:normalizeUsers(users),logs,geradoEm:new Date().toISOString()},null,2))};
$('#importJson').onchange=e=>{if(!isAdmin())return; const file=e.target.files[0]; if(!file)return; const r=new FileReader(); r.onload=()=>{try{const data=JSON.parse(r.result); pacientes=data.pacientes||[]; procedimentos=data.procedimentos||defaultProcedimentos; codigos=data.codigos||((data.cids||[]).map(c=>({tipo:'CID-10',codigo:c.codigo,descricao:c.descricao})))||defaultCodigos; locais=data.locais||defaultLocais; users=normalizeUsers(data.users||users); logs=data.logs||logs; addLog('Backup','Backup importado: '+file.name); save(); toast('Backup importado.')}catch{toast('Arquivo inválido.')}}; r.readAsText(file)};
$('#btnPublicJson').onclick=()=>{if(!isAdmin())return; addLog('Internet','Arquivo público JSON gerado.'); download('dados_publicos_cis_regulacao.json',JSON.stringify({atualizadoEm:new Date().toISOString(),dashboard:{total:pacientes.length,aguardando:pacientes.filter(p=>p.status==='Aguardando').length,riscoAlto:pacientes.filter(p=>(p.prioridade||'').includes('Prioridade 0')||(p.prioridade||'').includes('Prioridade 1')).length},filas:pacientes.map(({id,nome,cpf,sus,nascimento,contato,obs,operadorCadastro,operadorAtualizacao,...publico})=>publico)},null,2))};
$('#btnCsv').onclick=()=>{if(!isAdmin())return; const rows=filtered(); addLog('Exportação','CSV da fila exportado. Total: '+rows.length); const header=['Nome','CPF','SUS','Nascimento','Contato','Procedimento','CID/SIGTAP/CIAP/Motivo','ACS','PSF','Data Solicitacao','Operador','Local Marcacao/Atendimento','Data Marcacao/Atendimento','Prioridade','Status','Observacao']; const csv=[header,...rows.map(p=>[p.nome,p.cpf,p.sus,p.nascimento,p.contato,p.procedimento,p.cid,p.acs,p.psf,p.dataSolicitacao,firstName(p.operadorCadastro||p.operadorAtualizacao),p.localMarcacao,p.dataMarcacao,p.prioridade,p.status,p.obs])].map(r=>r.map(v=>'"'+(v||'').replace(/"/g,'""')+'"').join(';')).join('\n'); download(`fila_cis_regulacao_${today()}.csv`,csv,'text/csv;charset=utf-8')};

$('#btnPdf').onclick=()=>exportPdf();
function exportPdf(){
 const rows=filtered();
 addLog('Exportação','PDF da fila exportado. Total: '+rows.length);
 const filtros=[['Busca',$('#fBusca').value],['Procedimento',$('#fProc').value],['CID/SIGTAP/CIAP/Motivo',$('#fCid').value],['PSF',$('#fPsf').value],['ACS',$('#fAcs').value],['Prioridade',$('#fPrioridade').value],['Status',$('#fStatus').value]].filter(x=>x[1]);
 const filtroTxt=filtros.length?filtros.map(([k,v])=>`${k}: ${esc(v)}`).join(' · '):'Sem filtros aplicados';
 const html=`<!doctype html><html><head><meta charset="utf-8"><title>Fila CIS</title><style>
  @page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;color:#12303a;margin:0}.head{display:flex;align-items:center;justify-content:space-between;border-bottom:4px solid #1399a7;padding-bottom:10px;margin-bottom:12px}.head img{width:218px;height:auto}.title{text-align:right}.title h1{margin:0;color:#153f78;font-size:22px}.title p{margin:4px 0;color:#46636d;font-size:12px}.meta{background:#eef8fb;border:1px solid #d7edf2;border-radius:10px;padding:9px 11px;margin-bottom:12px;font-size:12px}.meta b{color:#153f78}table{width:100%;border-collapse:collapse;font-size:9.2px}th,td{border:1px solid #d8e5e9;padding:5px 4px;vertical-align:top}th{background:#153f78;color:white;text-align:left}.idx{width:28px;text-align:center}.status{font-weight:bold;color:#153f78}.footer{margin-top:12px;font-size:11px;color:#66808a;text-align:right}.empty{text-align:center;padding:22px}.water{position:fixed;right:12mm;bottom:12mm;opacity:.05;width:300px}</style></head><body>
  <div class="head"><img src="logo-cis.jpeg"><div class="title"><h1>Relatório de Fila de Regulação</h1><p>Central Integrada da Saúde · CIS</p></div></div>
  <div class="meta"><b>Data de emissão:</b> ${nowBR()} &nbsp; | &nbsp; <b>Operador:</b> ${esc(currentUser?.name||currentUser?.user||'Não identificado')} &nbsp; | &nbsp; <b>Total filtrado:</b> ${rows.length}<br><b>Filtros:</b> ${filtroTxt}</div>
  <table><thead><tr><th class="idx">#</th><th>Nome</th><th>CPF</th><th>SUS</th><th>Nasc.</th><th>Contato</th><th>Procedimento</th><th>CID/SIGTAP/CIAP/Motivo</th><th>ACS</th><th>PSF</th><th>Data sol.</th><th>Operador</th><th>Local</th><th>Data marc./atend.</th><th>Status/Prioridade</th></tr></thead><tbody>
  ${rows.length?rows.map((p,i)=>`<tr><td class="idx">${i+1}</td><td><b>${esc(p.nome)}</b></td><td>${esc(p.cpf)}</td><td>${esc(p.sus)}</td><td>${fmtDate(p.nascimento)}</td><td>${esc(p.contato)}</td><td>${esc(p.procedimento)}</td><td>${esc(p.cid)}</td><td>${esc(p.acs)}</td><td>${esc(p.psf)}</td><td>${fmtDate(p.dataSolicitacao)}</td><td>${esc(firstName(p.operadorCadastro||p.operadorAtualizacao))}</td><td>${esc(p.localMarcacao)}</td><td>${fmtDate(p.dataMarcacao)}</td><td class="status">${esc(p.status||'')}<br><small>${esc(p.prioridade||'Não Classificado')}</small></td></tr>`).join(''):`<tr><td colspan="15" class="empty">Nenhum cadastro encontrado.</td></tr>`}
  </tbody></table><div class="footer">Documento gerado pelo Sistema Local CIS · Regulação e Marcação</div>
  <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;
 const w=window.open('','_blank'); if(!w){toast('Permita pop-ups para gerar o PDF.'); return} w.document.write(html); w.document.close();
}


function renderUsersAdmin(){
 if(!isAdmin() || !$('#usuariosTable')) return;
 users=normalizeUsers(users);
 const tb=$('#usuariosTable tbody');
 tb.innerHTML=users.slice().sort((a,b)=>a.user.localeCompare(b.user,'pt-BR')).map(u=>{
  const perfil=u.role==='admin'?'Admin':'Regulador';
  const status=u.active!==false?'Ativo':'Inativo';
  return `<tr><td><b>${esc(u.name||u.user)}</b></td><td>${esc(u.user)}</td><td><span class="tag">${perfil}</span></td><td><span class="tag ${u.active!==false?'p2':'pn'}">${status}</span></td><td>${esc(logTime(u.updatedAt||u.createdAt))}</td><td><button class="btn secondary" type="button" onclick="editUsuario('${u.id}')">Editar</button></td></tr>`;
 }).join('') || '<tr><td colspan="6" class="mutedCell">Nenhum operador cadastrado.</td></tr>';
}
function clearUsuarioForm(){
 if(!$('#usuarioForm')) return;
 $('#usuarioId').value=''; $('#usuarioNome').value=''; $('#usuarioLogin').value=''; $('#usuarioSenha').value=''; $('#usuarioPerfil').value='regulador'; $('#usuarioAtivo').value='true';
 $('#usuarioForm').classList.add('hidden'); $('#excluirUsuario').disabled=true;
}
function showUsuarioForm(){ if(!isAdmin()) return; $('#usuarioForm').classList.remove('hidden'); $('#usuarioLogin').focus(); }
function editUsuario(id){
 if(!isAdmin()) return;
 users=normalizeUsers(users);
 const u=users.find(x=>x.id===id); if(!u) return;
 $('#usuarioId').value=u.id; $('#usuarioNome').value=u.name||u.user; $('#usuarioLogin').value=u.user; $('#usuarioSenha').value=u.pass; $('#usuarioPerfil').value=u.role; $('#usuarioAtivo').value=String(u.active!==false);
 $('#excluirUsuario').disabled=false; showUsuarioForm();
}
window.editUsuario=editUsuario;
function canRemoveOrDisableUser(targetId, makeInactive=false){
 const target=users.find(u=>u.id===targetId); if(!target) return false;
 if(target.role==='admin'){
  const activeAdmins=users.filter(u=>u.role==='admin' && u.active!==false && u.id!==targetId).length;
  if(makeInactive && activeAdmins<1){toast('Não é possível deixar o sistema sem nenhum Admin ativo.'); return false;}
  if(!makeInactive && activeAdmins<1){toast('Não é possível excluir o único Admin ativo.'); return false;}
 }
 return true;
}
if($('#btnNovoUsuario')) $('#btnNovoUsuario').onclick=()=>{clearUsuarioForm(); showUsuarioForm();};
if($('#cancelarUsuario')) $('#cancelarUsuario').onclick=clearUsuarioForm;
if($('#usuarioForm')) $('#usuarioForm').onsubmit=e=>{
 e.preventDefault(); if(!isAdmin()) return;
 users=normalizeUsers(users);
 const id=$('#usuarioId').value || uid();
 const user=$('#usuarioLogin').value.trim(); const pass=$('#usuarioSenha').value; const name=$('#usuarioNome').value.trim() || user; const role=$('#usuarioPerfil').value; const active=$('#usuarioAtivo').value==='true';
 if(!user || !pass) return toast('Login e senha são obrigatórios.');
 if(/\s/.test(user)) return toast('O login não pode ter espaço.');
 const repeated=users.find(u=>compact(u.user)===compact(user) && u.id!==id);
 if(repeated) return toast('Já existe operador com esse login.');
 const old=users.find(u=>u.id===id);
 if(old && old.role==='admin' && (role!=='admin' || active===false) && !canRemoveOrDisableUser(id,true)) return;
 const item={id,user,pass,name,role,active,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
 if(old) users=users.map(u=>u.id===id?item:u); else users.push(item);
 addLog('Usuários',`${old?'Operador editado':'Operador cadastrado'}: ${user} (${role==='admin'?'Admin':'Regulador'})${active?'':' - inativo'}`);
 persistAll(); renderUsersAdmin(); fillLogFilters(); clearUsuarioForm(); toast('Operador salvo.');
 if(currentUser?.id===id){currentUser={id:item.id,user:item.user,role:item.role,name:item.name}; sessionStorage.setItem(SESSION_KEY,JSON.stringify(currentUser)); applyLogin();}
};
if($('#excluirUsuario')) $('#excluirUsuario').onclick=()=>{
 if(!isAdmin()) return;
 const id=$('#usuarioId').value; if(!id) return;
 users=normalizeUsers(users);
 const u=users.find(x=>x.id===id); if(!u) return;
 if(currentUser?.id===id) return toast('Não exclua o operador que está logado agora. Crie outro Admin antes, se necessário.');
 if(!canRemoveOrDisableUser(id,false)) return;
 if(confirm(`Excluir o operador ${u.user}?`)){
  users=users.filter(x=>x.id!==id); addLog('Usuários','Operador excluído: '+u.user); persistAll(); renderUsersAdmin(); fillLogFilters(); clearUsuarioForm(); toast('Operador excluído.');
 }
};

function logTime(v){return v?new Date(v).toLocaleString('pt-BR'):''}
function fillLogFilters(){
 if(!isAdmin()||!$('#fLogUsuario')) return;
 const userSel=$('#fLogUsuario'), acaoSel=$('#fLogAcao');
 const userVal=userSel.value, acaoVal=acaoSel.value;
 const usuarios=Array.from(new Set([...logs.map(l=>l.usuario).filter(Boolean), ...normalizeUsers(users).map(u=>u.user)])).sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const acoes=Array.from(new Set(logs.map(l=>l.acao).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
 userSel.innerHTML='<option value="">Todos os operadores</option>'+usuarios.map(u=>`<option value="${esc(u)}">${esc(u)}</option>`).join('');
 acaoSel.innerHTML='<option value="">Todas as ações</option>'+acoes.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');
 userSel.value=userVal; acaoSel.value=acaoVal;
}
function filteredLogs(){
 if(!$('#fLogUsuario')) return logs;
 const usuario=$('#fLogUsuario').value, acao=$('#fLogAcao').value, busca=norm($('#fLogBusca').value);
 return logs.filter(l=>(!usuario||l.usuario===usuario)&&(!acao||l.acao===acao)&&(!busca||norm([l.usuario,l.perfil,l.acao,l.paciente,l.detalhes,logTime(l.quando)].join(' ')).includes(busca)));
}
function renderLog(){
 if(!isAdmin()||!$('#logTable')) return;
 fillLogFilters();
 const rows=filteredLogs().slice(0,800);
 const tb=$('#logTable tbody');
 tb.innerHTML=rows.map(l=>`<tr><td>${esc(logTime(l.quando))}</td><td><b>${esc(l.usuario)}</b></td><td>${esc(l.perfil)}</td><td><span class="tag">${esc(l.acao)}</span></td><td>${esc(l.paciente)}</td><td class="logDetail">${esc(l.detalhes)}</td></tr>`).join('') || '<tr><td colspan="6" class="mutedCell">Nenhum registro encontrado.</td></tr>';
}
['#fLogUsuario','#fLogAcao','#fLogBusca'].forEach(sel=>{const el=$(sel); if(el) el.addEventListener('input',renderLog);});
if($('#limparLog')) $('#limparLog').onclick=()=>{$('#fLogUsuario').value='';$('#fLogAcao').value='';$('#fLogBusca').value='';renderLog();};
if($('#btnLogCsv')) $('#btnLogCsv').onclick=()=>{if(!isAdmin())return; const rows=filteredLogs(); const header=['Data/Hora','Operador','Perfil','Ação','Paciente','Detalhes']; const csv=[header,...rows.map(l=>[logTime(l.quando),l.usuario,l.perfil,l.acao,l.paciente,l.detalhes])].map(r=>r.map(v=>'"'+(v||'').replace(/"/g,'""')+'"').join(';')).join('\n'); download(`log_cis_regulacao_${today()}.csv`,csv,'text/csv;charset=utf-8');};

function renderAll(){renderDashboard();renderFilas();renderBases();renderUsersAdmin();renderLog()}

initDataStorage();
