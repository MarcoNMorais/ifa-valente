from __future__ import annotations

import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import jsonify, redirect, request, send_file, send_from_directory

VERSAO_CIS = 14
MAX_BACKUPS_AUTO = 10
MAX_BACKUPS_LISTA = 10


def _now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")


def _iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _default_state() -> dict[str, Any]:
    return {
        "versao": VERSAO_CIS,
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
    1) CIS_DATA_DIR, se for criada no Render.
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

    def clean_state(data: dict[str, Any]) -> dict[str, Any]:
        allowed = ["versao", "atualizadoEm", "pacientes", "procedimentos", "codigos", "locais", "users", "logs"]
        clean = {k: data.get(k) for k in allowed if k in data}
        clean.setdefault("versao", VERSAO_CIS)
        clean["versao"] = max(int(clean.get("versao") or 0), VERSAO_CIS)
        clean["atualizadoEm"] = data.get("atualizadoEm") or _iso_now()
        for key in ["pacientes", "procedimentos", "codigos", "locais", "users", "logs"]:
            if not isinstance(clean.get(key), list):
                clean[key] = _default_state()[key]
        if not clean.get("users"):
            clean["users"] = _default_state()["users"]
        return clean

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
            base["versao"] = max(int(base.get("versao") or 0), VERSAO_CIS)
            return clean_state(base)
        except Exception:
            broken = cis_backup_dir / f"cis_database_corrompido_{_now_stamp()}.json"
            try:
                shutil.copy2(cis_data_file, broken)
            except Exception:
                pass
            return _default_state()

    def comparable_state(data: dict[str, Any]) -> dict[str, Any]:
        comp = dict(data or {})
        comp.pop("atualizadoEm", None)
        return comp

    def rotate_auto_backups(max_keep: int = MAX_BACKUPS_AUTO) -> None:
        backups = sorted(cis_backup_dir.glob("cis_database_auto_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in backups[max_keep:]:
            try:
                old.unlink()
            except Exception:
                pass

    def create_auto_backup_if_needed(new_clean: dict[str, Any]) -> bool:
        """Cria backup automático antes de sobrescrever, mas evita backup duplicado quando nada mudou."""
        if not cis_data_file.exists():
            return False
        try:
            with cis_data_file.open("r", encoding="utf-8") as f:
                current = json.load(f)
            if comparable_state(current) == comparable_state(new_clean):
                return False
        except Exception:
            # Se o arquivo atual tiver problema, salva uma cópia antes de sobrescrever.
            pass

        backup = cis_backup_dir / f"cis_database_auto_{_now_stamp()}.json"
        try:
            shutil.copy2(cis_data_file, backup)
            rotate_auto_backups()
            return True
        except Exception:
            return False

    def write_state(data: dict[str, Any]) -> dict[str, Any]:
        ensure_dirs()
        clean = clean_state(data)
        create_auto_backup_if_needed(clean)

        temp_file = cis_data_file.with_suffix(".json.tmp")
        with temp_file.open("w", encoding="utf-8") as f:
            json.dump(clean, f, ensure_ascii=False, indent=2)
        os.replace(temp_file, cis_data_file)
        return clean

    def backup_info(path: Path) -> dict[str, Any]:
        stat = path.stat()
        tipo = "Manual" if "_manual_" in path.name else "Automático" if "_auto_" in path.name else "Sistema"
        return {
            "nome": path.name,
            "tipo": tipo,
            "tamanho": stat.st_size,
            "criadoEm": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            "download_url": f"/api/cis/backup/{path.name}",
        }

    def list_backups(limit: int = MAX_BACKUPS_LISTA) -> list[dict[str, Any]]:
        ensure_dirs()
        arquivos = []
        for padrao in ["cis_database_auto_*.json", "cis_database_manual_*.json", "cis_database_corrompido_*.json"]:
            arquivos.extend(cis_backup_dir.glob(padrao))
        arquivos = sorted([p for p in arquivos if p.is_file()], key=lambda p: p.stat().st_mtime, reverse=True)
        return [backup_info(p) for p in arquivos[:limit]]

    def api_cis_dados():
        return jsonify(ok=True, data=read_state(), storage=str(cis_data_file))

    def api_cis_salvar():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(ok=False, erro="JSON inválido"), 400
        saved = write_state(data)
        return jsonify(ok=True, atualizadoEm=saved.get("atualizadoEm"), storage=str(cis_data_file), backups=list_backups())

    def api_cis_backup():
        ensure_dirs()
        if not cis_data_file.exists():
            write_state(_default_state())
        manual = cis_backup_dir / f"cis_database_manual_{_now_stamp()}.json"
        shutil.copy2(cis_data_file, manual)
        return send_file(manual, as_attachment=True, download_name=manual.name, mimetype="application/json")

    def api_cis_backups():
        try:
            limit = int(request.args.get("limit", MAX_BACKUPS_LISTA))
        except Exception:
            limit = MAX_BACKUPS_LISTA
        limit = max(1, min(limit, 30))
        return jsonify(ok=True, backups=list_backups(limit), pasta=str(cis_backup_dir), total_exibido=min(limit, MAX_BACKUPS_LISTA))

    def api_cis_download_backup(filename: str):
        ensure_dirs()
        safe_name = Path(filename).name
        path = cis_backup_dir / safe_name
        if not path.exists() or not path.is_file() or not safe_name.startswith("cis_database_") or path.suffix.lower() != ".json":
            return jsonify(ok=False, erro="Backup não encontrado"), 404
        return send_file(path, as_attachment=True, download_name=safe_name, mimetype="application/json")

    def api_cis_status():
        ensure_dirs()
        return jsonify(
            ok=True,
            cis_data_dir=str(cis_data_dir),
            cis_data_file=str(cis_data_file),
            cis_backup_dir=str(cis_backup_dir),
            exists=cis_data_file.exists(),
            size=cis_data_file.stat().st_size if cis_data_file.exists() else 0,
            atualizadoEm=datetime.fromtimestamp(cis_data_file.stat().st_mtime).isoformat(timespec="seconds") if cis_data_file.exists() else None,
            backups=list_backups(),
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
    # usarem esta versão com persistência e backups, sem precisar editar o app.py.
    endpoint_map = {
        "api_cis_dados": api_cis_dados,
        "api_cis_salvar": api_cis_salvar,
        "api_cis_backup": api_cis_backup,
        "api_cis_backups": api_cis_backups,
        "api_cis_download_backup": api_cis_download_backup,
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
    if "api_cis_backups" not in existing_endpoints:
        app.add_url_rule("/api/cis/backups", endpoint="api_cis_backups", view_func=api_cis_backups, methods=["GET"])
    if "api_cis_download_backup" not in existing_endpoints:
        app.add_url_rule("/api/cis/backup/<path:filename>", endpoint="api_cis_download_backup", view_func=api_cis_download_backup, methods=["GET"])
    if "api_cis_status" not in existing_endpoints:
        app.add_url_rule("/api/cis/status", endpoint="api_cis_status", view_func=api_cis_status, methods=["GET"])

    if "redirecionar_cis" not in existing_endpoints:
        for rule in ["/cis", "/cis/", "/cis/<path:path>", "/Cis", "/Cis/", "/Cis/<path:path>"]:
            app.add_url_rule(rule, endpoint="redirecionar_cis", view_func=redirecionar_cis)

    if "sistema_cis" not in existing_endpoints:
        for rule in ["/CIS", "/CIS/", "/CIS/<path:path>"]:
            app.add_url_rule(rule, endpoint="sistema_cis", view_func=sistema_cis)

    return app
