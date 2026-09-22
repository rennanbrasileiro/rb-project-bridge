# Changelog

## 0.6.0-alpha.2 — Bridge Cloud Pilot

- Dashboard web para o primeiro piloto Base44 → Bridge Cloud → GitLab.
- OAuth Base44 por Device Flow e listagem dos projetos diretamente no Cloud.
- Seleção automática do Agile Hub quando disponível na conta conectada.
- Token GitLab validado por `api` + `write_repository`, criptografado em repouso e removido do campo após a conexão.
- API + worker no mesmo container no modo piloto, eliminando dependência de filesystem compartilhado entre serviços.
- Download do pacote final diretamente pelo dashboard.
- Healthcheck, CI dedicado e build obrigatório da imagem Docker.
- Roteiro de homologação do Agile Hub documentado em `docs/BRIDGE_CLOUD.md`.

## 0.6.0-alpha.1 — Fundação Bridge Cloud

- Primeira trilha hospedável do RB Project Bridge sem dependência do computador do operador.
- Control plane HTTP com health, capabilities, autenticação Base44 por Device Flow, conexão GitLab e criação/consulta de jobs.
- Credenciais Base44 e GitLab criptografadas em repouso com AES-256-GCM; jobs carregam somente referências de conexão.
- Worker separado da API, com diretório de sessão efêmero por job e limpeza ao término.
- Validação do preview em Chromium headless sem dependência do Electron/BrowserWindow.
- Provider GitLab com criação/reuso de projeto privado, preservação de branches, snapshot `base44-source`, push Git e Merge Request.
- Imagem `Dockerfile.cloud` preparada para API e worker em serviços separados.
- Documentação `docs/BRIDGE_CLOUD.md` com arquitetura, variáveis, Docker, Railway e blockers para beta multi-tenant.
- GitHub desktop permanece inalterado; GitLab é o primeiro destino da trilha Cloud Alpha.

## 0.2.0 — Pipeline Standalone Supabase e preview local

- Fluxo modular: exportar, desacoplar, gerar Supabase, validar build e entregar.
- Repositórios privados obrigatórios e verificados após a criação.
- Snapshot sanitizado preservado no branch `base44-source`.
- Conversão automática de entidades JSONC em migrations PostgreSQL com RLS conservadora.
- Runtime `@base44/sdk` e plugin Vite removidos da entrega standalone.
- Adapter compatível sobre `@supabase/supabase-js`, com modo demo local para homologação de telas.
- Scaffold `supabase/`, `.env.example`, `.devcontainer`, CI e documentação de handoff.
- Build obrigatório em cópia isolada; `dist` copiado para a pasta `preview`.
- Servidor HTTP interno para abrir o preview local diretamente pelo aplicativo.
- Funções Base44 preservadas em `supabase/functions` e marcadas para revisão quando a conversão não é segura.
- Suíte ampliada com testes do gerador, gate de independência e preview SPA.

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
- Criação de repositório, commit e push com credencial efêmera por processo.
- Cancelamento seguro, três tentativas de push e retomada após falha.
- Relatórios JSON/Markdown e histórico local.
- 19 testes automatizados aprovados.
