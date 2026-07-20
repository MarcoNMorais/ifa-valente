from __future__ import annotations

import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import jsonify, redirect, request, send_file, send_from_directory


def _now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")


def _iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _default_state() -> dict[str, Any]:
    return {
        "versao": 13,
        "atualizadoEm": _iso_now(),
        "pacientes": [],
        "procedimentos": [],
        "codigos": [],
        "locais": [],
        "users": [
            {"id": "admin-default", "user": "admin", "pass": "1234", "role": "admin", "name": "admin", "active": True},
            {"id": "regulador-default", "user": "regulador", "pass": "1234", "role": "regulador", "name": "regulador", "active": True},
        ],
        "logs": [],
    }


def _resolve_cis_data_dir(app) -> Path:
    """
    Ordem de prioridade:
    1) CIS_DATA_DIR, se você criar essa variável no Render.
    2) IFA_DATA_DIR + /cis, usando o mesmo disco persistente do IFA.
    3) pasta data/cis dentro do projeto, para teste local.
    """
    cis_env = os.environ.get("CIS_DATA_DIR")
    if cis_env:
        return Path(cis_env)

    ifa_env = os.environ.get("IFA_DATA_DIR")
    if ifa_env:
        return Path(ifa_env) / "cis"

    return Path(app.root_path) / "data" / "cis"


def register_cis_routes(app):
    cis_dir = Path(app.root_path) / "CIS"
    cis_data_dir = _resolve_cis_data_dir(app)
    cis_backup_dir = cis_data_dir / "backups"
    cis_data_file = cis_data_dir / "cis_database.json"

    def ensure_dirs() -> None:
        cis_data_dir.mkdir(parents=True, exist_ok=True)
        cis_backup_dir.mkdir(parents=True, exist_ok=True)

    def read_state() -> dict[str, Any]:
        ensure_dirs()
        if not cis_data_file.exists():
            return _default_state()
        try:
            with cis_data_file.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                return _default_state()
            base = _default_state()
            base.update(data)
            base["versao"] = max(int(base.get("versao") or 0), 13)
            return base
        except Exception:
            broken = cis_backup_dir / f"cis_database_corrompido_{_now_stamp()}.json"
            try:
                shutil.copy2(cis_data_file, broken)
            except Exception:
                pass
            return _default_state()

    def clean_state(data: dict[str, Any]) -> dict[str, Any]:
        allowed = ["versao", "atualizadoEm", "pacientes", "procedimentos", "codigos", "locais", "users", "logs"]
        clean = {k: data.get(k) for k in allowed if k in data}
        clean.setdefault("versao", 13)
        clean["versao"] = max(int(clean.get("versao") or 0), 13)
        clean["atualizadoEm"] = data.get("atualizadoEm") or _iso_now()
        for key in ["pacientes", "procedimentos", "codigos", "locais", "users", "logs"]:
            if not isinstance(clean.get(key), list):
                clean[key] = _default_state()[key]
        if not clean.get("users"):
            clean["users"] = _default_state()["users"]
        return clean

    def rotate_backups(max_keep: int = 80) -> None:
        backups = sorted(cis_backup_dir.glob("cis_database_auto_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in backups[max_keep:]:
            try:
                old.unlink()
            except Exception:
                pass

    def write_state(data: dict[str, Any]) -> dict[str, Any]:
        ensure_dirs()
        clean = clean_state(data)

        if cis_data_file.exists():
            backup = cis_backup_dir / f"cis_database_auto_{_now_stamp()}.json"
            try:
                shutil.copy2(cis_data_file, backup)
                rotate_backups()
            except Exception:
                pass

        temp_file = cis_data_file.with_suffix(".json.tmp")
        with temp_file.open("w", encoding="utf-8") as f:
            json.dump(clean, f, ensure_ascii=False, indent=2)
        os.replace(temp_file, cis_data_file)
        return clean

    def api_cis_dados():
        return jsonify(ok=True, data=read_state(), storage=str(cis_data_file))

    def api_cis_salvar():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(ok=False, erro="JSON inválido"), 400
        saved = write_state(data)
        return jsonify(ok=True, atualizadoEm=saved.get("atualizadoEm"), storage=str(cis_data_file))

    def api_cis_backup():
        ensure_dirs()
        if not cis_data_file.exists():
            write_state(_default_state())
        manual = cis_backup_dir / f"cis_database_manual_{_now_stamp()}.json"
        shutil.copy2(cis_data_file, manual)
        return send_file(manual, as_attachment=True, download_name=manual.name, mimetype="application/json")

    def api_cis_status():
        ensure_dirs()
        return jsonify(
            ok=True,
            cis_data_dir=str(cis_data_dir),
            cis_data_file=str(cis_data_file),
            exists=cis_data_file.exists(),
            size=cis_data_file.stat().st_size if cis_data_file.exists() else 0,
            atualizadoEm=datetime.fromtimestamp(cis_data_file.stat().st_mtime).isoformat(timespec="seconds") if cis_data_file.exists() else None,
        )

    def redirecionar_cis(path=""):
        if path:
            return redirect("/CIS/" + path)
        return redirect("/CIS")

    def sistema_cis(path="index.html"):
        arquivo = cis_dir / path
        if path and arquivo.exists() and arquivo.is_file():
            return send_from_directory(cis_dir, path)
        return send_from_directory(cis_dir, "index.html")

    # Se o app.py antigo já tiver endpoints do CIS, estes replaces fazem as rotas antigas
    # usarem esta versão com persistência, sem precisar editar o app.py.
    endpoint_map = {
        "api_cis_dados": api_cis_dados,
        "api_cis_salvar": api_cis_salvar,
        "api_cis_backup": api_cis_backup,
        "api_cis_status": api_cis_status,
        "redirecionar_cis": redirecionar_cis,
        "sistema_cis": sistema_cis,
    }
    for endpoint, func in endpoint_map.items():
        app.view_functions[endpoint] = func

    existing_endpoints = {rule.endpoint for rule in app.url_map.iter_rules()}

    if "api_cis_dados" not in existing_endpoints:
        app.add_url_rule("/api/cis/dados", endpoint="api_cis_dados", view_func=api_cis_dados, methods=["GET"])
    if "api_cis_salvar" not in existing_endpoints:
        app.add_url_rule("/api/cis/salvar", endpoint="api_cis_salvar", view_func=api_cis_salvar, methods=["POST"])
    if "api_cis_backup" not in existing_endpoints:
        app.add_url_rule("/api/cis/backup", endpoint="api_cis_backup", view_func=api_cis_backup, methods=["GET"])
    if "api_cis_status" not in existing_endpoints:
        app.add_url_rule("/api/cis/status", endpoint="api_cis_status", view_func=api_cis_status, methods=["GET"])

    if "redirecionar_cis" not in existing_endpoints:
        for rule in ["/cis", "/cis/", "/cis/<path:path>", "/Cis", "/Cis/", "/Cis/<path:path>"]:
            app.add_url_rule(rule, endpoint="redirecionar_cis", view_func=redirecionar_cis)

    if "sistema_cis" not in existing_endpoints:
        for rule in ["/CIS", "/CIS/", "/CIS/<path:path>"]:
            app.add_url_rule(rule, endpoint="sistema_cis", view_func=sistema_cis)

    return app
