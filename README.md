# Secretaria Municipal de Saúde de Valente — Sistemas integrados

Um único projeto Flask e um único serviço Render para IFA, CIS, Estoque
Hospitalar e CEMES/Marcação. Cada módulo mantém seus dados em área própria
do mesmo disco persistente.

## Páginas e endereços

- `/ifa` — login ADM ou Regulador
- `/ifa/principal` — dashboard
- `/ifa/relatorios` — relatório por profissional ou unidade, mensal, quadrimestral e anual
- `/ifa/avaliacoes` — histórico, inclusão, edição, detalhamento e exclusão
- `/ifa/cadastro` — ACS/ACE e Unidades de Saúde
- `/ifa/criterios` — indicadores e faixas de pontuação
- `/ifa/administracao` — usuários, auditoria, backup automático/manual e restauração (somente ADM)
- `/CIS` — regulação CIS
- `/EstoqueHospital` — estoque hospitalar
- `/Cemes/` — Controle Municipal de Vagas e Marcação
- `/Cemes/api/health` — verificação do módulo CEMES

## Unidades de Saúde cadastradas

- USF Casas Populares
- USF Centro
- USF Cidade Nova
- USF Juazeiro Petrolina
- USF Queimada do Curral
- USF Santa Rita de Cássia
- USF Tanquinho
- USF Valilândia
- USF Junco
- USF Dr. Antônio Delfino Mota – Simões

O banco inicia sem profissionais e sem avaliações cadastradas.

## Como iniciar no Windows

Defina `SECRET_KEY` no ambiente antes de iniciar. Somente para um banco novo e sem usuários, defina também `IFA_INITIAL_ADMIN_PASSWORD` e `IFA_INITIAL_REGULATOR_PASSWORD`, ambas com pelo menos 8 caracteres. Não existem senhas padrão no código. Bancos existentes conservam seus usuários e senhas sem exigir essas duas variáveis iniciais.

1. Instale Python 3.11 ou superior.
2. Dê dois cliques em `iniciar.bat`.
3. O navegador abrirá em `http://127.0.0.1:5000/ifa`.

Na primeira execução, o instalador cria um ambiente virtual e baixa as dependências.

## Como iniciar pelo terminal

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

## Backup

- Após cada inclusão, alteração ou exclusão, o sistema cria automaticamente uma cópia segura do banco SQLite.
- São mantidos os 30 backups automáticos mais recentes.
- O ADM pode gerar um backup manual em ZIP (banco `.db` + conferência em JSON).
- A restauração aceita arquivo `.db` válido.

### Hospedagem

O projeto inclui `Procfile` e `render.yaml`. Para que banco e backups não sejam perdidos, use disco persistente e configure:

```text
IFA_DATA_DIR=/var/data
SECRET_KEY=uma-chave-secreta-forte
```

Sem disco persistente, hospedagens com sistema de arquivos temporário podem apagar o banco em reinícios ou novas publicações.

No Render existente, mantenha um único serviço, o disco montado em
`/var/data` e o comando:

```text
gunicorn server:app --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 120
```

O CEMES salva isoladamente em `/var/data/cemes/cmvr.db`. Ele não substitui
o banco do IFA nem o arquivo do CIS. Consulte
`LEIA-ME_CEMES_INTEGRADO.txt` antes de publicar.

## Regras implementadas

- 80% a 100%: **10 pontos**
- 70% a 79,99%: **7 pontos**
- Abaixo de 70%: **5 pontos**

O documento possui duas linhas com “<79%”, que se sobrepõem à faixa 70–79%. No sistema, essas linhas foram normalizadas para “<70%”, mantendo a regra consistente.

Realizado e meta podem ficar **ambos em branco**: o indicador não entra nas médias. Realizado igual a **zero**, com meta positiva, é preenchimento válido e entra no cálculo. Preencher apenas um dos dois campos é rejeitado. Fora de férias/licença, deve haver pelo menos um indicador preenchido.

A pontuação mensal é a soma dos pontos dividida pela quantidade de indicadores preenchidos, multiplicada por 10 (escala de 0 a 100). No relatório anual, cada indicador recebe a pontuação correspondente à média dos seus percentuais disponíveis; o resultado final considera somente os indicadores com dados. Meses e indicadores sem dados não viram zero. Índices ACS 2 e 3 continuam exclusivos de dezembro, inclusive em afastamento.

Revisão e testes: [REVISÃO IFA — 25/09/2026](docs/REVISAO_IFA_2026-09-25.md).

## Segurança e auditoria

- Senhas armazenadas com hash seguro.
- Sessão e proteção CSRF nos formulários.
- Perfis ADM e Regulador.
- Registro de inclusão, alteração, exclusão, login e backup.

## Produção

Antes do uso oficial, recomenda-se validar a Portaria final publicada, os critérios de proporcionalidade em afastamentos, a política de retenção de backups e a infraestrutura de hospedagem com a assessoria jurídica e a área técnica da Secretaria Municipal de Saúde.
