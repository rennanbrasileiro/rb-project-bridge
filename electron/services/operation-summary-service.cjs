'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { readJson, writeJson } = require('../core/fs-utils.cjs');
const { DELIVERY_PACKAGES, TARGET_PROFILES, LEVEL_RANK } = require('./delivery-package-service.cjs');
const {
  latestVerification,
  latestVerificationMap,
  currentTechnicalGates,
  publicationBlockers,
} = require('./verification-ledger-service.cjs');
const { openDefects, blockingDefects } = require('./defect-service.cjs');

const SCOPE_DEFINITIONS = Object.freeze([
  { id: 'data', label: 'Dados históricos', validationField: 'dataMigrationValidation' },
  { id: 'users', label: 'Usuários e autenticação', validationField: 'userMigrationValidation' },
  { id: 'storage', label: 'Arquivos e storage', validationField: 'storageMigrationValidation' },
  { id: 'integrations', label: 'Funções e integrações', validationField: 'backendValidation' },
  { id: 'deployment', label: 'Deploy, domínio e operação', validationField: 'deploymentValidation' },
]);

const VALIDATION_DEFINITIONS = Object.freeze({
  frontend: { id: 'frontend', label: 'Validação visual e navegação', description: 'Confirmar telas, navegação, botões e fluxos demonstráveis no preview migrado.', field: 'frontendValidation' },
  workspace: { id: 'workspace', label: 'Workspace, banco e autenticação', description: 'Executar Docker/Supabase, migrations, autenticação, CRUD, RLS e realtime.', field: 'workspaceValidation' },
  data: { id: 'data', label: 'Dados históricos', description: 'Migrar, reconciliar totais e registrar amostras ou relatórios de conferência.', field: 'dataMigrationValidation' },
  users: { id: 'users', label: 'Usuários e autenticação', description: 'Validar contas, papéis, convites, recuperação de acesso e regras de autorização.', field: 'userMigrationValidation' },
  storage: { id: 'storage', label: 'Arquivos e storage', description: 'Validar upload, download, permissões, estrutura de buckets e arquivos migrados.', field: 'storageMigrationValidation' },
  backend: { id: 'backend', label: 'Backend, funções e integrações', description: 'Homologar funções, webhooks, pagamentos, jobs, conectores, secrets e respostas reais.', field: 'backendValidation' },
  deployment: { id: 'deployment', label: 'Implantação e operação', description: 'Validar ambiente, domínio, TLS, SMTP, monitoramento, backup, restauração e rollback.', field: 'deploymentValidation' },
  production: { id: 'production', label: 'Aceite funcional e corte', description: 'Executar o checklist funcional, registrar aceite e definir a condição de desligamento da plataforma de origem.', field: 'productionValidation' },
});

