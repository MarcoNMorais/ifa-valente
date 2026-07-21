from __future__ import annotations

import csv
import io
import json
import os
import re
import secrets
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from functools import wraps
from pathlib import Path
from typing import Any

from flask import (
    Flask,
    Response,
    abort,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("IFA_DATA_DIR", BASE_DIR / "data"))
BACKUP_DIR = Path(os.environ.get("IFA_BACKUP_DIR", DATA_DIR / "backups"))
AUTO_BACKUP_DIR = BACKUP_DIR / "auto"
MANUAL_BACKUP_DIR = BACKUP_DIR / "manual"
DATABASE = DATA_DIR / "ifa_valente.db"

for folder in (DATA_DIR, AUTO_BACKUP_DIR, MANUAL_BACKUP_DIR):
    folder.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", "troque-esta-chave-em-producao-ifa-valente-2026"),
    MAX_CONTENT_LENGTH=25 * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",
)


OFFICIAL_UNITS = [
    "USF Casas Populares",
    "USF Centro",
    "USF Cidade Nova",
    "USF Juazeiro Petrolina",
    "USF Queimada do Curral",
    "USF Santa Rita de Cássia",
    "USF Tanquinho",
    "USF Valilândia",
    "USF Junco",
    "USF Dr. Antônio Delfino Mota – Simões",
]

INDICATORS = [
    {
        "code": "ACS_CAD_GERAL",
        "category": "ACS",
        "name": "Cadastro individual e domiciliar conforme estimativa da microárea",
        "description": "Percentual de Cadastro Individual e Domiciliar no SISAB de acordo com a estimativa da população da microárea.",
        "order": 1,
    },
    {
        "code": "ACS_CAD_INDIV_ATUAL",
        "category": "ACS",
        "name": "Cadastro individual atualizado anualmente",
        "description": "Percentual de Cadastro Individual no SISAB atualizado anualmente.",
        "order": 2,
    },
    {
        "code": "ACS_CAD_DOM_ATUAL",
        "category": "ACS",
        "name": "Cadastro domiciliar atualizado anualmente",
        "description": "Percentual de Cadastro Domiciliar no SISAB atualizado anualmente.",
        "order": 3,
    },
    {
        "code": "ACS_VISITAS_GERAIS",
        "category": "ACS",
        "name": "Visitas domiciliares registradas",
        "description": "Número de visitas domiciliares realizadas e registradas no SISAB em relação à estimativa populacional da microárea.",
        "order": 4,
    },
    {
        "code": "ACS_VISITAS_CRIANCAS",
        "category": "ACS",
        "name": "Visitas a crianças menores de 2 anos",
        "description": "Número de crianças menores de 2 anos com visitas domiciliares registradas no SISAB em relação à estimativa da microárea.",
        "order": 5,
    },
    {
        "code": "ACS_VISITAS_GESTANTES",
        "category": "ACS",
        "name": "Visitas a gestantes e puérperas",
        "description": "Número de gestantes e puérperas com visitas domiciliares registradas no SISAB em relação à estimativa da microárea.",
        "order": 6,
    },
    {
        "code": "ACS_VISITAS_HIPERTENSOS",
        "category": "ACS",
        "name": "Visitas a pessoas com hipertensão",
        "description": "Número de hipertensos com visitas registradas no SISAB em relação à estimativa populacional da microárea.",
        "order": 7,
    },
    {
        "code": "ACS_VISITAS_DIABETICOS",
        "category": "ACS",
        "name": "Visitas a pessoas com diabetes",
        "description": "Número de diabéticos com visitas registradas no SISAB em relação à estimativa populacional da microárea.",
        "order": 8,
    },
    {
        "code": "ACS_ASSIDUIDADE",
        "category": "ACS",
        "name": "Assiduidade em reuniões e convocações",
        "description": "Assiduidade nas reuniões de equipe, trabalho de campo e convocações pela Secretaria Municipal de Saúde.",
        "order": 9,
    },
    {
        "code": "ACS_BOLSA_FAMILIA",
        "category": "ACS",
        "name": "Condicionalidades de saúde do Bolsa Família",
        "description": "Percentual de beneficiários com condicionalidades de saúde avaliados em relação ao total de beneficiários da microárea.",
        "order": 10,
    },
    {
        "code": "ACE_METAS_PROGRAMAS",
        "category": "ACE",
        "name": "Metas dos programas ativos",
        "description": "Cumprimento das metas do Ministério da Saúde: imóveis visitados, ações de campo, pesquisa laboratorial e consolidação/análise de dados.",
        "order": 1,
    },
    {
        "code": "ACE_ASSIDUIDADE",
        "category": "ACE",
        "name": "Assiduidade em reuniões e mobilizações",
        "description": "Assiduidade nas reuniões de equipe, mobilizações e convocações realizadas pela Secretaria Municipal de Saúde.",
        "order": 2,
    },
]


def now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA journal_mode = WAL")
    return g.db


