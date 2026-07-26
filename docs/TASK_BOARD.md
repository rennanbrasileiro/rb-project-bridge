# Task Board — MVP real

## Frente A — Núcleo Base44

- [x] Login pelo Base44 CLI em sessão isolada do sistema.
- [x] Renovação de sessão via CLI.
- [x] Listagem de projetos autorizados.
- [x] Exportação autenticada.
- [x] Limite de tamanho e extração segura.
- [ ] Teste ponta a ponta com conta Base44 real no Windows.

## Frente B — Segurança

- [x] Redaction de logs, saídas e argumentos de subprocessos.
- [x] Isolamento de credenciais Base44, GitHub e configuração global do Git.
- [x] Sanitização de `.env`, `.git`, caches e builds.
- [x] `.env.example` automático.
- [x] Scanner bloqueante.
- [x] Rejeição de symlinks/arquivos especiais.
- [x] Limites de arquivos e bytes.
- [ ] Revisão de segurança independente.

## Frente C — GitHub

- [x] Descoberta/obtenção do GitHub CLI.
- [x] Descoberta/obtenção do Git no Windows.
- [x] Login pelo navegador.
- [x] Usuário e organizações.
- [x] Criação do repositório.
- [x] Commit e push com credencial efêmera via `GIT_ASKPASS`.
- [ ] Teste ponta a ponta em conta GitHub descartável.

## Frente D — Produto desktop

- [x] Electron com context isolation e renderer sandbox.
- [x] Wizard completo.
- [x] Progresso e logs.
- [x] Histórico local.
- [x] Cancelamento seguro e retomada de publicação.
- [x] Relatório e resultado.
- [x] Política de links e navegação.
- [ ] Assinatura de código do instalador.

## Frente E — Qualidade

- [x] Testes unitários (19 cenários automatizados).
- [x] Testes de orquestração com mocks.
- [x] Gate que impede criar repo antes do scan.
- [x] Build em sandbox temporário, sem adicionar dependências/artefatos ao GitHub.
- [x] Proteção contra retomada apontando para diretórios externos.
- [x] Workflow Windows.
- [ ] Build do instalador em ambiente com acesso ao npm.
- [ ] Teste de instalação limpa no Windows 10 e 11.

## Frente F — Comercialização

- [x] Runbook de operação.
- [x] Escopo explícito da exportação básica.
- [x] Threat model inicial.
- [ ] Termos de uso.
- [ ] Política de privacidade.
- [ ] Consentimento/ordem de serviço digital.
- [ ] Validação comercial com Base44.
