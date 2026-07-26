# Arquitetura do RB Project Bridge

## Objetivo

Executar a migração no computador do operador, reduzindo exposição de código e credenciais do cliente. A aplicação desktop atua como orquestrador de ferramentas oficiais e rotinas locais de segurança.

## Componentes

### Renderer

Interface HTML/CSS/JavaScript executada em `BrowserWindow` com `nodeIntegration=false`, `contextIsolation=true` e sandbox do renderer habilitado. Não possui acesso direto ao sistema de arquivos ou processos.

### Preload

Expõe uma API limitada por `contextBridge`. Somente canais IPC explicitamente permitidos podem ser consumidos pelo renderer.

### Main process

Valida entradas, abre seletores de pasta, controla links externos e instancia os serviços.

### Base44Service

- Executa o Base44 CLI empacotado para login e renovação de sessão.
- Mantém HOME e autenticação da CLI em diretório isolado do aplicativo.
- Lê a autenticação criada pela própria CLI.
- Lista projetos autorizados.
- Baixa o mesmo pacote de exportação utilizado pelo comando `eject`.
- Impõe limite de 1 GB no download.
- Extrai a árvore em diretório isolado.

### SecurityService

- Rejeita symlinks e arquivos especiais.
- Remove credenciais locais e diretórios gerados.
- Gera `.env.example`.
- Varre padrões de segredo.
- Bloqueia a criação do repositório quando há achados críticos ou altos.
- Produz inventário de dependências Base44.

### ToolchainService

- Usa Git/GitHub CLI existentes quando encontrados.
- No Windows, baixa GitHub CLI e MinGit oficiais para o diretório privado da aplicação quando necessário.
- Valida checksum do GitHub CLI e assinatura Authenticode dos executáveis no Windows.
- Mantém ferramentas fora do projeto migrado.

### GitHubService

- Autoriza a conta via GitHub CLI em configuração isolada.
- Lista usuário e organizações disponíveis.
- Cria o repositório somente após os gates de segurança.
- Isola a configuração global do Git e injeta a credencial de push apenas no processo via `GIT_ASKPASS`.
- Configura Git, cria commit e faz push para `main`.

### MigrationService

Orquestra uma state machine transacional:

`export → validate tree → backup → copy → sanitize → scan → inspect → optional isolated build → report → create repo → commit/push → final report`

Se uma etapa falhar, o repositório não é criado enquanto os gates anteriores não forem aprovados. Quando a falha ocorre após criação, o relatório registra o repositório vazio/parcial para intervenção do operador.

## Diretório de uma execução

```text
<output>/project-<timestamp>/
├── source-backup/                 # exportação original
├── repository/                    # cópia sanitizada e publicada
├── project-base44-source.zip      # backup original
├── project-base44-source.zip.sha256
├── RB-BRIDGE-REPORT.json
└── RB-BRIDGE-REPORT.md
```

## Fronteiras de confiança

- Renderer: não confiável para operações privilegiadas.
- IPC: entradas validadas no main process.
- Export Base44: conteúdo potencialmente hostil até passar pela validação.
- Scripts npm: não executados sem consentimento explícito; quando autorizados, rodam em cópia temporária descartável, nunca na árvore que será publicada.
- Ferramentas baixadas: origem oficial e HTTPS; GitHub CLI validado por SHA-256 e executáveis Windows validados por Authenticode.
