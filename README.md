# IFA Valente — Avaliação de Desempenho

Sistema web em Flask + SQLite para cadastro e avaliação dos Agentes Comunitários de Saúde (ACS) e Agentes de Combate às Endemias (ACE), baseado no Anexo I da Portaria municipal de 2026.

## Páginas e endereços

- `/ifa` — login ADM ou Regulador
- `/ifa/principal` — dashboard
- `/ifa/relatorios` — relatório por profissional ou unidade, mensal, quadrimestral e anual
- `/ifa/avaliacoes` — histórico, inclusão, edição, detalhamento e exclusão
- `/ifa/cadastro` — ACS/ACE e Unidades de Saúde
- `/ifa/criterios` — indicadores e faixas de pontuação
- `/ifa/administracao` — usuários, auditoria, backup automático/manual e restauração (somente ADM)

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
python app.py
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

## Regras implementadas

- 80% a 100%: **10 pontos**
- 70% a 79,99%: **7 pontos**
- Abaixo de 70%: **5 pontos**

O documento possui duas linhas com “<79%”, que se sobrepõem à faixa 70–79%. No sistema, essas linhas foram normalizadas para “<70%”, mantendo a regra consistente. A pontuação mensal do ACS soma 10 indicadores, total máximo de 100 pontos.

## Segurança e auditoria

- Senhas armazenadas com hash seguro.
- Sessão e proteção CSRF nos formulários.
- Perfis ADM e Regulador.
- Registro de inclusão, alteração, exclusão, login e backup.

## Produção

Antes do uso oficial, recomenda-se validar a Portaria final publicada, os critérios de proporcionalidade em afastamentos, a política de retenção de backups e a infraestrutura de hospedagem com a assessoria jurídica e a área técnica da Secretaria Municipal de Saúde.
