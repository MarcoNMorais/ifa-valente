"""Autenticação e gravação concorrente, exclusivamente para o CIS."""
import copy
import hashlib
import json
import os
import secrets
import threading
import time
from urllib.parse import urlsplit
from contextlib import contextmanager
from datetime import datetime
from flask import g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

SYSTEMS = ['Policlínica', 'IDS', 'SRA', 'Lista Única']

def install_security(app, root, read_state, write_state):
    lock = threading.RLock()
    failures = {}

    @contextmanager
    def transaction():
        root.mkdir(parents=True, exist_ok=True)
        with lock, (root / 'cis.lock').open('a+b') as handle:
            if os.name == 'nt':
                import msvcrt
                handle.seek(0, 2)
                if not handle.tell():
                    handle.write(b'0'); handle.flush()
                handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == 'nt':
                    handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle, fcntl.LOCK_UN)

    def revision(data):
        content = {k:v for k,v in data.items() if k not in ('logs','atualizadoEm')}
        return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def public_user(u):
        return {k:v for k,v in u.items() if k not in ('pass', 'senha', 'password_hash')}

    def public_state(data):
        result = copy.deepcopy(data)
        result['users'] = [public_user(u) for u in data['users']] if g.cis_user['role'] == 'admin' else []
        if g.cis_user['role'] != 'admin':
            result['logs'] = []
        return result

    def current(data):
        return next((u for u in data['users'] if u.get('id') == session.get('cis_user_id') and u.get('active', True)
                     and u.get('auth_version', 0) == session.get('cis_auth_version', 0)), None)

    def audit(data, action, detail):
        data['logs'].insert(0, dict(id=secrets.token_hex(12), quando=datetime.now().isoformat(),
            usuario=g.cis_user['user'], perfil=g.cis_user['role'], acao=action, detalhes=detail, paciente=''))
        data['logs'] = data['logs'][:5000]

    @app.before_request
    def cis_guard():
        if not request.path.startswith('/api/cis/'):
            return
        if request.path in ('/api/cis/login', '/api/cis/recover-admin-20260930'):
            origin = request.headers.get('Origin')
            if origin and (urlsplit(origin).scheme not in ('http','https') or urlsplit(origin).netloc != request.host):
                return jsonify(ok=False, erro='Origem inválida'), 403
            return
        try:
            with transaction():
                g.cis_user = current(read_state())
            if not g.cis_user:
                return jsonify(ok=False, erro='Entre no CIS para continuar.'), 401
            if request.method != 'GET' and not secrets.compare_digest(request.headers.get('X-CIS-CSRF', ''), session.get('cis_csrf', '!')):
                return jsonify(ok=False, erro='Sessão expirada. Entre novamente.'), 403
            if any(p in request.path for p in ('/backup', '/status', '/importar')) and g.cis_user['role'] != 'admin':
                return jsonify(ok=False, erro='Acesso exclusivo do administrador.'), 403
        except (ValueError, OSError):
            app.logger.exception('Falha ao ler banco CIS')
            return jsonify(ok=False, erro='Banco CIS indisponível. Dados preservados; contate o administrador.'), 503

    @app.after_request
    def cis_headers(response):
        if request.path.startswith('/api/cis/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    def login():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify(ok=False, erro='JSON inválido'), 400
        key = request.remote_addr or 'unknown'
        now = time.monotonic()
        with lock:
            failures[key] = [t for t in failures.get(key, []) if now-t < 300]
            if len(failures[key]) >= 15:
                return jsonify(ok=False, erro='Muitas tentativas. Aguarde cinco minutos.'), 429
            failures[key].append(now)
        with transaction():
            state = read_state()
            user = next((u for u in state['users'] if str(u.get('user', '')).strip().casefold() == str(data.get('user', '')).strip().casefold() and u.get('active', True)), None)
            password = str(data.get('pass', ''))
            valid = user and (check_password_hash(user['password_hash'], password) if user.get('password_hash') else
                              bool(user.get('pass')) and secrets.compare_digest(str(user['pass']), password))
            if not valid:
                return jsonify(ok=False, erro='Usuário ou senha inválidos.'), 401
            for item in state['users']:
                if item.get('pass'):
                    item['password_hash'] = generate_password_hash(str(item.pop('pass')))
                item.pop('senha', None)
            g.cis_user = user
            session['cis_user_id'] = user['id']
            session['cis_auth_version'] = user.get('auth_version', 0)
            session['cis_csrf'] = secrets.token_urlsafe(32)
            audit(state, 'Login', 'Autenticação no servidor')
            state = write_state(state)
            failures.pop(key, None)
            return jsonify(ok=True, user=public_user(user), csrf=session['cis_csrf'], data=public_state(state), revision=revision(state))

    def recover_admin_once():
        """Token de uso único, de curta duração, removido do código após a recuperação."""
        data = request.get_json(silent=True) or {}
        proof = str(data.get('proof', ''))
        digest = hashlib.sha256(('cis-v15-recovery-20260930|' + proof).encode()).hexdigest()
        expected = 'eccec4b79f4c0cbf24b3288c38d9ba86846fe30a0a80bf58116838b6a0402a51'
        if datetime.now().astimezone().isoformat() > '2026-09-30T23:59:59-03:00':
            return jsonify(ok=False, erro='Token de recuperação expirado.'), 410
        if not secrets.compare_digest(digest, expected) or len(proof) < 8:
            return jsonify(ok=False, erro='Prova de recuperação inválida.'), 401
        with transaction():
            state = read_state()
            if any(log.get('acao') == 'Recuperação de administrador v15 concluída' for log in state['logs']):
                return jsonify(ok=False, erro='Token de recuperação já utilizado.'), 410
            user = next((u for u in state['users'] if str(u.get('user', '')).strip().casefold() == 'admin'), None)
            if not user:
                return jsonify(ok=False, erro='Administrador não encontrado.'), 404
            user['role'] = 'admin'; user['active'] = True
            user['password_hash'] = generate_password_hash(proof)
            user.pop('pass', None); user.pop('senha', None)
            user['auth_version'] = user.get('auth_version', 0) + 1
            state['logs'].insert(0, dict(id=secrets.token_hex(12), quando=datetime.now().isoformat(),
                usuario='recuperacao-segura', perfil='sistema', acao='Recuperação de administrador v15 concluída',
                detalhes='Credencial do administrador restaurada a partir do backup autorizado.', paciente=''))
            write_state(state)
        return jsonify(ok=True)

    def auth_session():
        return jsonify(ok=True, user=public_user(g.cis_user), csrf=session['cis_csrf'])

    def logout():
        for key in ('cis_user_id', 'cis_auth_version', 'cis_csrf'):
            session.pop(key, None)
        return jsonify(ok=True)

    def dados():
        with transaction():
            state = read_state()
            return jsonify(ok=True, data=public_state(state), revision=revision(state))

    def salvar():
        data = request.get_json(silent=True)
        keys = ('pacientes','procedimentos','codigos','locais','users','logs')
        if not isinstance(data, dict) or any(not isinstance(data.get(k), list) for k in keys):
            return jsonify(ok=False, erro='Estrutura de dados inválida.'), 400
        with transaction():
            old = read_state()
            actor = current(old)
            if not actor:
                return jsonify(ok=False, erro='Sessão inválida'), 401
            if request.headers.get('If-Match') != revision(old):
                return jsonify(ok=False, erro='Outro computador alterou os dados. Exporte as alterações pendentes e recarregue antes de salvar.'), 409
            state = {k:copy.deepcopy(data[k]) for k in keys}
            ids = [p.get('id') for p in state['pacientes'] if isinstance(p, dict)]
            if len(ids) != len(state['pacientes']) or any(not isinstance(i,str) or not i for i in ids) or len(set(ids)) != len(ids):
                return jsonify(ok=False, erro='Identificadores de pacientes inválidos ou repetidos.'), 400
            for p in state['pacientes']:
                if any(not isinstance(p.get(k,''),str) for k in ('nome','cpf','sus','nascimento','contato','procedimento','cid','acs','psf','dataSolicitacao','dataMarcacao','localMarcacao','status','prioridade','obs')):
                    return jsonify(ok=False, erro='Os campos do paciente devem ser texto.'), 400
                if not isinstance(p.get('sistemas', []), list) or any(s not in SYSTEMS for s in p.get('sistemas', [])):
                    return jsonify(ok=False, erro='Sistema de lançamento inválido.'), 400
            if actor['role'] != 'admin':
                for k in ('users','procedimentos','codigos','locais'):
                    state[k] = old[k]
            else:
                previous = {u['id']:u for u in old['users']}
                names, user_ids = set(), set()
                for u in state['users']:
                    if not isinstance(u,dict) or not isinstance(u.get('id'),str) or not u.get('id') or not isinstance(u.get('user'),str) or not u.get('user','').strip() or u.get('role') not in ('admin','regulador') or not isinstance(u.get('active',True),bool):
                        return jsonify(ok=False, erro='Operador inválido.'), 400
                    name = str(u['user']).strip().casefold()
                    if name in names or u['id'] in user_ids:
                        return jsonify(ok=False, erro='Login ou identificador repetido.'), 400
                    names.add(name); user_ids.add(u['id'])
                    before = previous.get(u['id'], {})
                    password = u.pop('pass', '')
                    u.pop('senha', None); u.pop('password_hash', None)
                    if password:
                        if not isinstance(password,str) or len(password) < 8:
                            return jsonify(ok=False, erro='Novas senhas precisam de pelo menos 8 caracteres.'), 400
                        u['password_hash'] = generate_password_hash(password)
                    elif before.get('password_hash'):
                        u['password_hash'] = before['password_hash']
                    elif before.get('pass'):
                        u['password_hash'] = generate_password_hash(before['pass'])
                    else:
                        return jsonify(ok=False, erro='Informe uma senha para o novo operador.'), 400
                    changed = bool(password) or any(before.get(k) != u.get(k) for k in ('role','active','user'))
                    u['auth_version'] = before.get('auth_version', 0) + int(changed)
                if not any(u.get('active', True) and u['role']=='admin' for u in state['users']):
                    return jsonify(ok=False, erro='Mantenha pelo menos um administrador ativo.'), 400
            state['logs'] = old['logs']
            audit(state, 'Gravação', f"{len(state['pacientes'])} cadastros; gravação autenticada")
            saved = write_state(state)
            own = next((u for u in saved['users'] if u['id']==actor['id']), None)
            if own:
                session['cis_auth_version'] = own.get('auth_version', 0)
            return jsonify(ok=True, revision=revision(saved), atualizadoEm=saved['atualizadoEm'],
                           users=[public_user(u) for u in saved['users']] if actor['role']=='admin' else [])

    for endpoint, func in [('api_cis_dados',dados),('api_cis_salvar',salvar)]:
        app.view_functions[endpoint] = func
    for url, func, methods in [('/login',login,['POST']),('/session',auth_session,['GET']),('/logout',logout,['POST']),
                               ('/recover-admin-20260930',recover_admin_once,['POST'])]:
        app.add_url_rule('/api/cis'+url, 'cis_secure'+url, func, methods=methods)
