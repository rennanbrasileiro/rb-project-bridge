'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { readJson, writeJson } = require('../core/fs-utils.cjs');
const { DELIVERY_PACKAGES, TARGET_PROFILES, LEVEL_RANK } = require('./delivery-package-service.cjs');

const SCOPE_DEFINITIONS = Object.freeze([
  { id: 'data', label: 'Dados históricos', validationField: 'dataMigrationValidation' },
  { id: 'users', label: 'Usuários e autenticação', validationField: 'userMigrationValidation' },
  { id: 'storage', label: 'Arquivos e storage', validationField: 'storageMigrationValidation' },
  { id: 'integrations', label: 'Funções e integrações', validationField: 'backendValidation' },
  { id: 'deployment', label: 'Deploy, domínio e operação', validationField: 'deploymentValidation' },
]);

const VALIDATION_DEFINITIONS = Object.freeze({
  frontend: {
    id: 'frontend',
    label: 'Validação visual e navegação',
    description: 'Confirmar telas, navegação, botões e fluxos demonstráveis no preview migrado.',
    field: 'frontendValidation',
  },
  workspace: {
    id: 'workspace',
    label: 'Workspace, banco e autenticação',
    description: 'Executar Docker/Supabase, migrations, autenticação, CRUD, RLS e realtime.',
    field: 'workspaceValidation',
  },
  data: {
    id: 'data',
    label: 'Dados históricos',
    description: 'Migrar, reconciliar totais e registrar amostras ou relatórios de conferência.',
    field: 'dataMigrationValidation',
  },
  users: {
    id: 'users',
    label: 'Usuários e autenticação',
    description: 'Validar contas, papéis, convites, recuperação de acesso e regras de autorização.',
    field: 'userMigrationValidation',
  },
  storage: {
    id: 'storage',
    label: 'Arquivos e storage',
    description: 'Validar upload, download, permissões, estrutura de buckets e arquivos migrados.',
    field: 'storageMigrationValidation',
  },
  backend: {
    id: 'backend',
    label: 'Backend, funções e integrações',
    description: 'Homologar funções, webhooks, pagamentos, jobs, conectores, secrets e respostas reais.',
    field: 'backendValidation',
  },
  deployment: {
    id: 'deployment',
    label: 'Implantação e operação',
    description: 'Validar ambiente, domínio, TLS, SMTP, monitoramento, backup, restauração e rollback.',
    field: 'deploymentValidation',
  },
  production: {
    id: 'production',
    label: 'Aceite funcional e corte',
    description: 'Executar o checklist funcional, registrar aceite e definir a condição de desligamento da Base44.',
    field: 'productionValidation',
  },
});

