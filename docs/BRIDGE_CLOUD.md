# RB Project Bridge Cloud — v0.6 Alpha

## Objetivo

O Bridge Cloud transforma o motor desktop do RB Project Bridge em um serviço executável fora da máquina do operador. O cliente autoriza a Base44, conecta um destino Git e cria um job. O serviço exporta o projeto, preserva o snapshot, converte para workspace independente, valida o build em Chromium headless e publica no Git.

A v0.6 mantém o desktop existente e adiciona uma trilha Cloud separada. O primeiro destino Cloud suportado é **GitLab**. O primeiro piloto real é o **Agile Hub**.

## v0.6.0-alpha.2 — modo piloto hospedado

Para o primeiro piloto, API e worker podem rodar no **mesmo container** através de `cloud/pilot.cjs`. Isso evita depender de filesystem compartilhado entre serviços distintos antes da adoção de uma fila transacional.

O navegador recebe um dashboard em `/` com o fluxo guiado:

1. informar a chave de acesso do piloto;
2. autorizar Base44 via Device Flow;
3. listar os projetos Base44 e selecionar o Agile Hub;
4. validar um token GitLab com `api` + `write_repository`;
5. definir namespace, repositório e estratégia de criação/reuso;
6. iniciar a migração;
7. acompanhar os eventos do job;
8. abrir o repositório GitLab e baixar o pacote ZIP ao final.

A chave do piloto fica apenas em `sessionStorage`. O token GitLab é apagado do campo após a conexão e armazenado criptografado no backend.

## Arquitetura

```text
Browser / dashboard
      |
      v
Bridge Cloud API
      |---- conexões criptografadas AES-256-GCM
      |---- jobs / artefatos
      v
Worker embutido (piloto)
      |-- Base44 OAuth / export
      |-- Security scan + sanitização
      |-- Standalone Supabase transform
      |-- npm build isolado
      |-- Chromium headless validation
      `-- GitLab snapshot + workspace
```

No beta multi-tenant, API e workers voltam a ser separados e a fila em filesystem é substituída por Postgres/Redis/SQS.

## Endpoints do piloto

- `GET /` — dashboard do piloto
- `GET /health` — healthcheck público
- `GET /v1/capabilities`
- `POST /v1/auth/base44/device`
- `POST /v1/auth/base44/device/:sessionId/poll`
- `GET /v1/base44/projects?connectionId=...`
- `POST /v1/auth/gitlab/token`
- `POST /v1/jobs`
- `GET /v1/jobs`
- `GET /v1/jobs/:jobId`
- `GET /v1/jobs/:jobId/download`

Os endpoints `/v1/*` exigem `Authorization: Bearer <RB_BRIDGE_API_KEY>`.

## Segurança

Tokens não são gravados no payload público do job. As conexões Base44 e GitLab são armazenadas em envelopes AES-256-GCM usando `RB_BRIDGE_MASTER_KEY`. Jobs carregam somente IDs de conexão.

A chave mestre deve ter 32 bytes aleatórios em Base64 e nunca deve ser versionada.

O worker usa diretório efêmero para sessões e remove esse diretório no final da operação. Artefatos finais ficam no diretório de dados configurado para permitir download e auditoria.

## GitLab

O provider `electron/services/gitlab-service.cjs` implementa o contrato de entrega usado pelo motor de migração:

- verificar/criar projeto privado;
- preservar branches existentes;
- manter `base44-source`;
- publicar branches com Git-over-HTTPS;
- manter `main` como branch padrão em projeto novo;
- abrir Merge Request quando houver evolução dos dois lados;
- recuperar snapshot anterior quando a Base44 estiver temporariamente indisponível.

Para o fluxo comercial do Bridge, o token deve possuir `api` e `write_repository`.

## Variáveis

| Variável | Obrigatória | Finalidade |
|---|---:|---|
| `RB_BRIDGE_API_KEY` | sim | protege a API e o dashboard do piloto |
| `RB_BRIDGE_MASTER_KEY` | sim | criptografa conexões em repouso |
| `RB_BRIDGE_CLOUD_DATA` | sim em produção | jobs, conexões e artefatos |
| `PORT` | não | porta HTTP, padrão 8080 |
| `RB_BRIDGE_CHROMIUM` | não no Docker | caminho do Chromium |
| `RB_BRIDGE_WORKER_POLL_MS` | não | polling do worker, padrão 3000 ms |

## Docker

A imagem padrão do Alpha.2 inicia API + worker no mesmo processo de piloto:

```bash
docker build -f Dockerfile.cloud -t rb-project-bridge-cloud .
docker run --rm -p 8080:8080 \
  -e RB_BRIDGE_API_KEY=... \
  -e RB_BRIDGE_MASTER_KEY=... \
  -v bridge-data:/data \
  rb-project-bridge-cloud
```

Para ambientes que possuam fila/storage compartilhados, os processos continuam disponíveis separadamente por `cloud:api` e `cloud:worker`.

## Roteiro de homologação — Agile Hub

O primeiro piloto só é considerado tecnicamente concluído quando houver evidência de:

1. dashboard acessível e `/health` aprovado;
2. OAuth Base44 concluído sem senha no Bridge;
3. Agile Hub listado a partir da conta Base44;
4. token GitLab validado com os escopos mínimos;
5. exportação Base44 concluída e backup criado;
6. scanner de segurança sem segredo bloqueante;
7. transformação standalone concluída;
8. build isolado aprovado;
9. Chromium headless confirmando conteúdo renderizado;
10. `base44-source` publicado no GitLab;
11. `main` contendo o workspace independente;
12. pacote de entrega baixável pelo dashboard;
13. relatório final revisado antes de qualquer desligamento da Base44.

O piloto **não desliga nem altera a aplicação Base44 original**. O corte só ocorre depois da homologação funcional do workspace independente.

## CI

`.github/workflows/bridge-cloud-ci.yml` valida:

- instalação de dependências sem lifecycle scripts;
- sintaxe de desktop + Cloud;
- suíte automatizada do Bridge;
- build completo de `Dockerfile.cloud`.

A imagem não deve ser publicada se essa etapa falhar.

## Hospedagem

Railway é adequado para o piloto por suportar container longo, Git e Chromium. Na conta atual, novas provisões podem depender de aumento do limite do plano. O código permanece compatível com qualquer host que execute a imagem Docker e forneça as duas chaves obrigatórias.

## O que ainda bloqueia lançamento público multi-tenant

Esta versão é um **Cloud Alpha operacional**, não a versão final do SaaS. Antes de comercialização em escala, substituir:

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

1. OAuth Base44 e seleção do projeto sem acesso manual ao computador do operador;
2. exportação e checksum do ativo original;
3. conversão standalone e build sem dependência Base44 reconhecida;
4. renderização headless aprovada;
5. snapshot `base44-source` preservado;
6. entrega privada em GitLab/GitHub;
7. recuperação de erro sem exposição de credenciais;
8. exclusão automática dos diretórios efêmeros;
9. política de retenção/purge dos artefatos;
10. homologação funcional antes de declarar migração completa.
