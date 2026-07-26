'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJson } = require('../core/fs-utils.cjs');

const DELIVERY_PACKAGES = Object.freeze({
  preservation: {
    id: 'preservation',
    label: 'Diagnóstico e preservação',
    promise: 'Preservar o ativo técnico e mapear a saída da Base44, sem prometer execução independente.',
    minimumLevel: 'preserved',
    clientReceives: ['Backup original imutável com SHA-256', 'Snapshot sanitizado', 'Inventário técnico e de segurança', 'Relatório de dependências e próximos passos'],
  },
  sandbox: {
    id: 'sandbox',
    label: 'Sandbox executável',
    promise: 'Entregar uma aplicação navegável fora da Base44 para demonstração e evolução inicial do front-end.',
    minimumLevel: 'sandbox-ready',
    clientReceives: ['Tudo do pacote de preservação', 'Código standalone', 'Preview local validado em Chromium', 'Dados temporários de demonstração', 'Matriz de contratos Base44'],
  },
  workspace: {
    id: 'workspace',
    label: 'Workspace evolutivo',
    promise: 'Entregar um repositório que uma equipe consiga abrir, modificar e testar com banco independente.',
    minimumLevel: 'workspace-prepared',
    clientReceives: ['Tudo do sandbox', 'Supabase local e migrations', 'Scripts de preparação, reset e geração de tipos', 'Documentação de desenvolvimento', 'Backlog técnico de migração'],
  },
  production: {
    id: 'production',
    label: 'Migração completa e homologação',
    promise: 'Substituir a Base44 nos fluxos contratados, com dados, autenticação, integrações, implantação e aceite.',
    minimumLevel: 'production-candidate',
    clientReceives: ['Tudo do workspace', 'Plano de migração de dados e usuários', 'Conversão das funções e integrações contratadas', 'Blueprint de implantação', 'Checklist de homologação, rollback e handoff'],
  },
});

const TARGET_PROFILES = Object.freeze({
  'supabase-cloud-static': {
    id: 'supabase-cloud-static',
    label: 'Supabase Cloud + hospedagem web',
    automation: 'supported',
    summary: 'React/Vite em Vercel, Netlify, Cloudflare Pages ou host estático; Supabase para banco, autenticação, storage e funções.',
  },
  'supabase-self-hosted': {
    id: 'supabase-self-hosted',
    label: 'Supabase próprio ou local',
    automation: 'prepared',
    summary: 'Workspace Docker preparado; produção exige operação, backup, TLS, SMTP, monitoramento e atualização do ambiente Supabase.',
  },
  'aws-custom': {
    id: 'aws-custom',
    label: 'AWS customizado',
    automation: 'assessment-only',
    summary: 'Arquitetura de referência para S3/CloudFront, Lambda/API Gateway, Cognito, RDS e S3; requer adapter e implantação específicos.',
  },
  'repository-only': {
    id: 'repository-only',
    label: 'Somente código e documentação',
    automation: 'supported',
    summary: 'Entrega do repositório e pacote local sem implantação gerenciada.',
  },
});

const LEVEL_RANK = Object.freeze({
  'not-ready': 0,
  preserved: 1,
  isolated: 2,
  'sandbox-ready': 3,
  'workspace-prepared': 4,
  'production-candidate': 5,
});

function normalizeOptions(report = {}) {
  const packageId = report.options?.deliveryPackage || (report.options?.deliveryMode === 'snapshot' ? 'preservation' : 'workspace');
  const targetId = report.options?.targetProfile || (packageId === 'preservation' ? 'repository-only' : 'supabase-cloud-static');
  return {
    package: DELIVERY_PACKAGES[packageId] || DELIVERY_PACKAGES.workspace,
    target: TARGET_PROFILES[targetId] || TARGET_PROFILES['supabase-cloud-static'],
    clientName: String(report.options?.clientName || '').trim() || null,
    deliveryOwner: String(report.options?.deliveryOwner || '').trim() || null,
  };
}

function acceptanceState(report, packageDefinition) {
  const readiness = report.readiness || {};
  const actualRank = LEVEL_RANK[readiness.level] ?? 0;
  const requiredRank = LEVEL_RANK[packageDefinition.minimumLevel] ?? 0;
  const buildPassed = report.build?.status === 'passed';
  const runtimePassed = Boolean(report.build?.runtime?.passed);
  const noUnsupported = (readiness.runtimeContracts?.unsupported || 0) === 0;
  return {
    acceptedByAutomation: actualRank >= requiredRank,
    actualLevel: readiness.level || 'not-ready',
    requiredLevel: packageDefinition.minimumLevel,
    checks: [
      { id: 'source-preserved', label: 'Código original e backup preservados', passed: Boolean(report.backup?.sha256) },
      { id: 'security', label: 'Nenhum segredo bloqueante no pacote publicável', passed: (report.security?.blocking?.length || 0) === 0 },
      { id: 'standalone', label: 'Dependência estrutural da Base44 removida', passed: Boolean(report.standaloneGateAfterBuild?.passed || report.standaloneGateAfterPreviewRepair?.passed || report.standaloneGate?.passed) },
      { id: 'build', label: 'Build executado com sucesso', passed: buildPassed },
      { id: 'runtime', label: 'Aplicação renderizada no Chromium', passed: runtimePassed },
      { id: 'contracts', label: 'Nenhum contrato Base44 desconhecido', passed: noUnsupported },
      { id: 'workspace', label: 'Workspace independente preparado', passed: Boolean(report.build?.compatibility?.workspace?.prepared || report.runtimeCompatibility?.workspace?.prepared) },
      { id: 'production', label: 'Sem bloqueadores para os fluxos de produção contratados', passed: readiness.level === 'production-candidate' },
    ],
  };
}

