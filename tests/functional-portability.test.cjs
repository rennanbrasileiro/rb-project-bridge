'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeJson, readJson } = require('../electron/core/fs-utils.cjs');
const {
  appendVerification,
  latestVerification,
  publicationBlockers,
  canPublishCurrentEvidence,
} = require('../electron/services/verification-ledger-service.cjs');
const { assertCurrentVerification } = require('../electron/patches/verification-integrity-patch.cjs');
const { OperationControlService } = require('../electron/services/operation-control-service.cjs');
const { buildOperationSummary } = require('../electron/services/operation-summary-service.cjs');
const { verificationMigrationSql, verifierSource, enhanceWorkspace } = require('../electron/patches/functional-workspace-patch.cjs');

function baseReport(root) {
  return {
    jobId: 'fit-hub-regression',
    status: 'completed',
    checkpoint: 'snapshot-published',
    project: { id: 'fit-1', name: 'FitHub' },
    options: {
      deliveryMode: 'standalone-supabase',
      deliveryPackage: 'production',
      targetProfile: 'supabase-self-hosted',
      clientName: 'RB HUB',
      deliveryOwner: 'Rennan',
      migrationScope: { data: true, users: true, storage: true, integrations: true, deployment: true },
    },
    paths: { jobRoot: root, repositoryDir: path.join(root, 'repository'), previewDir: path.join(root, 'preview') },
    githubRepository: { fullName: 'rennan/fithub', htmlUrl: 'https://github.com/rennan/fithub' },
    pullRequest: { url: 'https://github.com/rennan/fithub/pull/6' },
    build: { status: 'passed', runtime: { passed: true }, compatibility: { converted: [], bridged: [], emulated: [], unsupported: [], workspace: { prepared: true } } },
    standaloneGateAfterBuild: { passed: true },
    security: { blocking: [] },
    backup: { sha256: 'abc' },
    readiness: { score: 85, level: 'workspace-prepared', label: 'Workspace evolutivo preparado', recommendedPackage: 'Workspace', contractedPackagePassed: false, nextActions: [], productionBlockers: [] },
    clientDelivery: { acceptance: { acceptedByAutomation: false, checks: [] } },
  };
}

test('latest failed runtime evidence invalidates an older pass', () => {
  const report = baseReport('/tmp/fithub');
  appendVerification(report, { gate: 'build', status: 'passed', finishedAt: '2026-07-27T01:00:00Z' });
  appendVerification(report, { gate: 'runtime', status: 'passed', finishedAt: '2026-07-27T01:00:01Z' });
  appendVerification(report, { gate: 'standalone', status: 'passed', finishedAt: '2026-07-27T01:00:02Z' });
  appendVerification(report, { gate: 'security', status: 'passed', finishedAt: '2026-07-27T01:00:03Z' });
  appendVerification(report, { gate: 'runtime', status: 'failed', source: 'preview-repair', finishedAt: '2026-07-27T02:00:00Z', errors: ['#root vazio'] });
  assert.equal(latestVerification(report, 'runtime').status, 'failed');
  assert.equal(canPublishCurrentEvidence(report), false);
  assert.match(publicationBlockers(report).join(' '), /Runtime atual: failed/);
});

test('retry publication is blocked after the FitHub-style later runtime failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-fithub-integrity-'));
  const report = baseReport(root);
  appendVerification(report, { gate: 'build', status: 'passed' });
  appendVerification(report, { gate: 'standalone', status: 'passed' });
  appendVerification(report, { gate: 'security', status: 'passed' });
  appendVerification(report, { gate: 'runtime', status: 'passed' });
  appendVerification(report, { gate: 'runtime', status: 'failed', source: 'preview-repair', errors: ['A aplicação não montou conteúdo no #root.'] });
  await writeJson(path.join(root, 'RB-BRIDGE-REPORT.json'), report);
  await assert.rejects(() => assertCurrentVerification(root), (error) => error.code === 'CURRENT_VERIFICATION_FAILED' && error.details.blockers.some((item) => item.includes('Runtime')));
});

