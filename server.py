"""
Servidor principal do projeto IFA + CIS.

Este arquivo evita alterar o app.py original.
O Render deve iniciar por aqui: gunicorn server:app
"""
from app import app  # importa o sistema IFA original
from cis_routes import register_cis_routes

register_cis_routes(app)
