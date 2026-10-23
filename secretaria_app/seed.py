"""Importação privada e única por administrador autenticado."""
import hashlib
import io
import json
import sqlite3
import time
import tempfile
from pathlib import Path
import zipfile
from contextlib import closing
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag
from . import core

AAD=b'secretaria-valente-presentation-v1'

def import_presentation(encrypted,password,username):
    with core.connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS secretaria_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        if db.execute("SELECT 1 FROM secretaria_meta WHERE key='presentation_imported'").fetchone():
            raise core.Problem('A apresentação já foi importada. Seus dados foram preservados.',409)
        # Never replace a database that has already received records.
        if db.execute('SELECT 1 FROM patients LIMIT 1').fetchone():
            raise core.Problem('O banco já possui pacientes. A importação não substitui dados existentes.',409)
    if len(encrypted)<48 or encrypted[:4]!=b'SEV1': raise core.Problem('Arquivo de apresentação inválido.')
    key=hashlib.pbkdf2_hmac('sha256',password.encode(),encrypted[4:20],600000,dklen=32)
    try:
        plain=AESGCM(key).decrypt(encrypted[20:32],encrypted[32:],AAD)
    except InvalidTag:
        raise core.Problem('A senha não abre este pacote de apresentação.')
    with zipfile.ZipFile(io.BytesIO(plain)) as archive:
        if sum(i.file_size for i in archive.infolist())>100*1024*1024: raise core.Problem('Apresentação muito grande.')
        snapshot=archive.read('atendimento.sqlite')
        with tempfile.TemporaryDirectory(prefix='import-',dir=core.DATA) as stage:
            (Path(stage)/'snapshot.sqlite').write_bytes(snapshot)
            with closing(sqlite3.connect(Path(stage)/'snapshot.sqlite')) as src:
                if src.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise core.Problem('Banco da apresentação inválido.')
                user=src.execute("SELECT password FROM users WHERE username=? COLLATE NOCASE AND active=1 AND role='ADM'",(username,)).fetchone()
                if not user or not core.password_ok(password,user[0]): raise core.Problem('Administrador da apresentação inválido.')
                src.execute('CREATE TABLE IF NOT EXISTS secretaria_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
                src.execute("UPDATE files SET path=replace(path, char(92), '/')")
                src.execute("INSERT OR REPLACE INTO secretaria_meta VALUES('presentation_imported',?)",(str(time.time()),))
                src.commit()
                counts={t:src.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['patients','visits','items','files']}
                for info in archive.infolist():
                    if info.filename=='atendimento.sqlite': continue
                    target=(core.DATA/info.filename).resolve()
                    if not target.is_relative_to(core.DATA/'pacientes') or info.is_dir(): raise core.Problem('Anexo inválido.')
                    target.parent.mkdir(parents=True,exist_ok=True)
                    target.write_bytes(archive.read(info))
                with closing(sqlite3.connect(core.DATA/'atendimento.sqlite')) as dst:
                    src.backup(dst)
                return counts
