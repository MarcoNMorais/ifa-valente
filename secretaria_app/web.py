"""WSGI isolation: no IFA session, routes or database are shared."""
import io
import json
import os
from http import HTTPStatus
from email.message import Message
from urllib.parse import urlsplit
from . import core


class RequestHandler(core.Handler):
    def __init__(self, environ, body):
        self.command = environ['REQUEST_METHOD']
        self.path = (environ.get('PATH_INFO', '')[len('/secretaria'):] or '/')
        if environ.get('QUERY_STRING'):
            self.path += '?' + environ['QUERY_STRING']
        self.headers = Message()
        for k,v in environ.items():
            if k.startswith('HTTP_') and k not in ('HTTP_HOST','HTTP_ORIGIN'):
                self.headers[k[5:].replace('_','-')] = v
        self.headers['Content-Length'] = str(len(body))
        # The middleware validates the external origin before adapting the local core.
        self.headers['Host'] = f'127.0.0.1:{core.PORT}'
        self.headers['Origin'] = f'http://127.0.0.1:{core.PORT}'
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self.response_headers = []
        self.secure = environ.get('wsgi.url_scheme') == 'https' or environ.get('HTTP_HOST','').split(':')[0] not in ('localhost','127.0.0.1')

    def send_response(self, status, message=None):
        self.status = status

    def send_header(self, key, value):
        if key.lower() == 'set-cookie':
            value = value.replace('Path=/;', 'Path=/secretaria;')
            if self.secure:
                value += '; Secure'
        self.response_headers.append((key,value))

    def end_headers(self):
        pass


class SecretariaMiddleware:
    def __init__(self, fallback):
        self.fallback = fallback
        self.ready = False

    @staticmethod
    def response(start_response, status, message, extra=()):
        body = json.dumps({'error':message},ensure_ascii=False).encode()
        start_response(f'{status} {HTTPStatus(status).phrase}', [('Content-Type','application/json; charset=utf-8'),('Content-Length',str(len(body))),('Cache-Control','no-store'),*extra])
        return [body]

    def __call__(self, environ, start_response):
        path = environ.get('PATH_INFO','')
        if path.lower() != '/secretaria' and not path.lower().startswith('/secretaria/'):
            return self.fallback(environ,start_response)
        if not path.startswith('/secretaria'):
            target='/secretaria'+path[len('/secretaria'):]
            if environ.get('QUERY_STRING'): target+='?'+environ['QUERY_STRING']
            return self.response(start_response,308,'Redirecionando.',[('Location',target)])
        method=environ.get('REQUEST_METHOD','GET')
        if method not in ('GET','HEAD','POST'):
            return self.response(start_response,405,'Método não permitido.')
        host=environ.get('HTTP_HOST','')
        allowed={'secsaudevalente.com.br','www.secsaudevalente.com.br','localhost','127.0.0.1'}
        if os.environ.get('RENDER_EXTERNAL_HOSTNAME'): allowed.add(os.environ['RENDER_EXTERNAL_HOSTNAME'])
        if host.split(':')[0] not in allowed:
            return self.response(start_response,403,'Host inválido.')
        if method=='POST':
            origin=urlsplit(environ.get('HTTP_ORIGIN',''))
            scheme='https' if host.split(':')[0] not in ('localhost','127.0.0.1') else environ.get('wsgi.url_scheme','http')
            if origin.scheme!=scheme or origin.netloc!=host:
                return self.response(start_response,403,'Origem inválida.')
        try: size=int(environ.get('CONTENT_LENGTH') or 0)
        except ValueError: return self.response(start_response,400,'Requisição inválida.')
        if size<0 or size>29*1024*1024:
            return self.response(start_response,413,'Arquivo muito grande.')
        body=environ['wsgi.input'].read(size) if method=='POST' else b''
        with core.LOCK:
            if not self.ready:
                core.initialize()
                self.ready=True
            handler=RequestHandler(environ,body)
            if method=='POST' and path=='/secretaria/api/import-presentation':
                self.import_presentation(handler)
            else:
                handler.handle_request(method=='POST')
        start_response(f'{handler.status} {HTTPStatus(handler.status).phrase}',handler.response_headers)
        return [] if method=='HEAD' else [handler.wfile.getvalue()]

    @staticmethod
    def import_presentation(handler):
        handler.active_db=None
        try:
            with core.connect() as db:
                user=handler.identity(db)
                handler.admin(user)
                if not core.hmac.compare_digest(handler.headers.get('X-CSRF-Token',''),handler.csrf):
                    raise core.Problem('Sessão expirada.',403)
                payload=handler.json_body()
                password=core.textval(payload.get('password',''))
                stored=db.execute('SELECT password FROM users WHERE id=?',(user['id'],)).fetchone()[0]
                if not core.password_ok(password,stored): raise core.Problem('Senha incorreta.',403)
            try: encrypted=core.base64.b64decode(payload.get('content',''),validate=True)
            except (ValueError,TypeError): raise core.Problem('Arquivo inválido.')
            from .seed import import_presentation
            counts=import_presentation(encrypted,password,user['username'])
            core.SESSIONS.clear()
            handler.send(200,{'ok':True,'counts':counts,'login_required':True})
        except core.Problem as exc:
            handler.send(exc.status,{'error':exc.message})