function bool(value) { return Boolean(value); }
function asList(value) { return Array.isArray(value) ? value : []; }
function validationGate(id) { return `validation:${id}`; }
function packageFor(report = {}) {
  const id = report.options?.deliveryPackage || (report.options?.deliveryMode === 'snapshot' ? 'preservation' : 'workspace');
  return DELIVERY_PACKAGES[id] || DELIVERY_PACKAGES.workspace;
}
function targetFor(report = {}) {
  const packageDefinition = packageFor(report);
  const id = report.options?.targetProfile || (packageDefinition.id === 'preservation' ? 'repository-only' : 'supabase-cloud-static');
  return TARGET_PROFILES[id] || TARGET_PROFILES['supabase-cloud-static'];
}
function statusFromVerification(attempt) {
  if (!attempt) return null;
  if (attempt.status === 'skipped') return 'not_applicable';
  if (['passed', 'failed', 'blocked'].includes(attempt.status)) return attempt.status;
  return null;
}
function validationStatus(report, definition) {
  const value = report?.[definition.field] || {};
  return value.status
    || statusFromVerification(latestVerification(report, validationGate(definition.id)))
    || (value.passed ? 'passed' : 'pending');
}
function validationSnapshot(report, definition) {
  const value = report?.[definition.field] || {};
  const status = validationStatus(report, definition);
  const gate = validationGate(definition.id);
  const gateDefects = openDefects(report, { gate });
  return {
    id: definition.id,
    gate,
    label: definition.label,
    description: definition.description,
    status,
    passed: ['passed', 'not_applicable'].includes(status),
    notes: String(value.notes || ''),
    evidence: String(value.evidence || ''),
    expected: String(value.expected || ''),
    observed: String(value.observed || ''),
    reproductionSteps: String(value.reproductionSteps || ''),
    severity: value.severity || null,
    validatedAt: value.validatedAt || null,
    validatedBy: value.validatedBy || null,
    defectId: value.defectId || gateDefects[0]?.id || null,
    openDefects: gateDefects,
    latestVerification: latestVerification(report, gate),
  };
}
function scopeRows(report = {}) {
  const scope = report.options?.migrationScope || {};
  return SCOPE_DEFINITIONS.map((definition) => {
    const selected = bool(scope[definition.id]);
    const validationDefinition = definition.id === 'integrations' ? VALIDATION_DEFINITIONS.backend : VALIDATION_DEFINITIONS[definition.id];
    const validation = validationSnapshot(report, validationDefinition);
    const status = !selected ? 'not-in-scope' : validation.status === 'passed' ? 'validated' : validation.status === 'not_applicable' ? 'not-applicable' : validation.status;
    const detail = !selected
      ? 'Não foi incluído no escopo comercial desta operação.'
      : status === 'validated'
        ? 'Incluído no escopo e homologado com evidência vigente.'
        : status === 'not-applicable'
          ? 'Incluído inicialmente, mas formalmente marcado como não aplicável com justificativa.'
          : status === 'failed'
            ? 'Reprovado; existe defeito aberto e é obrigatório corrigir e retestar.'
            : status === 'blocked'
              ? 'A execução está bloqueada por dependência ou ambiente.'
              : 'Incluído no escopo, mas ainda depende de execução e homologação.';
    return { id: definition.id, label: definition.label, selected, passed: validation.passed, status, detail, validationField: definition.validationField, defectId: validation.defectId };
  });
}
function relevantValidationIds(report = {}) {
  const packageDefinition = packageFor(report);
  const scope = report.options?.migrationScope || {};
  const ids = [];
  if (packageDefinition.id !== 'preservation') ids.push('frontend');
  if (['workspace', 'production'].includes(packageDefinition.id)) ids.push('workspace');
  if (scope.data) ids.push('data');
  if (scope.users) ids.push('users');
  if (scope.storage) ids.push('storage');
  if (scope.integrations) ids.push('backend');
  if (scope.deployment) ids.push('deployment');
  if (packageDefinition.id === 'production') ids.push('production');
  return [...new Set(ids)];
}
function evolutionPaths(report = {}) {
  const paths = report.paths || {};
  const compatibility = report.build?.compatibility || report.runtimeCompatibility || {};
  const hasCompatibilityGaps = asList(compatibility.unsupported).length || asList(compatibility.emulated).length || asList(report.standalone?.blockers).length;
  return [
    {
      id: 'frontend', title: 'Corrigir interface e experiência', useWhen: 'Telas, textos, navegação, layout ou regras de apresentação precisam evoluir depois da extração.', location: paths.repositoryDir || null, command: 'npm run dev:demo',
      steps: ['Abrir o workspace GitHub-first, não a plataforma de origem.', 'Criar uma branch de evolução no repositório do produto.', 'Executar npm install e npm run dev:demo.', 'Aplicar as correções.', 'Voltar ao Bridge para reconstruir e retestar o preview antes do merge.'],
    },
    {
      id: 'backend', title: 'Conectar banco e fluxos reais', useWhen: 'O produto precisa sair do modo demo e comprovar persistência, autenticação, arquivos, integrações ou pagamentos.', location: paths.repositoryDir || null, command: 'npm run rb:verify',
      steps: ['Preparar o ambiente de destino.', 'Aplicar migrations e configurar apenas secrets de desenvolvimento.', 'Executar o verificador automático de autenticação, CRUD, RLS e storage.', 'Corrigir os defeitos gerados.', 'Retestar somente os gates afetados e regenerar o pacote ao final.'],
    },
    {
      id: 'source-refresh', title: 'Trazer nova versão da origem', useWhen: 'A plataforma de origem recebeu alterações depois da exportação atual.', location: null, command: null,
      steps: ['Iniciar nova captura apontando para o mesmo repositório.', 'Comparar origem e GitHub.', 'Preservar ambos e abrir revisão sem apagar histórico.', 'Não substituir manualmente a branch principal.'],
    },
    {
      id: 'compatibility', title: 'Resolver obstáculo reutilizável', useWhen: 'Um piloto usa contrato, função ou integração ainda não coberta pelo Bridge.', location: paths.repositoryDir ? path.join(paths.repositoryDir, 'CLIENT_DELIVERY', 'PILOT_EXTENSION_REQUEST.json') : null, command: null, highlighted: bool(hasCompatibilityGaps),
      steps: ['Identificar contrato, arquivo e categoria.', 'Classificar como regra genérica ou customização exclusiva.', 'Implementar no núcleo ou em pacote versionado.', 'Adicionar regressão com o contrato real e revalidar o piloto.'],
    },
  ];
}
function technicalDefectBlocksMerge(defect) {
  return ['build', 'runtime', 'standalone', 'security', 'workspace', 'validation:frontend', 'validation:workspace'].includes(defect.gate);
}
function buildOperationSummary(report = {}) {
  const readiness = report.readiness || {};
  const packageDefinition = packageFor(report);
  const targetDefinition = targetFor(report);
  const compatibility = report.build?.compatibility || report.runtimeCompatibility || {};
  const validations = relevantValidationIds(report).map((id) => validationSnapshot(report, VALIDATION_DEFINITIONS[id]));
  const frontendValidation = validations.find((item) => item.id === 'frontend');
  const frontendValidated = packageDefinition.id === 'preservation' || frontendValidation?.passed;
  const requiredHumanValidationsPassed = validations.every((item) => item.passed);
  const technicalGates = currentTechnicalGates(report);
  const currentPublicationBlockers = publicationBlockers(report);
  const currentOpenDefects = openDefects(report);
  const currentBlockingDefects = blockingDefects(report);
  const mergeBlockingDefects = currentBlockingDefects.filter(technicalDefectBlocksMerge);
  const noUnsupported = asList(compatibility.unsupported).length === 0;
  const canMergeWorkspace = currentPublicationBlockers.length === 0 && noUnsupported && frontendValidated && mergeBlockingDefects.length === 0;
  const technicalPackagePassed = bool(readiness.contractedPackagePassed || report.clientDelivery?.acceptance?.acceptedByAutomation) && currentPublicationBlockers.length === 0;
  const readyForContractedHandoff = technicalPackagePassed && requiredHumanValidationsPassed && currentOpenDefects.length === 0;
  const canGoProduction = readiness.level === 'production-candidate' && readyForContractedHandoff && validationStatus(report, VALIDATION_DEFINITIONS.production) === 'passed';
  const requiredRank = LEVEL_RANK[packageDefinition.minimumLevel] ?? 0;
  const actualRank = LEVEL_RANK[readiness.level] ?? 0;
  const scope = scopeRows(report);
  const nextActions = [];
  if (currentPublicationBlockers.length) nextActions.push(`Corrigir e retestar os gates técnicos vigentes: ${currentPublicationBlockers.join('; ')}.`);
  if (!frontendValidated && packageDefinition.id !== 'preservation') nextActions.push('Concluir a validação visual; em caso de reprovação, corrigir o defeito e retestar.');
  for (const defect of currentOpenDefects) nextActions.push(`Resolver ${defect.id} — ${defect.title} (${defect.severity}).`);
  for (const item of asList(readiness.nextActions)) nextActions.push(item);
  if (report.pullRequest?.url && canMergeWorkspace && !readyForContractedHandoff) nextActions.push('O PR pode ser incorporado como workspace, mas o pacote contratado continua pendente até as homologações e defeitos restantes.');
  if (readyForContractedHandoff && packageDefinition.id !== 'production') nextActions.push('Percorrer o handoff, transferir custódia e registrar o aceite.');
  if (canGoProduction) nextActions.push('Executar a janela de corte, confirmar rollback e somente então desligar a plataforma de origem.');

  const checks = asList(report.clientDelivery?.acceptance?.checks).map((item) => ({ id: item.id, label: item.label, passed: bool(item.passed) }));
  const blockers = [
    ...currentPublicationBlockers.map((detail) => ({ type: 'verification', detail })),
    ...currentOpenDefects.map((item) => ({ type: 'defect', detail: `${item.id}: ${item.title}`, severity: item.severity })),
    ...asList(readiness.productionBlockers).map((detail) => ({ type: 'production', detail })),
    ...asList(compatibility.emulated).map((item) => ({ type: 'emulated', detail: item?.contract || item?.method || String(item) })),
    ...asList(compatibility.unsupported).map((item) => ({ type: 'unsupported', detail: item?.contract || item?.method || String(item) })),
  ];
  const repositoryUrl = report.pullRequest?.url || report.github?.url || report.githubRepository?.htmlUrl || null;
  const operationPlan = report.paths?.repositoryDir ? path.join(report.paths.repositoryDir, 'CLIENT_DELIVERY', 'OPERATION_STATUS_AND_NEXT_STEPS.md') : null;
  const extensionRequest = report.paths?.repositoryDir ? path.join(report.paths.repositoryDir, 'CLIENT_DELIVERY', 'PILOT_EXTENSION_REQUEST.json') : null;

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    project: report.project || null,
    client: { name: report.options?.clientName || null, deliveryOwner: report.options?.deliveryOwner || null },
    contracted: { package: packageDefinition, target: targetDefinition, scope },
    current: {
      status: report.status || 'unknown', score: readiness.score || 0, level: readiness.level || 'not-ready', label: readiness.label || 'Não classificado', recommendedPackage: readiness.recommendedPackage || 'Não classificado',
      technicalPackagePassed, requiredHumanValidationsPassed, readyForContractedHandoff,
      packageGap: currentPublicationBlockers.length
        ? 'Uma evidência técnica mais recente está reprovada; aprovações anteriores não são mais válidas.'
        : actualRank >= requiredRank
          ? 'O estágio técnico mínimo foi alcançado; ainda podem existir homologações ou defeitos.'
          : `O estágio atual está abaixo do mínimo exigido para ${packageDefinition.label}.`,
    },
    decisions: {
      canMergeWorkspace, readyForContractedHandoff, canGoProduction,
      mergeGuidance: !report.pullRequest?.url
        ? 'A operação não possui PR de revisão registrado.'
        : canMergeWorkspace
          ? 'O PR pode ser mesclado como evolução do workspace após a revisão final.'
          : `Não mescle o PR. ${currentPublicationBlockers.length ? 'A evidência técnica vigente está reprovada.' : 'Existem validações ou defeitos bloqueantes.'}`,
      deliveryGuidance: readyForContractedHandoff ? 'O pacote contratado possui evidências vigentes e nenhum defeito aberto.' : 'O pacote é apenas acompanhamento; não deve ser apresentado como integralmente homologado.',
      productionGuidance: canGoProduction ? 'A operação possui evidências para planejar o corte.' : 'Não desligar a plataforma de origem nem anunciar produção concluída.',
    },
    technicalGates,
    latestVerifications: latestVerificationMap(report),
    checks,
    validations,
    defects: report.defects || [],
    openDefects: currentOpenDefects,
    blockingDefects: currentBlockingDefects,
    blockers,
    nextActions: [...new Set(nextActions)],
    evolutionPaths: evolutionPaths(report),
    packageState: { dirty: bool(report.packageState?.dirty), lastValidationAt: report.packageState?.lastValidationAt || null, generatedAt: report.packageState?.generatedAt || report.finishedAt || null },
    artifacts: { jobRoot: report.paths?.jobRoot || null, repositoryDirectory: report.paths?.repositoryDir || null, previewDirectory: report.paths?.previewDir || null, clientArchive: report.paths?.clientDeliveryArchive || report.deliveryArchive?.path || null, operationPlan, extensionRequest, repositoryUrl },
  };
}

