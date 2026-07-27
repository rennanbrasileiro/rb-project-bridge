'use strict';

const { effectiveStatus, latestVerificationMap } = require('./verification-ledger-service.cjs');
const { openDefects, blockingDefects } = require('./defect-service.cjs');

function asList(value) { return Array.isArray(value) ? value : []; }
function stage(status, label, detail) { return { status, label, detail }; }
function validationPassed(report, field) {
  const value = report[field] || {};
  return value.status === 'not_applicable' || value.status === 'passed' || value.passed === true;
}

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
  const defects = openDefects(report);
  const hardDefects = blockingDefects(report);

  const sourcePreserved = Boolean(report.backup?.sha256 || report.export?.source);
  const legacyStandalone = Boolean(report.standaloneGateAfterPreviewRepair?.passed || report.standaloneGateAfterBuild?.passed || report.standaloneGate?.passed || report.standalone?.gate?.passed);
  const standalonePassed = effectiveStatus(report, 'standalone', legacyStandalone) === 'passed';
  const contractCovered = unsupported.length === 0;
  const buildPassed = effectiveStatus(report, 'build', report.build?.status === 'passed') === 'passed';
  const runtimePassed = effectiveStatus(report, 'runtime', report.build?.runtime?.passed) === 'passed';
  const securityPassed = effectiveStatus(report, 'security', (report.securityAfterPreviewRepair?.blocking?.length || report.securityAfterBuild?.blocking?.length || report.security?.blocking?.length || 0) === 0) === 'passed';
  const workspacePrepared = Boolean(compatibility.workspace?.prepared || report.standalone?.functionalVerification?.prepared || report.functionalVerification?.prepared);
  const localBackendValidated = effectiveStatus(report, 'workspace', report.workspaceValidation?.passed, 'skipped') === 'passed';
  const backendValidated = validationPassed(report, 'backendValidation');
  const productionValidation = validationPassed(report, 'productionValidation');
  const scopeChecks = {
    data: !scope.data || validationPassed(report, 'dataMigrationValidation'),
    users: !scope.users || validationPassed(report, 'userMigrationValidation'),
    storage: !scope.storage || validationPassed(report, 'storageMigrationValidation'),
    integrations: !scope.integrations || backendValidated,
    deployment: !scope.deployment || validationPassed(report, 'deploymentValidation'),
  };
  const scopeComplete = Object.values(scopeChecks).every(Boolean);
  const productionCandidate = buildPassed && runtimePassed && standalonePassed && securityPassed && localBackendValidated && contractCovered && productionBlockers.length === 0 && emulated.length === 0 && (bridged.length === 0 || backendValidated) && scopeComplete && productionValidation && defects.length === 0;

  let score = 0;
  if (sourcePreserved) score += 10;
  if (standalonePassed) score += 15;
  if (contractCovered) score += 15;
  if (buildPassed) score += 15;
  if (runtimePassed) score += 20;
  if (workspacePrepared) score += 5;
  if (localBackendValidated) score += 10;
  if (productionCandidate) score += 10;
  if (!securityPassed) score = Math.min(score, 25);
  if (!runtimePassed) score = Math.min(score, 55);
  if (hardDefects.length) score = Math.min(score, 70);

  let level = 'not-ready';
  let label = 'Não classificado';
  let recommendedPackage = 'Diagnóstico';
  if (sourcePreserved) { level = 'preserved'; label = 'Código preservado'; recommendedPackage = 'Preservação'; }
  if (standalonePassed) { level = 'isolated'; label = 'Aplicação isolada'; recommendedPackage = 'Isolamento'; }
  if (runtimePassed && buildPassed && standalonePassed && securityPassed) { level = 'sandbox-ready'; label = 'Sandbox executável'; recommendedPackage = 'Sandbox'; }
  if (runtimePassed && buildPassed && standalonePassed && securityPassed && workspacePrepared) { level = 'workspace-prepared'; label = localBackendValidated ? 'Workspace funcional validado' : 'Workspace funcional preparado'; recommendedPackage = 'Workspace'; }
  if (productionCandidate) { level = 'production-candidate'; label = 'Candidato à homologação de produção'; recommendedPackage = 'Migração completa'; }

  const contractedPackage = report.options?.deliveryPackage || (report.options?.deliveryMode === 'snapshot' ? 'preservation' : 'workspace');
  const requiredLevel = PACKAGE_MINIMUM[contractedPackage] || 'workspace-prepared';
  let contractedPackagePassed = false;
  if (contractedPackage === 'preservation') contractedPackagePassed = sourcePreserved && securityPassed;
  else if (contractedPackage === 'sandbox') contractedPackagePassed = runtimePassed && buildPassed && standalonePassed && securityPassed && contractCovered && hardDefects.length === 0;
  else if (contractedPackage === 'workspace') contractedPackagePassed = runtimePassed && buildPassed && standalonePassed && securityPassed && contractCovered && workspacePrepared && localBackendValidated && defects.length === 0;
  else if (contractedPackage === 'production') contractedPackagePassed = productionCandidate;
  const targetProfile = report.options?.targetProfile || (contractedPackage === 'preservation' ? 'repository-only' : 'supabase-cloud-static');

  const stages = {
    preservation: stage(sourcePreserved ? 'passed' : 'missing', 'Preservação', sourcePreserved ? 'Backup verificável e origem preservada.' : 'Backup verificável ainda não concluído.'),
    isolation: stage(standalonePassed ? 'passed' : 'failed', 'Isolamento', standalonePassed ? 'Dependência estrutural da origem removida na evidência vigente.' : 'A independência vigente está reprovada ou ausente.'),
    sandbox: stage(runtimePassed && buildPassed ? 'passed' : buildPassed ? 'failed' : 'missing', 'Sandbox executável', runtimePassed && buildPassed ? 'Bundle atual carregou em Chromium.' : buildPassed ? 'O build passou, mas a execução atual falhou.' : 'Build executável atual não aprovado.'),
    workspace: stage(localBackendValidated ? 'passed' : workspacePrepared ? 'prepared' : 'missing', 'Workspace funcional', localBackendValidated ? 'Supabase, login, profiles, CRUD e RLS aprovados automaticamente.' : workspacePrepared ? 'Verificador preparado; falta executar os testes funcionais.' : 'Workspace funcional ainda não preparado.'),
    production: stage(productionCandidate ? 'candidate' : 'blocked', 'Produção', productionCandidate ? 'Escopo, ambiente e aceite possuem evidências vigentes.' : 'Produção permanece bloqueada por gates, escopo ou defeitos.'),
  };

  const nextActions = [];
  if (!buildPassed) nextActions.push('Corrigir o build atual e executar nova validação.');
  if (buildPassed && !runtimePassed) nextActions.push('Corrigir os erros capturados pelo Chromium e repetir o reteste do preview.');
  if (!securityPassed) nextActions.push('Remover achados de segurança bloqueantes e repetir a varredura.');
  if (unsupported.length) nextActions.push(`Implementar ${unsupported.length} contrato(s) da origem ainda não suportado(s).`);
  if (emulated.length) nextActions.push(`Substituir ou homologar ${emulated.length} contrato(s) emulado(s) antes da produção.`);
  if (workspacePrepared && !localBackendValidated) nextActions.push('Executar “Testar banco, login e CRUD” e corrigir os defeitos gerados.');
  if (productionBlockers.length) nextActions.push(`Converter e homologar ${productionBlockers.length} função(ões) de backend preservada(s).`);
  if (bridged.length && !backendValidated) nextActions.push(`Homologar o backend de ${bridged.length} contrato(s) encaminhado(s) por adapter ou função.`);
  if (scope.data && !scopeChecks.data) nextActions.push('Migrar e reconciliar os dados históricos definidos no escopo.');
  if (scope.users && !scopeChecks.users) nextActions.push('Migrar ou recriar usuários, papéis, convites e autenticação.');
  if (scope.storage && !scopeChecks.storage) nextActions.push('Migrar arquivos e validar permissões de storage.');
  if (scope.deployment && !scopeChecks.deployment) nextActions.push('Implantar homologação/produção e validar domínio, TLS, backup, monitoramento e rollback.');
  for (const defect of defects) nextActions.push(`Resolver ${defect.id} — ${defect.title}.`);
  if (targetProfile === 'aws-custom') nextActions.push('Definir adapters e infraestrutura AWS; esta versão gera apenas o blueprint arquitetural.');
  if (contractedPackage === 'production' && !productionValidation) nextActions.push('Executar o aceite funcional antes do desligamento da plataforma de origem.');

  return {
    schemaVersion: 3,
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
    technicalGates: { build: buildPassed, runtime: runtimePassed, standalone: standalonePassed, security: securityPassed, workspace: localBackendValidated },
    latestVerifications: latestVerificationMap(report),
    runtimeContracts: { total: converted.length + bridged.length + emulated.length + unsupported.length, converted: converted.length, bridged: bridged.length, emulated: emulated.length, unsupported: unsupported.length },
    productionBlockers,
    openDefects: defects.length,
    blockingDefects: hardDefects.length,
    scopeChecks,
    nextActions: [...new Set(nextActions)],
  };
}

