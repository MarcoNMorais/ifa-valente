# Revisão do site IFA — 25/09/2026

## Resultado

Revisão feita no site Flask de `originais_extraidos/site/ifa-valente-main`, com acesso por `/ifa`. As alterações são locais; o site hospedado não foi acessado nem atualizado. O Integra Saúde e os módulos CIS, CEMES e Estoque não foram alterados.

O site original ainda obrigava todos os indicadores habilitados, e seu relatório anual dividia os pontos pela quantidade total de indicadores da categoria. Essas duas inconsistências foram corrigidas.

## Regra dos campos em branco

- Realizado e meta em branco: não grava resultado para o indicador e não entra no divisor mensal ou anual.
- Realizado zero e meta positiva: resultado válido de 0%, com 5 pontos, que entra na média.
- Apenas um dos campos preenchido: validação solicita completar o par ou apagar ambos.
- Sem qualquer indicador preenchido: exige pelo menos um, exceto em férias/licença com justificativa.
- Apagar os dois campos ao editar remove o resultado anterior e recalcula os relatórios.
- Meses sem resultado não recebem zero. Indicadores sem resultados no ano não entram no divisor anual.

Exemplo: um indicador com 80% recebe 10 pontos. Se todos os demais estiverem em branco, a pontuação normalizada é 100. Se outro indicador registrar zero realizado com meta positiva, ele recebe 5 pontos e a pontuação passa a 75. Percentual de realização e pontuação normalizada são medidas diferentes.

## Correções relacionadas

- Removidas definições duplicadas do cálculo no JavaScript; a prévia distingue branco, incompleto e zero.
- Preservados os valores digitados após erros de validação.
- Rejeitados números negativos, não finitos, metas inválidas, competências inválidas e fatores fora de 1 a 100.
- Relatório anual evita arredondamento intermediário do percentual final e não simula pagamento zero quando faltam resultados.
- Mantidos os índices ACS 2 e 3 exclusivos de dezembro e as regras de afastamento; corrigido o tratamento de afastamento de ACE em dezembro.
- Edição mantém disponíveis a competência histórica e o profissional desativado associado à avaliação.
- Alteração de categoria é bloqueada quando há avaliações, para preservar os indicadores do histórico.
- Removida a exceção incorreta que podia liberar a competência ocupada ao trocar o profissional durante uma edição.
- A competência inicial acompanha o mês atual, em vez de julho de 2026 fixo.
- Restauração fecha o arquivo temporário, verifica integridade e estrutura e usa a API de backup do SQLite para restaurar o banco, com cópia de segurança anterior.

## Validação

20 testes automatizados do servidor passaram, cobrindo branco, zero, avaliações parciais e completas, ACS/ACE, limites das faixas, fator proporcional, férias/licença, edição, duplicação, histórico, cálculo anual, CSV, páginas, autenticação, CSRF, permissões administrativas, auditoria, exclusão, backup e restauração.

Teste adicional no navegador Edge passou: prévia, validação do par incompleto, fator, bloqueio anual, inclusão, edição, relatório, competência já cadastrada e férias. Formulário e relatório também foram inspecionados em larguras de computador e celular.

Com as dependências do projeto instaladas, execute na pasta do site:

```powershell
python -m unittest discover -s tests -p test_ifa.py -v
```

O teste de navegador `tests/test_ifa_browser.cjs` exige Playwright, Edge e um servidor de testes isolado com os profissionais fictícios esperados. Não deve ser executado contra a base de produção.

Todos os testes usaram bases temporárias. A base local fornecida foi consultada somente para leitura: `integrity_check = ok`, nenhum erro de chave estrangeira e nenhuma avaliação cadastrada. Portanto, não havia avaliações reais locais para conferir nem registros antigos a recalcular.

## Limites da revisão

Na preparação para publicação em 26/09, foram retiradas as credenciais fixas de inicialização. A chave de sessão passa a exigir `SECRET_KEY`, já configurada no serviço existente. As senhas iniciais por variáveis só são consultadas quando não existe nenhum usuário; contas, hashes e senhas dos usuários atuais são preservados. Os testes usam credenciais aleatórias em bases temporárias.

Esta revisão verifica o funcionamento da implementação e a regra solicitada de exclusão de campos em branco. Não constitui homologação da portaria ou de pagamentos. Configuração, contas, dados e operação do ambiente hospedado não foram verificados. Zeros históricos não são convertidos automaticamente em branco, pois podem representar resultados válidos.