function buildDeliveryManifest(report = {}) {
  const options = normalizeOptions(report);
  const readiness = report.readiness || {};
  const acceptance = acceptanceState(report, options.package);
  const paths = report.paths || {};
  const repository = report.githubRepository || report.github || {};
  const unresolved = [
    ...(readiness.nextActions || []),
    ...((readiness.productionBlockers || []).map((item) => `Backend: ${item}`)),
  ];
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: report.project || null,
    client: { name: options.clientName, deliveryOwner: options.deliveryOwner },
    contractedPackage: options.package,
    targetProfile: options.target,
    status: report.status || 'unknown',
    readiness: {
      score: readiness.score || 0,
      level: readiness.level || 'not-ready',
      label: readiness.label || 'Não classificado',
      runtimeContracts: readiness.runtimeContracts || {},
    },
    acceptance,
    artifacts: {
      sourceBackup: paths.backupPath || report.backup?.path || null,
      clientArchive: paths.clientDeliveryArchive || report.deliveryArchive?.path || null,
      repositoryDirectory: paths.repositoryDir || null,
      previewDirectory: paths.previewDir || null,
      repositoryUrl: report.pullRequest?.url || repository.htmlUrl || repository.url || null,
      snapshotBranch: report.snapshot?.branch || 'base44-source',
      deliveryBranch: report.publishPlan?.branch || repository.defaultBranch || null,
    },
    clientReceives: options.package.clientReceives,
    unresolved: [...new Set(unresolved)],
    transferRules: [
      'Transferir ou conceder acesso ao repositório privado ao proprietário do produto.',
      'Entregar o ZIP e o SHA-256 por canal separado do envio de credenciais.',
      'Nunca colocar tokens, senhas, chaves privadas ou secrets no repositório ou no relatório.',
      'Registrar por escrito quais dados, usuários, integrações e domínios estão dentro ou fora do escopo.',
      'Realizar aceite funcional com evidências antes de desligar a Base44.',
    ],
  };
}

function list(items, empty = '- Nenhum item registrado.') {
  return items?.length ? items.map((item) => `- ${item}`).join('\n') : empty;
}

function clientHandoffMarkdown(manifest) {
  const acceptance = manifest.acceptance;
  return `# Entrega ao cliente\n\n## O que foi contratado\n\n- **Cliente:** ${manifest.client.name || 'Não informado'}\n- **Produto:** ${manifest.project?.name || 'Não informado'}\n- **Pacote:** ${manifest.contractedPackage.label}\n- **Objetivo:** ${manifest.contractedPackage.promise}\n- **Destino:** ${manifest.targetProfile.label}\n- **Prontidão atual:** ${manifest.readiness.label} (${manifest.readiness.score}/100)\n- **Aceite automático do pacote:** ${acceptance.acceptedByAutomation ? 'Aprovado' : 'Ainda não aprovado'}\n\n## O que o cliente recebe\n\n${list(manifest.clientReceives)}\n\n## Como realizar o handoff\n\n1. Conceda ao cliente acesso administrativo ao repositório privado ou transfira o repositório para a organização dele.\n2. Entregue o pacote ZIP e seu SHA-256 como cópia verificável.\n3. Demonstre o preview ou o ambiente implantado e percorra o checklist de aceite.\n4. Entregue secrets e credenciais em um cofre ou canal seguro, nunca pelo GitHub.\n5. Registre pendências, responsáveis, prazo de correção e condição para desligamento da Base44.\n6. Só considere a migração completa após aceite funcional do cliente e teste de rollback.\n\n## Evidências e caminhos\n\n- Repositório: ${manifest.artifacts.repositoryUrl || 'Ainda não publicado'}\n- Preview local: ${manifest.artifacts.previewDirectory || 'Não gerado'}\n- Backup original: ${manifest.artifacts.sourceBackup || 'Não gerado'}\n- Pacote do cliente: ${manifest.artifacts.clientArchive || 'Será gerado ao finalizar a operação'}\n\n## Pendências atuais\n\n${list(manifest.unresolved)}\n`;
}