function bool(value) { return Boolean(value); }
function asList(value) { return Array.isArray(value) ? value : []; }
function packageFor(report = {}) {
  const id = report.options?.deliveryPackage || (report.options?.deliveryMode === 'snapshot' ? 'preservation' : 'workspace');
  return DELIVERY_PACKAGES[id] || DELIVERY_PACKAGES.workspace;
}
function targetFor(report = {}) {
  const packageDefinition = packageFor(report);
  const id = report.options?.targetProfile || (packageDefinition.id === 'preservation' ? 'repository-only' : 'supabase-cloud-static');
  return TARGET_PROFILES[id] || TARGET_PROFILES['supabase-cloud-static'];
}
function validationSnapshot(report, definition) {
  const value = report?.[definition.field] || {};
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    passed: bool(value.passed),
    notes: String(value.notes || ''),
    evidence: String(value.evidence || ''),
    validatedAt: value.validatedAt || null,
    validatedBy: value.validatedBy || null,
  };
}
function scopeRows(report = {}) {
  const scope = report.options?.migrationScope || {};
  return SCOPE_DEFINITIONS.map((definition) => {
    const selected = bool(scope[definition.id]);
    const validation = report[definition.validationField] || {};
    const passed = bool(validation.passed);
    return {
      id: definition.id,
      label: definition.label,
      selected,
      passed,
      status: !selected ? 'not-in-scope' : passed ? 'validated' : 'pending',
      detail: !selected
        ? 'Não foi incluído no escopo comercial desta operação.'
        : passed
          ? 'Incluído no escopo e homologado com evidência registrada.'
          : 'Incluído no escopo, mas ainda depende de execução e homologação.',
      validationField: definition.validationField,
    };
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
  const hasCompatibilityGaps = asList(report.build?.compatibility?.unsupported || report.runtimeCompatibility?.unsupported).length
    || asList(report.build?.compatibility?.emulated || report.runtimeCompatibility?.emulated).length
    || asList(report.standalone?.blockers).length;
  return [
    {
      id: 'frontend',
      title: 'Corrigir interface e experiência',
      useWhen: 'Telas, textos, navegação, layout ou regras de apresentação precisam evoluir depois da migração.',
      location: paths.repositoryDir || null,
      command: 'npm run dev:demo',
      steps: [
        'Abrir o workspace migrado, não a Base44.',
        'Criar uma branch de evolução no repositório do produto.',
        'Executar npm install e npm run dev:demo para trabalhar com o sandbox local.',
        'Aplicar as correções de front-end e regras de apresentação.',
        'Voltar ao Bridge apenas para recriar e validar o preview antes do merge ou da entrega.',
      ],
    },
    {
      id: 'backend',
      title: 'Conectar banco e fluxos reais',
      useWhen: 'O produto precisa sair do modo demo e validar persistência, autenticação, arquivos, integrações ou pagamentos.',
      location: paths.repositoryDir || null,
      command: 'npm run workspace:dev',
      steps: [
        'Abrir o workspace e iniciar o Supabase local com npm run workspace:dev.',
        'Aplicar migrations e configurar apenas secrets de desenvolvimento.',
        'Validar autenticação, CRUD, RLS, realtime, storage e funções selecionadas no escopo.',
        'Registrar cada evidência no painel de homologação do Bridge.',
        'Regenerar o pacote somente quando a rodada de validação estiver concluída.',
      ],
    },
    {
      id: 'source-refresh',
      title: 'Trazer nova versão da Base44',
      useWhen: 'A origem Base44 recebeu novas alterações depois da exportação atual.',
      location: null,
      command: null,
      steps: [
        'Iniciar uma nova operação apontando para o mesmo repositório.',
        'O Bridge compara Base44 e GitHub, preserva ambos e abre revisão quando os dois evoluíram.',
        'Não substituir manualmente a branch principal nem apagar branches de segurança.',
      ],
    },
    {
      id: 'compatibility',
      title: 'Resolver obstáculo de outro piloto',
      useWhen: 'Um novo projeto usa contrato, função ou integração ainda não coberta pelo Bridge.',
      location: paths.repositoryDir ? path.join(paths.repositoryDir, 'CLIENT_DELIVERY', 'PILOT_EXTENSION_REQUEST.json') : null,
      command: null,
      highlighted: bool(hasCompatibilityGaps),
      steps: [
        'Usar o inventário estruturado do piloto para identificar contrato, arquivo e categoria.',
        'Implementar a solução no núcleo genérico do Bridge ou em um pacote de compatibilidade versionado.',
        'Adicionar regressão com o contrato real e validar novamente o projeto piloto.',
        'Evitar correção escondida somente no repositório do cliente quando a regra puder ser reutilizada.',
      ],
    },
  ];
}
function buildOperationSummary(report = {}) {
  const readiness = report.readiness || {};
  const packageDefinition = packageFor(report);
  const targetDefinition = targetFor(report);
  const compatibility = report.build?.compatibility || report.runtimeCompatibility || {};
  const validationIds = relevantValidationIds(report);
  const validations = validationIds.map((id) => validationSnapshot(report, VALIDATION_DEFINITIONS[id]));
  const frontendValidated = packageDefinition.id === 'preservation' || bool(report.frontendValidation?.passed);
  const technicalPackagePassed = bool(readiness.contractedPackagePassed || report.clientDelivery?.acceptance?.acceptedByAutomation);
  const requiredHumanValidationsPassed = validations.every((item) => item.passed);
  const runtimePassed = bool(report.build?.runtime?.passed);
  const noUnsupported = asList(compatibility.unsupported).length === 0;
  const canMergeWorkspace = runtimePassed && noUnsupported && frontendValidated;
  const readyForContractedHandoff = technicalPackagePassed && requiredHumanValidationsPassed;
  const canGoProduction = readiness.level === 'production-candidate' && bool(report.productionValidation?.passed);
  const requiredRank = LEVEL_RANK[packageDefinition.minimumLevel] ?? 0;
  const actualRank = LEVEL_RANK[readiness.level] ?? 0;
  const scope = scopeRows(report);
  const nextActions = [];
  if (!frontendValidated && packageDefinition.id !== 'preservation') nextActions.push('Registrar a validação visual e de navegação do preview.');
  for (const item of asList(readiness.nextActions)) nextActions.push(item);
  if (report.pullRequest?.url && canMergeWorkspace && !readyForContractedHandoff) {
    nextActions.push('O PR pode ser incorporado como workspace validado visualmente, mas o pacote contratado continua pendente até as homologações selecionadas.');
  }
  if (readyForContractedHandoff && packageDefinition.id !== 'production') nextActions.push('Percorrer o checklist de handoff, transferir custódia e registrar o aceite do cliente.');
  if (canGoProduction) nextActions.push('Executar a janela de corte, confirmar rollback e somente então desligar a Base44.');

  const checks = asList(report.clientDelivery?.acceptance?.checks).map((item) => ({
    id: item.id,
    label: item.label,
    passed: bool(item.passed),
  }));
  const blockers = [
    ...asList(readiness.productionBlockers).map((detail) => ({ type: 'production', detail })),
    ...asList(compatibility.emulated).map((item) => ({ type: 'emulated', detail: item?.contract || item?.method || String(item) })),
    ...asList(compatibility.unsupported).map((item) => ({ type: 'unsupported', detail: item?.contract || item?.method || String(item) })),
  ];
  const repositoryUrl = report.pullRequest?.url || report.github?.url || report.githubRepository?.htmlUrl || null;
  const operationPlan = report.paths?.repositoryDir
    ? path.join(report.paths.repositoryDir, 'CLIENT_DELIVERY', 'OPERATION_STATUS_AND_NEXT_STEPS.md')
    : null;
  const extensionRequest = report.paths?.repositoryDir
    ? path.join(report.paths.repositoryDir, 'CLIENT_DELIVERY', 'PILOT_EXTENSION_REQUEST.json')
    : null;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: report.project || null,
    client: {
      name: report.options?.clientName || null,
      deliveryOwner: report.options?.deliveryOwner || null,
    },
    contracted: {
      package: packageDefinition,
      target: targetDefinition,
      scope,
    },
    current: {
      status: report.status || 'unknown',
      score: readiness.score || 0,
      level: readiness.level || 'not-ready',
      label: readiness.label || 'Não classificado',
      recommendedPackage: readiness.recommendedPackage || 'Não classificado',
      technicalPackagePassed,
      requiredHumanValidationsPassed,
      readyForContractedHandoff,
      packageGap: actualRank >= requiredRank
        ? 'O estágio técnico mínimo foi alcançado; ainda podem existir homologações humanas ou de escopo.'
        : `O estágio atual ainda está abaixo do mínimo exigido para ${packageDefinition.label}.`,
    },
    decisions: {
      canMergeWorkspace,
      readyForContractedHandoff,
      canGoProduction,
      mergeGuidance: !report.pullRequest?.url
        ? 'A operação não possui PR de revisão registrado.'
        : canMergeWorkspace
          ? 'O PR pode ser mesclado como evolução do workspace após a revisão final do código.'
          : 'Não mescle o PR antes de validar o preview e eliminar contratos não suportados.',
      deliveryGuidance: readyForContractedHandoff
        ? 'O pacote contratado possui evidências suficientes para o handoff.'
        : 'O pacote local pode ser usado como acompanhamento, mas ainda não deve ser apresentado como contrato integralmente homologado.',
      productionGuidance: canGoProduction
        ? 'A operação possui evidências para planejar o corte de produção.'
        : 'Não desligar a Base44 nem anunciar produção concluída.',
    },
    checks,
    validations,
    blockers,
    nextActions: [...new Set(nextActions)],
    evolutionPaths: evolutionPaths(report),
    packageState: {
      dirty: bool(report.packageState?.dirty),
      lastValidationAt: report.packageState?.lastValidationAt || null,
      generatedAt: report.packageState?.generatedAt || report.finishedAt || null,
    },
    artifacts: {
      jobRoot: report.paths?.jobRoot || null,
      repositoryDirectory: report.paths?.repositoryDir || null,
      previewDirectory: report.paths?.previewDir || null,
      clientArchive: report.paths?.clientDeliveryArchive || report.deliveryArchive?.path || null,
      operationPlan,
      extensionRequest,
      repositoryUrl,
    },
  };
}

function markdownList(items, empty = '- Nenhuma ação pendente registrada.') {
  return items?.length ? items.map((item) => `- ${item}`).join('\n') : empty;
}
function operationSummaryMarkdown(summary) {
  const scope = summary.contracted.scope.map((item) => `| ${item.label} | ${item.selected ? 'Incluído' : 'Fora do escopo'} | ${item.status === 'validated' ? 'Validado' : item.status === 'pending' ? 'Pendente' : '—'} | ${item.detail} |`).join('\n');
  const validations = summary.validations.map((item) => `| ${item.label} | ${item.passed ? 'Validado' : 'Pendente'} | ${item.validatedBy || '—'} | ${item.evidence || item.notes || '—'} |`).join('\n') || '| Nenhuma homologação humana exigida | — | — | — |';
  const paths = summary.evolutionPaths.map((item) => `### ${item.title}\n\n**Quando usar:** ${item.useWhen}\n\n${item.command ? `**Comando principal:** \`${item.command}\`\n\n` : ''}${item.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`).join('\n\n');
  return `# Estado atual e próximos passos\n\n## Resumo executivo\n\n- **Projeto:** ${summary.project?.name || 'Não informado'}\n- **Cliente:** ${summary.client.name || 'Não informado'}\n- **Pacote contratado:** ${summary.contracted.package.label}\n- **Destino:** ${summary.contracted.target.label}\n- **Estágio alcançado:** ${summary.current.label} (${summary.current.score}/100)\n- **Pacote tecnicamente aprovado:** ${summary.current.technicalPackagePassed ? 'Sim' : 'Não'}\n- **Homologações humanas concluídas:** ${summary.current.requiredHumanValidationsPassed ? 'Sim' : 'Não'}\n- **Pronto para handoff do contratado:** ${summary.current.readyForContractedHandoff ? 'Sim' : 'Não'}\n\n> ${summary.current.packageGap}\n\n## Decisões\n\n- **Merge do workspace:** ${summary.decisions.mergeGuidance}\n- **Entrega contratual:** ${summary.decisions.deliveryGuidance}\n- **Produção:** ${summary.decisions.productionGuidance}\n\n## Escopo comercial declarado\n\n| Item | Escopo | Estado | Evidência atual |\n|---|---|---|---|\n${scope}\n\n## Homologações registradas\n\n| Validação | Estado | Responsável | Evidência |\n|---|---|---|---|\n${validations}\n\n## Próximas ações\n\n${markdownList(summary.nextActions)}\n\n## Como evoluir o produto sem refazer a migração\n\n${paths}\n\n## Regra do MVP\n\nO Bridge controla preservação, diagnóstico, validação, evidências e handoff. A evolução do código ocorre no workspace migrado e no repositório do produto. Uma nova operação Base44 só é necessária quando a origem Base44 mudar ou quando for preciso reaplicar uma compatibilidade do núcleo.\n`;
}
function extensionRequestPayload(report, summary) {
  const compatibility = report.build?.compatibility || report.runtimeCompatibility || {};
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: report.project || null,
    targetProfile: summary.contracted.target.id,
    contractedPackage: summary.contracted.package.id,
    readiness: {
      level: summary.current.level,
      score: summary.current.score,
    },
    contracts: {
      converted: asList(compatibility.converted),
      bridged: asList(compatibility.bridged),
      emulated: asList(compatibility.emulated),
      unsupported: asList(compatibility.unsupported),
    },
    productionBlockers: asList(report.standalone?.blockers),
    requestedResolution: [
      'Classificar se o obstáculo é regra reutilizável do Bridge ou customização exclusiva do cliente.',
      'Implementar a solução genérica com teste de regressão quando reutilizável.',
      'Revalidar o preview e atualizar a matriz de contratos do piloto.',
    ],
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
  await fs.writeFile(extensionMarkdownPath, `# Pedido de extensão do piloto\n\nEste arquivo organiza obstáculos específicos para que a solução possa ser incorporada ao núcleo genérico do Bridge.\n\n- **Contratos convertidos:** ${extensionPayload.contracts.converted.length}\n- **Contratos encaminhados:** ${extensionPayload.contracts.bridged.length}\n- **Contratos emulados:** ${extensionPayload.contracts.emulated.length}\n- **Contratos não suportados:** ${extensionPayload.contracts.unsupported.length}\n- **Bloqueadores de produção:** ${extensionPayload.productionBlockers.length}\n\n## Processo\n\n${extensionPayload.requestedResolution.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n`, 'utf8');

  const manifestPath = path.join(deliveryRoot, 'CLIENT_DELIVERY_MANIFEST.json');
  const manifest = await readJson(manifestPath, null);
  if (manifest) {
    manifest.commercialScope = summary.contracted.scope;
    manifest.packageVerification = {
      actualLevel: summary.current.level,
      actualLabel: summary.current.label,
      technicalPackagePassed: summary.current.technicalPackagePassed,
      humanValidationsPassed: summary.current.requiredHumanValidationsPassed,
      readyForContractedHandoff: summary.current.readyForContractedHandoff,
      packageGap: summary.current.packageGap,
    };
    manifest.operationSummary = {
      decisions: summary.decisions,
      nextActions: summary.nextActions,
      packageState: summary.packageState,
    };
    manifest.artifacts = {
      ...(manifest.artifacts || {}),
      operationPlan: operationPlanPath,
      pilotExtensionRequest: extensionJsonPath,
    };
    await writeJson(manifestPath, manifest);
  }
  return {
    summary,
    operationPlanPath,
    extensionJsonPath,
    extensionMarkdownPath,
  };
}

module.exports = {
  SCOPE_DEFINITIONS,
  VALIDATION_DEFINITIONS,
  buildOperationSummary,
  operationSummaryMarkdown,
  extensionRequestPayload,
  writeOperationArtifacts,
};
