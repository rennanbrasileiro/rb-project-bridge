# RB Project Bridge

Aplicativo desktop para retirar produtos da Base44 com um processo verificável: preservação do ativo, isolamento técnico, sandbox executável, workspace independente, homologação guiada e pacote formal de entrega ao cliente.

## Versão atual — 0.5.0

A v0.5.0 fecha o MVP comercial de ponta a ponta. Além de gerar e publicar o workspace, o Bridge passa a explicar dentro da própria aplicação:

- o que foi contratado;
- o que foi efetivamente alcançado;
- quais itens do escopo foram selecionados;
- quais homologações já possuem evidência;
- o que ainda bloqueia o handoff ou a produção;
- como evoluir o front-end, o backend ou uma nova versão Base44 sem refazer o trabalho aprovado.

O painel **Estado atual e continuidade** aparece abaixo dos detalhes técnicos e funciona também para operações anteriores carregadas do histórico.

## Pacotes disponíveis

1. **Diagnóstico e preservação** — backup, snapshot, inventário e plano de saída; não promete execução independente.
2. **Sandbox executável** — aplicação navegável fora da Base44, com modo demo e validação em Chromium.
3. **Workspace evolutivo** — repositório modificável, migrations, Supabase local, scripts e documentação.
4. **Migração completa e homologação** — projeto de substituição da Base44 com dados, usuários, storage, integrações, implantação e aceite funcional.

O Bridge compara o estágio efetivamente alcançado com o pacote contratado. Um React renderizado não é apresentado como migração completa.

## Fechamento guiado da operação

Depois da geração, o Bridge separa três decisões que não podem ser confundidas:

- **Merge do workspace** — o código pode ser incorporado depois da validação visual e da revisão do PR.
- **Handoff do pacote contratado** — exige as homologações humanas e de escopo registradas no painel.
- **Produção** — exige nível `production-candidate`, aceite funcional e evidências de implantação e rollback.

As homologações disponíveis são:

- validação visual e navegação;
- workspace, banco e autenticação;
- dados históricos;
- usuários e autorização;
- arquivos e storage;
- backend, funções e integrações;
- implantação e operação;
- aceite funcional e corte.

Cada registro contém estado, responsável, observações e evidência. A alteração recalcula os relatórios localmente e marca o pacote para regeneração. O GitHub não é alterado automaticamente.

## Como evoluir sem refazer a migração

### Correções de front-end

Abra o workspace migrado, crie uma branch do produto e use:

```bash
npm install
npm run dev:demo
```

Depois das correções, use **Recriar e validar preview** no Bridge. Uma nova exportação Base44 não é necessária.

### Banco e fluxos reais

Use:

```bash
npm install
npm run workspace:dev
```

Valide migrations, autenticação, CRUD, RLS, realtime, storage e funções. Registre as evidências no painel e regenere o pacote.

### Nova versão Base44

Inicie uma nova operação apontando para o mesmo repositório. O Bridge compara Base44 e GitHub, preserva os dois lados e abre revisão quando ambos evoluíram.

### Obstáculo de outro piloto

Cada pacote gera:

- `CLIENT_DELIVERY/PILOT_EXTENSION_REQUEST.json`;
- `CLIENT_DELIVERY/PILOT_EXTENSION_REQUEST.md`.

Esses arquivos organizam contratos convertidos, encaminhados, emulados, não suportados e bloqueadores de produção. O objetivo é transformar obstáculos reutilizáveis em correções genéricas do Bridge, evitando patches escondidos apenas no projeto do cliente.

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
- `OPERATION_STATUS_AND_NEXT_STEPS.md`;
- `PILOT_EXTENSION_REQUEST.json` e `.md`;
- relatórios de runtime, segurança e prontidão.

O manifesto agora contém a matriz **escopo selecionado x homologado**, a verificação do pacote contratado e a decisão atual de handoff.

## Processo de uma entrega comercial

1. **Definir o contrato** — registrar pacote, destino, funcionalidades, dados, usuários, arquivos, integrações e implantação incluídos.
2. **Obter autorização** — confirmar propriedade do produto e permissão para exportar, transformar e publicar.
3. **Preservar** — exportar, sanitizar, gerar backup com SHA-256 e proteger branches anteriores.
4. **Inventariar** — mapear entidades, autenticação, logs, funções, integrações, conectores e chamadas diretas de backend.
5. **Converter** — gerar adapter, schema, RLS, migrations, funções preparadas e workspace.
6. **Validar tecnicamente** — instalar em cópia isolada, compilar, abrir em Chromium e bloquear contratos desconhecidos.
7. **Evoluir o produto** — corrigir interface ou backend no workspace migrado, sem editar a Base44 desnecessariamente.
8. **Homologar conforme o pacote** — registrar no Bridge as evidências de banco, dados, usuários, storage, integrações e ambiente real.
9. **Recalcular e empacotar** — atualizar manifesto, plano, checklist, backlog, ZIP e checksum.
10. **Transferir custódia, aceitar e cortar** — colocar contas sob controle do cliente, testar rollback e somente então desligar a Base44.

Consulte [CLIENT_DELIVERY_PLAYBOOK.md](docs/CLIENT_DELIVERY_PLAYBOOK.md) para o roteiro operacional completo.

## Arquiteturas de destino

- **Supabase Cloud + hospedagem web** — perfil principal suportado para front-end React/Vite, banco, autenticação, storage, realtime e Edge Functions.
- **Supabase próprio ou local** — workspace Docker preparado; produção exige operação, TLS, SMTP, backup, observabilidade e atualização do ambiente.
- **AWS customizado** — gera blueprint para S3/CloudFront, Lambda/API Gateway, Cognito e RDS, mas não promete implantação automática.
- **Somente código e documentação** — repositório e pacote local sem implantação gerenciada.

## Compatibilidade Base44

O inventário cobre entidades e realtime, autenticação, convites, app logs, analytics, functions, integrations, rotas `/api/functions/*`, conectores, service role, agentes e namespaces desconhecidos.

Cada contrato é classificado como:

- **convertido** — possui implementação independente;
- **encaminhado** — usa função, storage ou adapter do destino;
- **emulado** — suficiente para sandbox, mas bloqueia produção até decisão;
- **não suportado** — interrompe a aprovação e identifica método e arquivo.

## Critério de aprovação

### Sandbox

Exige build, servidor local, carregamento em Chromium, conteúdo no `#root`, ausência de erro fatal e cobertura conhecida para todos os contratos detectados.

### Workspace

Além do sandbox, exige scripts e migrations preparados. A validação completa depende de Docker ativo e testes de autenticação, CRUD, RLS e realtime com persistência local.

### Produção

Nunca é aprovada apenas pelo build. Exige evidências separadas para dados, usuários, storage, backend, implantação, observabilidade, rollback e homologação funcional.

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

## Limite congelado do MVP

O Bridge é o plano de controle da migração: preserva, converte, valida, registra evidências e empacota. Ele não é um editor de código, uma IDE ou um executor de chaves arbitrárias. A evolução do produto ocorre no workspace e no repositório entregue; o Bridge volta a ser usado para revalidação, nova origem Base44, homologação e handoff.

## Desenvolvimento do Bridge

Requisitos: Node.js 20.19 ou superior e Windows 10/11, Linux ou macOS.

```bash
npm install
npm run check
npm start
```

O pipeline valida sintaxe, 80 testes automatizados, empacotamento Windows, OAuth no executável, checksums e artefatos.

## Licença

Uso interno da RB HUB neste estágio. Antes da comercialização pública, definir licença, política de privacidade, termos do serviço, SLA, contrato de tratamento de dados e assinatura de código do instalador.
