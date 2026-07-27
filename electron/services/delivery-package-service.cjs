'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJson } = require('../core/fs-utils.cjs');
const { effectiveStatus } = require('./verification-ledger-service.cjs');
const { openDefects } = require('./defect-service.cjs');

const DELIVERY_PACKAGES = Object.freeze({
  preservation: { id: 'preservation', label: 'Diagnóstico e preservação', promise: 'Preservar o ativo técnico e mapear a saída da plataforma de origem, sem prometer execução independente.', minimumLevel: 'preserved', clientReceives: ['Backup original imutável com SHA-256', 'Snapshot sanitizado', 'Inventário técnico e de segurança', 'Relatório de dependências e próximos passos'] },
  sandbox: { id: 'sandbox', label: 'Sandbox executável', promise: 'Entregar uma aplicação navegável fora da plataforma de origem para demonstração e evolução inicial do front-end.', minimumLevel: 'sandbox-ready', clientReceives: ['Tudo do pacote de preservação', 'Código independente', 'Preview local validado em Chromium', 'Dados temporários de demonstração', 'Matriz de contratos da origem'] },
  workspace: { id: 'workspace', label: 'Workspace evolutivo', promise: 'Entregar um repositório GitHub-first que uma equipe consiga modificar e testar com banco independente.', minimumLevel: 'workspace-prepared', clientReceives: ['Tudo do sandbox', 'Supabase local e migrations', 'Verificador de login, CRUD e RLS', 'Documentação de desenvolvimento', 'Backlog técnico de migração'] },
  production: { id: 'production', label: 'Migração completa e homologação', promise: 'Substituir a plataforma de origem nos fluxos contratados, com dados, autenticação, integrações, implantação e aceite.', minimumLevel: 'production-candidate', clientReceives: ['Tudo do workspace', 'Plano de migração de dados e usuários', 'Conversão das funções e integrações contratadas', 'Blueprint de implantação', 'Checklist de homologação, rollback e handoff'] },
});

const TARGET_PROFILES = Object.freeze({
  'supabase-cloud-static': { id: 'supabase-cloud-static', label: 'Supabase Cloud + hospedagem web', automation: 'supported', summary: 'React/Vite em hospedagem web; Supabase para banco, autenticação, storage e funções.' },
  'supabase-self-hosted': { id: 'supabase-self-hosted', label: 'Supabase próprio ou local', automation: 'prepared', summary: 'Workspace Docker preparado; produção exige operação, backup, TLS, SMTP, monitoramento e atualização.' },
  'aws-custom': { id: 'aws-custom', label: 'AWS customizado', automation: 'assessment-only', summary: 'Arquitetura de referência para S3/CloudFront, Lambda/API Gateway, Cognito, RDS e S3; requer adapters e implantação específicos.' },
  'repository-only': { id: 'repository-only', label: 'Somente código e documentação', automation: 'supported', summary: 'Entrega do repositório e pacote local sem implantação gerenciada.' },
});
const LEVEL_RANK = Object.freeze({ 'not-ready': 0, preserved: 1, isolated: 2, 'sandbox-ready': 3, 'workspace-prepared': 4, 'production-candidate': 5 });

function normalizeOptions(report = {}) {
  const packageId = report.options?.deliveryPackage || (report.options?.deliveryMode === 'snapshot' ? 'preservation' : 'workspace');
  const targetId = report.options?.targetProfile || (packageId === 'preservation' ? 'repository-only' : 'supabase-cloud-static');
  return { package: DELIVERY_PACKAGES[packageId] || DELIVERY_PACKAGES.workspace, target: TARGET_PROFILES[targetId] || TARGET_PROFILES['supabase-cloud-static'], clientName: String(report.options?.clientName || '').trim() || null, deliveryOwner: String(report.options?.deliveryOwner || '').trim() || null };
}

