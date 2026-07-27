'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildOperationSummary, writeOperationArtifacts } = require('../electron/services/operation-summary-service.cjs');
const { OperationControlService } = require('../electron/services/operation-control-service.cjs');
const { writeJson } = require('../electron/core/fs-utils.cjs');

function productionReport(root = '/tmp/bridge-operation') {
  const repositoryDir = path.join(root, 'repository');
  return {
    jobId: 'job-1',
    status: 'completed',
    finishedAt: '2026-07-27T02:08:41.000Z',
    project: { id: 'fit-1', name: 'FitHub Personal Trainer' },
    options: {
      deliveryMode: 'standalone-supabase',
      deliveryPackage: 'production',
      targetProfile: 'supabase-self-hosted',
      clientName: 'RB HUB',
      deliveryOwner: 'Rennan Brasileiro',
      migrationScope: { data: true, users: true, storage: true, integrations: true, deployment: true },
    },
    paths: { jobRoot: root, repositoryDir, previewDir: path.join(root, 'preview') },
    build: {
      status: 'passed',
      runtime: { passed: true },
      compatibility: {
        converted: Array(227).fill({ method: 'entity' }),
        bridged: Array(18).fill({ method: 'bridge' }),
        emulated: [{ method: 'appLogs' }],
        unsupported: [],
        workspace: { prepared: true },
      },
    },
    standaloneGateAfterBuild: { passed: true },
    standalone: {
      blockers: ['stripe-createCheckout', 'stripe-createPortal', 'stripe-webhook'],
      functionalVerification: { prepared: true, command: 'npm run rb:verify' },
    },
    backup: { sha256: 'abc' },
    security: { blocking: [] },
    readiness: {
      score: 80,
      level: 'workspace-prepared',
      label: 'Workspace funcional preparado',
      recommendedPackage: 'Workspace',
      contractedPackagePassed: false,
      nextActions: ['Executar “Testar banco, login e CRUD”.'],
      productionBlockers: ['stripe-createCheckout', 'stripe-createPortal', 'stripe-webhook'],
    },
    clientDelivery: {
      acceptance: {
        acceptedByAutomation: false,
        checks: [
          { id: 'runtime', label: 'Aplicação renderizada no Chromium', passed: true },
          { id: 'production', label: 'Sem bloqueadores para produção', passed: false },
        ],
      },
    },
    pullRequest: { url: 'https://github.com/rb/fithub/pull/5' },
  };
}

test('operation summary separates workspace merge from functional handoff and production', () => {
  const report = productionReport();
  report.frontendValidation = { status: 'passed', passed: true, evidence: 'Preview revisado', validatedBy: 'Rennan' };
  const summary = buildOperationSummary(report);
  assert.equal(summary.contracted.package.id, 'production');
  assert.equal(summary.contracted.scope.filter((item) => item.selected).length, 5);
  assert.equal(summary.current.readyForContractedHandoff, false);
  assert.equal(summary.decisions.canMergeWorkspace, true);
  assert.equal(summary.decisions.canGoProduction, false);
  assert.match(summary.decisions.deliveryGuidance, /não deve ser apresentado/i);
  assert.ok(summary.evolutionPaths.some((item) => item.id === 'frontend' && item.command === 'npm run dev:demo'));
  assert.ok(summary.evolutionPaths.some((item) => item.id === 'backend' && item.command === 'npm run rb:verify'));
  assert.ok(summary.evolutionPaths.some((item) => item.id === 'compatibility'));
});

