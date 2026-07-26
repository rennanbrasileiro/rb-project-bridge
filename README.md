# RB Project Bridge

Aplicativo desktop para retirar produtos da Base44 com um processo verificável: preservação do ativo, isolamento técnico, sandbox executável, workspace independente, avaliação de produção e pacote formal de entrega ao cliente.

## Versão atual — 0.4.0

A v0.4.0 organiza o Bridge pelo **resultado contratado**, não apenas pelo mecanismo técnico. Antes de iniciar, a operação registra cliente, responsável, pacote, arquitetura de destino e escopo declarado. Ao terminar, produz evidências técnicas e um handoff utilizável.

Pacotes disponíveis:

1. **Diagnóstico e preservação** — backup, snapshot, inventário e plano de saída; não promete execução independente.
2. **Sandbox executável** — aplicação navegável fora da Base44, com modo demo e validação em Chromium.
3. **Workspace evolutivo** — repositório modificável, migrations, Supabase local, scripts e documentação.
4. **Migração completa e homologação** — projeto de substituição da Base44 com dados, usuários, storage, integrações, implantação e aceite funcional.

O Bridge compara o estágio efetivamente alcançado com o pacote contratado. Um React renderizado não é apresentado como migração completa.

## O que o cliente recebe

A operação standalone gera:

- repositório GitHub privado, preservado e versionado;
- ZIP verificável da entrega com arquivo SHA-256;
- código standalone e snapshot Base44 em branch própria;
- preview local quando aplicável;
- `CLIENT_DELIVERY/CLIENT_DELIVERY_MANIFEST.json`;
- `CLIENT_HANDOFF.md`;
- `ACCEPTANCE_CHECKLIST.md`;
- `DEPLOYMENT_BLUEPRINT.md`;
- `CREDENTIALS_HANDOFF.md`;
- `MIGRATION_BACKLOG.md`;
- relatórios de runtime, segurança e prontidão.

O botão **Abrir pacote do cliente** abre o ZIP final quando disponível; em operações incompletas, abre a pasta documental.

## Processo de uma entrega comercial

1. **Definir o contrato** — registrar pacote, destino, funcionalidades, dados, usuários, arquivos, integrações e implantação incluídos.
2. **Obter autorização** — confirmar propriedade do produto e permissão para exportar, transformar e publicar.
3. **Preservar** — exportar, sanitizar, gerar backup com SHA-256 e proteger branches anteriores.
4. **Inventariar** — mapear entidades, autenticação, logs, funções, integrações, conectores e chamadas diretas de backend.
5. **Converter** — gerar adapter, schema, RLS, migrations, funções preparadas e workspace.
6. **Validar** — instalar em cópia isolada, compilar, abrir em Chromium e bloquear contratos desconhecidos.
7. **Homologar conforme o pacote** — testar banco local, dados, usuários, storage, integrações e ambiente real quando contratados.
8. **Empacotar** — produzir repositório, ZIP, checksum, manifesto, aceite, blueprint e backlog.
9. **Transferir custódia** — colocar GitHub, hospedagem, banco, domínio e provedores sob controle do cliente.
10. **Aceitar e cortar** — registrar evidências, testar backup/rollback e só então desligar a Base44.

Consulte [CLIENT_DELIVERY_PLAYBOOK.md](docs/CLIENT_DELIVERY_PLAYBOOK.md) para o roteiro operacional completo.

## Arquiteturas de destino

- **Supabase Cloud + hospedagem web** — perfil principal suportado para front-end React/Vite, banco, autenticação, storage, realtime e Edge Functions.
- **Supabase próprio ou local** — workspace Docker preparado; produção exige operação, TLS, SMTP, backup, observabilidade e atualização do ambiente.
- **AWS customizado** — gera blueprint para uma arquitetura como S3/CloudFront, Lambda/API Gateway, Cognito e RDS, mas não promete implantação automática. Exige adapters e infraestrutura específicos.
- **Somente código e documentação** — repositório e pacote local sem implantação gerenciada.

## Compatibilidade Base44

O inventário cobre famílias como:

- entidades e realtime;
- autenticação, inclusive `isAuthenticated` e fluxos de e-mail/senha, OTP e OAuth reconhecidos;
- convites de usuários, com função administrativa preparada no backend;
- app logs e analytics;
- functions, integrations e rotas `/api/functions/*`;
- conectores e service role;
- agentes e namespaces desconhecidos.

Cada contrato é classificado como:

- **convertido** — possui implementação independente;
- **encaminhado** — usa função, storage ou adapter do destino;
- **emulado** — suficiente para sandbox, mas bloqueia produção até decisão;
- **não suportado** — interrompe a aprovação e identifica método e arquivo.

## Sandbox e workspace

Sandbox imediato, sem Docker:

```bash
npm install
npm run dev:demo
```

Workspace com Supabase local:

```bash
npm install
npm run workspace:dev
```

Comandos adicionais:

```bash
npm run workspace:status
npm run workspace:reset
npm run supabase:types
```

## Critério de aprovação

### Sandbox

Exige build, servidor local, carregamento em Chromium, conteúdo no `#root`, ausência de erro fatal e cobertura conhecida para todos os contratos detectados.

### Workspace

Além do sandbox, exige scripts e migrations preparados. A validação completa depende de Docker ativo e testes de autenticação, CRUD, RLS e realtime com persistência local.

### Produção

Nunca é aprovada apenas pelo build. Exige evidências separadas para os itens contratados, como:

- dados e reconciliação;
- usuários, papéis, convites e autenticação;
- storage e permissões;
- funções, pagamentos, webhooks, jobs e integrações;
- implantação, domínio, TLS, backup, monitoramento e rollback;
- homologação funcional do cliente.

## Segurança e custódia

- Tokens e secrets não entram no repositório, ZIP ou log.
- Service role permanece exclusivamente no backend.
- Repositórios são privados por padrão.
- O backup original não é alterado.
- Branches anteriores são preservadas antes de atualizações.
- Credenciais devem ser entregues por cofre ou canal seguro.
- Contas de produção devem ficar em nome do cliente.
- Acesso temporário da equipe deve ser removido após o aceite.

Leia [THREAT_MODEL.md](docs/THREAT_MODEL.md) antes de uso comercial.

## Abrir ou reconstruir preview

- **Abrir preview** serve o bundle existente.
- **Parar preview** encerra apenas o servidor.
- **Recriar e validar preview** aplica o catálogo atual, recompila e testa novamente sem reexportar nem publicar.

## Desenvolvimento do Bridge

Requisitos: Node.js 20.19 ou superior e Windows 10/11, Linux ou macOS.

```bash
npm install
npm run check
npm start
```

O pipeline valida sintaxe, 72 testes automatizados, empacotamento Windows, OAuth no executável, checksums e artefatos.

## Licença

Uso interno da RB HUB neste estágio. Antes da comercialização pública, definir licença, política de privacidade, termos do serviço, SLA, contrato de tratamento de dados e assinatura de código do instalador.
