# Changelog

## 0.1.2 — Autenticação corrigida

- Corrigida a execução da CLI Base44 no aplicativo empacotado, usando o caminho físico `app.asar.unpacked`.
- Abertura automática das páginas de autorização Base44 e GitHub.
- Exibição destacada do código temporário do login GitHub.
- Estados visuais de espera, sucesso e erro nos botões de conexão.
- Adicionados testes de regressão para caminho empacotado, URLs de autorização e código de dispositivo.
- Pipeline Windows agora executa a CLI Base44 empacotada antes de liberar o instalador.
- Suíte ampliada de 19 para 22 testes automatizados.

## 0.1.1 — MVP RC2

- Nomes distintos para o instalador NSIS e a versão portátil do Windows.
- Relatório de homologação sincronizado com os 19 testes aprovados.
- Mantidas todas as barreiras de segurança e o fluxo Base44 → GitHub da RC1.

## 0.1.0 — MVP RC1 revisado

- Aplicativo desktop Electron com wizard Base44 → GitHub.
- Sessões Base44, GitHub e Git isoladas do perfil global do computador.
- Exportação autenticada, backup ZIP e SHA-256.
- Sanitização de `.env`, caches, dependências e artefatos gerados.
- Scanner bloqueante de tokens, JWTs, chaves privadas e credenciais comuns.
- Inventário de entidades, funções, conectores e referências ao SDK Base44.
- Validação de build opcional em cópia temporária isolada.
- Download verificado do GitHub CLI e MinGit quando ausentes no Windows.
- Criação de repositório, commit e push com credencial efêmera via `GIT_ASKPASS`.
- Cancelamento seguro, três tentativas de push e retomada após falha.
- Relatórios JSON/Markdown e histórico local.
- 19 testes automatizados aprovados.