@app.teardown_appcontext
def close_db(_: BaseException | None = None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_database() -> None:
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('ADM','REGULADOR')),
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            cnes TEXT,
            area TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            cpf TEXT UNIQUE,
            cns TEXT,
            category TEXT NOT NULL DEFAULT 'ACS' CHECK(category IN ('ACS','ACE')),
            unit_id INTEGER NOT NULL,
            microarea TEXT,
            admission_date TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS indicators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL CHECK(category IN ('ACS','ACE')),
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            high_min REAL NOT NULL DEFAULT 80,
            medium_min REAL NOT NULL DEFAULT 70,
            high_score REAL NOT NULL DEFAULT 10,
            medium_score REAL NOT NULL DEFAULT 7,
            low_score REAL NOT NULL DEFAULT 5,
            active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS evaluations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER NOT NULL,
            competence TEXT NOT NULL,
            proportional_factor REAL NOT NULL DEFAULT 100,
            notes TEXT,
            leave_type TEXT,
            leave_justification TEXT,
            leave_discarded INTEGER NOT NULL DEFAULT 0,
            evaluator_user_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(agent_id, competence),
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
            FOREIGN KEY (evaluator_user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS evaluation_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            evaluation_id INTEGER NOT NULL,
            indicator_id INTEGER NOT NULL,
            numerator REAL NOT NULL,
            denominator REAL NOT NULL,
            percentage REAL NOT NULL,
            score REAL NOT NULL,
            UNIQUE(evaluation_id, indicator_id),
            FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE,
            FOREIGN KEY (indicator_id) REFERENCES indicators(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            entity TEXT NOT NULL,
            entity_id INTEGER,
            description TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        """
    )

    existing_eval_cols = {row[1] for row in db.execute("PRAGMA table_info(evaluations)").fetchall()}
    if "leave_type" not in existing_eval_cols:
        db.execute("ALTER TABLE evaluations ADD COLUMN leave_type TEXT")
    if "leave_justification" not in existing_eval_cols:
        db.execute("ALTER TABLE evaluations ADD COLUMN leave_justification TEXT")
    if "leave_discarded" not in existing_eval_cols:
        db.execute("ALTER TABLE evaluations ADD COLUMN leave_discarded INTEGER NOT NULL DEFAULT 0")

    for indicator in INDICATORS:
        db.execute(
            """
            INSERT INTO indicators(code, category, name, description, order_index)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(code) DO UPDATE SET
                category=excluded.category,
                name=excluded.name,
                description=excluded.description,
                order_index=excluded.order_index
            """,
            (
                indicator["code"],
                indicator["category"],
                indicator["name"],
                indicator["description"],
                indicator["order"],
            ),
        )

    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        stamp = now_iso()
        db.executemany(
            "INSERT INTO users(name, username, password_hash, role, active, created_at, updated_at) VALUES(?,?,?,?,1,?,?)",
            [
                ("Administrador IFA", "admin", generate_password_hash("Admin@2026"), "ADM", stamp, stamp),
                ("Regulador IFA", "regulador", generate_password_hash("Regula@2026"), "REGULADOR", stamp, stamp),
            ],
        )

    stamp = now_iso()
    for unit_name in OFFICIAL_UNITS:
        db.execute(
            """
            INSERT OR IGNORE INTO units(name, cnes, area, active, created_at, updated_at)
            VALUES(?, NULL, NULL, 1, ?, ?)
            """,
            (unit_name, stamp, stamp),
        )

    db.commit()
    db.close()


def score_for_percentage(percentage: float) -> float:
    if percentage >= 80:
        return 10
    if percentage >= 70:
        return 7
    return 5


def create_backup(kind: str = "auto") -> Path:
    target_dir = AUTO_BACKUP_DIR if kind == "auto" else MANUAL_BACKUP_DIR
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    target = target_dir / f"ifa_valente_{kind}_{stamp}.db"
    source = sqlite3.connect(DATABASE)
    destination = sqlite3.connect(target)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()

    if kind == "auto":
        backups = sorted(target_dir.glob("ifa_valente_auto_*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in backups[30:]:
            old.unlink(missing_ok=True)
    return target


def audit(action: str, entity: str, entity_id: int | None, description: str) -> None:
    db = get_db()
    db.execute(
        "INSERT INTO audit_log(user_id, action, entity, entity_id, description, created_at) VALUES(?,?,?,?,?,?)",
        (session.get("user_id"), action, entity, entity_id, description, now_iso()),
    )


def commit_with_backup() -> None:
    get_db().commit()
    create_backup("auto")


def csrf_token() -> str:
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


app.jinja_env.globals["csrf_token"] = csrf_token


def validate_csrf() -> None:
    if request.method == "POST":
        token = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
        if not token or not secrets.compare_digest(token, session.get("csrf_token", "")):
            abort(400, "Token de segurança inválido. Atualize a página e tente novamente.")


@app.before_request
def load_logged_user() -> None:
    g.user = None
    if session.get("user_id"):
        g.user = get_db().execute(
            "SELECT id, name, username, role, active FROM users WHERE id=?",
            (session["user_id"],),
        ).fetchone()
        if g.user is None or not g.user["active"]:
            session.clear()
            g.user = None


@app.after_request
def security_headers(response: Response) -> Response:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Faça login para acessar o sistema.", "warning")
            return redirect(url_for("index"))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if g.user["role"] != "ADM":
            flash("Esta área é exclusiva para administradores.", "danger")
            return redirect(url_for("principal"))
        return view(*args, **kwargs)

    return wrapped


def normalize_number(value: str | None) -> float:
    if value is None:
        return 0.0
    value = value.strip().replace(".", "").replace(",", ".") if "," in value else value.strip()
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def format_competence(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m").strftime("%m/%Y")
    except ValueError:
        return value


app.jinja_env.filters["competencia"] = format_competence


def format_percent(value: Any, decimals: int = 2) -> str:
    if value is None or value == "":
        return "—"
    try:
        quant = Decimal("1").scaleb(-decimals)
        rounded = Decimal(str(value)).quantize(quant, rounding=ROUND_HALF_UP)
        return f"{rounded:.{decimals}f}"
    except Exception:
        return str(value)


app.jinja_env.filters["percent2"] = format_percent


@app.route("/")
@app.route("/index")
def root():
    return render_template("site_index.html")


@app.route("/IFA")
def ifa_upper_redirect():
    return redirect(url_for("index"))


@app.route("/ifa", methods=["GET", "POST"])
def index():
    if g.user is not None:
        return redirect(url_for("principal"))
    if request.method == "POST":
        validate_csrf()
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
        if user and user["active"] and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            session["csrf_token"] = secrets.token_urlsafe(32)
            audit("LOGIN", "USUARIO", user["id"], f"Acesso realizado por {user['username']}.")
            get_db().commit()
            return redirect(url_for("principal"))
        flash("Usuário ou senha inválidos.", "danger")
    return render_template("login.html")


@app.route("/ifa/sair")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.route("/ifa/principal")
@login_required
def principal():
    db = get_db()
    current_year = str(datetime.now().year)
    cards = {
        "agents": db.execute("SELECT COUNT(*) FROM agents WHERE active=1 AND category='ACS'").fetchone()[0],
        "units": db.execute("SELECT COUNT(*) FROM units WHERE active=1").fetchone()[0],
        "evaluations": db.execute("SELECT COUNT(*) FROM evaluations WHERE substr(competence,1,4)=?", (current_year,)).fetchone()[0],
        "avg_score": db.execute(
            """
            SELECT COALESCE(AVG(total_score),0) FROM (
                SELECT e.id, (SUM(i.score) * 10.0 / COUNT(i.id)) AS total_score
                FROM evaluations e
                JOIN evaluation_items i ON i.evaluation_id=e.id
                WHERE substr(e.competence,1,4)=?
                GROUP BY e.id
            )
            """,
            (current_year,),
        ).fetchone()[0],
    }
    recent = db.execute(
        """
        SELECT e.id, e.competence, e.leave_type, a.full_name, a.category, u.name AS unit_name,
               ROUND(CASE WHEN COUNT(i.id)>0 THEN SUM(i.score) * 10.0 / COUNT(i.id) END,2) AS total_score,
               ROUND(AVG(i.percentage),2) AS avg_percentage
        FROM evaluations e
        JOIN agents a ON a.id=e.agent_id
        JOIN units u ON u.id=a.unit_id
        LEFT JOIN evaluation_items i ON i.evaluation_id=e.id
        GROUP BY e.id
        ORDER BY e.competence DESC, e.updated_at DESC
        LIMIT 8
        """
    ).fetchall()
    monthly = db.execute(
        """
        SELECT e.competence, ROUND(AVG(scores.total_score),2) avg_score
        FROM evaluations e
        JOIN (
            SELECT evaluation_id, SUM(score) * 10.0 / COUNT(*) total_score
            FROM evaluation_items GROUP BY evaluation_id
        ) scores ON scores.evaluation_id=e.id
        WHERE substr(e.competence,1,4)=?
        GROUP BY e.competence ORDER BY e.competence
        """,
        (current_year,),
    ).fetchall()
    unit_ranking = db.execute(
        """
        SELECT u.name, ROUND(AVG(scores.total_score),2) avg_score
        FROM evaluations e
        JOIN agents a ON a.id=e.agent_id
        JOIN units u ON u.id=a.unit_id
        JOIN (
            SELECT evaluation_id, SUM(score) * 10.0 / COUNT(*) total_score
            FROM evaluation_items GROUP BY evaluation_id
        ) scores ON scores.evaluation_id=e.id
        WHERE substr(e.competence,1,4)=?
        GROUP BY u.id ORDER BY avg_score DESC LIMIT 6
        """,
        (current_year,),
    ).fetchall()
    return render_template(
        "principal.html",
        cards=cards,
        recent=recent,
        monthly_labels=[format_competence(r["competence"]) for r in monthly],
        monthly_values=[r["avg_score"] for r in monthly],
        unit_labels=[r["name"] for r in unit_ranking],
        unit_values=[r["avg_score"] for r in unit_ranking],
        year=current_year,
    )


MONTH_NAMES_SHORT = {
    1: "Jan",
    2: "Fev",
    3: "Mar",
    4: "Abr",
    5: "Mai",
    6: "Jun",
    7: "Jul",
    8: "Ago",
    9: "Set",
    10: "Out",
    11: "Nov",
    12: "Dez",
}


def month_label(competence: str) -> str:
    try:
        year_text, month_text = competence.split("-", 2)
        return f"{MONTH_NAMES_SHORT[int(month_text)]}/{year_text}"
    except (ValueError, KeyError):
        return competence


def clamp_month(value: int) -> int:
    return min(max(value, 1), 12)


def month_sequence(start: str, end: str) -> list[str]:
    start_year, start_month = (int(part) for part in start.split("-"))
    end_year, end_month = (int(part) for part in end.split("-"))
    result: list[str] = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        result.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            month = 1
            year += 1
    return result


def period_bounds(
    period_type: str,
    year: int,
    month: int,
    quadrimester: int,
    start_month: int = 1,
    end_month: int = 12,
) -> tuple[str, str, str]:
    year = min(max(year, 2020), 2100)
    month = clamp_month(month)
    if period_type == "mensal":
        start = end = f"{year:04d}-{month:02d}"
        label = f"{MONTH_NAMES_SHORT[month]} de {year}"
    elif period_type == "intervalo":
        first = clamp_month(start_month)
        last = clamp_month(end_month)
        if first > last:
            first, last = last, first
        start, end = f"{year:04d}-{first:02d}", f"{year:04d}-{last:02d}"
        label = f"{MONTH_NAMES_SHORT[first]} a {MONTH_NAMES_SHORT[last]} de {year}"
    elif period_type == "quadrimestral":
        q = min(max(quadrimester, 1), 3)
        first = (q - 1) * 4 + 1
        last = first + 3
        start, end = f"{year:04d}-{first:02d}", f"{year:04d}-{last:02d}"
        label = f"{q}º quadrimestre de {year}"
    else:
        start, end = f"{year:04d}-01", f"{year:04d}-12"
        label = f"Ano de {year}"
    return start, end, label


def report_where(start: str, end: str, agent_id: int | None, unit_id: int | None) -> tuple[str, list[Any]]:
    where = ["e.competence BETWEEN ? AND ?"]
    params: list[Any] = [start, end]
    if agent_id:
        where.append("a.id=?")
        params.append(agent_id)
    if unit_id:
        where.append("u.id=?")
        params.append(unit_id)
    return " AND ".join(where), params


def build_report_rows(group_by: str, start: str, end: str, agent_id: int | None, unit_id: int | None):
    db = get_db()
    where_sql, params = report_where(start, end, agent_id, unit_id)
    if group_by == "unidade":
        group_fields = "u.id, u.name"
        select_label = "u.name AS label"
    else:
        group_fields = "a.id, a.full_name, u.name"
        select_label = "a.full_name AS label"
    query = f"""
        SELECT {select_label}, u.name AS unit_name, a.category,
               COUNT(DISTINCT e.id) AS evaluation_count,
               ROUND(AVG(ev.total_score),2) AS avg_score,
               ROUND(AVG(ev.avg_percentage),2) AS avg_percentage,
               MIN(e.competence) AS first_competence,
               MAX(e.competence) AS last_competence
        FROM evaluations e
        JOIN agents a ON a.id=e.agent_id
        JOIN units u ON u.id=a.unit_id
        JOIN (
            SELECT evaluation_id, SUM(score) * 10.0 / COUNT(*) AS total_score, AVG(percentage) AS avg_percentage
            FROM evaluation_items GROUP BY evaluation_id
        ) ev ON ev.evaluation_id=e.id
        WHERE {where_sql}
        GROUP BY {group_fields}
        ORDER BY avg_score DESC, label
    """
    return db.execute(query, params).fetchall()


def build_report_summary(start: str, end: str, agent_id: int | None, unit_id: int | None) -> dict[str, float | int]:
    db = get_db()
    where_sql, params = report_where(start, end, agent_id, unit_id)
    row = db.execute(
        f"""
        SELECT COUNT(DISTINCT e.id) AS total_evals,
               ROUND(AVG(ev.total_score),2) AS avg_score,
               ROUND(AVG(ev.avg_percentage),2) AS avg_percentage
        FROM evaluations e
        JOIN agents a ON a.id=e.agent_id
        JOIN units u ON u.id=a.unit_id
        JOIN (
            SELECT evaluation_id, SUM(score) * 10.0 / COUNT(*) AS total_score, AVG(percentage) AS avg_percentage
            FROM evaluation_items GROUP BY evaluation_id
        ) ev ON ev.evaluation_id=e.id
        WHERE {where_sql}
        """,
        params,
    ).fetchone()
    return {
        "total_evals": int(row["total_evals"] or 0),
        "avg_score": float(row["avg_score"] or 0),
        "avg_percentage": float(row["avg_percentage"] or 0),
    }


def build_monthly_evolution(start: str, end: str, agent_id: int | None, unit_id: int | None) -> list[dict[str, Any]]:
    db = get_db()
    where_sql, params = report_where(start, end, agent_id, unit_id)
    raw = db.execute(
        f"""
        SELECT e.competence,
               COUNT(DISTINCT e.id) AS evaluation_count,
               ROUND(AVG(ev.total_score),2) AS avg_score,
               ROUND(AVG(ev.avg_percentage),2) AS avg_percentage
        FROM evaluations e
        JOIN agents a ON a.id=e.agent_id
        JOIN units u ON u.id=a.unit_id
        JOIN (
            SELECT evaluation_id, SUM(score) * 10.0 / COUNT(*) AS total_score, AVG(percentage) AS avg_percentage
            FROM evaluation_items GROUP BY evaluation_id
        ) ev ON ev.evaluation_id=e.id
        WHERE {where_sql}
        GROUP BY e.competence
        ORDER BY e.competence
        """,
        params,
    ).fetchall()
    by_month = {row["competence"]: row for row in raw}
    result: list[dict[str, Any]] = []
    previous_score: float | None = None
    for competence in month_sequence(start, end):
        row = by_month.get(competence)
        score = float(row["avg_score"]) if row and row["avg_score"] is not None else None
        percentage = float(row["avg_percentage"]) if row and row["avg_percentage"] is not None else None
        variation = round(score - previous_score, 2) if score is not None and previous_score is not None else None
        result.append(
            {
                "competence": competence,
                "label": month_label(competence),
                "evaluation_count": int(row["evaluation_count"] or 0) if row else 0,
                "avg_score": score,
                "avg_percentage": percentage,
                "variation": variation,
            }
        )
        previous_score = score
    return result


def selected_agent_category(agent_id: int | None) -> str | None:
    if not agent_id:
        return None
    row = get_db().execute("SELECT category FROM agents WHERE id=?", (agent_id,)).fetchone()
    return row["category"] if row else None


def build_indicator_evolution(
    start: str,
    end: str,
    agent_id: int | None,
    unit_id: int | None,
) -> list[dict[str, Any]]:
    db = get_db()
    where_sql, params = report_where(start, end, agent_id, unit_id)
    category = selected_agent_category(agent_id)
    catalog_params: list[Any] = []
    catalog_where = "WHERE active=1"
    if category:
        catalog_where += " AND category=?"
        catalog_params.append(category)
    catalog = db.execute(
        f"SELECT id, code, category, name, order_index FROM indicators {catalog_where} ORDER BY category, order_index",
        catalog_params,
    ).fetchall()
    raw = db.execute(
        f"""
        SELECT ind.id AS indicator_id, e.competence,
               COUNT(DISTINCT e.id) AS evaluation_count,
               ROUND(AVG(item.percentage),2) AS avg_percentage,
               ROUND(AVG(item.score),2) AS avg_points
        FROM evaluation_items item
        JOIN evaluations e ON e.id=item.evaluation_id
        JOIN agents a ON a.id=e.agent_id
        JOIN units u ON u.id=a.unit_id
        JOIN indicators ind ON ind.id=item.indicator_id
        WHERE {where_sql}
        GROUP BY ind.id, e.competence
        ORDER BY ind.category, ind.order_index, e.competence
        """,
        params,
    ).fetchall()
    values = {(row["indicator_id"], row["competence"]): row for row in raw}
    months = month_sequence(start, end)
    result: list[dict[str, Any]] = []
    for indicator in catalog:
        monthly: list[dict[str, Any]] = []
        valid_percentages: list[float] = []
        valid_points: list[float] = []
        for competence in months:
            row = values.get((indicator["id"], competence))
            percentage = float(row["avg_percentage"]) if row and row["avg_percentage"] is not None else None
            points = float(row["avg_points"]) if row and row["avg_points"] is not None else None
            if percentage is not None:
                valid_percentages.append(percentage)
            if points is not None:
                valid_points.append(points)
            monthly.append(
                {
                    "competence": competence,
                    "label": month_label(competence),
                    "percentage": percentage,
                    "points": points,
                    "evaluation_count": int(row["evaluation_count"] or 0) if row else 0,
                }
            )
        variation = None
        first_value = next((item["percentage"] for item in monthly if item["percentage"] is not None), None)
        last_value = next((item["percentage"] for item in reversed(monthly) if item["percentage"] is not None), None)
        if first_value is not None and last_value is not None and len(valid_percentages) >= 2:
            variation = round(last_value - first_value, 2)
        result.append(
            {
                "id": indicator["id"],
                "code": indicator["code"],
                "category": indicator["category"],
                "name": indicator["name"],
                "average_percentage": round(sum(valid_percentages) / len(valid_percentages), 2) if valid_percentages else None,
                "average_points": round(sum(valid_points) / len(valid_points), 2) if valid_points else None,
                "variation": variation,
                "months": monthly,
            }
        )
    return result



def build_agent_detail(start: str, end: str, agent_id: int | None) -> dict[str, Any] | None:
    if not agent_id:
        return None
    db = get_db()
    agent = db.execute(
        """
        SELECT a.id, a.full_name, a.category, a.microarea, u.name AS unit_name
        FROM agents a
        JOIN units u ON u.id=a.unit_id
        WHERE a.id=?
        """,
        (agent_id,),
    ).fetchone()
    if not agent:
        return None
    months = month_sequence(start, end)
    indicators = db.execute(
        "SELECT id, code, name, order_index FROM indicators WHERE category=? AND active=1 ORDER BY order_index",
        (agent['category'],),
    ).fetchall()
    raw = db.execute(
        """
        SELECT ind.id AS indicator_id, e.competence,
               item.numerator, item.denominator, item.percentage, item.score
        FROM evaluation_items item
        JOIN evaluations e ON e.id=item.evaluation_id
        JOIN indicators ind ON ind.id=item.indicator_id
        WHERE e.agent_id=? AND e.competence BETWEEN ? AND ?
        ORDER BY ind.order_index, e.competence
        """,
        (agent_id, start, end),
    ).fetchall()
    values = {(row['indicator_id'], row['competence']): row for row in raw}
    rows: list[dict[str, Any]] = []
    totals: list[dict[str, Any]] = []
    for indicator in indicators:
        monthly: list[dict[str, Any]] = []
        for competence in months:
            row = values.get((indicator['id'], competence))
            monthly.append(
                {
                    'competence': competence,
                    'label': month_label(competence),
                    'numerator': float(row['numerator']) if row else None,
                    'denominator': float(row['denominator']) if row else None,
                    'percentage': float(row['percentage']) if row and row['percentage'] is not None else None,
                    'score': float(row['score']) if row and row['score'] is not None else None,
                }
            )
        rows.append(
            {
                'id': indicator['id'],
                'code': indicator['code'],
                'name': indicator['name'],
                'months': monthly,
            }
        )
    for competence in months:
        comp_rows = [values.get((indicator['id'], competence)) for indicator in indicators]
        scores = [float(row['score']) for row in comp_rows if row and row['score'] is not None]
        percentages = [float(row['percentage']) for row in comp_rows if row and row['percentage'] is not None]
        totals.append(
            {
                'competence': competence,
                'label': month_label(competence),
                'total_score': round(sum(scores), 2) if scores else None,
                'avg_percentage': round(sum(percentages) / len(percentages), 2) if percentages else None,
            }
        )
    return {
        'agent': agent,
        'months': [{'competence': item, 'label': month_label(item)} for item in months],
        'indicators': rows,
        'totals': totals,
    }


def build_unit_indicator_matrix(start: str, end: str, unit_id: int | None = None) -> dict[str, Any] | None:
    db = get_db()
    where_sql, params = report_where(start, end, None, unit_id)
    summary_rows = build_report_rows('unidade', start, end, None, unit_id)
    summary_by_label = {row['label']: row for row in summary_rows}
    raw = db.execute(
        f"""
        SELECT u.id AS unit_id, u.name AS unit_name,
               ind.id AS indicator_id, ind.category, ind.name, ind.order_index,
               ROUND(AVG(item.percentage),2) AS avg_percentage,
               ROUND(AVG(item.score),2) AS avg_points,
               SUM(item.numerator) AS total_numerator,
               SUM(item.denominator) AS total_denominator,
               COUNT(DISTINCT e.id) AS evaluation_count
        FROM evaluation_items item
        JOIN evaluations e ON e.id=item.evaluation_id
        JOIN agents a ON a.id=e.agent_id
        JOIN units u ON u.id=a.unit_id
        JOIN indicators ind ON ind.id=item.indicator_id
        WHERE {where_sql}
        GROUP BY u.id, u.name, ind.id, ind.category, ind.name, ind.order_index
        ORDER BY u.name, ind.category, ind.order_index
        """,
        params,
    ).fetchall()
    if not raw and not summary_rows:
        return None
    catalog_map: dict[int, dict[str, Any]] = {}
    for row in raw:
        if row['indicator_id'] not in catalog_map:
            catalog_map[row['indicator_id']] = {
                'id': row['indicator_id'],
                'category': row['category'],
                'name': row['name'],
                'order_index': row['order_index'],
            }
    indicators = sorted(catalog_map.values(), key=lambda item: (item['category'], item['order_index']))
    value_map = {(row['unit_id'], row['indicator_id']): row for row in raw}
    units_index: dict[int, dict[str, Any]] = {}
    all_unit_rows = db.execute('SELECT id, name FROM units WHERE active=1 ORDER BY name').fetchall() if not unit_id else db.execute('SELECT id, name FROM units WHERE id=?', (unit_id,)).fetchall()
    for unit in all_unit_rows:
        summary = summary_by_label.get(unit['name'])
        metrics = []
        for indicator in indicators:
            row = value_map.get((unit['id'], indicator['id']))
            metrics.append(
                {
                    'indicator_id': indicator['id'],
                    'percentage': float(row['avg_percentage']) if row and row['avg_percentage'] is not None else None,
                    'points': float(row['avg_points']) if row and row['avg_points'] is not None else None,
                    'numerator': float(row['total_numerator']) if row and row['total_numerator'] is not None else None,
                    'denominator': float(row['total_denominator']) if row and row['total_denominator'] is not None else None,
                    'evaluation_count': int(row['evaluation_count'] or 0) if row else 0,
                }
            )
        units_index[unit['id']] = {
            'unit_id': unit['id'],
            'unit_name': unit['name'],
            'avg_score': float(summary['avg_score']) if summary and summary['avg_score'] is not None else None,
            'avg_percentage': float(summary['avg_percentage']) if summary and summary['avg_percentage'] is not None else None,
            'evaluation_count': int(summary['evaluation_count'] or 0) if summary else 0,
            'metrics': metrics,
        }
    base_rows = db.execute(
        f"""
        SELECT ind.id AS indicator_id, ind.category, ind.name, ind.order_index,
               SUM(item.numerator) AS total_numerator,
               SUM(item.denominator) AS total_denominator,
               ROUND(AVG(item.percentage),2) AS avg_percentage,
               ROUND(AVG(item.score),2) AS avg_points,
               COUNT(DISTINCT e.id) AS evaluation_count
        FROM evaluation_items item
        JOIN evaluations e ON e.id=item.evaluation_id
        JOIN agents a ON a.id=e.agent_id
        JOIN units u ON u.id=a.unit_id
        JOIN indicators ind ON ind.id=item.indicator_id
        WHERE {where_sql}
        GROUP BY ind.id, ind.category, ind.name, ind.order_index
        ORDER BY ind.category, ind.order_index
        """,
        params,
    ).fetchall()
    bases = [
        {
            'indicator_id': row['indicator_id'],
            'category': row['category'],
            'name': row['name'],
            'total_numerator': float(row['total_numerator']) if row['total_numerator'] is not None else None,
            'total_denominator': float(row['total_denominator']) if row['total_denominator'] is not None else None,
            'avg_percentage': float(row['avg_percentage']) if row['avg_percentage'] is not None else None,
            'avg_points': float(row['avg_points']) if row['avg_points'] is not None else None,
            'evaluation_count': int(row['evaluation_count'] or 0),
        }
        for row in base_rows
    ]
    return {
        'indicators': indicators,
        'units': list(units_index.values()),
        'bases': bases,
    }


def competence_options_for_years() -> list[dict[str, Any]]:
    current_year = datetime.now().year
    years = sorted({2026, current_year, current_year + 1})
    options: list[dict[str, Any]] = []
    for year in years:
        for month in range(1, 13):
            value = f"{year:04d}-{month:02d}"
            options.append({"value": value, "label": f"{MONTH_NAMES_SHORT[month]}/{str(year)[2:]}", "month": month, "year": year})
    return options


def existing_competences_by_agent(exclude_evaluation_id: int | None = None) -> dict[str, list[str]]:
    db = get_db()
    params: list[Any] = []
    where = ""
    if exclude_evaluation_id:
        where = "WHERE id<>?"
        params.append(exclude_evaluation_id)
    rows = db.execute(f"SELECT agent_id, competence FROM evaluations {where} ORDER BY competence", params).fetchall()
    result: dict[str, list[str]] = {}
    for row in rows:
        result.setdefault(str(row["agent_id"]), []).append(row["competence"])
    return result


def is_indicator_applicable(agent_category: str, indicator_order: int, competence: str) -> bool:
    # Indicadores ACS 2 e 3 são de atualização anual. Para competências 01 a 11,
    # ficam bloqueados e não entram no cálculo. Só entram na competência 12.
    try:
        month = int(competence[-2:])
    except ValueError:
        month = 0
    if agent_category == "ACS" and indicator_order in {2, 3} and month != 12:
        return False
    return True



def build_acs_annual_report(agent_id: int | None, year: int, salary_value: float | None = None) -> dict[str, Any] | None:
    if not agent_id:
        return None
    db = get_db()
    agent = db.execute(
        """
        SELECT a.id, a.full_name, a.category, a.microarea, u.name AS unit_name
        FROM agents a
        JOIN units u ON u.id=a.unit_id
        WHERE a.id=?
        """,
        (agent_id,),
    ).fetchone()
    if not agent:
        return None

    months = [{"value": f"{year:04d}-{m:02d}", "label": MONTH_NAMES_SHORT[m], "month": m} for m in range(1, 13)]
    indicators = db.execute(
        "SELECT id, code, category, name, description, order_index FROM indicators WHERE category=? AND active=1 ORDER BY order_index",
        (agent["category"],),
    ).fetchall()
    evaluations = db.execute(
        """
        SELECT id, competence, leave_type, leave_justification, leave_discarded
        FROM evaluations
        WHERE agent_id=? AND competence BETWEEN ? AND ?
        """,
        (agent_id, f"{year:04d}-01", f"{year:04d}-12"),
    ).fetchall()
    eval_by_competence = {row["competence"]: row for row in evaluations}
    raw_items = db.execute(
        """
        SELECT ind.id AS indicator_id, ind.order_index, e.competence,
               item.numerator, item.denominator, item.percentage, item.score
        FROM evaluation_items item
        JOIN evaluations e ON e.id=item.evaluation_id
        JOIN indicators ind ON ind.id=item.indicator_id
        WHERE e.agent_id=? AND e.competence BETWEEN ? AND ?
        ORDER BY ind.order_index, e.competence
        """,
        (agent_id, f"{year:04d}-01", f"{year:04d}-12"),
    ).fetchall()
    values = {(row["indicator_id"], row["competence"]): row for row in raw_items}

    indicator_rows: list[dict[str, Any]] = []
    monthly_score_values: dict[str, list[float]] = {m["value"]: [] for m in months}
    monthly_percent_values: dict[str, list[float]] = {m["value"]: [] for m in months}
    annual_indicator_points: list[float] = []

    for indicator in indicators:
        monthly: list[dict[str, Any]] = []
        valid_percentages: list[float] = []
        for month in months:
            evaluation = eval_by_competence.get(month["value"])
            leave_type = evaluation["leave_type"] if evaluation else None
            leave_discarded = bool(evaluation["leave_discarded"]) if evaluation else False
            applicable = is_indicator_applicable(agent["category"], int(indicator["order_index"]), month["value"])
            if leave_discarded and month["month"] != 12:
                applicable = False
            if leave_discarded and month["month"] == 12 and int(indicator["order_index"]) not in {2, 3}:
                applicable = False
            row = values.get((indicator["id"], month["value"])) if applicable else None
            percentage = float(row["percentage"]) if row and row["percentage"] is not None else None
            score = float(row["score"]) if row and row["score"] is not None else None
            if percentage is not None:
                valid_percentages.append(percentage)
                monthly_percent_values[month["value"]].append(percentage)
            if score is not None:
                monthly_score_values[month["value"]].append(score)
            monthly.append(
                {
                    "competence": month["value"],
                    "label": month["label"],
                    "applicable": applicable,
                    "leave_type": leave_type,
                    "leave_discarded": leave_discarded,
                    "percentage": percentage,
                    "score": score,
                    "numerator": float(row["numerator"]) if row and row["numerator"] is not None else None,
                    "denominator": float(row["denominator"]) if row and row["denominator"] is not None else None,
                }
            )
        annual_average = round(sum(valid_percentages) / len(valid_percentages), 2) if valid_percentages else None
        annual_points = float(score_for_percentage(annual_average)) if annual_average is not None else None
        if annual_points is not None:
            annual_indicator_points.append(annual_points)
        indicator_rows.append(
            {
                "id": indicator["id"],
                "order": indicator["order_index"],
                "code": indicator["code"],
                "name": indicator["name"],
                "description": indicator["description"],
                "annual_average": annual_average,
                "annual_points": annual_points,
                "months": monthly,
            }
        )

    monthly_totals: list[dict[str, Any]] = []
    valid_total_scores: list[float] = []
    discarded_months = 0
    for month in months:
        evaluation = eval_by_competence.get(month["value"])
        leave_type = evaluation["leave_type"] if evaluation else None
        leave_discarded = bool(evaluation["leave_discarded"]) if evaluation else False
        scores = monthly_score_values[month["value"]]
        percentages = monthly_percent_values[month["value"]]
        total_score = round(sum(scores) * 10.0 / len(scores), 2) if scores else None
        avg_percentage = round(sum(percentages) / len(percentages), 2) if percentages else None
        if leave_discarded and month["month"] != 12:
            discarded_months += 1
            total_score = None
            avg_percentage = None
        if total_score is not None:
            valid_total_scores.append(total_score)
        monthly_totals.append(
            {
                "competence": month["value"],
                "label": month["label"],
                "score": total_score,
                "avg_percentage": avg_percentage,
                "leave_type": leave_type,
                "leave_discarded": leave_discarded,
            }
        )

    monthly_annual_score = round(sum(valid_total_scores) / len(valid_total_scores), 2) if valid_total_scores else None

    # Regra final do IFA no relatório anual:
    # 80% a 100% = 10 pontos; 70% a 79,99% = 7 pontos; abaixo de 70% = 5 pontos.
    # A média final é a soma dos pontos anuais de cada índice dividida pela quantidade
    # de indicadores da categoria. Para ACS, normalmente são 10 índices.
    annual_denominator = len(indicators) if indicators else 0
    annual_points_average = round(sum(annual_indicator_points) / annual_denominator, 2) if annual_denominator and annual_indicator_points else None
    receive_percentage = round(annual_points_average * 10, 2) if annual_points_average is not None else None
    estimated_value = round((salary_value or 0) * (receive_percentage or 0) / 100, 2) if salary_value else None
    return {
        "agent": agent,
        "year": year,
        "months": months,
        "indicators": indicator_rows,
        "monthly_totals": monthly_totals,
        "annual_score": receive_percentage,
        "monthly_annual_score": monthly_annual_score,
        "annual_points_average": annual_points_average,
        "receive_percentage": receive_percentage,
        "salary_value": salary_value,
        "estimated_value": estimated_value,
        "months_counted": len(valid_total_scores),
        "months_discarded": discarded_months,
    }

def report_context_from_request() -> dict[str, Any]:
    current_year = datetime.now().year
    period_type = request.args.get("periodo", "anual")
    if period_type not in {"mensal", "intervalo", "quadrimestral", "anual"}:
        period_type = "anual"
    year = request.args.get("ano", default=current_year, type=int) or current_year
    month = request.args.get("mes", default=datetime.now().month, type=int) or datetime.now().month
    start_month = request.args.get("mes_inicio", default=1, type=int) or 1
    end_month = request.args.get("mes_fim", default=12, type=int) or 12
    quadrimester = request.args.get("quadrimestre", default=1, type=int) or 1
    group_by = request.args.get("agrupar", "acs")
    if group_by not in {"acs", "unidade"}:
        group_by = "acs"
    agent_id = request.args.get("agente", type=int)
    unit_id = request.args.get("unidade", type=int)
    start, end, period_label = period_bounds(period_type, year, month, quadrimester, start_month, end_month)
    normalized_start_month = int(start[-2:]) if period_type == "intervalo" else clamp_month(start_month)
    normalized_end_month = int(end[-2:]) if period_type == "intervalo" else clamp_month(end_month)
    return {
        "period_type": period_type,
        "year": min(max(year, 2020), 2100),
        "month": clamp_month(month),
        "start_month": normalized_start_month,
        "end_month": normalized_end_month,
        "quadrimester": min(max(quadrimester, 1), 3),
        "group_by": group_by,
        "agent_id": agent_id,
        "unit_id": unit_id,
        "start": start,
        "end": end,
        "period_label": period_label,
    }


@app.route("/ifa/relatorios")
@login_required
def relatorios():
    db = get_db()
    current_year = datetime.now().year
    year = request.args.get("ano", default=current_year, type=int) or current_year
    year = min(max(year, 2020), 2100)
    agent_id = request.args.get("agente", type=int)
    salary_text = request.args.get("salario", "").strip()
    salary_value = normalize_number(salary_text) if salary_text else None
    if salary_value is not None and salary_value <= 0:
        salary_value = None
    agents = db.execute(
        """
        SELECT a.id, a.full_name, a.category, u.name AS unit_name
        FROM agents a
        JOIN units u ON u.id=a.unit_id
        WHERE a.active=1 AND a.category='ACS'
        ORDER BY a.full_name
        """
    ).fetchall()
    report = build_acs_annual_report(agent_id, year, salary_value)
    return render_template(
        "relatorios.html",
        agents=agents,
        selected_agent=agent_id,
        year=year,
        salary_text=salary_text,
        report=report,
    )


@app.route("/ifa/relatorios/csv")
@login_required
def relatorios_csv():
    current_year = datetime.now().year
    year = request.args.get("ano", default=current_year, type=int) or current_year
    year = min(max(year, 2020), 2100)
    agent_id = request.args.get("agente", type=int)
    salary_text = request.args.get("salario", "").strip()
    salary_value = normalize_number(salary_text) if salary_text else None
    report = build_acs_annual_report(agent_id, year, salary_value)
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Relatório anual por ACS", year])
    if not report:
        writer.writerow(["Selecione um ACS para gerar o relatório."])
    else:
        writer.writerow(["Profissional", report["agent"]["full_name"]])
        writer.writerow(["Unidade", report["agent"]["unit_name"]])
        writer.writerow(["Percentual a receber", report["receive_percentage"] if report["receive_percentage"] is not None else ""])
        writer.writerow(["Média dos pontos anuais", report["annual_points_average"] if report["annual_points_average"] is not None else ""])
        if report["salary_value"]:
            writer.writerow(["Salário/base informado", report["salary_value"]])
            writer.writerow(["Valor estimado", report["estimated_value"]])
        writer.writerow([])
        header = ["Indicador", "Média anual (%)", "Pontos anuais"] + [m["label"] for m in report["months"]]
        writer.writerow(header)
        for indicator in report["indicators"]:
            line = [f'Índice {indicator["order"]} - {indicator["name"]}', indicator["annual_average"] if indicator["annual_average"] is not None else "", indicator["annual_points"] if indicator["annual_points"] is not None else ""]
            for value in indicator["months"]:
                if not value["applicable"]:
                    line.append("N/A")
                elif value["percentage"] is None:
                    line.append("")
                else:
                    line.append(value["percentage"])
            writer.writerow(line)
        total_line = ["Média geral pelos pesos / percentual a receber", report["annual_score"] if report["annual_score"] is not None else "", report["annual_points_average"] if report["annual_points_average"] is not None else ""]
        for item in report["monthly_totals"]:
            total_line.append(item["score"] if item["score"] is not None else "")
        writer.writerow(total_line)
    data = "\ufeff" + output.getvalue()
    filename = f"relatorio_acs_{year}.csv"
    return Response(data, mimetype="text/csv; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={filename}"})

@app.route("/ifa/avaliacoes")
@login_required
def avaliacoes():
    db = get_db()
    query = request.args.get("q", "").strip()
    params: list[Any] = []
    where = ""
    if query:
        where = "WHERE a.full_name LIKE ? OR u.name LIKE ? OR e.competence LIKE ?"
        term = f"%{query}%"
        params = [term, term, term]
    rows = db.execute(
        f"""
        SELECT e.id, e.competence, e.updated_at, e.leave_type, a.full_name, a.category, u.name AS unit_name,
               ROUND(CASE WHEN COUNT(i.id)>0 THEN SUM(i.score) * 10.0 / COUNT(i.id) END,2) total_score,
               ROUND(AVG(i.percentage),2) avg_percentage
        FROM evaluations e
        JOIN agents a ON a.id=e.agent_id
        JOIN units u ON u.id=a.unit_id
        LEFT JOIN evaluation_items i ON i.evaluation_id=e.id
        {where}
        GROUP BY e.id
        ORDER BY e.competence DESC, a.full_name
        LIMIT 200
        """,
        params,
    ).fetchall()
    return render_template("avaliacoes.html", rows=rows, query=query)


def load_evaluation_form(evaluation_id: int | None = None):
    db = get_db()
    agents = db.execute(
        "SELECT a.id, a.full_name, a.category, a.microarea, u.name AS unit_name FROM agents a JOIN units u ON u.id=a.unit_id WHERE a.active=1 ORDER BY a.full_name"
    ).fetchall()
    indicators = db.execute("SELECT * FROM indicators WHERE active=1 ORDER BY category, order_index").fetchall()
    evaluation = None
    item_values: dict[int, dict[str, float]] = {}
    if evaluation_id:
        evaluation = db.execute("SELECT * FROM evaluations WHERE id=?", (evaluation_id,)).fetchone()
        if not evaluation:
            abort(404)
        for row in db.execute("SELECT * FROM evaluation_items WHERE evaluation_id=?", (evaluation_id,)).fetchall():
            item_values[row["indicator_id"]] = {
                "numerator": row["numerator"],
                "denominator": row["denominator"],
                "percentage": row["percentage"],
                "score": row["score"],
            }
    existing_competences = existing_competences_by_agent(evaluation_id)
    competence_options = competence_options_for_years()
    return agents, indicators, evaluation, item_values, existing_competences, competence_options



def save_evaluation(evaluation_id: int | None = None):
    validate_csrf()
    db = get_db()
    agent_id = request.form.get("agent_id", type=int)
    competence = request.form.get("competence", "").strip()
    notes = request.form.get("notes", "").strip()
    leave_type = request.form.get("leave_type", "").strip()
    leave_justification = request.form.get("leave_justification", "").strip()
    if leave_type not in {"ferias", "licenca"}:
        leave_type = ""
        leave_justification = ""
    if leave_type and not leave_justification:
        flash("Quando marcar férias ou licença, informe a justificativa.", "danger")
        return None
    proportional_factor = normalize_number(request.form.get("proportional_factor")) or 100
    proportional_factor = max(1.0, min(proportional_factor, 100.0))
    if not re.fullmatch(r"\d{4}-\d{2}", competence):
        flash("Informe uma competência válida.", "danger")
        return None
    agent = db.execute("SELECT * FROM agents WHERE id=?", (agent_id,)).fetchone()
    if not agent:
        flash("Selecione um profissional válido.", "danger")
        return None
    try:
        competence_month = int(competence[-2:])
    except ValueError:
        competence_month = 0
    leave_discarded = 1 if leave_type else 0
    indicators = db.execute(
        "SELECT * FROM indicators WHERE category=? AND active=1 ORDER BY order_index",
        (agent["category"],),
    ).fetchall()
    items = []
    for ind in indicators:
        order_index = int(ind["order_index"])
        if leave_type:
            # Nos meses 01 a 11, o mês é descartado da média e nenhum índice é computado.
            # Na competência 12, os índices 2 e 3 podem ser preenchidos mesmo com férias/licença.
            if not (agent["category"] == "ACS" and competence_month == 12 and order_index in {2, 3}):
                continue
        elif not is_indicator_applicable(agent["category"], order_index, competence):
            continue
        numerator = normalize_number(request.form.get(f"num_{ind['id']}"))
        denominator = normalize_number(request.form.get(f"den_{ind['id']}"))
        if denominator <= 0:
            flash(f"O denominador do indicador “{ind['name']}” deve ser maior que zero.", "danger")
            return None
        adjusted_denominator = denominator * (proportional_factor / 100.0)
        percentage = max(0, min((numerator / adjusted_denominator) * 100, 100))
        score = score_for_percentage(percentage)
        items.append((ind["id"], numerator, denominator, percentage, score))
    stamp = now_iso()
    try:
        if evaluation_id:
            db.execute(
                """
                UPDATE evaluations
                SET agent_id=?, competence=?, proportional_factor=?, notes=?, leave_type=?, leave_justification=?, leave_discarded=?, evaluator_user_id=?, updated_at=?
                WHERE id=?
                """,
                (agent_id, competence, proportional_factor, notes, leave_type or None, leave_justification or None, leave_discarded, g.user["id"], stamp, evaluation_id),
            )
            db.execute("DELETE FROM evaluation_items WHERE evaluation_id=?", (evaluation_id,))
            eval_id = evaluation_id
            action = "ALTERAR"
        else:
            cur = db.execute(
                """
                INSERT INTO evaluations(agent_id, competence, proportional_factor, notes, leave_type, leave_justification, leave_discarded, evaluator_user_id, created_at, updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                """,
                (agent_id, competence, proportional_factor, notes, leave_type or None, leave_justification or None, leave_discarded, g.user["id"], stamp, stamp),
            )
            eval_id = cur.lastrowid
            action = "CRIAR"
        if items:
            db.executemany(
                "INSERT INTO evaluation_items(evaluation_id, indicator_id, numerator, denominator, percentage, score) VALUES(?,?,?,?,?,?)",
                [(eval_id, *item) for item in items],
            )
        audit(action, "AVALIACAO", eval_id, f"Avaliação de {agent['full_name']} referente a {competence}.")
        commit_with_backup()
    except sqlite3.IntegrityError:
        db.rollback()
        flash("Já existe uma avaliação para este profissional nesta competência.", "danger")
        return None
    return eval_id


@app.route("/ifa/avaliacoes/nova", methods=["GET", "POST"])
@login_required
def avaliacao_nova():
    if request.method == "POST":
        eval_id = save_evaluation()
        if eval_id:
            flash("Avaliação cadastrada e pontuação calculada com sucesso.", "success")
            return redirect(url_for("avaliacao_detalhe", evaluation_id=eval_id))
    agents, indicators, evaluation, item_values, existing_competences, competence_options = load_evaluation_form()
    return render_template("avaliacao_form.html", agents=agents, indicators=indicators, evaluation=evaluation, item_values=item_values, existing_competences=existing_competences, competence_options=competence_options)


@app.route("/ifa/avaliacoes/editar/<int:evaluation_id>", methods=["GET", "POST"])
@login_required
def avaliacao_editar(evaluation_id: int):
    if request.method == "POST":
        eval_id = save_evaluation(evaluation_id)
        if eval_id:
            flash("Avaliação atualizada com sucesso.", "success")
            return redirect(url_for("avaliacao_detalhe", evaluation_id=eval_id))
    agents, indicators, evaluation, item_values, existing_competences, competence_options = load_evaluation_form(evaluation_id)
    return render_template("avaliacao_form.html", agents=agents, indicators=indicators, evaluation=evaluation, item_values=item_values, existing_competences=existing_competences, competence_options=competence_options)


@app.route("/ifa/avaliacoes/detalhe/<int:evaluation_id>")
@login_required
def avaliacao_detalhe(evaluation_id: int):
    db = get_db()
    evaluation = db.execute(
        """
        SELECT e.*, a.full_name, a.category, a.microarea, u.name AS unit_name, us.name AS evaluator_name
        FROM evaluations e
        JOIN agents a ON a.id=e.agent_id
        JOIN units u ON u.id=a.unit_id
        LEFT JOIN users us ON us.id=e.evaluator_user_id
        WHERE e.id=?
        """,
        (evaluation_id,),
    ).fetchone()
    if not evaluation:
        abort(404)
    items = db.execute(
        """
        SELECT i.*, ind.name, ind.description, ind.order_index
        FROM evaluation_items i JOIN indicators ind ON ind.id=i.indicator_id
        WHERE i.evaluation_id=? ORDER BY ind.order_index
        """,
        (evaluation_id,),
    ).fetchall()
    total_score = round(sum(row["score"] for row in items), 2) if items else None
    max_score = len(items) * 10
    avg_percentage = round(sum(row["percentage"] for row in items) / len(items), 2) if items else None
    return render_template("avaliacao_detalhe.html", evaluation=evaluation, items=items, total_score=total_score, max_score=max_score, avg_percentage=avg_percentage)


@app.route("/ifa/avaliacoes/excluir/<int:evaluation_id>", methods=["POST"])
@login_required
def avaliacao_excluir(evaluation_id: int):
    validate_csrf()
    db = get_db()
    row = db.execute(
        "SELECT e.id, e.competence, a.full_name FROM evaluations e JOIN agents a ON a.id=e.agent_id WHERE e.id=?",
        (evaluation_id,),
    ).fetchone()
    if not row:
        abort(404)
    db.execute("DELETE FROM evaluations WHERE id=?", (evaluation_id,))
    audit("EXCLUIR", "AVALIACAO", evaluation_id, f"Avaliação excluída: {row['full_name']} - {row['competence']}.")
    commit_with_backup()
    flash("Avaliação excluída.", "success")
    return redirect(url_for("avaliacoes"))


@app.route("/ifa/cadastro")
@login_required
def cadastro():
    db = get_db()
    units = db.execute(
        "SELECT u.*, COUNT(a.id) AS agents_count FROM units u LEFT JOIN agents a ON a.unit_id=u.id GROUP BY u.id ORDER BY u.name"
    ).fetchall()
    agents = db.execute(
        "SELECT a.*, u.name AS unit_name FROM agents a JOIN units u ON u.id=a.unit_id ORDER BY a.full_name"
    ).fetchall()
    return render_template("cadastro.html", units=units, agents=agents, tab=request.args.get("tab", "agentes"))


@app.route("/ifa/cadastro/unidade/nova", methods=["POST"])
@login_required
def unidade_nova():
    validate_csrf()
    name = request.form.get("name", "").strip()
    cnes = request.form.get("cnes", "").strip()
    area = request.form.get("area", "").strip()
    if not name:
        flash("Informe o nome da unidade.", "danger")
        return redirect(url_for("cadastro", tab="unidades"))
    stamp = now_iso()
    try:
        cur = get_db().execute(
            "INSERT INTO units(name,cnes,area,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
            (name, cnes, area, stamp, stamp),
        )
        audit("CRIAR", "UNIDADE", cur.lastrowid, f"Unidade cadastrada: {name}.")
        commit_with_backup()
        flash("Unidade cadastrada com sucesso.", "success")
    except sqlite3.IntegrityError:
        get_db().rollback()
        flash("Já existe uma unidade com esse nome.", "danger")
    return redirect(url_for("cadastro", tab="unidades"))


@app.route("/ifa/cadastro/unidade/editar/<int:unit_id>", methods=["POST"])
@login_required
def unidade_editar(unit_id: int):
    validate_csrf()
    name = request.form.get("name", "").strip()
    cnes = request.form.get("cnes", "").strip()
    area = request.form.get("area", "").strip()
    active = 1 if request.form.get("active") == "1" else 0
    if not name:
        flash("Informe o nome da unidade.", "danger")
        return redirect(url_for("cadastro", tab="unidades"))
    try:
        get_db().execute("UPDATE units SET name=?, cnes=?, area=?, active=?, updated_at=? WHERE id=?", (name, cnes, area, active, now_iso(), unit_id))
        audit("ALTERAR", "UNIDADE", unit_id, f"Unidade atualizada: {name}.")
        commit_with_backup()
        flash("Unidade atualizada.", "success")
    except sqlite3.IntegrityError:
        get_db().rollback()
        flash("Já existe uma unidade com esse nome.", "danger")
    return redirect(url_for("cadastro", tab="unidades"))


@app.route("/ifa/cadastro/unidade/excluir/<int:unit_id>", methods=["POST"])
@login_required
def unidade_excluir(unit_id: int):
    validate_csrf()
    db = get_db()
    unit = db.execute("SELECT * FROM units WHERE id=?", (unit_id,)).fetchone()
    if not unit:
        abort(404)
    count = db.execute("SELECT COUNT(*) FROM agents WHERE unit_id=?", (unit_id,)).fetchone()[0]
    if count:
        flash("Não é possível excluir uma unidade que possui profissionais vinculados. Desative-a ou mova os profissionais.", "danger")
    else:
        db.execute("DELETE FROM units WHERE id=?", (unit_id,))
        audit("EXCLUIR", "UNIDADE", unit_id, f"Unidade excluída: {unit['name']}.")
        commit_with_backup()
        flash("Unidade excluída.", "success")
    return redirect(url_for("cadastro", tab="unidades"))


@app.route("/ifa/cadastro/agente/novo", methods=["POST"])
@login_required
def agente_novo():
    validate_csrf()
    form = request.form
    full_name = form.get("full_name", "").strip()
    unit_id = form.get("unit_id", type=int)
    category = form.get("category", "ACS")
    if not full_name or not unit_id or category not in ("ACS", "ACE"):
        flash("Preencha nome, categoria e unidade.", "danger")
        return redirect(url_for("cadastro", tab="agentes"))
    stamp = now_iso()
    try:
        cur = get_db().execute(
            """
            INSERT INTO agents(full_name,cpf,cns,category,unit_id,microarea,admission_date,active,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,1,?,?)
            """,
            (full_name, form.get("cpf", "").strip() or None, form.get("cns", "").strip(), category, unit_id, form.get("microarea", "").strip(), form.get("admission_date", "").strip(), stamp, stamp),
        )
        audit("CRIAR", "AGENTE", cur.lastrowid, f"Profissional cadastrado: {full_name} ({category}).")
        commit_with_backup()
        flash("Profissional cadastrado com sucesso.", "success")
    except sqlite3.IntegrityError:
        get_db().rollback()
        flash("O CPF informado já está cadastrado.", "danger")
    return redirect(url_for("cadastro", tab="agentes"))


@app.route("/ifa/cadastro/agente/editar/<int:agent_id>", methods=["POST"])
@login_required
def agente_editar(agent_id: int):
    validate_csrf()
    form = request.form
    full_name = form.get("full_name", "").strip()
    unit_id = form.get("unit_id", type=int)
    category = form.get("category", "ACS")
    active = 1 if form.get("active") == "1" else 0
    if not full_name or not unit_id or category not in ("ACS", "ACE"):
        flash("Preencha nome, categoria e unidade.", "danger")
        return redirect(url_for("cadastro", tab="agentes"))
    try:
        get_db().execute(
            """
            UPDATE agents SET full_name=?, cpf=?, cns=?, category=?, unit_id=?, microarea=?, admission_date=?, active=?, updated_at=? WHERE id=?
            """,
            (full_name, form.get("cpf", "").strip() or None, form.get("cns", "").strip(), category, unit_id, form.get("microarea", "").strip(), form.get("admission_date", "").strip(), active, now_iso(), agent_id),
        )
        audit("ALTERAR", "AGENTE", agent_id, f"Profissional atualizado: {full_name} ({category}).")
        commit_with_backup()
        flash("Profissional atualizado.", "success")
    except sqlite3.IntegrityError:
        get_db().rollback()
        flash("O CPF informado já está cadastrado.", "danger")
    return redirect(url_for("cadastro", tab="agentes"))


@app.route("/ifa/cadastro/agente/excluir/<int:agent_id>", methods=["POST"])
@login_required
def agente_excluir(agent_id: int):
    validate_csrf()
    db = get_db()
    agent = db.execute("SELECT * FROM agents WHERE id=?", (agent_id,)).fetchone()
    if not agent:
        abort(404)
    count = db.execute("SELECT COUNT(*) FROM evaluations WHERE agent_id=?", (agent_id,)).fetchone()[0]
    if count:
        flash("Este profissional possui avaliações. Para preservar o histórico, desative-o em vez de excluir.", "danger")
    else:
        db.execute("DELETE FROM agents WHERE id=?", (agent_id,))
        audit("EXCLUIR", "AGENTE", agent_id, f"Profissional excluído: {agent['full_name']}.")
        commit_with_backup()
        flash("Profissional excluído.", "success")
    return redirect(url_for("cadastro", tab="agentes"))


@app.route("/ifa/criterios")
@login_required
def criterios():
    rows = get_db().execute("SELECT * FROM indicators WHERE active=1 ORDER BY category, order_index").fetchall()
    return render_template("criterios.html", rows=rows)


@app.route("/ifa/administracao")
@admin_required
def administracao():
    db = get_db()
    users = db.execute("SELECT id,name,username,role,active,created_at,updated_at FROM users ORDER BY name").fetchall()
    logs = db.execute(
        "SELECT l.*, u.name AS user_name FROM audit_log l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 80"
    ).fetchall()
    backups = []
    for kind, folder in (("Automático", AUTO_BACKUP_DIR), ("Manual", MANUAL_BACKUP_DIR)):
        for path in folder.glob("*.db"):
            backups.append({"name": path.name, "kind": kind, "size": path.stat().st_size, "mtime": datetime.fromtimestamp(path.stat().st_mtime), "folder": "auto" if kind == "Automático" else "manual"})
    backups.sort(key=lambda x: x["mtime"], reverse=True)
    return render_template("administracao.html", users=users, logs=logs, backups=backups[:50])


@app.route("/ifa/administracao/usuario/novo", methods=["POST"])
@admin_required
def usuario_novo():
    validate_csrf()
    name = request.form.get("name", "").strip()
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    role = request.form.get("role", "REGULADOR")
    if not name or not username or len(password) < 8 or role not in ("ADM", "REGULADOR"):
        flash("Preencha os campos. A senha deve ter pelo menos 8 caracteres.", "danger")
        return redirect(url_for("administracao"))
    stamp = now_iso()
    try:
        cur = get_db().execute(
            "INSERT INTO users(name,username,password_hash,role,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)",
            (name, username, generate_password_hash(password), role, stamp, stamp),
        )
        audit("CRIAR", "USUARIO", cur.lastrowid, f"Usuário criado: {username} ({role}).")
        commit_with_backup()
        flash("Perfil de acesso criado.", "success")
    except sqlite3.IntegrityError:
        get_db().rollback()
        flash("Este nome de usuário já está em uso.", "danger")
    return redirect(url_for("administracao"))


@app.route("/ifa/administracao/usuario/editar/<int:user_id>", methods=["POST"])
@admin_required
def usuario_editar(user_id: int):
    validate_csrf()
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        abort(404)
    name = request.form.get("name", "").strip()
    role = request.form.get("role", "REGULADOR")
    active = 1 if request.form.get("active") == "1" else 0
    password = request.form.get("password", "")
    if user_id == g.user["id"] and not active:
        flash("Você não pode desativar o próprio acesso.", "danger")
        return redirect(url_for("administracao"))
    removing_last_admin = user["role"] == "ADM" and (role != "ADM" or not active)
    if removing_last_admin:
        active_admins = db.execute("SELECT COUNT(*) FROM users WHERE role='ADM' AND active=1").fetchone()[0]
        if active_admins <= 1:
            flash("O sistema deve manter pelo menos um Administrador ativo.", "danger")
            return redirect(url_for("administracao"))
    if role not in ("ADM", "REGULADOR") or not name:
        flash("Dados do usuário inválidos.", "danger")
        return redirect(url_for("administracao"))
    if password and len(password) < 8:
        flash("A nova senha deve ter pelo menos 8 caracteres.", "danger")
        return redirect(url_for("administracao"))
    if password:
        db.execute("UPDATE users SET name=?, role=?, active=?, password_hash=?, updated_at=? WHERE id=?", (name, role, active, generate_password_hash(password), now_iso(), user_id))
    else:
        db.execute("UPDATE users SET name=?, role=?, active=?, updated_at=? WHERE id=?", (name, role, active, now_iso(), user_id))
    audit("ALTERAR", "USUARIO", user_id, f"Usuário atualizado: {user['username']} ({role}).")
    commit_with_backup()
    flash("Perfil atualizado.", "success")
    return redirect(url_for("administracao"))


@app.route("/ifa/administracao/backup-manual", methods=["POST"])
@admin_required
def backup_manual():
    validate_csrf()
    backup_path = create_backup("manual")
    json_path = backup_path.with_suffix(".json")
    export_database_json(json_path)
    zip_path = backup_path.with_suffix(".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(backup_path, backup_path.name)
        zf.write(json_path, json_path.name)
    audit("BACKUP", "SISTEMA", None, f"Backup manual gerado: {zip_path.name}.")
    get_db().commit()
    return send_file(zip_path, as_attachment=True, download_name=zip_path.name)


def export_database_json(path: Path) -> None:
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    payload = {"generated_at": now_iso(), "tables": {}}
    for table in ("users", "units", "agents", "indicators", "evaluations", "evaluation_items", "audit_log"):
        rows = [dict(row) for row in db.execute(f"SELECT * FROM {table}").fetchall()]
        if table == "users":
            for row in rows:
                row["password_hash"] = "[HASH OMITIDO NO JSON]"
        payload["tables"][table] = rows
    db.close()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


@app.route("/ifa/administracao/backup/baixar/<folder>/<path:filename>")
@admin_required
def backup_baixar(folder: str, filename: str):
    if folder not in ("auto", "manual"):
        abort(404)
    directory = AUTO_BACKUP_DIR if folder == "auto" else MANUAL_BACKUP_DIR
    safe = secure_filename(filename)
    path = directory / safe
    if not path.exists() or path.suffix != ".db":
        abort(404)
    return send_file(path, as_attachment=True, download_name=path.name)


@app.route("/ifa/administracao/restaurar", methods=["POST"])
@admin_required
def restaurar_backup():
    validate_csrf()
    upload = request.files.get("backup_file")
    if not upload or not upload.filename:
        flash("Selecione um arquivo .db de backup.", "danger")
        return redirect(url_for("administracao"))
    if not upload.filename.lower().endswith(".db"):
        flash("O arquivo de restauração deve ter extensão .db.", "danger")
        return redirect(url_for("administracao"))
    temp = Path(tempfile.mkstemp(suffix=".db")[1])
    try:
        upload.save(temp)
        test = sqlite3.connect(temp)
        required = {"users", "units", "agents", "indicators", "evaluations", "evaluation_items"}
        existing = {r[0] for r in test.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        test.close()
        if not required.issubset(existing):
            raise ValueError("Estrutura incompatível")
        create_backup("manual")
        close_db()
        shutil.copy2(temp, DATABASE)
        flash("Backup restaurado. Faça login novamente para atualizar a sessão.", "success")
        session.clear()
        return redirect(url_for("index"))
    except Exception:
        flash("Não foi possível restaurar: arquivo inválido ou incompatível.", "danger")
        return redirect(url_for("administracao"))
    finally:
        temp.unlink(missing_ok=True)


@app.route("/ifa/api/indicadores/<category>")
@login_required
def api_indicators(category: str):
    if category not in ("ACS", "ACE"):
        return jsonify([])
    rows = get_db().execute(
        "SELECT id, code, name, description, order_index FROM indicators WHERE category=? AND active=1 ORDER BY order_index",
        (category,),
    ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.errorhandler(400)
def bad_request(error):
    return render_template("error.html", code=400, title="Solicitação inválida", message=str(error.description)), 400


@app.errorhandler(404)
def not_found(_):
    return render_template("error.html", code=404, title="Página não encontrada", message="O endereço informado não existe ou o registro foi removido."), 404


@app.errorhandler(500)
def server_error(_):
    return render_template("error.html", code=500, title="Erro interno", message="O sistema encontrou um erro inesperado. Consulte o administrador."), 500


init_database()
import os
from flask import send_from_directory, redirect

@app.route('/cis')
@app.route('/cis/')
@app.route('/cis/<path:path>')
@app.route('/Cis')
@app.route('/Cis/')
@app.route('/Cis/<path:path>')
def redirecionar_cis(path=''):
    if path:
        return redirect('/CIS/' + path)
    return redirect('/CIS')

@app.route('/CIS')
@app.route('/CIS/')
@app.route('/CIS/<path:path>')
def sistema_cis(path='index.html'):
    pasta_cis = os.path.join(app.root_path, 'CIS')

    arquivo = os.path.join(pasta_cis, path)
    if path and os.path.exists(arquivo):
        return send_from_directory(pasta_cis, path)

    return send_from_directory(pasta_cis, 'index.html')


# ===== ROTA ESTOQUE HOSPITAL =====
@app.route('/estoquehospital')
@app.route('/estoquehospital/')
@app.route('/estoquehospital/<path:path>')
@app.route('/Estoquehospital')
@app.route('/Estoquehospital/')
@app.route('/Estoquehospital/<path:path>')
def redirecionar_estoque_hospital(path=''):
    if path:
        return redirect('/EstoqueHospital/' + path)
    return redirect('/EstoqueHospital')


@app.route('/EstoqueHospital')
@app.route('/EstoqueHospital/')
@app.route('/EstoqueHospital/<path:path>')
def sistema_estoque_hospital(path='index.html'):
    pasta_estoque = os.path.join(app.root_path, 'EstoqueHospital')

    arquivo = os.path.join(pasta_estoque, path)
    if path and os.path.exists(arquivo):
        return send_from_directory(pasta_estoque, path)

    return send_from_directory(pasta_estoque, 'index.html')
# ===== FIM ROTA ESTOQUE HOSPITAL =====

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
