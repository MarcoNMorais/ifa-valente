"""Atendimento Especial - servidor local, somente biblioteca padrão Python 3.10+."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from http.cookies import SimpleCookie
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from collections import defaultdict
from contextlib import contextmanager, closing
import base64, csv, hashlib, hmac, html, io, json, mimetypes, os, re, secrets, sqlite3, sys, threading, time, unicodedata, zipfile

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path: sys.path.insert(0,str(ROOT))
DATA = Path(os.environ.get('SECRETARIA_DATA_DIR', Path(os.environ.get('IFA_DATA_DIR', ROOT.parent / 'data')) / 'secretaria')).resolve()
PORT = int(os.environ.get('ATENDIMENTO_PORT', '5088'))
FIELDS = ['name','cpf','birth','age','rg','sus','address','district','responsible','kinship','phone','diagnosis','cras','psf','acs']
LABELS = dict(zip(FIELDS, ['Nome','CPF','Data de nascimento','Idade','RG','Cartão do SUS','Endereço','Bairro','Responsável','Parentesco','Contato','Diagnóstico','CRAS','PSF','ACS']))
SESSIONS = {}
FAILURES = defaultdict(list)
LOCK = threading.RLock()

def norm(value):
    return ''.join(c for c in unicodedata.normalize('NFKD',str(value).casefold()) if not unicodedata.combining(c)).strip()

@contextmanager
def connect():
    db = sqlite3.connect(DATA/'atendimento.sqlite', timeout=20)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        with db:
            yield db
    finally:
        db.close()

def password_hash(value, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ':' + hashlib.pbkdf2_hmac('sha256',value.encode(),salt.encode(),260000).hex()

def password_ok(value, stored):
    if stored.startswith('werkzeug$'):
        from werkzeug.security import check_password_hash
        return check_password_hash(stored[len('werkzeug$'):], value)
    return hmac.compare_digest(password_hash(value,stored.split(':')[0]),stored)

def initialize():
    DATA.mkdir(parents=True,exist_ok=True)
    (DATA/'pacientes').mkdir(exist_ok=True)
    (DATA/'backups').mkdir(exist_ok=True)
    with connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE COLLATE NOCASE,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('ADM','SECRETARIA','DIGITADOR')),active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS patients(id INTEGER PRIMARY KEY,name TEXT NOT NULL,search TEXT NOT NULL,cpf TEXT UNIQUE,details TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name TEXT NOT NULL,search TEXT NOT NULL UNIQUE,unit TEXT NOT NULL DEFAULT 'unidade');
        CREATE TABLE IF NOT EXISTS suppliers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,search TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS visits(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),date TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',snapshot TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,request_id TEXT UNIQUE NOT NULL);
        CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY,visit_id INTEGER NOT NULL REFERENCES visits(id),product_id INTEGER NOT NULL REFERENCES products(id),supplier_id INTEGER REFERENCES suppliers(id),quantity REAL NOT NULL CHECK(quantity>0),cents INTEGER NOT NULL CHECK(cents>=0),description TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),visit_id INTEGER REFERENCES visits(id),name TEXT NOT NULL,path TEXT NOT NULL UNIQUE,mime TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor INTEGER,action TEXT NOT NULL,entity TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_patient_search ON patients(search);
        CREATE INDEX IF NOT EXISTS idx_visit_patient ON visits(patient_id,date);
        CREATE INDEX IF NOT EXISTS idx_visit_date ON visits(date);
        CREATE INDEX IF NOT EXISTS idx_item_product ON items(product_id,visit_id);
        ''')
        if not db.execute('SELECT 1 FROM users LIMIT 1').fetchone():
            # Initial copy only; subsequent credentials and sessions are independent.
            initial=os.environ.get('SECRETARIA_INITIAL_PASSWORD')
            if initial:
                if len(initial)<8: raise RuntimeError('Senha inicial muito curta.')
                stored=password_hash(initial)
            else:
                source=Path(os.environ.get('IFA_DATA_DIR',ROOT.parent/'data'))/'ifa_valente.db'
                with closing(sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True)) as src:
                    row=src.execute("SELECT password_hash FROM users WHERE username='admin' COLLATE NOCASE AND role='ADM' AND active=1").fetchone()
                if not row: raise RuntimeError('Administrador inicial não encontrado.')
                stored='werkzeug$'+row[0]
            db.execute('INSERT INTO users(name,username,password,role) VALUES(?,?,?,?)',('Administrador','Admin',stored,'ADM'))
        for name in ['Farmácia Cuidar Mais','Farmácia Mais Saúde','Laboratório','CLIMEV']:
            db.execute('INSERT OR IGNORE INTO suppliers(name,search) VALUES(?,?)',(name,norm(name)))
    backup_database()

def backup_database():
    target=DATA/'backups'/('banco-'+date.today().isoformat()+'.sqlite')
    if not target.exists():
        with LOCK, connect() as src, closing(sqlite3.connect(target)) as dst:
            src.backup(dst)

def audit(db,user,action,entity):
    db.execute('INSERT INTO audit(actor,action,entity,created_at) VALUES(?,?,?,?)',(user['id'],action,str(entity),datetime.now().isoformat(timespec='seconds')))

class Problem(Exception):
    def __init__(self,message,status=400,**extra): self.message,self.status,self.extra=message,status,extra

def textval(value,limit=250):
    if not isinstance(value,str) or len(value)>limit: raise Problem('Texto inválido ou muito longo.')
    return value.strip()

def valid_date(value,birth=False):
    if not isinstance(value,str) or not re.fullmatch(r'\d{2}/\d{2}/\d{4}',value): raise Problem('Informe a data no formato dd/mm/aaaa.')
    try: d=datetime.strptime(value,'%d/%m/%Y').date()
    except ValueError: raise Problem('Essa data não existe. Confira o dia e o mês.')
    if birth:
        if d>date.today() or d.year<date.today().year-130: raise Problem('Data de nascimento fora da realidade.')
    elif not 2000<=d.year<=date.today().year+10: raise Problem('Informe uma data de atendimento entre 2000 e os próximos 10 anos.')
    return d.isoformat()

def patient_values(payload):
    if not isinstance(payload,dict): raise Problem('Cadastro de paciente inválido.')
    values={f:textval(payload.get(f,''),1000 if f=='diagnosis' else 250) for f in FIELDS}
    if not values['name']: raise Problem('Informe o nome do paciente.')
    cpf=re.sub(r'\D','',values['cpf'])
    if cpf:
        if len(cpf)!=11 or len(set(cpf))==1: raise Problem('CPF inválido. Corrija ou deixe em branco.')
        for n in (9,10):
            dig=(sum(int(cpf[i])*(n+1-i) for i in range(n))*10)%11%10
            if dig!=int(cpf[n]): raise Problem('CPF inválido. Corrija ou deixe em branco.')
    values['cpf']=cpf
    if values['birth']:
        valid_date(values['birth'],True)
        b=datetime.strptime(values['birth'],'%d/%m/%Y').date(); now=date.today()
        values['age']=str(now.year-b.year-((now.month,now.day)<(b.month,b.day)))
    if values['age'] and (not values['age'].isdigit() or not 0<=int(values['age'])<=130): raise Problem('Idade inválida.')
    return values

def save_patient(db,payload,user,confirmed=False):
    values=patient_values(payload); pid=payload.get('id')
    if pid:
        old=db.execute('SELECT * FROM patients WHERE id=?',(pid,)).fetchone()
        if not old: raise Problem('Paciente não encontrado.',404)
        if payload.get('version')!=old['version']: raise Problem('O cadastro mudou. Selecione o paciente novamente antes de salvar.',409)
        before=json.loads(old['details']); changes=[{'field':LABELS[f],'before':before.get(f,''),'after':values[f]} for f in FIELDS if before.get(f,'')!=values[f]]
        if changes and not confirmed: raise Problem('Confirme as alterações dos dados pessoais.',409,changes=changes)
        if changes:
            db.execute('UPDATE patients SET name=?,search=?,cpf=?,details=?,version=version+1 WHERE id=?',(values['name'],norm(values['name']),values['cpf'] or None,json.dumps(values,ensure_ascii=False),pid))
            audit(db,user,'alterar paciente',json.dumps({'id':pid,'changes':changes},ensure_ascii=False))
    else:
        pid=db.execute('INSERT INTO patients(name,search,cpf,details) VALUES(?,?,?,?)',(values['name'],norm(values['name']),values['cpf'] or None,json.dumps(values,ensure_ascii=False))).lastrowid
        audit(db,user,'cadastrar paciente',pid)
    return pid

def patient_obj(row):
    return {**json.loads(row['details']),'id':row['id'],'version':row['version']}

def shift_month(key, delta):
    y,m=map(int,key.split('-')); n=y*12+m-1+delta
    return f'{n//12:04}-{n%12+1:02}'

def report(db,q):
    month=q.get('month',date.today().strftime('%Y-%m'))
    if not re.fullmatch(r'20\d{2}-(0[1-9]|1[0-2])',month): raise Problem('Mês inválido.')
    clauses=['v.date>=?','v.date<?']; args=[shift_month(month,-11)+'-01',shift_month(month,1)+'-01']
    for key,column in [('product','i.product_id'),('supplier','i.supplier_id')]:
        if q.get(key): clauses.append(column+'=?'); args.append(q[key])
    rows=db.execute('''SELECT v.id visit_id,v.date,v.patient_id,p.name patient,pr.id product_id,pr.name product,pr.unit,s.name supplier,i.quantity,i.cents FROM items i JOIN visits v ON v.id=i.visit_id JOIN patients p ON p.id=v.patient_id JOIN products pr ON pr.id=i.product_id LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE '''+' AND '.join(clauses)+' ORDER BY v.date DESC,v.id DESC',args).fetchall()
    months=[]
    for delta in range(-11,1):
        key=shift_month(month,delta); subset=[r for r in rows if r['date'][:7]==key]
        months.append({'month':key,'cents':sum(r['cents'] for r in subset),'quantity':sum(r['quantity'] for r in subset),'people':len({r['patient_id'] for r in subset})})
    current=[dict(r) for r in rows if r['date'][:7]==month]
    products=[]
    for pid in dict.fromkeys(r['product_id'] for r in current):
        subset=[r for r in current if r['product_id']==pid]
        prior=[r for r in rows if r['product_id']==pid and shift_month(month,-6)<=r['date'][:7]<month]
        qty=sum(r['quantity'] for r in subset); avg=sum(r['quantity'] for r in prior)/6
        products.append({'id':pid,'name':subset[0]['product'],'unit':subset[0]['unit'],'quantity':qty,'cents':sum(r['cents'] for r in subset),'people':len({r['patient_id'] for r in subset}),'average':avg,'growth':round((qty/avg-1)*100,1) if avg else None})
    total=months[-1]; previous=months[-2]['cents']
    return {'month':month,'summary':{**total,'visits':len({r['visit_id'] for r in current}),'variation':round((total['cents']/previous-1)*100,1) if previous else None},'months':months,'products':sorted(products,key=lambda x:x['quantity'],reverse=True),'rows':current}

def money(cents):
    return 'R$ '+f'{cents/100:,.2f}'.replace(',','X').replace('.',',').replace('X','.')

def period_bounds(q):
    start,end=q.get('from',''),q.get('to','')
    for value in (start,end):
        if value:
            try:
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value): raise ValueError()
                date.fromisoformat(value)
            except ValueError: raise Problem('Data do período inválida.')
    if start and end and start>end: raise Problem('A data inicial deve ser anterior ou igual à final.')
    return start,end

def history_data(db,q):
    p=db.execute('SELECT * FROM patients WHERE id=?',(q.get('patient'),)).fetchone()
    if not p: raise Problem('Paciente não encontrado.',404)
    start,end=period_bounds(q)
    sql='SELECT * FROM visits WHERE patient_id=?';args=[p['id']]
    if start: sql+=' AND date>=?';args.append(start)
    if end: sql+=' AND date<=?';args.append(end)
    visits=[]
    for v in db.execute(sql+' ORDER BY date DESC,id DESC',args):
        items=[dict(it) for it in db.execute('SELECT i.*,pr.name product,pr.unit,s.name supplier FROM items i JOIN products pr ON pr.id=i.product_id LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE visit_id=?',(v['id'],))]
        visits.append({**dict(v),'items':items,'cents':sum(it['cents'] for it in items)})
    ids={v['id'] for v in visits}
    files=[dict(f) for f in db.execute('SELECT id,visit_id,name,created_at FROM files WHERE patient_id=? ORDER BY id DESC',(p['id'],)) if not f['visit_id'] or f['visit_id'] in ids]
    return {'patient':patient_obj(p),'visits':visits,'files':files,'period':{'from':start,'to':end}}

def daily_report(db,q):
    raw=q.get('day','')
    start,end=period_bounds({'from':raw,'to':raw})
    if not start: raise Problem('Escolha o dia do relatório.')
    previous=(date.fromisoformat(start)-timedelta(days=1)).isoformat()
    where=['v.date IN (?,?)'];args=[previous,start]
    for key,column in [('product','i.product_id'),('supplier','i.supplier_id')]:
        if q.get(key): where.append(column+'=?');args.append(q[key])
    rows=[dict(r) for r in db.execute('SELECT v.id visit_id,v.date,v.patient_id,p.name patient,pr.id product_id,pr.name product,pr.unit,s.name supplier,i.quantity,i.cents FROM items i JOIN visits v ON v.id=i.visit_id JOIN patients p ON p.id=v.patient_id JOIN products pr ON pr.id=i.product_id LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE '+' AND '.join(where)+' ORDER BY v.id DESC,i.id',args)]
    current=[r for r in rows if r['date']==start];prior=sum(r['cents'] for r in rows if r['date']==previous)
    cents=sum(r['cents'] for r in current)
    groups={}
    for r in current:
        group=groups.setdefault(r['product_id'],{'id':r['product_id'],'name':r['product'],'unit':r['unit'],'quantity':0,'cents':0,'patients':set()})
        group['quantity']+=r['quantity'];group['cents']+=r['cents'];group['patients'].add(r['patient_id'])
    products=[]
    for group in groups.values():
        group['people']=len(group.pop('patients'));products.append(group)
    return {'day':start,'summary':{'cents':cents,'visits':len({r['visit_id'] for r in current}),'people':len({r['patient_id'] for r in current}),'variation':round((cents/prior-1)*100,1) if prior else None},'rows':current,'products':products,'months':[]}

def printable(db,pid,visit=None,period=None):
    patient=db.execute('SELECT * FROM patients WHERE id=?',(pid,)).fetchone()
    if not patient: raise Problem('Paciente não encontrado.',404)
    sql='SELECT * FROM visits WHERE patient_id=?'; args=[pid]
    if visit: sql+=' AND id=?'; args.append(visit)
    start,end=period_bounds(period or {})
    if start: sql+=' AND date>=?';args.append(start)
    if end: sql+=' AND date<=?';args.append(end)
    visits=db.execute(sql+' ORDER BY date,id',args).fetchall()
    if not visits: raise Problem('Nenhum atendimento para imprimir.',404)
    esc=lambda x: html.escape(str(x or ''))
    months=['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO']
    groups=defaultdict(list)
    for v in visits: groups[v['date'][:7]].append(v)
    pages=[]
    for key,vs in groups.items():
        rows=[]
        for v in vs:
            for it in db.execute('SELECT i.*,p.name product,p.unit,s.name supplier FROM items i JOIN products p ON p.id=i.product_id LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE visit_id=? ORDER BY i.id',(v['id'],)):
                rows.append((v,it))
        for start in range(0,len(rows),5):
            chunk=rows[start:start+5]
            p=json.loads(chunk[-1][0]['snapshot']) if visit else json.loads(patient['details'])
            def cell(label,key,span=1): return f'<td colspan="{span}"><b>{label}:</b> {esc(p.get(key))}</td>'
            head='<table class="personal"><tr>'+cell('Nome','name',6)+cell('Idade','age')+cell('Data de nascimento','birth',3)+'</tr><tr>'+cell('CPF','cpf',3)+cell('RG','rg',3)+cell('Cartão do SUS','sus',4)+'</tr><tr>'+cell('Endereço','address',7)+cell('Bairro','district',3)+'</tr><tr>'+cell('Responsável','responsible',5)+cell('Parentesco','kinship',2)+cell('Contato','phone',3)+'</tr><tr>'+cell('Diagnóstico','diagnosis',10)+'</tr><tr>'+cell('CRAS','cras',3)+cell('PSF','psf',3)+cell('ACS','acs',4)+'</tr></table>'
            body=''
            for v,it in chunk:
                desc=f"{it['quantity']:g} {it['unit']} — {it['product']}"+(f" · {it['description']}" if it['description'] else '')
                body+=f'<tr><td>{datetime.strptime(v["date"],"%Y-%m-%d").strftime("%d/%m/%Y")}</td><td>{esc(desc)}</td><td>{esc(it["supplier"])}</td><td>{money(it["cents"])}</td><td></td></tr>'
            pages.append(f'<section class="sheet"><header><img src="/secretaria/static/logo.png"><h1>FORMULÁRIO DE ATENDIMENTO</h1></header>{head}<table class="month"><tr><th>MÊS</th><td>{months[int(key[5:])-1]} / {key[:4]}</td></tr></table><table class="items"><thead><tr><th>DATA</th><th>DESCRIÇÃO/ITEM</th><th>FORNECEDOR</th><th>VALOR R$</th><th>ASSINATURA</th></tr></thead><tbody>{body}</tbody></table><footer>{esc(patient["name"])} · Atendimento Especial · {start//5+1}</footer></section>')
    return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Formulário de atendimento</title><link rel="stylesheet" href="/secretaria/static/print.css"><div class="toolbar"><button id="print">Imprimir / salvar PDF</button><span>A4 paisagem · escala 100% · desative cabeçalhos e rodapés do navegador</span></div>'+''.join(pages)+'<script src="/secretaria/static/print.js"></script></html>'

class Handler(BaseHTTPRequestHandler):
    server_version='AtendimentoLocal/1.0'
    def log_message(self,*args): pass
    def send(self,status,data,kind='application/json; charset=utf-8',headers=None):
        if status<400 and self.command=='POST' and getattr(self,'active_db',None):
            self.active_db.commit()
        if isinstance(data,(dict,list)): data=json.dumps(data,ensure_ascii=False).encode()
        elif isinstance(data,str): data=data.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type',kind); self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-Frame-Options','DENY'); self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(data)
    def json_body(self):
        try: size=int(self.headers.get('Content-Length','0'))
        except ValueError: raise Problem('Requisição inválida.')
        if size<=0 or size>29*1024*1024: raise Problem('Arquivo ou requisição muito grande.',413)
        try: payload=json.loads(self.rfile.read(size))
        except (ValueError,UnicodeError): raise Problem('Dados inválidos.')
        if not isinstance(payload,dict): raise Problem('Dados inválidos.')
        return payload
    def identity(self,db):
        cookie=SimpleCookie(); cookie.load(self.headers.get('Cookie',''))
        token=cookie.get('secretaria_atendimento'); token=token.value if token else ''
        with LOCK: session=SESSIONS.get(token)
        if not session or session['expires']<time.time(): raise Problem('Entre no sistema para continuar.',401)
        u=db.execute('SELECT id,name,username,role FROM users WHERE id=? AND active=1',(session['uid'],)).fetchone()
        if not u: raise Problem('Acesso desativado.',401)
        self.token=token; self.csrf=session['csrf']
        return dict(u)
    def writable(self,user):
        if user['role'] not in ('ADM','DIGITADOR'): raise Problem('Seu perfil permite somente consultas e relatórios.',403)
    def admin(self,user):
        if user['role']!='ADM': raise Problem('Acesso exclusivo do administrador.',403)
    def do_GET(self): self.handle_request(False)
    def do_POST(self): self.handle_request(True)
    def handle_request(self,post):
        self.active_db=None
        try:
            host=self.headers.get('Host','')
            if host not in (f'127.0.0.1:{PORT}',f'localhost:{PORT}'): raise Problem('Acesso permitido somente neste computador.',403)
            url=urlparse(self.path); path=unquote(url.path); q={k:v[0] for k,v in parse_qs(url.query).items()}
            if post and self.headers.get('Origin') not in (f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}'): raise Problem('Origem inválida.',403)
            if not post and path.startswith('/static/'):
                target=(ROOT/'static'/path[8:]).resolve()
                if not target.is_relative_to(ROOT/'static') or not target.is_file(): raise Problem('Arquivo não encontrado.',404)
                return self.send(200,target.read_bytes(),mimetypes.guess_type(target)[0] or 'application/octet-stream')
            if not post and (path=='/' or path.startswith('/AtendimentoEspecial')):
                return self.send(200,(ROOT/'static/index.html').read_bytes(),'text/html; charset=utf-8')
            body=self.json_body() if post else {}
            with LOCK, connect() as db:
                self.active_db=db
                if path=='/api/login' and post:
                    key=norm(body.get('username','')); now=time.time(); FAILURES[key]=[t for t in FAILURES[key] if now-t<300]
                    if len(FAILURES[key])>=8: raise Problem('Muitas tentativas. Aguarde 5 minutos.',429)
                    row=db.execute('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1',(key,)).fetchone()
                    if not row or not password_ok(textval(body.get('password','')),row['password']):
                        FAILURES[key].append(now); raise Problem('Usuário ou senha incorretos.',401)
                    FAILURES.pop(key,None); token=secrets.token_urlsafe(32); csrf=secrets.token_urlsafe(32)
                    SESSIONS[token]={'uid':row['id'],'csrf':csrf,'expires':now+12*3600}
                    return self.send(200,{'ok':True},headers={'Set-Cookie':f'secretaria_atendimento={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'})
                user=self.identity(db)
                if post and not hmac.compare_digest(self.headers.get('X-CSRF-Token',''),self.csrf): raise Problem('Sessão expirada. Recarregue a página.',403)
                if path=='/api/me' and not post: return self.send(200,{'user':user,'csrf':self.csrf})
                if path=='/api/logout' and post:
                    SESSIONS.pop(self.token,None); return self.send(200,{'ok':True},headers={'Set-Cookie':'secretaria_atendimento=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})
                if path=='/api/search' and not post:
                    kind=q.get('kind'); term=norm(q.get('q',''))
                    if kind not in ('patients','products','suppliers'): raise Problem('Busca inválida.')
                    if len(term)<3: return self.send(200,[])
                    term=term.replace('!','!!').replace('%','!%').replace('_','!_')
                    if kind=='patients':
                        digits=re.sub(r'\D','',q.get('q',''))
                        rows=db.execute("SELECT * FROM patients WHERE search LIKE ? ESCAPE '!' OR (? != '' AND cpf LIKE ?) ORDER BY name LIMIT 20",('%'+term+'%',digits,'%'+digits+'%')).fetchall()
                        return self.send(200,[patient_obj(r) for r in rows])
                    return self.send(200,[dict(r) for r in db.execute(f"SELECT * FROM {kind} WHERE search LIKE ? ESCAPE '!' ORDER BY name LIMIT 20",('%'+term+'%',))])
                if path=='/api/catalog' and post:
                    self.writable(user); kind=body.get('kind'); name=textval(body.get('name',''))
                    if kind not in ('products','suppliers') or not name: raise Problem('Informe o nome.')
                    if kind=='products':
                        unit=textval(body.get('unit','unidade'),30) or 'unidade'
                        db.execute('INSERT OR IGNORE INTO products(name,search,unit) VALUES(?,?,?)',(name,norm(name),unit))
                    else: db.execute('INSERT OR IGNORE INTO suppliers(name,search) VALUES(?,?)',(name,norm(name)))
                    row=db.execute(f'SELECT * FROM {kind} WHERE search=?',(norm(name),)).fetchone(); audit(db,user,'cadastrar '+kind,row['id'])
                    return self.send(200,dict(row))
                if path=='/api/patient' and post:
                    self.writable(user); pid=save_patient(db,body.get('patient',{}),user,body.get('confirmed',False))
                    return self.send(200,patient_obj(db.execute('SELECT * FROM patients WHERE id=?',(pid,)).fetchone()))
                if path=='/api/visit' and post:
                    self.writable(user)
                    request_id=textval(body.get('request_id',''),100)
                    if not request_id: raise Problem('Identificação do atendimento ausente. Recarregue a página.')
                    previous=db.execute('SELECT id,patient_id FROM visits WHERE request_id=?',(request_id,)).fetchone()
                    if previous: return self.send(200,dict(previous))
                    day=valid_date(body.get('date','')); notes=textval(body.get('notes',''),2000)
                    items=body.get('items',[])
                    if not isinstance(items,list) or not 1<=len(items)<=100: raise Problem('Adicione ao menos um item ao atendimento.')
                    checked=[]
                    for it in items:
                        if not isinstance(it,dict): raise Problem('Item inválido.')
                        if not db.execute('SELECT 1 FROM products WHERE id=?',(it.get('product_id'),)).fetchone(): raise Problem('Selecione ou cadastre o item.')
                        sid=it.get('supplier_id') or None
                        if sid and not db.execute('SELECT 1 FROM suppliers WHERE id=?',(sid,)).fetchone(): raise Problem('Fornecedor inválido.')
                        try:
                            quantity=Decimal(str(it.get('quantity',0))); cents=it.get('cents')
                            if not quantity.is_finite() or not 0<quantity<=1000000 or quantity.as_tuple().exponent < -3: raise ValueError()
                            if type(cents)!=int or not 0<=cents<=10000000000: raise ValueError()
                        except (InvalidOperation,ValueError): raise Problem('Confira a quantidade e o valor do item (até 3 casas na quantidade).')
                        checked.append((it['product_id'],sid,float(quantity),cents,textval(it.get('description',''),500)))
                    pid=save_patient(db,body.get('patient',{}),user,body.get('confirmed',False))
                    patient=db.execute('SELECT * FROM patients WHERE id=?',(pid,)).fetchone()
                    vid=db.execute('INSERT INTO visits(patient_id,date,notes,snapshot,created_by,created_at,request_id) VALUES(?,?,?,?,?,?,?)',(pid,day,notes,patient['details'],user['id'],datetime.now().isoformat(timespec='seconds'),request_id)).lastrowid
                    db.executemany('INSERT INTO items(visit_id,product_id,supplier_id,quantity,cents,description) VALUES(?,?,?,?,?,?)',[(vid,*it) for it in checked])
                    audit(db,user,'registrar atendimento',vid)
                    return self.send(200,{'id':vid,'patient_id':pid})
                if path=='/api/history' and not post:
                    return self.send(200,history_data(db,q))
                if path=='/api/upload' and post:
                    self.writable(user); pid=body.get('patient_id'); vid=body.get('visit_id') or None
                    p=db.execute('SELECT * FROM patients WHERE id=?',(pid,)).fetchone()
                    if not p: raise Problem('Paciente não encontrado.',404)
                    if vid and not db.execute('SELECT 1 FROM visits WHERE id=? AND patient_id=?',(vid,pid)).fetchone(): raise Problem('Atendimento inválido.')
                    name=textval(body.get('name',''),200); ext=Path(name).suffix.lower()
                    types={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'}
                    if ext not in types: raise Problem('Envie PDF, JPG ou PNG.')
                    try: content=base64.b64decode(body.get('content',''),validate=True)
                    except ValueError: raise Problem('Arquivo inválido.')
                    if not content or len(content)>20*1024*1024: raise Problem('O arquivo deve ter até 20 MB.')
                    if not ((ext=='.pdf' and content.startswith(b'%PDF-')) or (ext=='.png' and content.startswith(b'\x89PNG\r\n\x1a\n')) or (ext in ('.jpg','.jpeg') and content.startswith(b'\xff\xd8\xff'))): raise Problem('O conteúdo não corresponde ao tipo do arquivo.')
                    folders=list((DATA/'pacientes').glob(str(pid)+'-*'))
                    slug=re.sub(r'[^a-zA-Z0-9 -]','',norm(p['name']))[:80].strip(' .') or 'paciente'
                    folder=folders[0] if folders else DATA/'pacientes'/f'{pid}-{slug}'
                    folder.mkdir(exist_ok=True); target=folder/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(6)+ext)
                    target.write_bytes(content)
                    try:
                        fid=db.execute('INSERT INTO files(patient_id,visit_id,name,path,mime,created_at) VALUES(?,?,?,?,?,?)',(pid,vid,name,str(target.relative_to(DATA)),types[ext],datetime.now().isoformat(timespec='seconds'))).lastrowid
                        audit(db,user,'anexar arquivo',fid)
                        db.commit()
                    except Exception:
                        target.unlink(missing_ok=True); raise
                    return self.send(200,{'id':fid,'folder':str(folder)})
                if path.startswith('/file/') and not post:
                    row=db.execute('SELECT * FROM files WHERE id=?',(path.split('/')[-1],)).fetchone()
                    if not row: raise Problem('Arquivo não encontrado.',404)
                    target=(DATA/row['path']).resolve()
                    if not target.is_relative_to(DATA/'pacientes') or not target.is_file(): raise Problem('Arquivo não encontrado na pasta local.',404)
                    return self.send(200,target.read_bytes(),row['mime'],{'Content-Disposition':'inline'})
                if path=='/print' and not post: return self.send(200,printable(db,q.get('patient'),q.get('visit'),q),'text/html; charset=utf-8')
                if path=='/report-print' and not post:
                    from .report_layout import render
                    data=history_data(db,q) if q.get('patient') else daily_report(db,q) if q.get('day') else report(db,q)
                    for key,table in [('product','products'),('supplier','suppliers')]:
                        if q.get(key):
                            row=db.execute(f'SELECT name FROM {table} WHERE id=?',(q[key],)).fetchone()
                            data[key+'_label']=row['name'] if row else ''
                    return self.send(200,render(data,q),'text/html; charset=utf-8')
                if path=='/api/dashboard' and not post:
                    totals=db.execute('SELECT COALESCE(SUM(cents),0) cents FROM items').fetchone()
                    people=db.execute('SELECT COUNT(DISTINCT patient_id) n FROM visits').fetchone()['n']
                    count=db.execute('SELECT COUNT(*) n FROM visits').fetchone()['n']
                    top=[dict(r) for r in db.execute('SELECT p.name,p.unit,SUM(i.quantity) quantity,SUM(i.cents) cents FROM items i JOIN products p ON p.id=i.product_id GROUP BY p.id ORDER BY quantity DESC LIMIT 10')]
                    return self.send(200,{'cents':totals['cents'],'people':people,'visits':count,'top':top})
                if path=='/api/report' and not post: return self.send(200,report(db,q))
                if path=='/api/daily' and not post: return self.send(200,daily_report(db,q))
                if path=='/api/users' and not post:
                    self.admin(user); return self.send(200,[dict(r) for r in db.execute('SELECT id,name,username,role,active FROM users ORDER BY name')])
                if path=='/api/users' and post:
                    self.admin(user); uid=body.get('id'); action=body.get('action','save')
                    existing=db.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone() if uid else None
                    if uid and not existing: raise Problem('Usuário não encontrado.',404)
                    if action=='delete':
                        if uid==user['id']: raise Problem('Você não pode excluir seu próprio acesso.')
                        db.execute('UPDATE users SET active=0 WHERE id=?',(uid,)); audit(db,user,'excluir acesso',uid)
                    else:
                        name=textval(body.get('name','')); username=textval(body.get('username',''),80); role=body.get('role'); pw=textval(body.get('password',''))
                        if not name or not username or role not in ('ADM','SECRETARIA','DIGITADOR'): raise Problem('Preencha nome, usuário e perfil.')
                        if uid==user['id'] and role!='ADM': raise Problem('Mantenha seu próprio perfil como ADM.')
                        if (not uid or pw) and len(pw)<8: raise Problem('Use uma senha com pelo menos 8 caracteres.')
                        if uid: db.execute('UPDATE users SET name=?,username=?,role=?,password=?,active=1 WHERE id=?',(name,username,role,password_hash(pw) if pw else existing['password'],uid))
                        else: uid=db.execute('INSERT INTO users(name,username,role,password) VALUES(?,?,?,?)',(name,username,role,password_hash(pw))).lastrowid
                        audit(db,user,'salvar acesso',uid)
                    for token,s in list(SESSIONS.items()):
                        if s['uid']==uid and token!=self.token: SESSIONS.pop(token,None)
                    return self.send(200,{'ok':True})
                if path=='/api/backup' and post:
                    self.admin(user); name='backup-completo-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.zip'; target=DATA/'backups'/name
                    mem=sqlite3.connect(':memory:'); db.backup(mem)
                    tmp=DATA/'backups'/('snapshot-'+secrets.token_hex(5)+'.sqlite')
                    with closing(sqlite3.connect(tmp)) as dest: mem.backup(dest)
                    mem.close()
                    try:
                        with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
                            z.write(tmp,'atendimento.sqlite')
                            for f in (DATA/'pacientes').rglob('*'):
                                if f.is_file(): z.write(f,str(f.relative_to(DATA)))
                    finally: tmp.unlink(missing_ok=True)
                    audit(db,user,'backup completo',name)
                    return self.send(200,{'name':name,'path':str(target)})
                if path.startswith('/backup/') and not post:
                    self.admin(user); name=path.split('/')[-1]; target=DATA/'backups'/name
                    if not re.fullmatch(r'backup-completo-\d{8}-\d{6}\.zip',name) or not target.is_file(): raise Problem('Backup não encontrado.',404)
                    return self.send(200,target.read_bytes(),'application/zip',{'Content-Disposition':f'attachment; filename="{name}"'})
                raise Problem('Página não encontrada.',404)
        except Problem as e: self.send(e.status,{'error':e.message,**e.extra})
        except sqlite3.IntegrityError: self.send(409,{'error':'CPF ou nome de usuário já cadastrado. Pesquise e selecione o registro existente.'})
        except (ValueError,TypeError,KeyError): self.send(400,{'error':'Dados inválidos. Confira os campos e tente novamente.'})
        except (BrokenPipeError,ConnectionResetError): pass
        except Exception:
            import traceback
            traceback.print_exc()
            self.send(500,{'error':'Não foi possível concluir. Seus dados não foram descartados; tente novamente.'})

if __name__=='__main__':
    initialize()
    print(f'Atendimento Especial: http://127.0.0.1:{PORT}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
