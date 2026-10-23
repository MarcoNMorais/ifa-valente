"""Provisionamento único autenticado por assinatura Ed25519, sem senha do IFA."""
import base64,hashlib,io,json,sqlite3,tempfile,time,zipfile
from contextlib import closing
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature
from . import core
from .provision_key import PUBLIC_KEY

def provision(payload):
    try:
        manifest=base64.b64decode(payload['manifest'],validate=True)
        signature=base64.b64decode(payload['signature'],validate=True)
        Ed25519PublicKey.from_public_bytes(base64.b64decode(PUBLIC_KEY)).verify(signature,manifest)
        info=json.loads(manifest)
        if info['aud']!='secsaudevalente.com.br/secretaria' or info['expires']<time.time():
            raise ValueError('Pacote expirado')
        content=base64.b64decode(payload['content'],validate=True)
        if hashlib.sha256(content).hexdigest()!=info['sha256']: raise ValueError('Conteúdo alterado')
    except (KeyError,TypeError,ValueError,InvalidSignature):
        raise core.Problem('Assinatura de provisionamento inválida ou expirada.',403)
    with core.connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS secretaria_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        if db.execute("SELECT 1 FROM secretaria_meta WHERE key='presentation_imported'").fetchone() or db.execute('SELECT 1 FROM patients LIMIT 1').fetchone():
            raise core.Problem('A base já possui registros. Nenhum dado foi substituído.',409)
    with zipfile.ZipFile(io.BytesIO(content)) as archive, tempfile.TemporaryDirectory(dir=core.DATA,prefix='import-') as stage:
        if sum(i.file_size for i in archive.infolist())>100*1024*1024: raise core.Problem('Pacote muito grande.')
        source=Path(stage)/'snapshot.sqlite'
        source.write_bytes(archive.read('atendimento.sqlite'))
        with closing(sqlite3.connect(source)) as src:
            if src.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise core.Problem('Banco inválido.')
            counts={t:src.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['patients','visits','items','files']}
            src.execute('CREATE TABLE IF NOT EXISTS secretaria_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            src.execute("INSERT OR REPLACE INTO secretaria_meta VALUES('presentation_imported',?)",(str(time.time()),))
            src.execute("UPDATE files SET path=replace(path,char(92),'/')")
            src.commit()
            for entry in archive.infolist():
                if entry.filename=='atendimento.sqlite': continue
                target=(core.DATA/entry.filename).resolve()
                if not target.is_relative_to(core.DATA/'pacientes') or entry.is_dir(): raise core.Problem('Anexo inválido.')
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(archive.read(entry))
            with closing(sqlite3.connect(core.DATA/'atendimento.sqlite')) as dst: src.backup(dst)
    core.SESSIONS.clear()
    return counts
