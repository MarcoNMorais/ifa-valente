from __future__ import annotations

from functools import wraps

from flask import flash, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

from app import commit_with_backup, get_db, now_iso

_STARTS = ['Hoje, lembre-se de que sua presença tem valor.', 'Você não precisa resolver tudo de uma vez.', 'Seu ritmo também merece respeito.', 'Há força em pedir ajuda quando o peso fica grande.', 'Mesmo um dia difícil pode terminar de um jeito mais leve.', 'Você merece cuidado, inclusive de si para si.', 'Pequenos passos continuam sendo passos.', 'Sua história não termina em um momento difícil.', 'Respirar, parar e recomeçar também é seguir em frente.', 'Você é mais importante do que qualquer problema de hoje.', 'Há pessoas que podem caminhar ao seu lado.', 'Seu bem-estar importa e merece atenção.', 'Nem todo cansaço precisa ser enfrentado sozinho.', 'Dar nome ao que você sente pode abrir espaço para o cuidado.', 'Você pode escolher tratar-se com mais gentileza hoje.', 'Há coragem em reconhecer que você precisa de apoio.', 'Um momento difícil não define toda a sua vida.', 'Você merece ser ouvido com respeito e sem julgamento.', 'Cuide de você como cuidaria de alguém que ama.', 'Seu valor não diminui nos dias em que você não está bem.', 'Você pode começar o dia novamente a qualquer hora.', 'Há caminhos que aparecem quando dividimos o que estamos sentindo.', 'Você não precisa ter todas as respostas hoje.', 'Seu esforço de continuar já diz muita coisa sobre você.', 'É possível atravessar momentos difíceis com apoio e cuidado.']
_ENDS = ['Permita-se seguir um passo de cada vez.', 'Procure alguém de confiança e converse se precisar.', 'Reserve um instante para respirar e perceber como você está.', 'Você merece apoio, escuta e acolhimento.', 'Cuide do que está ao seu alcance agora.', 'Escolha uma pequena coisa que possa tornar seu dia mais leve.', 'Falar sobre o que sente pode ser o começo de uma mudança.', 'Não carregue sozinho aquilo que pode ser compartilhado.', 'Seu futuro pode guardar possibilidades que hoje ainda não aparecem.', 'Valorize cada avanço, mesmo os menores.', 'Se hoje estiver pesado, peça companhia para atravessar o dia.', 'Trate seus sentimentos com a mesma atenção que daria a alguém querido.', 'Uma conversa sincera pode fazer diferença.', 'Descansar também pode ser uma forma de cuidado.', 'Você não precisa provar força o tempo todo.', 'Recomeçar quantas vezes forem necessárias também faz parte da vida.', 'Procure apoio profissional quando sentir que precisa.', 'Há espaço para novos capítulos e novos encontros.', 'Seja paciente com o processo e gentil com você.', 'O importante agora pode ser apenas não enfrentar tudo sozinho.', 'Permita que alguém saiba como você realmente está.', 'Cuidar da mente é parte importante de cuidar da saúde.', 'Você merece tempo, apoio e oportunidade para se sentir melhor.', 'Hoje pode ser um bom dia para escolher o cuidado.']

DEFAULT_CAMPAIGN = 'SETEMBRO_AMARELO'


def _ensure_messages_table() -> None:
    db = get_db()
    db.execute('''CREATE TABLE IF NOT EXISTS message_campaigns (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        month_number INTEGER,
        active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS daily_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL UNIQUE COLLATE NOCASE,
        active INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'padrao',
        created_at TEXT NOT NULL)''')
    msg_cols = {row[1] for row in db.execute('PRAGMA table_info(daily_messages)').fetchall()}
    if 'campaign_slug' not in msg_cols:
        db.execute("ALTER TABLE daily_messages ADD COLUMN campaign_slug TEXT NOT NULL DEFAULT 'SETEMBRO_AMARELO'")
    db.execute('''CREATE TABLE IF NOT EXISTS message_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origem TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        accessed_at TEXT NOT NULL)''')
    access_cols = {row[1] for row in db.execute('PRAGMA table_info(message_access)').fetchall()}
    if 'campaign_slug' not in access_cols:
        db.execute("ALTER TABLE message_access ADD COLUMN campaign_slug TEXT NOT NULL DEFAULT 'SETEMBRO_AMARELO'")
    db.execute('CREATE INDEX IF NOT EXISTS idx_message_access_origem ON message_access(origem)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_message_access_visitor ON message_access(visitor_id)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_message_access_campaign ON message_access(campaign_slug)')

    stamp = now_iso()
    db.execute('''INSERT OR IGNORE INTO message_campaigns(slug,name,month_number,active,created_at)
                  VALUES(?,?,?,?,?)''', (DEFAULT_CAMPAIGN, 'Setembro Amarelo', 9, 1, stamp))
    if db.execute('SELECT COUNT(*) FROM message_campaigns WHERE active=1').fetchone()[0] == 0:
        db.execute('UPDATE message_campaigns SET active=1 WHERE slug=?', (DEFAULT_CAMPAIGN,))
    db.execute("UPDATE daily_messages SET campaign_slug=? WHERE campaign_slug IS NULL OR campaign_slug=''", (DEFAULT_CAMPAIGN,))
    db.execute("UPDATE message_access SET campaign_slug=? WHERE campaign_slug IS NULL OR campaign_slug=''", (DEFAULT_CAMPAIGN,))

    total = db.execute('SELECT COUNT(*) FROM daily_messages').fetchone()[0]
    if total == 0:
        rows = [(f'{start} {end}', 1, 'padrao', stamp, DEFAULT_CAMPAIGN) for start in _STARTS for end in _ENDS]
        db.executemany('INSERT OR IGNORE INTO daily_messages(text, active, source, created_at, campaign_slug) VALUES(?,?,?,?,?)', rows)
    db.commit()


