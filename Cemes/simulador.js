const area = document.getElementById('notifications');
function show() {
  let toast = document.getElementById('success-toast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'success-toast'; toast.className = 'toast toast-success'; toast.setAttribute('role','alert'); area.appendChild(toast); }
  toast.textContent = 'Solicitação agendada com sucesso.';
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; toast.textContent = ''; }, 5000);
}
document.getElementById('simulate').addEventListener('click', () => { document.getElementById('success-toast')?.remove(); show(); });
document.getElementById('repeat').addEventListener('click', show);
