# ACS e Endemias — acessos separados

Em Acessos e Backup, o administrador pode escolher o perfil Endemias — somente ACE. Esse perfil acessa apenas cadastros, avaliações, critérios e relatórios ACE, com verificação no servidor inclusive em URLs diretas e CSV. Unidades compartilhadas e administração de acessos permanecem sob os perfis gerais.

Administrador e Coordenador / Regulador alternam entre as abas ACS e Endemias. Contas existentes mantêm acesso e senha; nenhuma conta é convertida automaticamente em Endemias. O administrador deve selecionar a conta correta.

ACE usa os dois indicadores existentes: Metas dos programas ativos e Assiduidade em reuniões e mobilizações. Os bloqueios anuais dos índices ACS 2 e 3 não se aplicam a ACE. Indicadores em branco continuam fora das médias.

A migração apenas acrescenta users.access_scope com padrão TODOS, preservando as tabelas e dados existentes. Antes da alteração, salva e valida backup SQLite em backups/migrations no diretório do banco.

Validação: 21 regressões existentes e 8 cenários de permissões, preservação na migração e indicadores próprios de ACE. Bancos de teste isolados dos dados reais.
