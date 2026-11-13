# TVs da Saúde de Valente

Painel independente com Node.js >=22 e FFmpeg. Instruções de execução, Docker e hospedagem separada: [DEPLOY-INDEPENDENTE.md](DEPLOY-INDEPENDENTE.md).

- Iniciar: `node server.mjs` (definir TVHOSP_ADMIN_PASSWORD antes).
- Testar: `node --test test/*.test.mjs`.
- Administração: `/TV`. Painéis: `/TV/TVHosp` e `/TV/TVsaude`.

Os sistemas e bancos existentes da IFA não são utilizados pelo painel.
