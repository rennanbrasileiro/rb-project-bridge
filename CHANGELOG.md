# Changelog

## 0.1.5 — Autenticação Base44 reimplementada por OAuth direto

- Removida completamente a execução da CLI Base44 dentro do Electron.
- Implementado o fluxo oficial OAuth Device Authorization diretamente pelos endpoints `/oauth/device/code`, `/oauth/token` e `/oauth/userinfo`.
- Código e link da Base44 exibidos em painel próprio, fora do log.
- Sessão Base44 salva e renovada no diretório isolado do aplicativo.
- Dependência npm `base44` removida do pacote final.
- Smoke test exige prova JSON criada pelo aplicativo com código real e URL oficial da Base44.
- Validação confirmada tanto em `win-unpacked` quanto no Portable autoextraível executado em `%TEMP%`.
- Suíte ampliada para 26 testes automatizados.

## 0.1.4 — Tentativa de normalização dos argumentos Base44

- Adicionado um adaptador entre o `utilityProcess` e a CLI Base44.
- O adaptador reconstruía `process.argv` antes de importar `base44/bin/run.js`.
- Limitação identificada no teste real: a CLI ainda recebia o próprio caminho como comando no Portable.
- O smoke test anterior verificava o código de saída, mas não comprovava que o fluxo OAuth tinha sido iniciado.

## 0.1.3 — Execução Base44 parcialmente corrigida

- Substituída a tentativa de executar a CLI pelo próprio `.exe` do aplicativo por `utilityProcess.fork` do Electron.
- O caminho físico da CLI passou a ser resolvido em `app.asar.unpacked`.
- Adicionado smoke test inicial no diretório `win-unpacked`.
- Código temporário do GitHub exibido em painel próprio, com ações para copiar e reabrir a autorização.
- Lista de projetos e contas passou a ser montada com elementos DOM, sem interpolação de HTML.
- Limitação identificada após teste no Portable: o vetor `process.argv` ainda continha o caminho do módulo duplicado.

## 0.1.2 — Autenticação parcialmente corrigida

- Corrigido o caminho físico da CLI Base44 para `app.asar.unpacked`.
- Abertura automática das páginas de autorização Base44 e GitHub.
- Estados visuais de espera, sucesso e erro nos botões de conexão.
- Adicionados testes de regressão para caminho empacotado, URLs de autorização e código de dispositivo.
- Limitação identificada após teste real: o `.exe` empacotado ainda tratava o caminho da CLI como um comando, impedindo o login Base44.

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