test('all required validations make a production package ready only when readiness is production-candidate', () => {
  const report = productionReport();
  report.readiness = {
    ...report.readiness,
    level: 'production-candidate',
    label: 'Candidato à homologação de produção',
    contractedPackagePassed: true,
    nextActions: [],
    productionBlockers: [],
  };
  report.standalone.blockers = [];
  report.build.compatibility.emulated = [];
  for (const field of ['frontendValidation', 'workspaceValidation', 'dataMigrationValidation', 'userMigrationValidation', 'storageMigrationValidation', 'backendValidation', 'deploymentValidation', 'productionValidation']) {
    report[field] = { status: 'passed', passed: true, evidence: 'ok' };
  }
  const summary = buildOperationSummary(report);
  assert.equal(summary.current.readyForContractedHandoff, true);
  assert.equal(summary.decisions.canGoProduction, true);
  assert.equal(summary.openDefects.length, 0);
});

test('operation artifacts enrich the client manifest and generate a reusable source-neutral extension request', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-operation-artifacts-'));
  const delivery = path.join(root, 'CLIENT_DELIVERY');
  await fs.mkdir(delivery, { recursive: true });
  await writeJson(path.join(delivery, 'CLIENT_DELIVERY_MANIFEST.json'), { artifacts: {} });
  const report = productionReport(root);
  const artifacts = await writeOperationArtifacts(root, report);
  const manifest = JSON.parse(await fs.readFile(path.join(delivery, 'CLIENT_DELIVERY_MANIFEST.json'), 'utf8'));
  const extension = JSON.parse(await fs.readFile(artifacts.extensionJsonPath, 'utf8'));
  const plan = await fs.readFile(artifacts.operationPlanPath, 'utf8');
  assert.equal(manifest.commercialScope.length, 5);
  assert.equal(manifest.packageVerification.readyForContractedHandoff, false);
  assert.equal(manifest.packageVerification.openDefects, 0);
  assert.equal(extension.productionBlockers.length, 3);
  assert.equal(extension.sourcePlatform, 'base44');
  assert.match(plan, /Como evoluir sem refazer a captura/);
  assert.match(plan, /evidência mais recente prevalece/i);
});

test('operation control records approval without regenerating the archive and marks the package dirty', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-operation-control-'));
  const repositoryDir = path.join(root, 'repository');
  await fs.mkdir(repositoryDir, { recursive: true });
  const report = productionReport(root);
  await writeJson(path.join(root, 'RB-BRIDGE-REPORT.json'), report);
  const writes = [];
  const reports = {
    async writeReport(directory, nextReport, options) {
      writes.push({ directory, options });
      await writeJson(path.join(directory, 'RB-BRIDGE-REPORT.json'), nextReport);
      return { clientDeliveryArchive: null };
    },
  };
  const service = new OperationControlService({ reports, logger: { info() {} } });
  const state = await service.saveValidation(root, {
    validationId: 'frontend',
    status: 'passed',
    evidence: 'Preview aprovado',
    validatedBy: 'Rennan',
  });
  assert.equal(state.result.frontendValidation.status, 'passed');
  assert.equal(state.result.frontendValidation.passed, true);
  assert.equal(state.result.packageState.dirty, true);
  assert.equal(writes.length, 2);
  assert.ok(writes.every((item) => item.options?.skipArchive === true));
});

test('renderer contains rejection, defect, retest and automated workspace verification controls', async () => {
  const html = await fs.readFile(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const decisionScript = await fs.readFile(path.join(__dirname, '..', 'renderer', 'operation-decision-ui.js'), 'utf8');
  const functionalScript = await fs.readFile(path.join(__dirname, '..', 'renderer', 'functional-verification-ui.js'), 'utf8');
  assert.match(html, /id="operationDecision"/);
  assert.match(html, /Escopo selecionado x homologado/);
  assert.match(html, /id="regeneratePackageDecision"/);
  assert.match(decisionScript, /Comportamento esperado/);
  assert.match(decisionScript, /migration\.saveValidation/);
  assert.match(decisionScript, /migration\.retestDefect/);
  assert.match(decisionScript, /migration\.regeneratePackage/);
  assert.match(functionalScript, /Testar banco, login e CRUD/);
  assert.match(functionalScript, /migration\.verifyWorkspace/);
});
