# Especificação funcional resumida

## Perfis

### Administrador (ADM)
Acesso integral, inclusive criação/edição de usuários, backups, restauração e auditoria.

### Regulador
Acesso ao dashboard, relatórios, avaliações, cadastros e critérios. Não acessa a Administração.

## Fluxo principal

1. Cadastrar Unidade de Saúde.
2. Cadastrar ACS/ACE e vincular à unidade e microárea.
3. Abrir Nova Avaliação e selecionar competência mensal.
4. Informar numerador e denominador de cada indicador.
5. O sistema calcula percentual, faixa e pontuação automaticamente.
6. Consultar o resultado individual e os relatórios consolidados.

## Periodicidade

A entrada é mensal para permitir consolidação por mês, quadrimestre e ano. A apuração anual é formada pelas competências cadastradas no período selecionado.

## Exclusão e preservação de histórico

- Avaliações podem ser editadas e excluídas.
- Profissionais com avaliações não podem ser excluídos; devem ser desativados.
- Unidades com profissionais vinculados não podem ser excluídas; devem ser desativadas.