function acceptanceMarkdown(manifest) {
  const rows = manifest.acceptance.checks.map((item) => `- [${item.passed ? 'x' : ' '}] ${item.label}`).join('\n');
  return `# Checklist de aceite\n\n## Aceite técnico automatizado\n\n${rows}\n\n## Aceite funcional do cliente\n\n- [ ] Acesso com cada perfil contratado.\n- [ ] Navegação pelos fluxos críticos acordados.\n- [ ] Criação, consulta, alteração e exclusão dos dados selecionados.\n- [ ] Upload, download e permissões de arquivos, quando aplicável.\n- [ ] E-mails, pagamentos, webhooks, jobs e integrações externas contratadas.\n- [ ] Dados migrados conferidos por amostragem e totais.\n- [ ] Domínio, HTTPS, backup, monitoramento e alertas.\n- [ ] Teste de restauração e rollback.\n- [ ] Termo de aceite e data de desligamento da Base44.\n\nO checklist funcional deve ser adaptado ao contrato. Um preview renderizado não comprova todos os fluxos de negócio.\n`;
}

function deploymentMarkdown(manifest) {
  const target = manifest.targetProfile;
  const warning = target.automation === 'assessment-only'
    ? '\n> Este destino é apenas um blueprint nesta versão. A operação não deve ser vendida como implantação automática.\n'
    : '';
  return `# Blueprint de implantação\n\n- **Perfil:** ${target.label}\n- **Nível de automação:** ${target.automation}\n- **Resumo:** ${target.summary}\n${warning}\n## Arquitetura recomendada\n\n### Front-end\n\nBuild React/Vite estático, com variáveis públicas definidas no provedor de hospedagem e fallback de SPA para \`index.html\`.\n\n### Backend\n\nBanco PostgreSQL, autenticação, storage, realtime e funções devem usar o ambiente de destino escolhido. Secrets ficam exclusivamente no backend.\n\n### Operação\n\nDefinir ambientes de desenvolvimento, homologação e produção; CI/CD; logs; métricas; alertas; backup; restauração; domínio; DNS; TLS e rollback.\n\n### Regra de corte\n\nA Base44 só pode ser desligada depois que dados, usuários, arquivos, integrações e fluxos críticos forem homologados no destino.\n`;
}

function credentialsMarkdown() {
  return `# Handoff de acessos e credenciais\n\nEste arquivo é apenas um checklist. **Não preencha secrets dentro do repositório.**\n\n- [ ] Organização e repositório GitHub transferidos ou compartilhados.\n- [ ] Conta do provedor de hospedagem em nome do cliente.\n- [ ] Projeto Supabase ou ambiente equivalente em nome do cliente.\n- [ ] Domínio e DNS sob controle do cliente.\n- [ ] SMTP e remetentes validados.\n- [ ] Stripe ou outro provedor de pagamento transferido.\n- [ ] OAuth apps e conectores externos transferidos.\n- [ ] Secrets cadastrados no cofre ou provedor de deploy.\n- [ ] Acessos temporários da equipe removidos após o aceite.\n- [ ] Responsáveis por suporte, cobrança e incidentes definidos.\n`;
}

function backlogMarkdown(manifest) {
  return `# Backlog de migração\n\n## Pendências detectadas\n\n${list(manifest.unresolved)}\n\n## Itens que sempre precisam de decisão de escopo\n\n- Dados históricos e regra de reconciliação.\n- Usuários, senhas, convites, papéis e sessões.\n- Arquivos e storage.\n- Funções de backend, jobs, webhooks e pagamentos.\n- Integrações, OAuth e secrets.\n- Domínio, DNS, e-mail transacional e observabilidade.\n- Testes funcionais, carga, segurança, backup e rollback.\n\nCada item deve ter responsável, prazo, evidência e critério de aceite.\n`;
}

async function writeClientDeliveryPackage(directory, report) {
  const manifest = buildDeliveryManifest(report);
  const root = path.join(directory, 'CLIENT_DELIVERY');
  await fs.mkdir(root, { recursive: true });
  await writeJson(path.join(root, 'CLIENT_DELIVERY_MANIFEST.json'), manifest);
  await fs.writeFile(path.join(root, 'CLIENT_HANDOFF.md'), clientHandoffMarkdown(manifest), 'utf8');
  await fs.writeFile(path.join(root, 'ACCEPTANCE_CHECKLIST.md'), acceptanceMarkdown(manifest), 'utf8');
  await fs.writeFile(path.join(root, 'DEPLOYMENT_BLUEPRINT.md'), deploymentMarkdown(manifest), 'utf8');
  await fs.writeFile(path.join(root, 'CREDENTIALS_HANDOFF.md'), credentialsMarkdown(), 'utf8');
  await fs.writeFile(path.join(root, 'MIGRATION_BACKLOG.md'), backlogMarkdown(manifest), 'utf8');
  return { root, manifest };
}

module.exports = {
  DELIVERY_PACKAGES,
  TARGET_PROFILES,
  LEVEL_RANK,
  normalizeOptions,
  buildDeliveryManifest,
  writeClientDeliveryPackage,
  clientHandoffMarkdown,
  acceptanceMarkdown,
  deploymentMarkdown,
};
