from __future__ import annotations

from flask import flash, redirect, render_template, request, url_for

from app import admin_required, commit_with_backup, get_db, now_iso

_STARTS = ['Hoje, lembre-se de que sua presença tem valor.', 'Você não precisa resolver tudo de uma vez.', 'Seu ritmo também merece respeito.', 'Há força em pedir ajuda quando o peso fica grande.', 'Mesmo um dia difícil pode terminar de um jeito mais leve.', 'Você merece cuidado, inclusive de si para si.', 'Pequenos passos continuam sendo passos.', 'Sua história não termina em um momento difícil.', 'Respirar, parar e recomeçar também é seguir em frente.', 'Você é mais importante do que qualquer problema de hoje.', 'Há pessoas que podem caminhar ao seu lado.', 'Seu bem-estar importa e merece atenção.', 'Nem todo cansaço precisa ser enfrentado sozinho.', 'Dar nome ao que você sente pode abrir espaço para o cuidado.', 'Você pode escolher tratar-se com mais gentileza hoje.', 'Há coragem em reconhecer que você precisa de apoio.', 'Um momento difícil não define toda a sua vida.', 'Você merece ser ouvido com respeito e sem julgamento.', 'Cuide de você como cuidaria de alguém que ama.', 'Seu valor não diminui nos dias em que você não está bem.', 'Você pode começar o dia novamente a qualquer hora.', 'Há caminhos que aparecem quando dividimos o que estamos sentindo.', 'Você não precisa ter todas as respostas hoje.', 'Seu esforço de continuar já diz muita coisa sobre você.', 'É possível atravessar momentos difíceis com apoio e cuidado.']
_ENDS = ['Permita-se seguir um passo de cada vez.', 'Procure alguém de confiança e converse se precisar.', 'Reserve um instante para respirar e perceber como você está.', 'Você merece apoio, escuta e acolhimento.', 'Cuide do que está ao seu alcance agora.', 'Escolha uma pequena coisa que possa tornar seu dia mais leve.', 'Falar sobre o que sente pode ser o começo de uma mudança.', 'Não carregue sozinho aquilo que pode ser compartilhado.', 'Seu futuro pode guardar possibilidades que hoje ainda não aparecem.', 'Valorize cada avanço, mesmo os menores.', 'Se hoje estiver pesado, peça companhia para atravessar o dia.', 'Trate seus sentimentos com a mesma atenção que daria a alguém querido.', 'Uma conversa sincera pode fazer diferença.', 'Descansar também pode ser uma forma de cuidado.', 'Você não precisa provar força o tempo todo.', 'Recomeçar quantas vezes forem necessárias também faz parte da vida.', 'Procure apoio profissional quando sentir que precisa.', 'Há espaço para novos capítulos e novos encontros.', 'Seja paciente com o processo e gentil com você.', 'O importante agora pode ser apenas não enfrentar tudo sozinho.', 'Permita que alguém saiba como você realmente está.', 'Cuidar da mente é parte importante de cuidar da saúde.', 'Você merece tempo, apoio e oportunidade para se sentir melhor.', 'Hoje pode ser um bom dia para escolher o cuidado.']


def _ensure_messages_table() -> None:
    db = get_db()
    db.execute('''CREATE TABLE IF NOT EXISTS daily_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL UNIQUE COLLATE NOCASE,
        active INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'padrao',
        created_at TEXT NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS message_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origem TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        accessed_at TEXT NOT NULL)''')
    db.execute('CREATE INDEX IF NOT EXISTS idx_message_access_origem ON message_access(origem)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_message_access_visitor ON message_access(visitor_id)')
    total = db.execute('SELECT COUNT(*) FROM daily_messages').fetchone()[0]
    if total == 0:
        stamp = now_iso()
        rows = [(f'{start} {end}', 1, 'padrao', stamp) for start in _STARTS for end in _ENDS]
        db.executemany('INSERT OR IGNORE INTO daily_messages(text, active, source, created_at) VALUES(?,?,?,?)', rows)
    db.commit()


