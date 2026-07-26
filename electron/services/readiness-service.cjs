'use strict';

function asList(value) { return Array.isArray(value) ? value : []; }
function stage(status, label, detail) { return { status, label, detail }; }

const PACKAGE_MINIMUM = Object.freeze({ preservation: 'preserved', sandbox: 'sandbox-ready', workspace: 'workspace-prepared', production: 'production-candidate' });
const LEVEL_RANK = Object.freeze({ 'not-ready': 0, preserved: 1, isolated: 2, 'sandbox-ready': 3, 'workspace-prepared': 4, 'production-candidate': 5 });

function assessMigrationReadiness(report = {}) {
  const compatibility = report.build?.compatibility || report.runtimeCompatibility || {};
  const unsupported = asList(compatibility.unsupported);
  const emulated = asList(compatibility.emulated);
  const bridged = asList(compatibility.bridged);
  const converted = asList(compatibility.converted);
  const productionBlockers = asList(report.standalone?.blockers);
  const scope = report.options?.migrationScope || {};

  const sourcePreserved = Boolean(report.backup?.sha256 || report.export?.source);
  const standalonePassed = Boolean(report.standaloneGateAfterBuild?.passed || report.standaloneGateAfterPreviewRepair?.passed || report.standaloneGate?.passed || report.standalone?.gate?.passed);
  const contractCovered = unsupported.length === 0;
  const buildPassed = report.build?.status === 'passed';
  const runtimePassed = Boolean(report.build?.runtime?.passed);
  const workspacePrepared = Boolean(compatibility.workspace?.prepared);
  const localBackendValidated = Boolean(report.workspaceValidation?.passed);
  const backendValidated = Boolean(report.backendValidation?.passed);
  const productionValidation = Boolean(report.productionValidation?.passed);
  const scopeChecks = {
    data: !scope.data || Boolean(report.dataMigrationValidation?.passed),
    users: !scope.users || Boolean(report.userMigrationValidation?.passed),
    storage: !scope.storage || Boolean(report.storageMigrationValidation?.passed),
    integrations: !scope.integrations || backendValidated,
    deployment: !scope.deployment || Boolean(report.deploymentValidation?.passed),
  };
  const scopeComplete = Object.values(scopeChecks).every(Boolean);
  const productionCandidate = runtimePassed && contractCovered && productionBlockers.length === 0 && emulated.length === 0 && (bridged.length === 0 || backendValidated) && scopeComplete && productionValidation;

  let score = 0;
  if (sourcePreserved) score += 10;
  if (standalonePassed) score += 15;
  if (contractCovered) score += 15;
  if (buildPassed) score += 15;
  if (runtimePassed) score += 20;
  if (workspacePrepared) score += 10;
  if (productionCandidate) score += 15;

  let level = 'not-ready';
  let label = 'Não classificado';
  let recommendedPackage = 'Diagnóstico';
  if (sourcePreserved) { level = 'preserved'; label = 'Código preservado'; recommendedPackage = 'Preservação'; }
  if (standalonePassed) { level = 'isolated'; label = 'Aplicação isolada'; recommendedPackage = 'Isolamento'; }
  if (runtimePassed) { level = 'sandbox-ready'; label = 'Sandbox executável'; recommendedPackage = 'Sandbox'; }
  if (runtimePassed && workspacePrepared) { level = 'workspace-prepared'; label = localBackendValidated ? 'Workspace evolutivo validado' : 'Workspace evolutivo preparado'; recommendedPackage = 'Workspace'; }
  if (productionCandidate) { level = 'production-candidate'; label = 'Candidato à homologação de produção'; recommendedPackage = 'Migração completa'; }

  const contractedPackage = report.options?.deliveryPackage || (report.options?.deliveryMode === 'snapshot' ? 'preservation' : 'workspace');
  const requiredLevel = PACKAGE_MINIMUM[contractedPackage] || 'workspace-prepared';
  let contractedPackagePassed = false;
  if (contractedPackage === 'preservation') contractedPackagePassed = sourcePreserved;
  else if (contractedPackage === 'sandbox') contractedPackagePassed = runtimePassed && contractCovered;
  else if (contractedPackage === 'workspace') contractedPackagePassed = runtimePassed && contractCovered && workspacePrepared && localBackendValidated;
  else if (contractedPackage === 'production') contractedPackagePassed = productionCandidate;
  const targetProfile = report.options?.targetProfile || (contractedPackage === 'preservation' ? 'repository-only' : 'supabase-cloud-static');

  const stages = {
    preservation: stage(sourcePreserved ? 'passed' : 'missing', 'Preservação', sourcePreserved ? 'Backup verificável e origem preservada.' : 'Backup verificável ainda não concluído.'),
    isolation: stage(standalonePassed ? 'passed' : 'missing', 'Isolamento', standalonePassed ? 'Runtime Base44 removido e gate standalone aprovado.' : 'A independência estrutural ainda não foi comprovada.'),
    sandbox: stage(runtimePassed ? 'passed' : buildPassed ? 'blocked' : 'missing', 'Sandbox executável', runtimePassed ? 'Bundle carregado e renderizado em Chromium.' : buildPassed ? 'O código compilou, mas falhou durante a execução.' : 'Build executável ainda não aprovado.'),
    workspace: stage(localBackendValidated ? 'passed' : workspacePrepared ? 'prepared' : 'missing', 'Workspace evolutivo', localBackendValidated ? 'Banco local e aplicação foram validados em conjunto.' : workspacePrepared ? 'Scripts, documentação e Supabase local preparados; falta validar Docker, migrations, autenticação e CRUD.' : 'Workspace local ainda não foi preparado.'),
    production: stage(productionCandidate ? 'candidate' : 'blocked', 'Produção', productionCandidate ? 'Escopo contratado, backend e ambiente de produção possuem evidências de validação.' : 'Produção exige homologação funcional, dados e integrações reais, implantação, observabilidade e rollback.'),
  };

  const nextActions = [];
  if (!runtimePassed) nextActions.push('Corrigir os erros capturados pelo Chromium e repetir a validação do preview.');
  if (unsupported.length) nextActions.push(`Implementar ${unsupported.length} contrato(s) Base44 ainda não suportado(s).`);
  if (emulated.length) nextActions.push(`Substituir ou homologar ${emulated.length} contrato(s) emulado(s) antes da produção.`);
  if (workspacePrepared && !localBackendValidated) nextActions.push('Executar o workspace com Docker, aplicar migrations e validar autenticação, CRUD, RLS e realtime.');
  if (productionBlockers.length) nextActions.push(`Converter e homologar ${productionBlockers.length} função(ões) de backend preservada(s).`);
  if (bridged.length && !backendValidated) nextActions.push(`Homologar o backend de ${bridged.length} contrato(s) encaminhado(s) por adapter ou função.`);
  if (scope.data && !scopeChecks.data) nextActions.push('Migrar e reconciliar os dados históricos definidos no escopo.');
  if (scope.users && !scopeChecks.users) nextActions.push('Migrar ou recriar usuários, papéis, convites e autenticação.');
  if (scope.storage && !scopeChecks.storage) nextActions.push('Migrar arquivos e validar permissões de storage.');
  if (scope.deployment && !scopeChecks.deployment) nextActions.push('Implantar homologação/produção e validar domínio, TLS, backup, monitoramento e rollback.');
  if (targetProfile === 'aws-custom') nextActions.push('Definir e implementar adapters e infraestrutura AWS; esta versão gera apenas o blueprint arquitetural.');
  if (contractedPackage === 'production' && !productionValidation) nextActions.push('Executar o checklist funcional do cliente e registrar a evidência de homologação antes do desligamento da Base44.');

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    score,
    level,
    label,
    recommendedPackage,
    contractedPackage,
    contractedPackagePassed,
    requiredLevel,
    targetProfile,
    stages,
    runtimeContracts: { total: converted.length + bridged.length + emulated.length + unsupported.length, converted: converted.length, bridged: bridged.length, emulated: emulated.length, unsupported: unsupported.length },
    productionBlockers,
    scopeChecks,
    nextActions: [...new Set(nextActions)],
  };
}