function acceptanceState(report, packageDefinition) {
  const readiness = report.readiness || {};
  const sourcePreserved = Boolean(report.backup?.sha256 || report.export?.source);
  const buildPassed = effectiveStatus(report, 'build', report.build?.status === 'passed') === 'passed';
  const runtimePassed = effectiveStatus(report, 'runtime', report.build?.runtime?.passed) === 'passed';
  const standalonePassed = effectiveStatus(report, 'standalone', Boolean(report.standaloneGateAfterPreviewRepair?.passed || report.standaloneGateAfterBuild?.passed || report.standaloneGate?.passed)) === 'passed';
  const securityPassed = effectiveStatus(report, 'security', (report.securityAfterPreviewRepair?.blocking?.length || report.securityAfterBuild?.blocking?.length || report.security?.blocking?.length || 0) === 0) === 'passed';
  const noUnsupported = (readiness.runtimeContracts?.unsupported || 0) === 0;
  const workspacePrepared = Boolean(report.build?.compatibility?.workspace?.prepared || report.runtimeCompatibility?.workspace?.prepared || report.standalone?.functionalVerification?.prepared || report.functionalVerification?.prepared);
  const workspaceValidated = effectiveStatus(report, 'workspace', report.workspaceValidation?.passed, 'skipped') === 'passed';
  const defects = openDefects(report);
  let acceptedByAutomation = false;
  if (packageDefinition.id === 'preservation') acceptedByAutomation = sourcePreserved && securityPassed;
  else if (packageDefinition.id === 'sandbox') acceptedByAutomation = buildPassed && runtimePassed && standalonePassed && securityPassed && noUnsupported && defects.length === 0;
  else if (packageDefinition.id === 'workspace') acceptedByAutomation = buildPassed && runtimePassed && standalonePassed && securityPassed && noUnsupported && workspacePrepared && workspaceValidated && defects.length === 0;
  else if (packageDefinition.id === 'production') acceptedByAutomation = readiness.level === 'production-candidate' && defects.length === 0;
  return {
    acceptedByAutomation,
    actualLevel: readiness.level || 'not-ready',
    requiredLevel: packageDefinition.minimumLevel,
    openDefects: defects.length,
    checks: [
      { id: 'source-preserved', label: 'Código original e backup preservados', passed: sourcePreserved },
      { id: 'security', label: 'Nenhum segredo bloqueante na evidência vigente', passed: securityPassed },
      { id: 'standalone', label: 'Dependência estrutural da origem removida', passed: standalonePassed },
      { id: 'build', label: 'Build vigente executado com sucesso', passed: buildPassed },
      { id: 'runtime', label: 'Aplicação vigente renderizada no Chromium', passed: runtimePassed },
      { id: 'contracts', label: 'Nenhum contrato desconhecido da origem', passed: noUnsupported },
      { id: 'workspace-prepared', label: 'Workspace funcional preparado', passed: workspacePrepared },
      { id: 'workspace-validated', label: 'Banco, autenticação, CRUD e RLS validados', passed: workspaceValidated },
      { id: 'defects', label: 'Nenhum defeito aberto', passed: defects.length === 0 },
      { id: 'production', label: 'Sem bloqueadores para os fluxos de produção contratados', passed: readiness.level === 'production-candidate' && defects.length === 0 },
    ],
  };
}

function buildDeliveryManifest(report = {}) {
  const options = normalizeOptions(report);
  const readiness = report.readiness || {};
  const acceptance = acceptanceState(report, options.package);
  const paths = report.paths || {};
  const repository = report.githubRepository || report.github || {};
  const unresolved = [...(readiness.nextActions || []), ...((readiness.productionBlockers || []).map((item) => `Backend: ${item}`)), ...openDefects(report).map((item) => `${item.id}: ${item.title}`)];
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    project: report.project || null,
    source: report.sourceManifest?.source || 'base44',
    client: { name: options.clientName, deliveryOwner: options.deliveryOwner },
    contractedPackage: options.package,
    targetProfile: options.target,
    status: report.status || 'unknown',
    readiness: { score: readiness.score || 0, level: readiness.level || 'not-ready', label: readiness.label || 'Não classificado', runtimeContracts: readiness.runtimeContracts || {}, openDefects: readiness.openDefects || 0 },
    acceptance,
    artifacts: { sourceBackup: paths.backupPath || report.backup?.path || null, clientArchive: paths.clientDeliveryArchive || report.deliveryArchive?.path || null, repositoryDirectory: paths.repositoryDir || null, previewDirectory: paths.previewDir || null, functionalVerification: paths.repositoryDir ? path.join(paths.repositoryDir, 'RB-FUNCTIONAL-VERIFICATION.json') : null, repositoryUrl: report.pullRequest?.url || repository.htmlUrl || repository.url || null, snapshotBranch: report.snapshot?.branch || 'source-snapshot', deliveryBranch: report.publishPlan?.branch || repository.defaultBranch || null },
    clientReceives: options.package.clientReceives,
    unresolved: [...new Set(unresolved)],
    transferRules: ['Transferir ou conceder acesso ao repositório privado ao proprietário.', 'Entregar ZIP e SHA-256 por canal separado do envio de credenciais.', 'Nunca colocar tokens, senhas, chaves privadas ou secrets no repositório ou relatório.', 'Registrar quais dados, usuários, integrações e domínios estão dentro ou fora do escopo.', 'Realizar aceite funcional com evidências vigentes antes de desligar a plataforma de origem.'],
  };
}