def _clean_origin(value: str | None) -> str:
    raw = (value or 'DIRETO').strip().upper()
    safe = ''.join(ch for ch in raw if ch.isalnum() or ch in '-_')[:60]
    return safe or 'DIRETO'


def register_mensagem_routes(app) -> None:
    @app.get('/mensagem')
    def mensagem_do_dia():
        _ensure_messages_table()
        rows = get_db().execute('SELECT id, text FROM daily_messages WHERE active=1 ORDER BY id').fetchall()
        messages = [{'id': row['id'], 'text': row['text']} for row in rows]
        return render_template('mensagem_v2.html', messages=messages, total=len(messages))

    @app.get('/mensagem/registrar')
    def mensagem_registrar():
        _ensure_messages_table()
        origem = _clean_origin(request.args.get('origem'))
        visitor = (request.args.get('v') or '').strip()[:80]
        if 8 <= len(visitor) <= 80 and all(ch.isalnum() or ch in '-_' for ch in visitor):
            db = get_db()
            db.execute('INSERT INTO message_access(origem, visitor_id, accessed_at) VALUES(?,?,?)', (origem, visitor, now_iso()))
            db.commit()
        return ('', 204)

    @app.route('/mensagem/admin', methods=['GET', 'POST'])
    @admin_required
    def mensagem_admin():
        _ensure_messages_table()
        db = get_db()

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
                        db.execute("INSERT INTO daily_messages(text, active, source, created_at) VALUES(?,1,'manual',?)", (text, now_iso()))
                        commit_with_backup()
                        flash('Frase adicionada com sucesso.', 'success')
                    except Exception:
                        db.rollback()
                        flash('Essa frase já existe.', 'warning')
            elif action == 'toggle':
                try:
                    message_id = int(request.form.get('id') or 0)
                    db.execute('UPDATE daily_messages SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?', (message_id,))
                    commit_with_backup()
                    flash('Status da frase atualizado.', 'success')
                except (TypeError, ValueError):
                    flash('Frase inválida.', 'danger')
            elif action == 'delete':
                try:
                    message_id = int(request.form.get('id') or 0)
                    row = db.execute('SELECT source FROM daily_messages WHERE id=?', (message_id,)).fetchone()
                    if row and row['source'] == 'manual':
                        db.execute('DELETE FROM daily_messages WHERE id=?', (message_id,))
                        commit_with_backup()
                        flash('Frase manual removida.', 'success')
                    else:
                        flash('As frases padrão não são excluídas; você pode apenas desativá-las.', 'warning')
                except (TypeError, ValueError):
                    flash('Frase inválida.', 'danger')
            return redirect(url_for('mensagem_admin'))

        rows = db.execute('SELECT id, text, active, source, created_at FROM daily_messages ORDER BY source DESC, id DESC').fetchall()
        stats = db.execute('''SELECT COUNT(*) AS total,
            SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN source='manual' THEN 1 ELSE 0 END) AS manual
            FROM daily_messages''').fetchone()
        access_stats = db.execute('''SELECT COUNT(*) AS acessos,
            COUNT(DISTINCT visitor_id) AS visitantes
            FROM message_access''').fetchone()
        today_stats = db.execute("SELECT COUNT(*) AS acessos, COUNT(DISTINCT visitor_id) AS visitantes FROM message_access WHERE date(accessed_at)=date('now','localtime')").fetchone()
        origins = db.execute('''SELECT origem, COUNT(*) AS acessos,
            COUNT(DISTINCT visitor_id) AS visitantes,
            MAX(accessed_at) AS ultimo
            FROM message_access GROUP BY origem ORDER BY acessos DESC, origem''').fetchall()
        return render_template('mensagem_admin.html', rows=rows, stats=stats, access_stats=access_stats, today_stats=today_stats, origins=origins)
