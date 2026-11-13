"""Servidor único do IFA, CIS, Estoque Hospitalar e CEMES."""
from app import app  # importa o sistema IFA original
from cemes_routes import register_cemes_routes
from cis_routes import register_cis_routes
from ig_routes import register_ig_routes
from mensagem_routes import register_mensagem_routes

register_cis_routes(app)
register_cemes_routes(app)
register_mensagem_routes(app)
register_ig_routes(app)


from secretaria_app.web import SecretariaMiddleware
app.wsgi_app = SecretariaMiddleware(app.wsgi_app)



# Entrada no domínio institucional; o painel continua em serviço independente.
from flask import redirect

@app.route("/tv")
@app.route("/tv/")
@app.route("/TV")
@app.route("/TV/")
def tv_entry():
    return redirect("https://tv-valente.onrender.com/TV", code=302)

if __name__ == "__main__":
    import os

    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)