test('rejected validation creates a defect and a later pass resolves it by retest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-rejection-loop-'));
  const repositoryDir = path.join(root, 'repository');
  await fs.mkdir(repositoryDir, { recursive: true });
  const report = baseReport(root);
  await writeJson(path.join(root, 'RB-BRIDGE-REPORT.json'), report);
  const reports = {
    async writeReport(directory, nextReport) { await fs.mkdir(directory, { recursive: true }); await writeJson(path.join(directory, 'RB-BRIDGE-REPORT.json'), nextReport); return {}; },
  };
  const service = new OperationControlService({ reports, logger: { info() {} } });
  let state = await service.saveValidation(root, {
    validationId: 'users', status: 'failed', expected: 'Usuário entra com e-mail e senha.', observed: 'Login não cria sessão.', severity: 'critical', evidence: 'teste local', validatedBy: 'Rennan',
  });
  assert.equal(state.result.userMigrationValidation.status, 'failed');
  assert.equal(state.openDefects.length, 1);
  assert.equal(state.openDefects[0].severity, 'critical');
  state = await service.saveValidation(root, { validationId: 'users', status: 'passed', evidence: 'Reteste com sessão real', validatedBy: 'Rennan' });
  assert.equal(state.result.userMigrationValidation.status, 'passed');
  assert.equal(state.openDefects.length, 0);
  assert.equal(state.result.defects[0].status, 'resolved');
  assert.equal(state.result.defects[0].retests.at(-1).status, 'passed');
});

test('operation summary blocks merge when current runtime evidence failed', () => {
  const report = baseReport('/tmp/fithub');
  report.frontendValidation = { status: 'passed', passed: true };
  for (const gate of ['build', 'standalone', 'security', 'runtime']) appendVerification(report, { gate, status: 'passed' });
  appendVerification(report, { gate: 'runtime', status: 'failed', errors: ['#root vazio'] });
  const summary = buildOperationSummary(report);
  assert.equal(summary.decisions.canMergeWorkspace, false);
  assert.match(summary.decisions.mergeGuidance, /Não mescle/);
  assert.match(summary.current.packageGap, /evidência técnica mais recente/i);
});

test('functional workspace adds profile trigger smoke RLS and rb:verify command', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-functional-workspace-'));
  await fs.mkdir(path.join(root, 'supabase', 'migrations'), { recursive: true });
  await writeJson(path.join(root, 'package.json'), { name: 'pilot', scripts: { build: 'vite build', 'dev:demo': 'vite --mode demo' } });
  const report = await enhanceWorkspace(root, { entities: [{ name: 'User', table: 'profiles' }] });
  const packageJson = await readJson(path.join(root, 'package.json'));
  const migrations = await fs.readdir(path.join(root, 'supabase', 'migrations'));
  const migration = await fs.readFile(path.join(root, 'supabase', 'migrations', migrations[0]), 'utf8');
  const verifier = await fs.readFile(path.join(root, 'scripts', 'rb-verify-workspace.mjs'), 'utf8');
  assert.equal(packageJson.scripts['rb:verify'], 'node scripts/rb-verify-workspace.mjs');
  assert.match(migration, /handle_new_user_profile/);
  assert.match(migration, /rb_bridge_smoke/);
  assert.match(migration, /created_by_id = auth\.uid\(\)/);
  assert.match(verifier, /signInWithPassword/);
  assert.match(verifier, /rls-other-user/);
  assert.equal(report.functionalVerification.prepared, true);
});

test('generated verifier never persists local service role credentials', () => {
  const source = verifierSource();
  assert.match(source, /SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /fs\.writeFileSync\([^\n]+serviceKey/);
  assert.match(verificationMigrationSql(), /security definer/);
});
