# Relatório de validação — CEMES integrado

Versão validada: 1.7.0  
Data: 28/07/2026

## Resultado

- 15 testes de integração Flask aprovados.
- 9 testes de comportamento da interface aprovados.
- Sintaxe Python, JavaScript e manifesto da extensão aprovados.
- Inicialização pelo comando real do Render/Gunicorn aprovada.
- Rotas IFA, CIS, Estoque Hospitalar e CEMES responderam HTTP 200.
- CSS, JavaScript e imagens do CEMES responderam HTTP 200.

## Fluxos validados

- 13 unidades e setores, com um perfil ativo por unidade.
- 14 procedimentos, 15 médicos e vínculos múltiplos.
- Filtro de médicos pelo procedimento.
- Edição, inativação e reativação de médico, procedimento e unidade.
- Bloqueio de distribuição com uma vaga faltante ou excedente.
- Mesma distribuição em várias datas com horários distintos.
- Bloqueio de horário sobreposto e gravação atômica.
- Unidade visualiza e dá baixa somente nas próprias vagas.
- CEMES visualiza tudo e dá baixa em CEMES e Secretaria.
- Perfil gestor somente para consulta.
- CSRF, senha incorreta e chave de extensão inválida.
- Registro e deduplicação pela extensão.
- Registro manual, pendência, resolução, remarcação e cancelamento.
- Transferência de vaga entre unidades.
- Importação de planilha Excel.
- Relatórios CSV, XLSX e PDF.
- Backup, download e restauração.
- Auditoria das operações.
- Persistência SQLite em pasta isolada do CEMES.
- Arquivo do CIS, banco do IFA e arquivo-sentinela permaneceram inalterados
  durante todas as operações do CEMES.

## Limite do teste local

A detecção da mensagem verde foi validada com simulador e testes de DOM.
A conferência final no portal real exige uma estação já autorizada e
autenticada em `regulacao.saude.gov.br`; deve ser feita na unidade piloto
após a publicação.
