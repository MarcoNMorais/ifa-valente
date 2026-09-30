import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from flask import Flask
from cis_routes import register_cis_routes

class CISTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.env=patch.dict(os.environ,{'CIS_DATA_DIR':str(self.root),'CIS_INITIAL_ADMIN_PASSWORD':'test-admin-123'})
        self.env.start()
        self.app=Flask(__name__); self.app.secret_key='test-only'
        register_cis_routes(self.app)
        self.client=self.app.test_client()
    def tearDown(self):
        self.env.stop();self.temp.cleanup()
    def login(self, client=None):
        result=(client or self.client).post('/api/cis/login',json={'user':'admin','pass':'test-admin-123'})
        self.assertEqual(result.status_code,200)
        return result.json
    def save(self, auth, data=None, client=None):
        return (client or self.client).post('/api/cis/salvar',json=data or auth['data'],headers={'X-CIS-CSRF':auth['csrf'],'If-Match':auth['revision']})
    def test_access_and_csrf(self):
        for route in ('dados','backup','backups','status'):
            self.assertEqual(self.client.get('/api/cis/'+route).status_code,401)
        auth=self.login()
        self.assertNotIn('password_hash',json.dumps(auth))
        self.assertEqual(self.client.post('/api/cis/salvar',json=auth['data']).status_code,403)
        self.assertEqual(self.save(auth).status_code,200)
    def test_conflict_preserves_first_writer(self):
        self.login(); other=self.app.test_client(); auth2=self.login(other)
        auth1={**auth2,**self.client.get('/api/cis/dados').json,'csrf':self.client.get('/api/cis/session').json['csrf']}
        auth1['data']['pacientes']=[{'id':'one','nome':'Paciente sintético','sistemas':['IDS','SRA']}]
        self.assertEqual(self.save(auth1).status_code,200)
        self.assertEqual(self.save(auth2,client=other).status_code,409)
        self.assertEqual(self.client.get('/api/cis/dados').json['data']['pacientes'][0]['id'],'one')
    def test_corrupt_database_never_resets(self):
        self.login();path=self.root/'cis_database.json';path.write_text('{broken')
        self.assertEqual(self.client.get('/api/cis/dados').status_code,503)
        self.assertEqual(path.read_text(),'{broken')
    def test_legacy_password_migration(self):
        self.login();path=self.root/'cis_database.json';state=json.loads(path.read_text())
        state['users'][0].pop('password_hash');state['users'][0]['pass']='test-admin-123'
        state['pacientes']=[{'id':'legacy','nome':'Sintético'}];path.write_text(json.dumps(state))
        auth=self.login();self.assertEqual(len(auth['data']['pacientes']),1)
        migrated=json.loads(path.read_text());self.assertNotIn('pass',migrated['users'][0]);self.assertIn('password_hash',migrated['users'][0])
    def test_admin_cannot_remove_last_admin(self):
        auth=self.login();auth['data']['users']=[]
        self.assertEqual(self.save(auth).status_code,400)
    def test_regulator_cannot_escalate_or_read_backups(self):
        auth=self.login();auth['data']['users'].append(dict(id='reg',user='reg',role='regulador',active=True,name='Reg',**{'pass':'test-reg-123'}))
        self.assertEqual(self.save(auth).status_code,200)
        c=self.app.test_client();auth=c.post('/api/cis/login',json={'user':'reg','pass':'test-reg-123'}).json
        self.assertEqual(auth['data']['users'],[]);self.assertEqual(c.get('/api/cis/backup').status_code,403)
        auth['data']['users']=[dict(id='reg',user='reg',role='admin',active=True,**{'pass':'test-reg-123'})]
        self.assertEqual(self.save(auth,client=c).status_code,200)
        self.assertEqual(c.get('/api/cis/session').json['user']['role'],'regulador')

if __name__=='__main__':unittest.main()
