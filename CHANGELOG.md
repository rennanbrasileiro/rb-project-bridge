# Changelog

## 0.1.3 — Execução Base44 corrigida de ponta a ponta

- Substituída a tentativa de executar a CLI pelo próprio `.exe` do aplicativo por `utilityProcess.fork` do Electron.
- O caminho físico da CLI continua sendo resolvido em `app.asar.unpacked`, mas agora é passado como módulo, separado dos argumentos `login`, `whoami` e `logout`.
- Adicionado smoke test que abre o executável Windows empacotado e executa `base44 login --help` pelo mesmo fluxo usado em produção.
- Código temporário do GitHub exibido em painel próprio, com ações para copiar e reabrir a autorização.
- Lista de projetos e contas passou a ser montada com elementos DOM, sem interpolação de HTML.
- Suíte ampliada para 23 testes automatizados.

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