function readinessMarkdown(readiness) {
  const stageRows = Object.values(readiness.stages || {}).map((item) => `| ${item.label} | ${item.status} | ${item.detail} |`).join('\n');
  const nextActions = asList(readiness.nextActions).length ? readiness.nextActions.map((item) => `- ${item}`).join('\n') : '- Nenhuma ação obrigatória registrada.';
  const blockers = asList(readiness.productionBlockers).length ? readiness.productionBlockers.map((item) => `- ${item}`).join('\n') : '- Nenhum bloqueador de backend registrado.';
  return `# Prontidão da migração\n\n- **Pontuação:** ${readiness.score}/100\n- **Estágio:** ${readiness.label}\n- **Pacote contratado:** ${readiness.contractedPackage}\n- **Pacote aprovado:** ${readiness.contractedPackagePassed ? 'Sim' : 'Não'}\n- **Pacote recomendado:** ${readiness.recommendedPackage}\n- **Destino:** ${readiness.targetProfile}\n- **Defeitos abertos:** ${readiness.openDefects || 0}\n- **Defeitos bloqueantes:** ${readiness.blockingDefects || 0}\n\n> A evidência mais recente prevalece. Uma falha posterior invalida aprovações antigas.\n\n## Marcos\n\n| Marco | Estado | Evidência |\n|---|---|---|\n${stageRows}\n\n## Contratos de runtime\n\n- Convertidos: ${readiness.runtimeContracts?.converted ?? 0}\n- Encaminhados: ${readiness.runtimeContracts?.bridged ?? 0}\n- Emulados: ${readiness.runtimeContracts?.emulated ?? 0}\n- Não suportados: ${readiness.runtimeContracts?.unsupported ?? 0}\n\n## Bloqueadores de produção\n\n${blockers}\n\n## Próximas ações\n\n${nextActions}\n`;
}

module.exports = { assessMigrationReadiness, readinessMarkdown, PACKAGE_MINIMUM, LEVEL_RANK };
