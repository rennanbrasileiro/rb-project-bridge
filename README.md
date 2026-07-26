# RB Project Bridge

Aplicativo desktop para transformar projetos Base44 em ativos independentes e verificáveis: preservação, desacoplamento, sandbox executável, workspace Supabase local, diagnóstico de prontidão e entrega segura em GitHub privado.

## Versão atual — 0.3.0

A v0.3.0 transforma o Bridge de um exportador técnico em uma **esteira de saída da Base44**. Cada operação passa a informar qual estágio foi realmente alcançado:

1. **Preservação** — código original, backup verificável e histórico protegidos.
2. **Isolamento** — runtime Base44 removido e estrutura Supabase criada.
3. **Sandbox executável** — aplicação compilada e renderizada em Chromium com dados temporários.
4. **Workspace evolutivo** — scripts e documentação para front-end e Supabase local via Docker.
5. **Produção homologável** — dados, usuários, funções e integrações reais convertidos e validados.

Principais capacidades:

- inventário de entidades, autenticação, logs, funções e integrações Base44;
- classificação de cada contrato como convertido, encaminhado, emulado ou não suportado;
- compatibilidade para realtime e `base44.appLogs.logUserInApp`;
- bloqueio de APIs desconhecidas antes da publicação;
- build em cópia isolada;
- validação real em Chromium, incluindo montagem do `#root` e captura de erros;
- diagnóstico visível no preview em vez de tela branca silenciosa;
- sandbox imediato com dados temporários no navegador;
- workspace com Supabase local, Docker e `.env.local` gerado automaticamente;
- relatório de prontidão de 0 a 100, pacote recomendado e próximas ações;
- reconstrução de previews antigos sem reexportar a Base44 nem alterar o GitHub;
- preservação automática da branch principal e da origem anterior;
- publicação direta ou por pull request conforme a evolução do repositório.

## Fluxo do produto

1. **Conectar contas** — autentica Base44 e GitHub pelo navegador e reutiliza sessões válidas.
2. **Selecionar produto e pasta** — define a origem e o diretório que guardará backup, código convertido, preview e relatório.
3. **Exportar** — baixa ou reaproveita um snapshot Base44 válido, valida a árvore e gera backup ZIP com SHA-256.
4. **Desacoplar** — remove o runtime Base44, gera schema, RLS, adapter, migrations e modo demo.
5. **Auditar runtime** — identifica os contratos usados pelas telas e aplica compatibilidades conhecidas.
6. **Preparar workspace** — adiciona scripts, documentação e configuração para Supabase local.
7. **Validar** — instala dependências em cópia isolada, executa o build, abre o bundle em Chromium e confirma a renderização.
8. **Classificar prontidão** — registra estágio, nota, bloqueadores e pacote recomendado.
9. **Preservar destino** — salva a `main` e a `base44-source` anteriores em branches datadas.
10. **Entregar** — publica o snapshot e a aplicação independente ou abre uma revisão quando o GitHub evoluiu.

## Arquivos gerados

Toda entrega standalone pode conter:

- `RB-BRIDGE-REPORT.json` e `.md`;
- `RB-MIGRATION-READINESS.json` e `.md`;
- `RB-RUNTIME-CONTRACTS.json`;
- `RUNTIME_COMPATIBILITY.md`;
- `DEVELOPMENT_WORKSPACE.md`;
- `MIGRATION_REPORT.md`;
- `SUPABASE_SETUP.md`;
- migrations, seed, funções preservadas e workflow de validação.

## Abrir ou reconstruir o preview

- **Abrir preview** liga o servidor local e usa o bundle já existente.
- **Parar preview** encerra apenas o servidor.
- **Recriar e validar preview** aplica compatibilidades atuais, recompila e testa novamente em Chromium.

A reconstrução usa o checkpoint local e não reexporta a Base44 nem publica no GitHub.

## Modos de evolução do projeto entregue

### Sandbox imediato

```bash
npm install
npm run dev:demo
```

Não exige Docker. É indicado para revisar telas, navegação e componentes. Os dados ficam temporariamente no navegador.

### Workspace com Supabase local

```bash
npm install
npm run workspace:dev
```

Exige Docker Desktop. O script inicia o Supabase, obtém as credenciais locais, cria `.env.local` e abre o Vite. O reset local pode ser feito com:

```bash
npm run workspace:reset
```

## Critério de aprovação do sandbox

O preview só é considerado aprovado quando:

- o build produz `index.html` e assets;
- o servidor local entrega o bundle;
- uma janela Chromium isolada carrega a aplicação;
- o elemento `#root` recebe conteúdo;
- não há erro fatal, rejeição não tratada ou falha principal de carregamento;
- todos os contratos Base44 detectados possuem tratamento conhecido.

## Limites da automação

A conversão estrutural não transfere automaticamente:

- registros reais do banco;
- usuários e sessões;
- secrets e autorizações OAuth;
- arquivos de storage;
- funções dependentes de `context.base44`, secrets, raw body ou contratos específicos;
- pagamentos, webhooks, domínio, DNS, backup e observabilidade de produção.

Esses itens passam a ser inventariados e entram no plano de migração, mas exigem conversão e homologação específicas.

## Pacotes comerciais

Consulte [PRODUCT_PACKAGES.md](docs/PRODUCT_PACKAGES.md). Os pacotes são:

- Diagnóstico e Preservação;
- Sandbox Executável;
- Workspace Evolutivo;
- Migração Completa e Homologação.

A nota de prontidão é evidência técnica; não substitui o aceite funcional do cliente.

## Segurança

- O aplicativo não solicita senhas da Base44 ou do GitHub.
- As sessões ficam isoladas no diretório privado do aplicativo.
- Tokens não são incluídos em URL, commit ou log.
- Logs passam por redaction antes da persistência.
- `.env`, `.git`, caches e artefatos temporários são removidos da cópia publicável.
- Possíveis tokens, chaves privadas e segredos bloqueiam a entrega.
- Symlinks e arquivos especiais bloqueiam a execução.
- Repositórios são privados por padrão.
- O backup original nunca é modificado.
- A branch principal existente é preservada antes da atualização.

Leia [THREAT_MODEL.md](docs/THREAT_MODEL.md) antes de uso comercial.

## Desenvolvimento do Bridge

Requisitos:

- Node.js 20.19 ou superior;
- Windows 10/11, Linux ou macOS.

```bash
npm install
npm run check
npm start
```

## Gerar instalador Windows

```powershell
./scripts/build-windows.ps1
```

O pipeline executa validação sintática, testes, empacotamento, smoke OAuth no executável, checksums e upload dos artefatos.

## Estado da qualidade

A suíte cobre, entre outros pontos:

- autenticação e capacidades GitHub;
- retries de rede Base44;
- sanitização, redaction e scanner de segredos;
- transformação standalone e gate Supabase;
- inventário de contratos de runtime;
- realtime, app logs e APIs emuladas;
- preparação do workspace local;
- diagnóstico e nota de prontidão;
- diagnóstico de erros no preview;
- renderização em Chromium;
- reconstrução de previews concluídos;
- preservação de branches e retomada segura;
- estratégia por pull request;
- fluxo completo com serviços simulados.

Consulte [OPERATOR_RUNBOOK.md](docs/OPERATOR_RUNBOOK.md) e [BUILD_STATUS.md](BUILD_STATUS.md).

## Licença

Uso interno da RB HUB neste estágio. Antes da comercialização pública, definir licença, política de privacidade, termos do serviço e assinatura de código do instalador.
