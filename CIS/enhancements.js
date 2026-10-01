/* CIS v15. Dados clínicos no servidor; anexos somente na pasta escolhida. */
let cisRevision='', cisCsrf='', cisDirty=false, cisSaving=null, cisChange=0, cisConflict=false;
let attachmentRoot=null;
const syncPanel=document.createElement('aside');
syncPanel.style.cssText='position:sticky;top:0;z-index:30;padding:10px 18px;background:#edf6ff;color:#173653';
syncPanel.innerHTML='<span id="cisSync" role="status">Entre para carregar os dados.</span> <button id="cisRetry" type="button">Tentar salvar</button> <button id="cisPending" type="button">Exportar alterações pendentes</button>';
$('#appShell').prepend(syncPanel);
function syncMessage(message){$('#cisSync').textContent=message;}
async function cisRequest(path,options={}){
 const response=await fetch(CIS_API_BASE+path,{...options,cache:'no-store',headers:{'Content-Type':'application/json','X-CIS-CSRF':cisCsrf,...options.headers}});
 const result=await response.json();
 if(!response.ok){const error=new Error(result.erro||'Não foi possível completar a operação.');error.status=response.status;throw error;}
 return result;
}
// Nunca autenticar usando dados do navegador ou sincronizar automaticamente uma base antiga.
persistLocalOnly=function(){};
persistAll=function(){if(!currentUser)return;cisDirty=true;cisChange++;syncMessage('Alterações pendentes de gravação.');scheduleServerSave();};
scheduleServerSave=function(){if(!serverSyncReady||cisConflict)return;clearTimeout(serverSaveTimer);serverSaveTimer=setTimeout(saveStateToServer,450);};
saveStateToServer=async function(){
 clearTimeout(serverSaveTimer);
 if(cisSaving)return cisSaving;
 if(!currentUser||!serverSyncReady||cisConflict)return false;
 cisSaving=(async()=>{
  try{
   while(cisDirty){
    const change=cisChange; const payload=statePayload();
    syncMessage('Salvando no servidor…');
    const result=await cisRequest('/salvar',{method:'POST',headers:{'If-Match':cisRevision},body:JSON.stringify(payload)});
    cisRevision=result.revision;
    if(change===cisChange){users=normalizeUsers(result.users);cisDirty=false;}
   }
   serverStatus='online';syncMessage('Dados salvos no servidor.');return true;
  }catch(error){
   if(error.status===409)cisConflict=true;
   syncMessage('NÃO SALVO: '+error.message);toast(error.message);return false;
  }finally{cisSaving=null;}
 })();return cisSaving;
};
save=async function(){persistAll();renderAll();return await saveStateToServer();};
$('#cisRetry').onclick=saveStateToServer;
$('#cisPending').onclick=()=>{const data=statePayload();data.users=data.users.map(({pass,...u})=>u);download('cis-alteracoes-pendentes-'+today()+'.json',JSON.stringify(data,null,2));};
window.addEventListener('beforeunload',e=>{if(cisDirty){e.preventDefault();e.returnValue='';}});
login=async function(user,pass){
 try{
  const result=await cisRequest('/login',{method:'POST',body:JSON.stringify({user,pass})});
  cisCsrf=result.csrf;cisRevision=result.revision;currentUser=result.user;cisDirty=false;cisConflict=false;
  applyStatePayload(result.data);serverSyncReady=true;$('#loginPass').value='';applyLogin();syncMessage('Dados carregados do servidor.');
 }catch(error){toast(error.message);}
};
logout=async function(){
 if(cisDirty&&!await saveStateToServer())return;
 try{await cisRequest('/logout',{method:'POST',body:'{}'});}catch(error){return toast(error.message);}
 currentUser=null;pacientes=[];users=[];logs=[];serverSyncReady=false;cisCsrf='';attachmentRoot=null;
 $('#appShell').classList.add('hidden');$('#loginScreen').classList.remove('hidden');routeToLogin(true);
};
$('#btnLogout').onclick=logout;
initDataStorage=async function(){
 // Remove apenas caches antigos deste módulo; nunca toca no armazenamento de outros sistemas.
 [USERS_KEY,SESSION_KEY,OLD_USERS_KEY,OLD_SESSION_KEY].forEach(k=>{localStorage.removeItem(k);sessionStorage.removeItem(k);});
 pacientes=[];users=[];logs=[];currentUser=null;
 try{
  const auth=await cisRequest('/session');cisCsrf=auth.csrf;currentUser=auth.user;
  const result=await cisRequest('/dados');cisRevision=result.revision;applyStatePayload(result.data);serverSyncReady=true;applyLogin();syncMessage('Dados carregados do servidor.');
 }catch(error){if(error.status!==401)toast(error.message);}
};
$('#filaTable').addEventListener('click',e=>{
 const editButton=e.target.closest('[data-edit-paciente]');
 if(editButton){editPaciente(editButton.dataset.editPaciente);return;}
 const documentsButton=e.target.closest('[data-open-documents]');
 if(documentsButton){
  editPaciente(documentsButton.dataset.openDocuments);
  requestAnimationFrame(()=>{
   attachmentPanel.scrollIntoView({behavior:'smooth',block:'start'});
   $('#refreshCisFiles').focus();
  });
 }
});
$('#usuariosTable').addEventListener('click',e=>{const button=e.target.closest('[data-edit-usuario]');if(button)editUsuario(button.dataset.editUsuario);});
const importDetails=document.createElement('aside');importDetails.id='cisImportDetails';importDetails.style.cssText='padding:12px;margin:12px 0;background:#fff8e6;white-space:pre-wrap';
$('#pacienteForm').prepend(importDetails);
const editPacienteBase=editPaciente;
editPaciente=function(id){
 editPacienteBase(id);const patient=pacientes.find(p=>p.id===String(id));
 importDetails.textContent=patient?.fontesImportacao?.length?'Origem: '+patient.fontesImportacao.map(f=>f.arquivo+' · '+f.planilha+' · linha '+f.linha).join('\n'):'';
 if(patient?.possiveisCadastrosRelacionados?.length)importDetails.textContent+='\nConferir: há '+patient.possiveisCadastrosRelacionados.length+' outro(s) cadastro(s) com mesmo nome e SUS. Os pedidos foram preservados separadamente.';
};window.editPaciente=editPaciente;
const clearFormBase=clearForm;clearForm=function(){clearFormBase();importDetails.textContent='';if($('#cisAttachmentPatient'))$('#cisAttachmentPatient').textContent='Salve ou abra um cadastro para anexar documentos.';};$('#novoCadastro').onclick=clearForm;
// Os documentos não são incluídos em statePayload nem enviados por fetch.
const attachmentPanel=document.createElement('article');attachmentPanel.className='card';
attachmentPanel.innerHTML='<h3>Documentos e prescrições — pasta local / rede</h3><p id="cisAttachmentPatient">Abra um paciente pela fila para ver seus documentos.</p><p>Escolha a pasta CIS do computador principal. Nos outros computadores, escolha a mesma pasta compartilhada da rede. Use Chrome ou Edge. Os arquivos ficam somente nessa pasta.</p><button id="chooseCisFolder" class="btn secondary" type="button">Selecionar pasta dos documentos</button> <span id="cisFolderName">Nenhuma pasta selecionada</span><p><label>Tipo <select id="attachmentType"><option>Documento</option><option>Prescrição</option></select></label> <input id="cisFiles" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" /> <button id="addCisFiles" class="btn" type="button">Salvar arquivos na pasta</button> <button id="refreshCisFiles" class="btn secondary" type="button">Atualizar lista</button></p><div id="anexosLista">Salve ou abra um cadastro para anexar documentos.</div>';
$('#cadastro').append(attachmentPanel);
async function folderStore(value){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open('cis-pasta-anexos',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('config');
  req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{const db=req.result;const tx=db.transaction('config',value?'readwrite':'readonly');const store=tx.objectStore('config');const op=value?store.put(value,'pasta'):store.get('pasta');op.onsuccess=()=>{const result=op.result;tx.oncomplete=()=>{db.close();resolve(result);};};op.onerror=()=>reject(op.error);};
 });
}
$('#chooseCisFolder').onclick=async()=>{
 try{
  if(!window.showDirectoryPicker)throw new Error('Abra o CIS no Chrome ou Edge para usar a pasta compartilhada.');
  attachmentRoot=await window.showDirectoryPicker({id:'cis-documentos',mode:'readwrite'});
  await folderStore(attachmentRoot);$('#cisFolderName').textContent=attachmentRoot.name;await refreshAttachments();
 }catch(error){if(error.name!=='AbortError')toast(error.message);}
};
async function getPatientFolder(create=false){
 if(!currentUser)throw new Error('Entre no CIS.');
 const id=$('#pacienteId').value;
 if(!id||!pacientes.some(p=>p.id===id))throw new Error('Primeiro salve o cadastro e abra-o pela fila.');
 if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('Identificador do cadastro incompatível com a pasta.');
 attachmentRoot=attachmentRoot||await folderStore();
 if(!attachmentRoot)throw new Error('Selecione a pasta dos documentos.');
 if(await attachmentRoot.queryPermission({mode:'readwrite'})!=='granted' && await attachmentRoot.requestPermission({mode:'readwrite'})!=='granted')throw new Error('Permita o acesso à pasta selecionada.');
 $('#cisFolderName').textContent=attachmentRoot.name;
 return attachmentRoot.getDirectoryHandle(id,{create});
}
async function refreshAttachments(){
 const target=$('#anexosLista');target.replaceChildren();
 const patient=pacientes.find(item=>String(item.id)===String($('#pacienteId').value));
 $('#cisAttachmentPatient').textContent=patient?`Documentos de: ${patient.nome}`:'Salve ou abra um cadastro para anexar documentos.';
 try{
  const folder=await getPatientFolder();let count=0;
  for await(const [name,handle] of folder.entries()){
   if(handle.kind!=='file')continue;
   const line=document.createElement('p');const button=document.createElement('button');button.type='button';button.className='btn secondary';button.textContent='Abrir / baixar: '+name;
   button.onclick=async()=>{try{const file=await handle.getFile();const url=URL.createObjectURL(file);const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(error){toast('Pasta indisponível: '+error.message);}};
   line.append(button);target.append(line);count++;
  }
  if(!count)target.textContent='Nenhum documento nesta pasta de paciente.';
 }catch(error){target.textContent=error.name==='NotFoundError'?'Nenhum documento neste cadastro.':error.message;}
}
window.refreshAttachments=refreshAttachments;
$('#refreshCisFiles').onclick=refreshAttachments;
$('#addCisFiles').onclick=async()=>{
 const button=$('#addCisFiles');button.disabled=true;
 try{
  const files=Array.from($('#cisFiles').files);if(!files.length)throw new Error('Selecione os arquivos.');
  const folder=await getPatientFolder(true);
  for(const file of files){
   if(!/\.(pdf|jpe?g|png|webp|docx?)$/i.test(file.name))throw new Error('Tipo de arquivo não permitido: '+file.name);
   const name=$('#attachmentType').value+'_'+crypto.randomUUID()+'_'+file.name.replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').slice(-120);
   const handle=await folder.getFileHandle(name,{create:true});const writer=await handle.createWritable();
   try{await writer.write(file);await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}
  }
  $('#cisFiles').value='';toast('Arquivos salvos na pasta local / rede.');await refreshAttachments();
 }catch(error){toast('Falha ao salvar arquivo: '+error.message);}finally{button.disabled=false;}
};
// Importação de lote previamente conferido: inclusão, nunca restauração do banco inteiro.
const importPanel=document.createElement('article');importPanel.className='card';
importPanel.innerHTML='<h3>Importar pacientes em lote</h3><p>Selecione um lote JSON conferido. Cadastros com a mesma chave de importação são ignorados. Os pacientes atuais são preservados.</p><input id="cisImportBatch" type="file" accept=".json"><button id="cisImportConfirm" type="button" class="btn" disabled>Importar lote conferido</button><p id="cisImportSummary"></p>';
$('#admin').append(importPanel);
let pendingBatch=[];
$('#cisImportBatch').onchange=async e=>{
 pendingBatch=[];$('#cisImportConfirm').disabled=true;
 try{
  const data=JSON.parse(await e.target.files[0].text());
  if(data.tipo!=='cis-importacao-v1'||!Array.isArray(data.pacientes))throw new Error('Use um lote de importação CIS, não um backup.');
  if(data.pacientes.some(p=>!p.nome||!p.importKey||!p.id))throw new Error('Lote contém registros inválidos.');
  const existing=new Set(pacientes.map(p=>p.importKey).filter(Boolean));const ids=new Set(pacientes.map(p=>p.id));
  pendingBatch=data.pacientes.filter(p=>{if(existing.has(p.importKey)||ids.has(p.id))return false;existing.add(p.importKey);ids.add(p.id);return true;});
  $('#cisImportSummary').textContent=pendingBatch.length+' novos registros; '+(data.pacientes.length-pendingBatch.length)+' já presentes.';
  $('#cisImportConfirm').disabled=!pendingBatch.length;
 }catch(error){$('#cisImportSummary').textContent=error.message;}
};
$('#cisImportConfirm').onclick=async()=>{
 if(!isAdmin()||!pendingBatch.length)return;
 $('#cisImportConfirm').disabled=true;pacientes.push(...pendingBatch);pendingBatch=[];
 if(await save())$('#cisImportSummary').textContent='Importação salva no servidor.';
};
// O arquivo público contém somente totais agregados.
$('#btnPublicJson').onclick=()=>{if(isAdmin())download('cis-totais.json',JSON.stringify({total:pacientes.length,status:countBy(pacientes,'status')},null,2));};
initDataStorage();