function list(items, empty = '- Nenhum item registrado.') { return items?.length ? items.map((item) => `- ${item}`).join('\n') : empty; }
function clientHandoffMarkdown(manifest) {
  const acceptance = manifest.acceptance;
  return `# Entrega ao cliente\n\n## O que foi contratado\n\n- **Cliente:** ${manifest.client.name || 'Não informado'}\n- **Produto:** ${manifest.project?.name || 'Não informado'}\n- **Origem:** ${manifest.source}\n- **Pacote:** ${manifest.contractedPackage.label}\n- **Objetivo:** ${manifest.contractedPackage.promise}\n- **Destino:** ${manifest.targetProfile.label}\n- **Prontidão atual:** ${manifest.readiness.label} (${manifest.readiness.score}/100)\n- **Defeitos abertos:** ${manifest.acceptance.openDefects}\n- **Aceite automático:** ${acceptance.acceptedByAutomation ? 'Aprovado' : 'Ainda não aprovado'}\n\n## O que o cliente recebe\n\n${list(manifest.clientReceives)}\n\n## Como realizar o handoff\n\n1. Conceda acesso administrativo ao repositório privado ou transfira-o.\n2. Entregue o ZIP e SHA-256.\n3. Demonstre o ambiente e percorra o checklist.\n4. Entregue credenciais em cofre ou canal seguro.\n5. Registre pendências, responsáveis, prazo e condição de corte.\n6. Só considere migração completa após aceite funcional e teste de rollback.\n\n## Evidências e caminhos\n\n- Repositório: ${manifest.artifacts.repositoryUrl || 'Ainda não publicado'}\n- Preview: ${manifest.artifacts.previewDirectory || 'Não gerado'}\n- Verificação funcional: ${manifest.artifacts.functionalVerification || 'Não executada'}\n- Backup: ${manifest.artifacts.sourceBackup || 'Não gerado'}\n- Pacote: ${manifest.artifacts.clientArchive || 'Será gerado ao finalizar'}\n\n## Pendências atuais\n\n${list(manifest.unresolved)}\n`;
}
function acceptanceMarkdown(manifest) {
  const rows = manifest.acceptance.checks.map((item) => `- [${item.passed ? 'x' : ' '}] ${item.label}`).join('\n');
  return `# Checklist de aceite\n\n## Aceite técnico automatizado\n\n${rows}\n\n## Aceite funcional do cliente\n\n- [ ] Acesso com cada perfil contratado.\n- [ ] Navegação pelos fluxos críticos.\n- [ ] CRUD dos dados selecionados.\n- [ ] Upload, download e permissões.\n- [ ] E-mails, pagamentos, webhooks, jobs e integrações.\n- [ ] Dados migrados conferidos.\n- [ ] Domínio, HTTPS, backup, monitoramento e alertas.\n- [ ] Restauração e rollback.\n- [ ] Termo de aceite e data de desligamento da origem.\n\nUm preview renderizado não comprova os fluxos de negócio. A evidência mais recente prevalece.\n`;
}
function deploymentMarkdown(manifest) {
  const target = manifest.targetProfile;
  const warning = target.automation === 'assessment-only' ? '\n> Este destino é apenas um blueprint. Não vender como implantação automática.\n' : '';
  return `# Blueprint de implantação\n\n- **Perfil:** ${target.label}\n- **Nível de automação:** ${target.automation}\n- **Resumo:** ${target.summary}\n${warning}\n## Arquitetura recomendada\n\n### Front-end\n\nBuild React/Vite estático, variáveis públicas no provedor e fallback SPA.\n\n### Backend\n\nBanco, autenticação, storage, realtime e funções usam o destino escolhido. Secrets ficam no backend.\n\n### Operação\n\nDefinir desenvolvimento, homologação e produção; CI/CD; logs; métricas; alertas; backup; restauração; domínio; DNS; TLS e rollback.\n\n### Regra de corte\n\nA origem só pode ser desligada depois que dados, usuários, arquivos, integrações e fluxos críticos forem homologados.\n`;
}
function credentialsMarkdown() { return `# Handoff de acessos e credenciais\n\nNão preencha secrets no repositório.\n\n- [ ] Repositório transferido ou compartilhado.\n- [ ] Hospedagem em nome do cliente.\n- [ ] Banco em nome do cliente.\n- [ ] Domínio e DNS sob controle do cliente.\n- [ ] SMTP validado.\n- [ ] Provedor de pagamento transferido.\n- [ ] OAuth e conectores transferidos.\n- [ ] Secrets no cofre.\n- [ ] Acessos temporários removidos.\n- [ ] Suporte e incidentes definidos.\n`; }
function backlogMarkdown(manifest) { return `# Backlog de migração\n\n## Pendências detectadas\n\n${list(manifest.unresolved)}\n\n## Itens que sempre precisam de decisão\n\n- Dados históricos e reconciliação.\n- Usuários, senhas, convites, papéis e sessões.\n- Arquivos e storage.\n- Funções, jobs, webhooks e pagamentos.\n- Integrações, OAuth e secrets.\n- Domínio, DNS, e-mail e observabilidade.\n- Testes, carga, segurança, backup e rollback.\n\nCada item deve ter responsável, prazo, evidência e critério de aceite.\n`; }
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

module.exports = { DELIVERY_PACKAGES, TARGET_PROFILES, LEVEL_RANK, normalizeOptions, acceptanceState, buildDeliveryManifest, writeClientDeliveryPackage, clientHandoffMarkdown, acceptanceMarkdown, deploymentMarkdown };
