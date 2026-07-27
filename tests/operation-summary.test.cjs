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
      compatibility: { converted: Array(227).fill({ method: 'entity' }), bridged: Array(18).fill({ method: 'bridge' }), emulated: [{ method: 'appLogs' }], unsupported: [], workspace: { prepared: true } },
    },
    standaloneGateAfterBuild: { passed: true },
    standalone: { blockers: ['stripe-createCheckout', 'stripe-createPortal', 'stripe-webhook'] },
    backup: { sha256: 'abc' },
    security: { blocking: [] },
    readiness: {
      score: 85,
      level: 'workspace-prepared',
      label: 'Workspace evolutivo preparado',
      recommendedPackage: 'Workspace',
      contractedPackagePassed: false,
      nextActions: ['Executar o workspace com Docker.'],
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

test('operation summary exposes contracted scope and separates workspace merge from production approval', () => {
  const report = productionReport();
  report.frontendValidation = { passed: true, evidence: 'Preview revisado', validatedBy: 'Rennan' };
  const summary = buildOperationSummary(report);
  assert.equal(summary.contracted.package.id, 'production');
  assert.equal(summary.contracted.scope.filter((item) => item.selected).length, 5);
  assert.equal(summary.current.readyForContractedHandoff, false);
  assert.equal(summary.decisions.canMergeWorkspace, true);
  assert.equal(summary.decisions.canGoProduction, false);
  assert.match(summary.decisions.deliveryGuidance, /ainda não deve/i);
  assert.ok(summary.evolutionPaths.some((item) => item.id === 'frontend' && item.command === 'npm run dev:demo'));
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
    report[field] = { passed: true, evidence: 'ok' };
  }
  const summary = buildOperationSummary(report);
  assert.equal(summary.current.readyForContractedHandoff, true);
  assert.equal(summary.decisions.canGoProduction, true);
});

test('operation artifacts enrich the client manifest and generate a reusable pilot extension request', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-operation-artifacts-'));
  const delivery = path.join(root, 'CLIENT_DELIVERY');
  await fs.mkdir(delivery, { recursive: true });
  await writeJson(path.join(delivery, 'CLIENT_DELIVERY_MANIFEST.json'), { artifacts: {} });
  const report = productionReport(root);
  const artifacts = await writeOperationArtifacts(root, report);
  const manifest = JSON.parse(await fs.readFile(path.join(delivery, 'CLIENT_DELIVERY_MANIFEST.json'), 'utf8'));
  const extension = JSON.parse(await fs.readFile(artifacts.extensionJsonPath, 'utf8'));
  assert.equal(manifest.commercialScope.length, 5);
  assert.equal(manifest.packageVerification.readyForContractedHandoff, false);
  assert.equal(extension.productionBlockers.length, 3);
  assert.match(await fs.readFile(artifacts.operationPlanPath, 'utf8'), /Como evoluir o produto sem refazer a migração/);
});

test('operation control records evidence without regenerating the archive and marks the package dirty', async () => {
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
  const state = await service.saveValidation(root, { validationId: 'frontend', passed: true, evidence: 'Preview aprovado', validatedBy: 'Rennan' });
  assert.equal(state.result.frontendValidation.passed, true);
  assert.equal(state.result.packageState.dirty, true);
  assert.equal(writes.length, 2);
  assert.ok(writes.every((item) => item.options?.skipArchive === true));
});

test('renderer contains the post-operation decision panel and validation controls', async () => {
  const html = await fs.readFile(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const script = await fs.readFile(path.join(__dirname, '..', 'renderer', 'operation-decision-ui.js'), 'utf8');
  assert.match(html, /id="operationDecision"/);
  assert.match(html, /Escopo selecionado x homologado/);
  assert.match(html, /id="regeneratePackageDecision"/);
  assert.match(script, /migration\.saveValidation/);
  assert.match(script, /migration\.regeneratePackage/);
});