function markdownList(items, empty = '- Nenhuma ação pendente registrada.') { return items?.length ? items.map((item) => `- ${item}`).join('\n') : empty; }
function statusLabel(status) { return ({ passed: 'Aprovado', failed: 'Reprovado', blocked: 'Bloqueado', pending: 'Pendente', not_applicable: 'Não aplicável' })[status] || status; }
function operationSummaryMarkdown(summary) {
  const scope = summary.contracted.scope.map((item) => `| ${item.label} | ${item.selected ? 'Incluído' : 'Fora do escopo'} | ${statusLabel(item.status)} | ${item.detail} |`).join('\n');
  const validations = summary.validations.map((item) => `| ${item.label} | ${statusLabel(item.status)} | ${item.validatedBy || '—'} | ${item.evidence || item.observed || item.notes || '—'} |`).join('\n') || '| Nenhuma homologação humana exigida | — | — | — |';
  const defects = summary.openDefects.map((item) => `| ${item.id} | ${item.severity} | ${item.title} | ${item.owner || '—'} | ${item.status} |`).join('\n') || '| Nenhum defeito aberto | — | — | — | — |';
  const paths = summary.evolutionPaths.map((item) => `### ${item.title}\n\n**Quando usar:** ${item.useWhen}\n\n${item.command ? `**Comando principal:** \`${item.command}\`\n\n` : ''}${item.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`).join('\n\n');
  return `# Estado atual e próximos passos\n\n## Resumo executivo\n\n- **Projeto:** ${summary.project?.name || 'Não informado'}\n- **Cliente:** ${summary.client.name || 'Não informado'}\n- **Pacote contratado:** ${summary.contracted.package.label}\n- **Destino:** ${summary.contracted.target.label}\n- **Estágio alcançado:** ${summary.current.label} (${summary.current.score}/100)\n- **Pacote tecnicamente aprovado:** ${summary.current.technicalPackagePassed ? 'Sim' : 'Não'}\n- **Homologações concluídas:** ${summary.current.requiredHumanValidationsPassed ? 'Sim' : 'Não'}\n- **Defeitos abertos:** ${summary.openDefects.length}\n- **Pronto para handoff:** ${summary.current.readyForContractedHandoff ? 'Sim' : 'Não'}\n\n> ${summary.current.packageGap}\n\n## Decisões\n\n- **Merge do workspace:** ${summary.decisions.mergeGuidance}\n- **Entrega contratual:** ${summary.decisions.deliveryGuidance}\n- **Produção:** ${summary.decisions.productionGuidance}\n\n## Escopo\n\n| Item | Escopo | Estado | Evidência atual |\n|---|---|---|---|\n${scope}\n\n## Homologações\n\n| Validação | Estado | Responsável | Evidência ou falha |\n|---|---|---|---|\n${validations}\n\n## Defeitos abertos\n\n| ID | Severidade | Defeito | Responsável | Estado |\n|---|---|---|---|---|\n${defects}\n\n## Próximas ações\n\n${markdownList(summary.nextActions)}\n\n## Como evoluir sem refazer a captura\n\n${paths}\n\n## Regra\n\nA evidência mais recente prevalece. Uma reprovação posterior invalida aprovações anteriores até que um novo reteste seja aprovado. O GitHub é o ativo canônico; o Bridge orquestra captura, verificação, defeitos, retestes e handoff.\n`;
}
function extensionRequestPayload(report, summary) {
  const compatibility = report.build?.compatibility || report.runtimeCompatibility || {};
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    project: report.project || null,
    sourcePlatform: report.sourceManifest?.source || 'base44',
    targetProfile: summary.contracted.target.id,
    contractedPackage: summary.contracted.package.id,
    readiness: { level: summary.current.level, score: summary.current.score },
    currentTechnicalGates: summary.technicalGates,
    openDefects: summary.openDefects,
    contracts: { converted: asList(compatibility.converted), bridged: asList(compatibility.bridged), emulated: asList(compatibility.emulated), unsupported: asList(compatibility.unsupported) },
    productionBlockers: asList(report.standalone?.blockers),
    requestedResolution: ['Classificar se o obstáculo é regra reutilizável ou customização exclusiva.', 'Implementar solução genérica com regressão quando reutilizável.', 'Executar reteste e atualizar a matriz do piloto.'],
  };
}
async function writeOperationArtifacts(directory, report) {
  const summary = buildOperationSummary(report);
  const deliveryRoot = path.join(directory, 'CLIENT_DELIVERY');
  await fs.mkdir(deliveryRoot, { recursive: true });
  const operationPlanPath = path.join(deliveryRoot, 'OPERATION_STATUS_AND_NEXT_STEPS.md');
  const extensionJsonPath = path.join(deliveryRoot, 'PILOT_EXTENSION_REQUEST.json');
  const extensionMarkdownPath = path.join(deliveryRoot, 'PILOT_EXTENSION_REQUEST.md');
  const extensionPayload = extensionRequestPayload(report, summary);
  await fs.writeFile(operationPlanPath, operationSummaryMarkdown(summary), 'utf8');
  await writeJson(extensionJsonPath, extensionPayload);
  await fs.writeFile(extensionMarkdownPath, `# Pedido de extensão do piloto\n\n- **Origem:** ${extensionPayload.sourcePlatform}\n- **Contratos convertidos:** ${extensionPayload.contracts.converted.length}\n- **Encaminhados:** ${extensionPayload.contracts.bridged.length}\n- **Emulados:** ${extensionPayload.contracts.emulated.length}\n- **Não suportados:** ${extensionPayload.contracts.unsupported.length}\n- **Defeitos abertos:** ${extensionPayload.openDefects.length}\n\n## Processo\n\n${extensionPayload.requestedResolution.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n`, 'utf8');
  const manifestPath = path.join(deliveryRoot, 'CLIENT_DELIVERY_MANIFEST.json');
  const manifest = await readJson(manifestPath, null);
  if (manifest) {
    manifest.commercialScope = summary.contracted.scope;
    manifest.packageVerification = { actualLevel: summary.current.level, actualLabel: summary.current.label, technicalPackagePassed: summary.current.technicalPackagePassed, humanValidationsPassed: summary.current.requiredHumanValidationsPassed, readyForContractedHandoff: summary.current.readyForContractedHandoff, packageGap: summary.current.packageGap, openDefects: summary.openDefects.length };
    manifest.operationSummary = { decisions: summary.decisions, technicalGates: summary.technicalGates, nextActions: summary.nextActions, packageState: summary.packageState };
    manifest.defects = summary.defects;
    manifest.latestVerifications = summary.latestVerifications;
    manifest.artifacts = { ...(manifest.artifacts || {}), operationPlan: operationPlanPath, pilotExtensionRequest: extensionJsonPath };
    await writeJson(manifestPath, manifest);
  }
  return { summary, operationPlanPath, extensionJsonPath, extensionMarkdownPath };
}

module.exports = { SCOPE_DEFINITIONS, VALIDATION_DEFINITIONS, validationGate, validationStatus, buildOperationSummary, operationSummaryMarkdown, extensionRequestPayload, writeOperationArtifacts };
