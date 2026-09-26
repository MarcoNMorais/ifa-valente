"""IFA regression tests. All databases and backups are isolated from real data."""
import csv
import io
import os
import re
import secrets
import sqlite3
import tempfile
import unittest
from pathlib import Path

TEST_ROOT = tempfile.TemporaryDirectory(prefix="ifa-review-")
os.environ["IFA_DATA_DIR"] = TEST_ROOT.name
os.environ["IFA_BACKUP_DIR"] = str(Path(TEST_ROOT.name) / "backups")
os.environ["SECRET_KEY"] = secrets.token_urlsafe(32)
TEST_PASSWORD = secrets.token_urlsafe(24)
os.environ["IFA_INITIAL_ADMIN_PASSWORD"] = TEST_PASSWORD
os.environ["IFA_INITIAL_REGULATOR_PASSWORD"] = secrets.token_urlsafe(24)
os.environ["COOKIE_SECURE"] = "0"

import app as ifa


class IFAReviewTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(dir=TEST_ROOT.name)
        root = Path(self.folder.name)
        ifa.DATABASE = root / "test.db"
        ifa.AUTO_BACKUP_DIR = root / "auto"
        ifa.MANUAL_BACKUP_DIR = root / "manual"
        ifa.init_database()
        ifa.app.config.update(TESTING=True)
        self.client = ifa.app.test_client()
        with self.client.session_transaction() as session:
            session["user_id"] = 1
            session["csrf_token"] = "test-token"
        with ifa.app.app_context():
            db = ifa.get_db()
            stamp = ifa.now_iso()
            for category in ("ACS", "ACE"):
                db.execute("INSERT INTO agents(full_name,category,unit_id,created_at,updated_at) VALUES(?,?,1,?,?)", ("Teste " + category, category, stamp, stamp))
            db.commit()
            self.indicators = {(r["category"], r["order_index"]): r["id"] for r in db.execute("SELECT * FROM indicators")}

    def tearDown(self):
        self.folder.cleanup()

    def form(self, items=None, **overrides):
        data = dict(csrf_token="test-token", agent_id="1", competence="2026-12", proportional_factor="100", leave_type="", leave_justification="", notes="")
        data.update(overrides)
        category = "ACE" if str(data["agent_id"]) == "2" else "ACS"
        for order, (numerator, denominator) in (items or {}).items():
            indicator = self.indicators[(category, order)]
            data[f"num_{indicator}"] = str(numerator)
            data[f"den_{indicator}"] = str(denominator)
        return data

    def save(self, items=None, evaluation=None, **overrides):
        url = f"/ifa/avaliacoes/editar/{evaluation}" if evaluation else "/ifa/avaliacoes/nova"
        return self.client.post(url, data=self.form(items, **overrides))

    def rows(self, query, params=()):
        with ifa.app.app_context():
            return [dict(row) for row in ifa.get_db().execute(query, params)]

    def report(self, agent=1, salary=None):
        with ifa.app.app_context():
            return ifa.build_acs_annual_report(agent, 2026, salary)

    def test_partial_blanks_excluded_monthly_annual_and_csv(self):
        result = self.save({1: (80, 100), 2: ("", ""), 3: (" ", " ")})
        self.assertEqual(result.status_code, 302)
        self.assertEqual(len(self.rows("SELECT * FROM evaluation_items")), 1)
        report = self.report(salary=3000)
        self.assertEqual(report["annual_score"], 100)
        self.assertEqual(report["indicators_counted"], 1)
        self.assertEqual(report["months_counted"], 1)
        self.assertEqual(report["estimated_value"], 3000)
        self.assertEqual(report["monthly_totals"][11]["score"], 100)
        csv_result = self.client.get("/ifa/relatorios/csv?agente=1&ano=2026")
        lines = list(csv.reader(io.StringIO(csv_result.get_data(as_text=True)), delimiter=";"))
        self.assertIn(["Percentual a receber", "100.0"], lines)
        blank = next(row for row in lines if row and row[0].startswith("Índice 2 -"))
        self.assertEqual(blank[1:3], ["", ""])
        self.assertEqual(blank[-1], "")

    def test_zero_is_counted(self):
        self.assertEqual(self.save({1: (80, 100), 2: (0, 100)}).status_code, 302)
        report = self.report()
        self.assertEqual(report["annual_score"], 75)
        self.assertEqual(report["indicators_counted"], 2)
        self.assertEqual(report["indicators"][1]["annual_average"], 0)
        self.assertEqual(report["indicators"][1]["annual_points"], 5)

    def test_all_ten_and_ace(self):
        self.assertEqual(self.save({i: (70, 100) for i in range(1, 11)}).status_code, 302)
        self.assertEqual(self.report()["annual_score"], 70)
        self.assertEqual(self.save({1: (80, 100)}, agent_id="2").status_code, 302)
        self.assertEqual(self.report(2)["annual_score"], 100)

    def test_half_filled_rejected_and_form_preserved(self):
        for values in (("", 100), (80, "")):
            response = self.save({1: values}, notes="Preservar observação")
            self.assertEqual(response.status_code, 200)
            html = response.get_data(as_text=True)
            self.assertIn("preencha realizado e meta", html)
            self.assertIn("Preservar observação", html)
            self.assertIn('value="2026-12" data-month="12" selected', html)
            self.assertIn("Cadastrar avaliação", html)
        self.assertFalse(self.rows("SELECT * FROM evaluations"))

    def test_invalid_numbers_rejected(self):
        for numerator, denominator in ((-1, 100), (1, 0), (1, -1), ("abc", 100), ("nan", 100), ("inf", 100), (1, "nan"), (1, "inf")):
            with self.subTest(numerator=numerator, denominator=denominator):
                self.assertEqual(self.save({1: (numerator, denominator)}).status_code, 200)
                self.assertFalse(self.rows("SELECT * FROM evaluations"))

    def test_invalid_period_and_factor(self):
        for period in ("2026-00", "2026-13", "abcd-12", "0000-12"):
            self.assertEqual(self.save({1: (80, 100)}, competence=period).status_code, 200)
        for factor in ("nan", "inf", "abc", "0", "-1", "101"):
            self.assertEqual(self.save({1: (80, 100)}, proportional_factor=factor).status_code, 200)
        self.assertFalse(self.rows("SELECT * FROM evaluations"))

    def test_factor_thresholds_cap_and_decimal_comma(self):
        for month, numerator, factor, expected in ((1, "40", "50", 10), (2, "69,99", "100", 5), (3, "70", "100", 7), (4, "79,99", "100", 7), (5, "80", "100", 10), (6, "120", "100", 10)):
            self.assertEqual(self.save({1: (numerator, 100)}, competence=f"2026-{month:02d}", proportional_factor=factor).status_code, 302)
            row = self.rows("SELECT i.* FROM evaluation_items i JOIN evaluations e ON e.id=i.evaluation_id WHERE e.competence=?", (f"2026-{month:02d}",))[0]
            self.assertEqual(row["score"], expected)
            self.assertLessEqual(row["percentage"], 100)

    def test_empty_evaluation_rejected_except_leave(self):
        self.assertIn("pelo menos um indicador", self.save().get_data(as_text=True))
        self.assertFalse(self.rows("SELECT * FROM evaluations"))
        self.assertEqual(self.save(leave_type="ferias", leave_justification="Férias oficiais", competence="2026-01").status_code, 302)
        self.assertIsNone(self.report(salary=3000)["annual_score"])
        self.assertIsNone(self.report(salary=3000)["estimated_value"])

    def test_leave_justification_and_annual_locks(self):
        self.assertEqual(self.save(leave_type="licenca").status_code, 200)
        self.assertEqual(self.save({1: (80, 100), 2: (0, 100)}, competence="2026-01").status_code, 302)
        self.assertEqual(len(self.rows("SELECT * FROM evaluation_items")), 1)
        self.assertEqual(self.save({1: (0, 100), 2: (80, 100)}, leave_type="licenca", leave_justification="Licença oficial").status_code, 302)
        report = self.report()
        self.assertEqual(report["annual_score"], 100)
        self.assertIsNone(report["indicators"][0]["months"][11]["percentage"])
        self.assertEqual(report["indicators"][1]["months"][11]["percentage"], 80)
        self.assertEqual(self.save({2: (80, 100)}, agent_id="2", leave_type="ferias", leave_justification="Férias").status_code, 302)
        self.assertIsNone(self.report(2)["annual_score"])

    def test_annual_averages_ignore_missing_months_and_do_not_double_round(self):
        self.save({1: (80, 100)}, competence="2026-01")
        self.save({1: (60, 100), 4: (80, 100)}, competence="2026-02")
        self.save({5: (80, 100)}, competence="2026-03")
        report = self.report()
        self.assertEqual(report["indicators"][0]["annual_average"], 70)
        self.assertEqual(report["annual_score"], 90)
        self.assertEqual(report["indicators_counted"], 3)

    def test_threshold_uses_unrounded_average(self):
        self.save({1: (79.999, 100)})
        self.assertEqual(self.report()["indicators"][0]["annual_points"], 7)

    def test_final_percentage_single_rounding(self):
        self.save({1: (80, 100), 2: (80, 100), 3: (0, 100)})
        self.assertEqual(self.report()["annual_score"], 83.33)

    def test_edit_clears_item_and_recalculates(self):
        self.save({1: (80, 100), 2: (0, 100)})
        self.assertEqual(self.save({1: (80, 100), 2: ("", "")}, evaluation=1).status_code, 302)
        self.assertEqual(len(self.rows("SELECT * FROM evaluation_items")), 1)
        self.assertEqual(self.report()["annual_score"], 100)
        self.assertEqual(self.save(evaluation=1).status_code, 200)
        self.assertEqual(self.report()["annual_score"], 100)

    def test_duplicate_rollback_and_missing_edit(self):
        self.save({1: (80, 100)})
        self.assertEqual(self.save({1: (0, 100)}).status_code, 200)
        self.assertEqual(len(self.rows("SELECT * FROM evaluations")), 1)
        self.assertEqual(self.report()["annual_score"], 100)
        self.assertEqual(self.save({1: (0, 100)}, evaluation=999).status_code, 404)
        self.save({1: (70, 100)}, competence="2026-11")
        self.assertEqual(self.save({1: (0, 100)}, evaluation=2).status_code, 200)
        self.assertEqual(self.rows("SELECT competence FROM evaluations WHERE id=2")[0]["competence"], "2026-11")

    def test_historical_and_inactive_evaluation_can_be_edited(self):
        self.save({1: (80, 100)}, competence="2024-01")
        with ifa.app.app_context():
            ifa.get_db().execute("UPDATE agents SET active=0 WHERE id=1")
            ifa.get_db().commit()
        html = self.client.get("/ifa/avaliacoes/editar/1").get_data(as_text=True)
        self.assertIn('value="2024-01" data-month="1" selected', html)
        self.assertIn('value="1" data-category="ACS" selected', html)
        self.assertEqual(self.save({1: (70, 100)}, evaluation=1, competence="2024-01").status_code, 302)
        self.assertEqual(self.save({1: (70, 100)}).status_code, 200)

    def test_pages_details_summary_and_exports(self):
        self.save({1: (80, 100)})
        for path in ("/ifa/principal", "/ifa/avaliacoes", "/ifa/avaliacoes/nova", "/ifa/avaliacoes/editar/1", "/ifa/avaliacoes/detalhe/1", "/ifa/cadastro", "/ifa/criterios", "/ifa/administracao", "/ifa/relatorios", "/ifa/relatorios?agente=1&ano=2026", "/ifa/api/indicadores/ACS", "/ifa/api/indicadores/ACE"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)
        with ifa.app.app_context():
            summary = ifa.build_report_summary("2026-01", "2026-12", 1, None)
            self.assertEqual(summary["avg_score"], 100)
            self.assertEqual(summary["avg_percentage"], 80)

    def test_auth_csrf_admin_and_login(self):
        anonymous = ifa.app.test_client()
        self.assertEqual(anonymous.get("/ifa/avaliacoes").status_code, 302)
        self.assertEqual(self.client.post("/ifa/avaliacoes/nova", data={}).status_code, 400)
        anonymous.get("/ifa")
        with anonymous.session_transaction() as session:
            token = session["csrf_token"]
        self.assertEqual(anonymous.post("/ifa", data=dict(csrf_token=token, username="admin", password=TEST_PASSWORD)).status_code, 302)
        with self.client.session_transaction() as session:
            session["user_id"] = 2
        self.assertEqual(self.client.get("/ifa/administracao").status_code, 302)

    def test_backup_audit_and_delete(self):
        self.save({1: (80, 100)})
        backups = list(ifa.AUTO_BACKUP_DIR.glob("*.db"))
        self.assertTrue(backups)
        with sqlite3.connect(backups[-1]) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM evaluation_items").fetchone()[0], 1)
        db.close()
        self.assertTrue(self.rows("SELECT * FROM audit_log WHERE entity='AVALIACAO'"))
        response = self.client.post("/ifa/administracao/backup-manual", data=dict(csrf_token="test-token"))
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertEqual(self.client.post("/ifa/avaliacoes/excluir/1", data=dict(csrf_token="test-token")).status_code, 302)
        self.assertFalse(self.rows("SELECT * FROM evaluation_items"))
        self.assertIsNone(self.report()["annual_score"])

    def test_restore_backup_and_reject_invalid_database(self):
        self.save({1: (80, 100)})
        with ifa.app.app_context():
            backup = ifa.create_backup("manual").read_bytes()
        self.save({1: (0, 100)}, evaluation=1)
        self.assertEqual(self.report()["annual_score"], 50)
        response = self.client.post("/ifa/administracao/restaurar", data={"csrf_token":"test-token", "backup_file":(io.BytesIO(b"invalid database"),"invalid.db")})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.report()["annual_score"], 50)
        response = self.client.post("/ifa/administracao/restaurar", data={"csrf_token":"test-token", "backup_file":(io.BytesIO(backup),"backup.db")})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/ifa")
        self.assertEqual(self.report()["annual_score"], 100)
        with self.client.session_transaction() as session:
            self.assertNotIn("user_id", session)

    def test_category_change_does_not_erase_report_history(self):
        self.save({1: (80, 100)})
        response = self.client.post("/ifa/cadastro/agente/editar/1", data=dict(csrf_token="test-token", full_name="Teste ACS", category="ACE", unit_id="1", active="1"))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.rows("SELECT category FROM agents WHERE id=1")[0]["category"], "ACS")
        self.assertEqual(self.report()["annual_score"], 100)

    def test_existing_users_unchanged_without_initial_passwords(self):
        before = self.rows("SELECT * FROM users ORDER BY id")
        from unittest.mock import patch
        with patch.dict(os.environ, {"IFA_INITIAL_ADMIN_PASSWORD":"", "IFA_INITIAL_REGULATOR_PASSWORD":""}):
            ifa.init_database()
        self.assertEqual(self.rows("SELECT * FROM users ORDER BY id"), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
