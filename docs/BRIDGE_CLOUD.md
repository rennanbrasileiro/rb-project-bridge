# RB Project Bridge Cloud — v0.6 Alpha

## Objetivo

O Bridge Cloud transforma o motor desktop do RB Project Bridge em um serviço executável fora da máquina do operador. O cliente autoriza a Base44, conecta um destino Git e cria um job. A API registra o job, um worker isolado exporta o projeto, preserva o snapshot, converte para workspace independente, valida o build em Chromium headless e publica no Git.

A v0.6 Alpha mantém o desktop existente e adiciona uma trilha cloud separada. O primeiro destino cloud suportado é **GitLab**. GitHub continua suportado no desktop e deve ser incluído no cloud por um adapter token-based antes do lançamento público.

## Componentes

```text
Cliente / Portal
      |
      v
Bridge Cloud API  ---- conexões criptografadas ----> volume / secret store
      |
      v
filesystem queue (alpha)
      |
      v
Bridge Cloud Worker
      |-- Base44 OAuth / export
      |-- Security scan + sanitização
      |-- Standalone Supabase transform
      |-- npm build isolado
      |-- Chromium headless validation
      `-- GitLab snapshot + workspace
```

### Control plane

`cloud/server.cjs`

- `GET /health`
- `GET /v1/capabilities`
- `POST /v1/auth/base44/device`
- `POST /v1/auth/base44/device/:sessionId/poll`
- `POST /v1/auth/gitlab/token`
- `POST /v1/jobs`
- `GET /v1/jobs`
- `GET /v1/jobs/:jobId`

Todos os endpoints, exceto `/health`, exigem `Authorization: Bearer <RB_BRIDGE_API_KEY>`.

### Worker

`cloud/worker.cjs` busca jobs em estado `queued`, cria um diretório efêmero por operação e executa o mesmo `MigrationService` utilizado pelo produto desktop. No final, a pasta de sessão efêmera é removida.

### Segredos

Tokens não são gravados no payload público do job. As conexões Base44 e GitLab são armazenadas em envelopes AES-256-GCM usando `RB_BRIDGE_MASTER_KEY`. Jobs carregam somente IDs de conexão.

A chave mestre deve ter 32 bytes aleatórios em Base64. Exemplo de geração:

```bash
openssl rand -base64 32
```

Não versionar essa chave.

## GitLab

O provider `electron/services/gitlab-service.cjs` implementa o contrato que o `MigrationService` já espera do GitHub:

- verificar/criar projeto privado;
- preservar branches;
- manter `base44-source`;
- publicar branches com Git-over-HTTPS;
- abrir Merge Request quando houver alterações dos dois lados;
- recuperar o último snapshot quando a Base44 estiver temporariamente indisponível.

Para o fluxo comercial do Bridge, o token deve possuir `api` e `write_repository`.

## Variáveis do Cloud

| Variável | Obrigatória | Finalidade |
|---|---:|---|
| `RB_BRIDGE_API_KEY` | sim | protege a API alpha |
| `RB_BRIDGE_MASTER_KEY` | sim | criptografa conexões em repouso |
| `RB_BRIDGE_CLOUD_DATA` | sim em produção | volume persistente de jobs/artefatos |
| `PORT` | não | porta HTTP, padrão 8080 |
| `RB_BRIDGE_CHROMIUM` | não no Docker | caminho do Chromium |
| `RB_BRIDGE_WORKER_POLL_MS` | não | polling do worker, padrão 3000 ms |

## Docker

Build:

```bash
docker build -f Dockerfile.cloud -t rb-project-bridge-cloud .
```

API:

```bash
docker run --rm -p 8080:8080 \
  -e RB_BRIDGE_API_KEY=... \
  -e RB_BRIDGE_MASTER_KEY=... \
  -v bridge-data:/data \
  rb-project-bridge-cloud
```

Worker, usando o mesmo volume e as mesmas chaves:

```bash
docker run --rm \
  -e RB_BRIDGE_API_KEY=... \
  -e RB_BRIDGE_MASTER_KEY=... \
  -v bridge-data:/data \
  rb-project-bridge-cloud node cloud/worker.cjs
```

## Railway

O Alpha pode ser colocado em dois serviços a partir da mesma imagem:

1. `bridge-api`: comando padrão do Dockerfile, com porta pública e volume persistente.
2. `bridge-worker`: comando `node cloud/worker.cjs`, sem porta pública, compartilhando o mesmo volume.

As duas instâncias precisam das mesmas `RB_BRIDGE_MASTER_KEY` e `RB_BRIDGE_CLOUD_DATA`. O `RB_BRIDGE_API_KEY` só precisa ser exposto ao portal/control plane.

## O que ainda bloqueia lançamento público multi-tenant

Esta versão é um **Cloud Alpha operacional**, não a versão final de SaaS público. Antes de comercialização em escala, substituir:

- API key global por autenticação de usuários/organizações e RBAC;
- fila em filesystem por Postgres/Redis/SQS com claim transacional;
- volume local por object storage para ZIP, relatórios e evidências;
- secret store em arquivos por Vault/KMS/secret manager gerenciado;
- worker único por jobs em containers efêmeros com limites de CPU, memória e tempo;
- retenção indefinida por política de expiração e purge;
- logs locais por observabilidade centralizada sem conteúdo sensível;
- GitHub desktop-only por provider GitHub token/OAuth no mesmo contrato cloud;
- aceite operacional por termos, LGPD, política de privacidade, DPA, SLA e resposta a incidentes.

## Critério para beta comercial

O Beta deve provar, com ao menos dois projetos diferentes:

1. OAuth Base44 e listagem/seleção do projeto sem acesso manual ao computador do operador.
2. Exportação e checksum do ativo original.
3. Conversão standalone e build sem dependência Base44 reconhecida.
4. Renderização headless aprovada.
5. Snapshot `base44-source` preservado.
6. Entrega privada em GitLab/GitHub.
7. Recuperação de erro sem exposição de credenciais.
8. Exclusão automática dos diretórios efêmeros.
9. Evidência de retenção/purge dos artefatos.
10. Homologação funcional antes de declarar migração completa.
