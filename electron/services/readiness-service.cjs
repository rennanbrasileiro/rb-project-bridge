'use strict';

function asList(value) { return Array.isArray(value) ? value : []; }

function stage(status, label, detail) { return { status, label, detail }; }

function assessMigrationReadiness(report = {}) {
  const compatibility = report.build?.compatibility || report.runtimeCompatibility || {};
  const unsupported = asList(compatibility.unsupported);
  const emulated = asList(compatibility.emulated);
  const bridged = asList(compatibility.bridged);
  const converted = asList(compatibility.converted);
  const productionBlockers = asList(report.standalone?.blockers);

  const sourcePreserved = Boolean(report.backup?.sha256 || report.export?.source);
  const standalonePassed = Boolean(report.standaloneGateAfterBuild?.passed || report.standaloneGateAfterPreviewRepair?.passed || report.standaloneGate?.passed || report.standalone?.gate?.passed);
  const contractCovered = unsupported.length === 0;
  const buildPassed = report.build?.status === 'passed';
  const runtimePassed = Boolean(report.build?.runtime?.passed);
  const workspacePrepared = Boolean(compatibility.workspace?.prepared);
  const localBackendValidated = Boolean(report.workspaceValidation?.passed);
  const productionCandidate = runtimePassed && contractCovered && productionBlockers.length === 0 && emulated.length === 0;

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
  if (runtimePassed && workspacePrepared) { level = 'workspace-prepared'; label = 'Workspace evolutivo preparado'; recommendedPackage = 'Workspace'; }
  if (productionCandidate) { level = 'production-candidate'; label = 'Candidato à homologação de produção'; recommendedPackage = 'Migração completa'; }

  const stages = {
    preservation: stage(sourcePreserved ? 'passed' : 'missing', 'Preservação', sourcePreserved ? 'Backup verificável e origem preservada.' : 'Backup verificável ainda não concluído.'),
    isolation: stage(standalonePassed ? 'passed' : 'missing', 'Isolamento', standalonePassed ? 'Runtime Base44 removido e gate standalone aprovado.' : 'A independência estrutural ainda não foi comprovada.'),
    sandbox: stage(runtimePassed ? 'passed' : buildPassed ? 'blocked' : 'missing', 'Sandbox executável', runtimePassed ? 'Bundle carregado e renderizado em Chromium.' : buildPassed ? 'O código compilou, mas falhou durante a execução.' : 'Build executável ainda não aprovado.'),
    workspace: stage(localBackendValidated ? 'passed' : workspacePrepared ? 'prepared' : 'missing', 'Workspace evolutivo', localBackendValidated ? 'Banco local e aplicação foram validados em conjunto.' : workspacePrepared ? 'Scripts, documentação e Supabase local foram preparados; falta validar o Docker e o banco na máquina de desenvolvimento.' : 'Workspace local ainda não foi preparado.'),
    production: stage(productionCandidate ? 'candidate' : 'blocked', 'Produção', productionCandidate ? 'Nenhuma API emulada ou função bloqueante permanece.' : `${productionBlockers.length} função(ões) e ${emulated.length} contrato(s) emulado(s) exigem homologação ou conversão.`),
  };

  const nextActions = [];
  if (!runtimePassed) nextActions.push('Corrigir os erros capturados pelo Chromium e repetir a validação do preview.');
  if (unsupported.length) nextActions.push(`Implementar ${unsupported.length} contrato(s) Base44 ainda não suportado(s).`);
  if (emulated.length) nextActions.push(`Decidir se ${emulated.length} contrato(s) emulado(s) serão mantidos, substituídos ou removidos para produção.`);
  if (workspacePrepared && !localBackendValidated) nextActions.push('Executar o workspace com Docker e Supabase local, aplicar migrations e validar autenticação e CRUD.');
  if (productionBlockers.length) nextActions.push(`Converter e homologar ${productionBlockers.length} função(ões) de backend preservada(s).`);
  if (!productionCandidate) nextActions.push('Planejar migração de dados, usuários, storage, secrets, domínio e observabilidade antes da produção.');

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    score,
    level,
    label,
    recommendedPackage,
    stages,
    runtimeContracts: {
      total: converted.length + bridged.length + emulated.length + unsupported.length,
      converted: converted.length,
      bridged: bridged.length,
      emulated: emulated.length,
      unsupported: unsupported.length,
    },
    productionBlockers,
    nextActions,
  };
}

function readinessMarkdown(readiness) {
  const stageRows = Object.values(readiness.stages || {}).map((item) => `| ${item.label} | ${item.status} | ${item.detail} |`).join('\n');
  const nextActions = asList(readiness.nextActions).length ? readiness.nextActions.map((item) => `- ${item}`).join('\n') : '- Nenhuma ação obrigatória registrada.';
  const blockers = asList(readiness.productionBlockers).length ? readiness.productionBlockers.map((item) => `- ${item}`).join('\n') : '- Nenhum bloqueador de backend registrado.';
  return `# Prontidão da migração\n\n- **Pontuação:** ${readiness.score}/100\n- **Estágio:** ${readiness.label}\n- **Pacote recomendado:** ${readiness.recommendedPackage}\n\n## Marcos\n\n| Marco | Estado | Evidência |\n|---|---|---|\n${stageRows}\n\n## Contratos de runtime\n\n- Convertidos: ${readiness.runtimeContracts?.converted ?? 0}\n- Encaminhados por adapter: ${readiness.runtimeContracts?.bridged ?? 0}\n- Emulados: ${readiness.runtimeContracts?.emulated ?? 0}\n- Não suportados: ${readiness.runtimeContracts?.unsupported ?? 0}\n\n## Bloqueadores de produção\n\n${blockers}\n\n## Próximas ações\n\n${nextActions}\n`;
}

module.exports = { assessMigrationReadiness, readinessMarkdown };