def _active_campaign(db=None):
    db = db or get_db()
    row = db.execute('SELECT slug,name,month_number FROM message_campaigns WHERE active=1 ORDER BY month_number LIMIT 1').fetchone()
    if row:
        return row
    return {'slug': DEFAULT_CAMPAIGN, 'name': 'Setembro Amarelo', 'month_number': 9}


def _clean_origin(value: str | None) -> str:
    raw = (value or 'DIRETO').strip().upper()
    safe = ''.join(ch for ch in raw if ch.isalnum() or ch in '-_')[:60]
    return safe or 'DIRETO'


def mensagem_admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user_id = session.get('mensagem_admin_user_id')
        if not user_id:
            return redirect(url_for('mensagem_admin_login', next=request.path))
        user = get_db().execute('SELECT id, name, username, role, active FROM users WHERE id=?', (user_id,)).fetchone()
        if not user or not user['active'] or user['role'] != 'ADM':
            session.pop('mensagem_admin_user_id', None)
            return redirect(url_for('mensagem_admin_login'))
        return view(*args, **kwargs)
    return wrapped


def register_mensagem_routes(app) -> None:
    @app.get('/mensagem')
    def mensagem_do_dia():
        _ensure_messages_table()
        db = get_db()
        campaign = _active_campaign(db)
        rows = db.execute('SELECT id, text FROM daily_messages WHERE active=1 AND campaign_slug=? ORDER BY id', (campaign['slug'],)).fetchall()
        messages = [{'id': row['id'], 'text': row['text']} for row in rows]
        return render_template('mensagem_v2.html', messages=messages, total=len(messages), campaign=campaign)

    @app.get('/mensagem/registrar')
    def mensagem_registrar():
        _ensure_messages_table()
        origem = _clean_origin(request.args.get('origem'))
        visitor = (request.args.get('v') or '').strip()[:80]
        if 8 <= len(visitor) <= 80 and all(ch.isalnum() or ch in '-_' for ch in visitor):
            db = get_db()
            campaign = _active_campaign(db)
            db.execute('INSERT INTO message_access(origem, visitor_id, accessed_at, campaign_slug) VALUES(?,?,?,?)', (origem, visitor, now_iso(), campaign['slug']))
            db.commit()
        return ('', 204)

    @app.route('/mensagem/admin/login', methods=['GET', 'POST'])
    def mensagem_admin_login():
        if session.get('mensagem_admin_user_id'):
            return redirect(url_for('mensagem_admin'))
        error = None
        if request.method == 'POST':
            username = (request.form.get('username') or '').strip()
            password = request.form.get('password') or ''
            user = get_db().execute('SELECT id, name, username, password_hash, role, active FROM users WHERE username=? COLLATE NOCASE', (username,)).fetchone()
            if user and user['active'] and user['role'] == 'ADM' and check_password_hash(user['password_hash'], password):
                session['mensagem_admin_user_id'] = user['id']
                session['mensagem_admin_name'] = user['name']
                return redirect(url_for('mensagem_admin'))
            error = 'Usuário ou senha inválidos para o painel de mensagens.'
        return render_template('mensagem_admin_login.html', error=error)

    @app.get('/mensagem/admin/sair')
    def mensagem_admin_logout():
        session.pop('mensagem_admin_user_id', None)
        session.pop('mensagem_admin_name', None)
        return redirect(url_for('mensagem_admin_login'))

    @app.route('/mensagem/admin', methods=['GET', 'POST'])
    @mensagem_admin_required
    def mensagem_admin():
        _ensure_messages_table()
        db = get_db()
        campaign = _active_campaign(db)

        if request.method == 'POST':
            action = (request.form.get('action') or 'add').strip()
            if action == 'add':
                text = ' '.join((request.form.get('text') or '').split())
                if len(text) < 10:
                    flash('A frase precisa ter pelo menos 10 caracteres.', 'warning')
                elif len(text) > 320:
                    flash('A frase pode ter no máximo 320 caracteres.', 'warning')
                else:
                    try:
                        db.execute("INSERT INTO daily_messages(text, active, source, created_at, campaign_slug) VALUES(?,1,'manual',?,?)", (text, now_iso(), campaign['slug']))
                        commit_with_backup()
                        flash(f'Frase adicionada em {campaign["name"]}.', 'success')
                    except Exception:
                        db.rollback()
                        flash('Essa frase já existe.', 'warning')
            elif action == 'toggle':
                try:
                    message_id = int(request.form.get('id') or 0)
                    db.execute('UPDATE daily_messages SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=? AND campaign_slug=?', (message_id, campaign['slug']))
                    commit_with_backup()
                    flash('Status da frase atualizado.', 'success')
                except (TypeError, ValueError):
                    flash('Frase inválida.', 'danger')
            elif action == 'delete':
                try:
                    message_id = int(request.form.get('id') or 0)
                    row = db.execute('SELECT source FROM daily_messages WHERE id=? AND campaign_slug=?', (message_id, campaign['slug'])).fetchone()
                    if row and row['source'] == 'manual':
                        db.execute('DELETE FROM daily_messages WHERE id=?', (message_id,))
                        commit_with_backup()
                        flash('Frase manual removida.', 'success')
                    else:
                        flash('As frases padrão não são excluídas; você pode apenas desativá-las.', 'warning')
                except (TypeError, ValueError):
                    flash('Frase inválida.', 'danger')
            elif action == 'activate_campaign':
                slug = (request.form.get('campaign_slug') or '').strip().upper()
                exists = db.execute('SELECT 1 FROM message_campaigns WHERE slug=?', (slug,)).fetchone()
                if exists:
                    db.execute('UPDATE message_campaigns SET active=0')
                    db.execute('UPDATE message_campaigns SET active=1 WHERE slug=?', (slug,))
                    commit_with_backup()
                    flash('Campanha ativa alterada.', 'success')
                else:
                    flash('Campanha inválida.', 'danger')
            return redirect(url_for('mensagem_admin'))

        campaign = _active_campaign(db)
        campaigns = db.execute('''SELECT c.slug,c.name,c.month_number,c.active,
            COUNT(m.id) AS total_messages,
            SUM(CASE WHEN m.active=1 THEN 1 ELSE 0 END) AS active_messages
            FROM message_campaigns c LEFT JOIN daily_messages m ON m.campaign_slug=c.slug
            GROUP BY c.slug,c.name,c.month_number,c.active ORDER BY c.month_number''').fetchall()
        rows = db.execute('SELECT id, text, active, source, created_at FROM daily_messages WHERE campaign_slug=? ORDER BY source DESC, id DESC', (campaign['slug'],)).fetchall()
        stats = db.execute('''SELECT COUNT(*) AS total,
            SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN source='manual' THEN 1 ELSE 0 END) AS manual
            FROM daily_messages WHERE campaign_slug=?''', (campaign['slug'],)).fetchone()
        access_stats = db.execute('SELECT COUNT(*) AS acessos, COUNT(DISTINCT visitor_id) AS visitantes FROM message_access WHERE campaign_slug=?', (campaign['slug'],)).fetchone()
        today_stats = db.execute("SELECT COUNT(*) AS acessos, COUNT(DISTINCT visitor_id) AS visitantes FROM message_access WHERE campaign_slug=? AND date(accessed_at)=date('now','localtime')", (campaign['slug'],)).fetchone()
        origins = db.execute('''SELECT origem, COUNT(*) AS acessos, COUNT(DISTINCT visitor_id) AS visitantes,
            MAX(accessed_at) AS ultimo FROM message_access WHERE campaign_slug=?
            GROUP BY origem ORDER BY acessos DESC, origem''', (campaign['slug'],)).fetchall()
        return render_template('mensagem_admin.html', rows=rows, stats=stats, access_stats=access_stats,
            today_stats=today_stats, origins=origins, campaigns=campaigns, campaign=campaign,
            admin_name=session.get('mensagem_admin_name') or 'Administrador')