function readinessMarkdown(readiness) {
  const stageRows = Object.values(readiness.stages || {}).map((item) => `| ${item.label} | ${item.status} | ${item.detail} |`).join('\n');
  const nextActions = asList(readiness.nextActions).length ? readiness.nextActions.map((item) => `- ${item}`).join('\n') : '- Nenhuma ação obrigatória registrada.';
  const blockers = asList(readiness.productionBlockers).length ? readiness.productionBlockers.map((item) => `- ${item}`).join('\n') : '- Nenhum bloqueador de backend registrado.';
  return `# Prontidão da migração\n\n- **Pontuação:** ${readiness.score}/100\n- **Estágio:** ${readiness.label}\n- **Pacote contratado:** ${readiness.contractedPackage}\n- **Pacote contratado aprovado:** ${readiness.contractedPackagePassed ? 'Sim' : 'Não'}\n- **Pacote recomendado pelo estágio atual:** ${readiness.recommendedPackage}\n- **Destino:** ${readiness.targetProfile}\n\n## Marcos\n\n| Marco | Estado | Evidência |\n|---|---|---|\n${stageRows}\n\n## Contratos de runtime\n\n- Convertidos: ${readiness.runtimeContracts?.converted ?? 0}\n- Encaminhados: ${readiness.runtimeContracts?.bridged ?? 0}\n- Emulados: ${readiness.runtimeContracts?.emulated ?? 0}\n- Não suportados: ${readiness.runtimeContracts?.unsupported ?? 0}\n\n## Bloqueadores de produção\n\n${blockers}\n\n## Próximas ações\n\n${nextActions}\n`;
}

module.exports = { assessMigrationReadiness, readinessMarkdown, PACKAGE_MINIMUM, LEVEL_RANK };
