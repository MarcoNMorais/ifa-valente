"""Módulo financeiro isolado da IG Integra Gestão.

Todas as rotas ficam sob /ig e os dados são mantidos em um banco separado
no mesmo disco persistente utilizado pelo serviço no Render.
"""
from __future__ import annotations

import os
import secrets
import sqlite3
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps
from pathlib import Path

from flask import abort, flash, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("IG_DATA_DIR", os.environ.get("IFA_DATA_DIR", BASE_DIR / "data")))
IG_DATABASE = DATA_DIR / "ig_financeiro.db"
IFA_DATABASE = DATA_DIR / "ifa_valente.db"

DEFAULT_CATEGORIES = {
    "entry": ("Mensalidade", "Serviço", "Conta recebida", "Outros"),
    "expense": ("Serviços", "Impostos", "Equipamentos", "Deslocamento", "Outros"),
}


def _connect_ig() -> sqlite3.Connection:
    db = sqlite3.connect(IG_DATABASE, timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    return db


def _connect_ifa() -> sqlite3.Connection:
    db = sqlite3.connect(IFA_DATABASE, timeout=20)
    db.row_factory = sqlite3.Row
    return db


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _today() -> str:
    return date.today().isoformat()


def _money(value: int | None) -> str:
    amount = (value or 0) / 100
    formatted = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {formatted}"


def _date_br(value: str | None) -> str:
    if not value:
        return "—"
    try:
        return date.fromisoformat(value).strftime("%d/%m/%Y")
    except ValueError:
        return value


def _valid_date(value: str) -> str | None:
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        return None


def _amount_to_cents(value: str) -> int:
    cleaned = (value or "").strip().replace("R$", "").replace(" ", "")
    if "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    try:
        amount = Decimal(cleaned).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return 0
    if amount <= 0:
        return 0
    return int(amount * 100)


def _init_database() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = _connect_ig()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS ig_people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL COLLATE NOCASE,
            phone TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ig_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL COLLATE NOCASE,
            type TEXT NOT NULL CHECK(type IN ('entry', 'expense')),
            created_at TEXT NOT NULL,
            UNIQUE(type, name)
        );

        CREATE TABLE IF NOT EXISTS ig_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL CHECK(type IN ('entry', 'expense')),
            description TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
            transaction_date TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            person_id INTEGER,
            paid_by_person_id INTEGER,
            created_by INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY(category_id) REFERENCES ig_categories(id) ON DELETE RESTRICT,
            FOREIGN KEY(person_id) REFERENCES ig_people(id) ON DELETE SET NULL,
            FOREIGN KEY(paid_by_person_id) REFERENCES ig_people(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS ig_receivables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
            due_date TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid')),
            paid_at TEXT,
            transaction_id INTEGER,
            created_by INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY(person_id) REFERENCES ig_people(id) ON DELETE RESTRICT,
            FOREIGN KEY(transaction_id) REFERENCES ig_transactions(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ig_transactions_date
            ON ig_transactions(transaction_date DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_ig_receivables_status_due
            ON ig_receivables(status, due_date);
        """
    )
    stamp = _now()
    for category_type, names in DEFAULT_CATEGORIES.items():
        db.executemany(
            "INSERT OR IGNORE INTO ig_categories(name, type, created_at) VALUES(?,?,?)",
            [(name, category_type, stamp) for name in names],
        )
    db.commit()
    db.close()


def _csrf_token() -> str:
    token = session.get("ig_csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["ig_csrf_token"] = token
    return token


def _validate_csrf() -> None:
    submitted = request.form.get("csrf_token", "")
    stored = session.get("ig_csrf_token", "")
    if not submitted or not stored or not secrets.compare_digest(submitted, stored):
        abort(400, "Token de segurança inválido. Atualize a página e tente novamente.")


def _current_user():
    user_id = session.get("ig_user_id")
    if not user_id or not IFA_DATABASE.exists():
        return None
    db = _connect_ifa()
    try:
        return db.execute(
            "SELECT id, name, username, role, active FROM users WHERE id=? AND active=1 AND role='ADM'",
            (user_id,),
        ).fetchone()
    finally:
        db.close()


def _login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if _current_user() is None:
            flash("Faça login com o acesso ADM do IFA.", "warning")
            return redirect(url_for("ig_login"))
        return view(*args, **kwargs)

    return wrapped


def _person_exists(db: sqlite3.Connection, person_id: int | None) -> bool:
    return bool(person_id and db.execute("SELECT 1 FROM ig_people WHERE id=?", (person_id,)).fetchone())


def _category_for_type(db: sqlite3.Connection, category_id: int | None, movement_type: str):
    if not category_id:
        return None
    return db.execute(
        "SELECT id, name FROM ig_categories WHERE id=? AND type=?",
        (category_id, movement_type),
    ).fetchone()


def register_ig_routes(app) -> None:
    _init_database()
    app.jinja_env.globals["ig_csrf_token"] = _csrf_token
    app.jinja_env.filters["ig_money"] = _money
    app.jinja_env.filters["ig_date"] = _date_br

    @app.route("/IG")
    @app.route("/IG/")
    def ig_upper_redirect():
        return redirect(url_for("ig_dashboard"))

    @app.route("/ig/login", methods=["GET", "POST"])
    def ig_login():
        if _current_user() is not None:
            return redirect(url_for("ig_dashboard"))
        if request.method == "POST":
            _validate_csrf()
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            user = None
            if IFA_DATABASE.exists():
                db = _connect_ifa()
                try:
                    user = db.execute(
                        "SELECT id, name, username, password_hash, role, active "
                        "FROM users WHERE username=? COLLATE NOCASE AND active=1 AND role='ADM'",
                        (username,),
                    ).fetchone()
                finally:
                    db.close()
            if user and check_password_hash(user["password_hash"], password):
                session["ig_user_id"] = user["id"]
                session["ig_csrf_token"] = secrets.token_urlsafe(32)
                return redirect(url_for("ig_dashboard"))
            flash("Usuário ou senha inválidos. Use um acesso ADM do IFA.", "danger")
        return render_template("ig/login.html")

    @app.route("/ig/logout")
    def ig_logout():
        session.pop("ig_user_id", None)
        session.pop("ig_csrf_token", None)
        return redirect(url_for("ig_login"))

    @app.route("/ig")
    @app.route("/ig/")
    @_login_required
    def ig_dashboard():
        user = _current_user()
        db = _connect_ig()
        try:
            people = db.execute(
                """
                SELECT p.id, p.name, p.phone, p.notes,
                       COUNT(t.id) AS payment_count,
                       COALESCE(SUM(t.amount_cents), 0) AS total_paid_cents,
                       MAX(t.transaction_date) AS last_payment_date
                FROM ig_people p
                LEFT JOIN ig_transactions t ON t.person_id=p.id AND t.type='entry'
                GROUP BY p.id
                ORDER BY p.name COLLATE NOCASE
                """
            ).fetchall()
            categories = db.execute(
                "SELECT id, name, type FROM ig_categories ORDER BY type, name COLLATE NOCASE"
            ).fetchall()
            transactions = db.execute(
                """
                SELECT t.*, c.name AS category_name,
                       person.name AS person_name,
                       payer.name AS paid_by_person_name
                FROM ig_transactions t
                JOIN ig_categories c ON c.id=t.category_id
                LEFT JOIN ig_people person ON person.id=t.person_id
                LEFT JOIN ig_people payer ON payer.id=t.paid_by_person_id
                ORDER BY t.transaction_date DESC, t.id DESC
                """
            ).fetchall()
            receivables = db.execute(
                """
                SELECT r.*, p.name AS person_name
                FROM ig_receivables r
                JOIN ig_people p ON p.id=r.person_id
                ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.due_date, r.id DESC
                """
            ).fetchall()
        finally:
            db.close()

        entries = sum(row["amount_cents"] for row in transactions if row["type"] == "entry")
        expenses = sum(row["amount_cents"] for row in transactions if row["type"] == "expense")
        pending = sum(row["amount_cents"] for row in receivables if row["status"] == "pending")
        totals = {"entries": entries, "expenses": expenses, "pending": pending, "balance": entries - expenses}
        active_tab = request.args.get("tab", "overview")
        if active_tab not in {"overview", "movement", "receivables", "people", "categories"}:
            active_tab = "overview"
        return render_template(
            "ig/dashboard.html",
            user=user,
            people=people,
            categories=categories,
            transactions=transactions,
            receivables=receivables,
            totals=totals,
            today=_today(),
            active_tab=active_tab,
        )

    @app.route("/ig/pessoas/adicionar", methods=["POST"])
    @_login_required
    def ig_add_person():
        _validate_csrf()
        name = request.form.get("name", "").strip()
        phone = request.form.get("phone", "").strip()
        notes = request.form.get("notes", "").strip()
        if not name or len(name) > 120:
            flash("Informe um nome com até 120 caracteres.", "danger")
            return redirect(url_for("ig_dashboard", tab="people"))
        db = _connect_ig()
        try:
            db.execute(
                "INSERT INTO ig_people(name, phone, notes, created_at) VALUES(?,?,?,?)",
                (name, phone[:40], notes[:300], _now()),
            )
            db.commit()
        finally:
            db.close()
        flash("Pessoa adicionada com sucesso.", "success")
        return redirect(url_for("ig_dashboard", tab="people"))

    @app.route("/ig/categorias/adicionar", methods=["POST"])
    @_login_required
    def ig_add_category():
        _validate_csrf()
        name = request.form.get("name", "").strip()
        category_type = request.form.get("type", "")
        return_tab = request.form.get("return_tab", "categories")
        if category_type not in {"entry", "expense"} or not name or len(name) > 60:
            flash("Informe uma categoria válida com até 60 caracteres.", "danger")
            return redirect(url_for("ig_dashboard", tab=return_tab))
        db = _connect_ig()
        try:
            db.execute(
                "INSERT INTO ig_categories(name, type, created_at) VALUES(?,?,?)",
                (name, category_type, _now()),
            )
            db.commit()
            flash("Categoria adicionada.", "success")
        except sqlite3.IntegrityError:
            flash("Essa categoria já está cadastrada.", "warning")
        finally:
            db.close()
        return redirect(url_for("ig_dashboard", tab=return_tab))

    @app.route("/ig/movimentos/adicionar", methods=["POST"])
    @_login_required
    def ig_add_transaction():
        _validate_csrf()
        user = _current_user()
        movement_type = request.form.get("type", "")
        description = request.form.get("description", "").strip()
        category_id = request.form.get("category_id", type=int)
        amount_cents = _amount_to_cents(request.form.get("amount", ""))
        transaction_date = _valid_date(request.form.get("transaction_date", ""))
        notes = request.form.get("notes", "").strip()
        person_id = request.form.get("person_id", type=int)
        paid_by_person_id = request.form.get("paid_by_person_id", type=int)

        db = _connect_ig()
        try:
            category = _category_for_type(db, category_id, movement_type)
            if (
                movement_type not in {"entry", "expense"}
                or not description
                or len(description) > 160
                or not category
                or amount_cents <= 0
                or not transaction_date
            ):
                flash("Preencha descrição, categoria cadastrada, valor e data.", "danger")
                return redirect(url_for("ig_dashboard", tab="movement"))
            if person_id and not _person_exists(db, person_id):
                flash("A pessoa informada não foi encontrada.", "danger")
                return redirect(url_for("ig_dashboard", tab="movement"))
            if paid_by_person_id and not _person_exists(db, paid_by_person_id):
                flash("A pessoa informada em quem pagou não foi encontrada.", "danger")
                return redirect(url_for("ig_dashboard", tab="movement"))

            db.execute(
                """
                INSERT INTO ig_transactions(
                    type, description, category_id, amount_cents, transaction_date,
                    notes, person_id, paid_by_person_id, created_by, created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    movement_type,
                    description,
                    category_id,
                    amount_cents,
                    transaction_date,
                    notes[:300],
                    person_id if movement_type == "entry" else None,
                    paid_by_person_id if movement_type == "expense" else None,
                    user["id"],
                    _now(),
                ),
            )
            db.commit()
        finally:
            db.close()
        flash("Entrada registrada." if movement_type == "entry" else "Saída registrada.", "success")
        return redirect(url_for("ig_dashboard", tab="movement"))

    @app.route("/ig/a-receber/adicionar", methods=["POST"])
    @_login_required
    def ig_add_receivable():
        _validate_csrf()
        user = _current_user()
        person_id = request.form.get("person_id", type=int)
        description = request.form.get("description", "").strip()
        amount_cents = _amount_to_cents(request.form.get("amount", ""))
        due_date = _valid_date(request.form.get("due_date", ""))
        db = _connect_ig()
        try:
            if (
                not _person_exists(db, person_id)
                or not description
                or len(description) > 160
                or amount_cents <= 0
                or not due_date
            ):
                flash("Informe pessoa, descrição, valor e vencimento.", "danger")
                return redirect(url_for("ig_dashboard", tab="receivables"))
            db.execute(
                """
                INSERT INTO ig_receivables(
                    person_id, description, amount_cents, due_date, status,
                    created_by, created_at
                ) VALUES(?,?,?,?, 'pending', ?,?)
                """,
                (person_id, description, amount_cents, due_date, user["id"], _now()),
            )
            db.commit()
        finally:
            db.close()
        flash("Conta a receber adicionada.", "success")
        return redirect(url_for("ig_dashboard", tab="receivables"))

    @app.route("/ig/a-receber/<int:receivable_id>/confirmar", methods=["POST"])
    @_login_required
    def ig_confirm_receivable(receivable_id: int):
        _validate_csrf()
        user = _current_user()
        db = _connect_ig()
        try:
            item = db.execute(
                "SELECT * FROM ig_receivables WHERE id=?", (receivable_id,)
            ).fetchone()
            if not item:
                abort(404)
            if item["status"] == "paid":
                return redirect(url_for("ig_dashboard", tab="receivables"))
            category = db.execute(
                "SELECT id FROM ig_categories WHERE type='entry' AND name='Conta recebida' COLLATE NOCASE"
            ).fetchone()
            cursor = db.execute(
                """
                INSERT INTO ig_transactions(
                    type, description, category_id, amount_cents, transaction_date,
                    notes, person_id, paid_by_person_id, created_by, created_at
                ) VALUES('entry',?,?,?,?, '', ?, NULL, ?,?)
                """,
                (
                    item["description"],
                    category["id"],
                    item["amount_cents"],
                    _today(),
                    item["person_id"],
                    user["id"],
                    _now(),
                ),
            )
            db.execute(
                "UPDATE ig_receivables SET status='paid', paid_at=?, transaction_id=? WHERE id=?",
                (_today(), cursor.lastrowid, receivable_id),
            )
            db.commit()
        finally:
            db.close()
        flash("Recebimento confirmado e lançado nas entradas.", "success")
        return redirect(url_for("ig_dashboard", tab="receivables"))
