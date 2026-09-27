"""Category permissions use disposable databases only."""
import sqlite3
from contextlib import closing
import unittest
from pathlib import Path
from test_ifa import IFAReviewTest, ifa


class EndemiasAccessTest(unittest.TestCase):
    setUp = IFAReviewTest.setUp
    tearDown = IFAReviewTest.tearDown
    rows = IFAReviewTest.rows
    form = IFAReviewTest.form
    save = IFAReviewTest.save

    def profile(self, scope='ACE', role='REGULADOR'):
        with ifa.app.app_context():
            db = ifa.get_db()
            db.execute('UPDATE users SET role=?, access_scope=? WHERE id=2', (role, scope))
            db.commit()
        with self.client.session_transaction() as session:
            session['user_id'] = 2

    def test_endemias_lists_reports_and_forged_category(self):
        self.save({1:(80,100)})
        self.save({1:(70,100)}, agent_id='2')
        self.profile()
        for page in ('principal','cadastro','avaliacoes','avaliacoes/nova','criterios','relatorios'):
            for category in ('ACE','ACS'):
                response=self.client.get('/ifa/'+page+'?categoria='+category)
                self.assertEqual(response.status_code,200,(page,category))
                html=response.get_data(as_text=True)
                self.assertNotIn('Teste ACS',html,page)
                self.assertNotIn('Agentes Comunitários (ACS)</a>',html,page)
                self.assertIn('Endemias (ACE)',html,page)
        report=self.client.get('/ifa/relatorios?agente=2').get_data(as_text=True)
        self.assertIn('Teste ACE',report)
        self.assertNotIn('Teste ACS',report)
        for suffix in ('','/csv'):
            self.assertEqual(self.client.get('/ifa/relatorios'+suffix+'?agente=1').status_code,403)
            self.assertEqual(self.client.get('/ifa/relatorios'+suffix+'?agente=2').status_code,200)
        self.assertEqual(self.client.get('/ifa/api/indicadores/ACS').status_code,403)
        self.assertEqual(len(self.client.get('/ifa/api/indicadores/ACE').json),2)

    def test_direct_access_and_writes_cannot_touch_acs(self):
        self.save({1:(80,100)})
        self.save({1:(80,100)},agent_id='2')
        before=self.rows('SELECT * FROM agents')
        eval_before=self.rows('SELECT * FROM evaluations')
        items_before=self.rows('SELECT * FROM evaluation_items')
        self.profile()
        for route in ('detalhe','editar'):
            self.assertEqual(self.client.get('/ifa/avaliacoes/'+route+'/1').status_code,403)
        data={'csrf_token':'test-token','category':'ACE','full_name':'Changed','unit_id':'1'}
        for route in ('editar','excluir'):
            self.assertEqual(self.client.post('/ifa/cadastro/agente/'+route+'/1',data=data).status_code,403)
            self.assertEqual(self.client.post('/ifa/avaliacoes/'+route+'/1',data=self.form({1:(80,100)},agent_id='2')).status_code,403)
        self.assertEqual(self.save({1:(80,100)},competence='2026-11').status_code,403)
        self.assertEqual(self.save({1:(80,100)},evaluation=2,agent_id='1').status_code,403)
        self.assertEqual(self.client.post('/ifa/cadastro/agente/novo',data={**data,'category':'ACS'}).status_code,403)
        self.assertEqual(self.rows('SELECT * FROM agents'),before)
        self.assertEqual(self.rows('SELECT * FROM evaluations'),eval_before)
        self.assertEqual(self.rows('SELECT * FROM evaluation_items'),items_before)

    def test_endemias_can_register_and_evaluate_ace(self):
        self.profile()
        data={'csrf_token':'test-token','category':'ACE','full_name':'Novo ACE','unit_id':'1'}
        response=self.client.post('/ifa/cadastro/agente/novo',data=data,follow_redirects=True)
        self.assertEqual(response.status_code,200)
        self.assertIn('Novo ACE',response.get_data(as_text=True))
        self.assertEqual(self.save({1:(80,100)},agent_id='2').status_code,302)
        self.assertEqual(self.client.get('/ifa/avaliacoes/detalhe/1').status_code,200)
        self.assertEqual(self.save({1:(70,100)},agent_id='2',evaluation=1).status_code,302)
        self.assertEqual(self.rows('SELECT COUNT(*) AS n FROM evaluation_items')[0]['n'],1)

    def test_ace_uses_its_own_two_indicators_in_all_months(self):
        self.profile()
        html=self.client.get('/ifa/avaliacoes/nova').get_data(as_text=True)
        self.assertIn('Metas dos programas ativos',html)
        self.assertIn('Assiduidade em reuniões e mobilizações',html)
        self.assertNotIn('Cadastro individual e domiciliar',html)
        self.assertNotIn('índices 2 e 3 continuam habilitados',html)
        for month in ('2026-01','2026-12'):
            self.assertEqual(self.save({1:(80,100),2:(70,100)},agent_id='2',competence=month).status_code,302)
        rows=self.rows('SELECT ind.category,i.score FROM evaluation_items i JOIN indicators ind ON ind.id=i.indicator_id')
        self.assertEqual([r['category'] for r in rows],['ACE']*4)
        self.assertEqual([r['score'] for r in rows],[10,7,10,7])
        html=self.client.get('/ifa/relatorios?agente=2&ano=2026').get_data(as_text=True)
        self.assertIn('85.00',html)
        self.assertNotIn('Cadastro individual e domiciliar',html)

    def test_shared_units_and_administration_restricted(self):
        self.profile()
        data={'csrf_token':'test-token','name':'Changed'}
        for suffix in ('nova','editar/1','excluir/1'):
            self.assertEqual(self.client.post('/ifa/cadastro/unidade/'+suffix,data=data).status_code,403)
        for url in ('/ifa/administracao','/ifa/administracao/backup/baixar/manual/example.db'):
            self.assertEqual(self.client.get(url).status_code,302)
        html=self.client.get('/ifa/cadastro?tab=unidades').get_data(as_text=True)
        self.assertNotIn('Nova unidade',html)
        self.assertNotIn('Acessos e Backup',html)

    def test_admin_and_coordinator_tabs_are_separate(self):
        self.save({1:(80,100)})
        self.save({1:(80,100)},agent_id='2')
        for role in ('ADM','REGULADOR'):
            self.profile('TODOS',role)
            for category,other in (('ACS','ACE'),('ACE','ACS')):
                for page in ('principal','cadastro','avaliacoes','avaliacoes/nova','relatorios'):
                    result=self.client.get('/ifa/'+page+'?categoria='+category)
                    self.assertEqual(result.status_code,200,(role,category,page))
                    html=result.get_data(as_text=True)
                    self.assertIn('Teste '+category,html)
                    self.assertNotIn('Teste '+other,html)
                    self.assertIn('Agentes Comunitários (ACS)</a>',html)
                    self.assertIn('Endemias (ACE)</a>',html)
            self.assertEqual(self.client.get('/ifa/avaliacoes/detalhe/1').status_code,200)
            self.assertEqual(self.client.get('/ifa/avaliacoes/detalhe/2').status_code,200)

    def test_admin_assigns_scope_without_changing_password(self):
        old=self.rows('SELECT password_hash FROM users WHERE id=2')[0]
        data={'csrf_token':'test-token','name':'Endemias','role':'ENDEMIAS','active':'1','password':''}
        self.assertEqual(self.client.post('/ifa/administracao/usuario/editar/2',data=data).status_code,302)
        user=self.rows('SELECT role,access_scope,password_hash FROM users WHERE id=2')[0]
        self.assertEqual(user['role'],'REGULADOR')
        self.assertEqual(user['access_scope'],'ACE')
        self.assertEqual(user['password_hash'],old['password_hash'])
        data['role']='REGULADOR'
        self.client.post('/ifa/administracao/usuario/editar/2',data=data)
        self.assertEqual(self.rows('SELECT access_scope FROM users WHERE id=2')[0]['access_scope'],'TODOS')

    def test_legacy_migration_preserves_users_and_evaluations(self):
        self.save({1:(80,100)})
        with closing(sqlite3.connect(ifa.DATABASE)) as db:
            db.execute('ALTER TABLE users DROP COLUMN access_scope')
            db.commit()
            before_users=db.execute('SELECT * FROM users').fetchall()
            before_evals=db.execute('SELECT * FROM evaluations').fetchall()
        ifa.init_database()
        ifa.init_database()
        with closing(sqlite3.connect(ifa.DATABASE)) as db:
            self.assertEqual(db.execute('SELECT id,name,username,password_hash,role,active,created_at,updated_at FROM users').fetchall(),before_users)
            self.assertEqual(db.execute('SELECT * FROM evaluations').fetchall(),before_evals)
            self.assertEqual(db.execute('SELECT DISTINCT access_scope FROM users').fetchall(),[('TODOS',)])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
        backups=list((ifa.DATABASE.parent/'backups'/'migrations').glob('*.db'))
        self.assertEqual(len(backups),1)
        with closing(sqlite3.connect(backups[0])) as db:
            self.assertEqual(db.execute('SELECT * FROM users').fetchall(),before_users)


if __name__=='__main__':
    unittest.main()
