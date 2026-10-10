'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const {
  checkpointRank,
  canRetryPublish,
  recoveryFromReport,
  publishPlanFor,
  MigrationService,
} = require('../electron/services/migration-service.cjs');

test('only a prepared product is eligible for publish retry', () => {
  const base = { githubRepository: { fullName: 'rb/app' }, paths: { repositoryDir: '/tmp/job/repository' } };
  assert.equal(canRetryPublish({ ...base, checkpoint: 'converted' }, { code: 'PROCESS_FAILED' }), false);
  assert.equal(canRetryPublish({ ...base, checkpoint: 'ready-to-publish' }, { code: 'PROCESS_FAILED' }), true);
  assert.ok(checkpointRank('snapshot-published') > checkpointRank('ready-to-publish'));
});

test('recovery exposes preview and checkpoint without rerunning build', () => {
  const recovery = recoveryFromReport({
    checkpoint: 'snapshot-published',
    build: { status: 'passed', preview: { directory: '/tmp/job/preview' } },
    paths: { jobRoot: '/tmp/job', repositoryDir: '/tmp/job/repository' },
    githubRepository: { fullName: 'rb/app', htmlUrl: 'https://github.com/rb/app' },
    snapshot: { sha: 'abc' },
  }, true);
  assert.equal(recovery.canRetryPublish, true);
  assert.equal(recovery.previewDir, '/tmp/job/preview');
  assert.equal(recovery.snapshotPublished, true);
});

test('GitHub evolution is resumed through a review branch', () => {
  const report = {
    options: { deliveryMode: 'standalone-supabase' },
    sourceStatusBeforePublish: { status: 'github-newer' },
    githubRepository: { reused: true },
  };
  const plan = publishPlanFor(report, { default_branch: 'main' }, '2026-07-26T18-00-00');
  assert.equal(plan.strategy, 'pull-request');
  assert.equal(plan.base, 'main');
  assert.match(plan.branch, /^bridge\/base44-refresh-/);
});

test('renderer keeps preview available after partial delivery and opens GitHub once', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const loginHandler = renderer.match(/\$\('githubLogin'\)\.onclick = async \(\) => \{[\s\S]*?\n\};/)?.[0] || '';
  assert.doesNotMatch(loginHandler, /system\.openExternal/);
  assert.match(renderer, /applyRecovery/);
  assert.match(renderer, /previewDir/);
  assert.match(renderer, /retryableHistoryEntry/);
  assert.match(html, /id="resumeCard"/);
  assert.match(html, /id="resultTitle"/);
  assert.match(html, /Ver detalhes técnicos/);
});

async function retryFixture({ hasMain = false, historicallyPreserved = false, alreadyPushedMain = false } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rb-agilehub-empty-git-'));
  const repositoryDir = path.join(root, 'repository');
  const snapshotDir = path.join(root, 'base44-snapshot');
  await fsp.mkdir(repositoryDir);
  await fsp.mkdir(snapshotDir);
  const report = {
    jobId: 'agilehub-test',
    status: 'partial',
    checkpoint: 'repository-ready',
    startedAt: '2026-10-09T21:00:00.000Z',
    project: { id: '69c57c699087d62b03433bfd', name: 'Agile Hub' },
    options: { deliveryMode: 'standalone-supabase' },
    sourceStatusBeforePublish: { status: 'unlinked' },
    paths: { jobRoot: root, repositoryDir, snapshotDir },
    githubRepository: { fullName: 'rennanbrasileiro/agile-hub-sefaz', cloneUrl: 'https://github.com/rennanbrasileiro/agile-hub-sefaz.git', htmlUrl: 'https://github.com/rennanbrasileiro/agile-hub-sefaz', owner: { login: 'rennanbrasileiro' }, defaultBranch: 'main', reused: true },
    sourceManifest: { projectId: '69c57c699087d62b03433bfd', projectName: 'Agile Hub' },
    ...(historicallyPreserved ? { previousDefaultBranch: { sha: 'historicalsha' } } : {}),
    ...(alreadyPushedMain ? { github: { sha: 'originalmainsuccess', fullName: 'rennanbrasileiro/agile-hub-sefaz' } } : {}),
  };
  await fsp.writeFile(path.join(root, 'RB-BRIDGE-REPORT.json'), JSON.stringify(report));
  const pushes = [];
  const github = {
    ensureDirectoryScopes: async () => {},
    getBranchRef: async () => hasMain ? { object: { sha: 'newcommit' } } : null,
    publish: async ({ branch, force }) => {
      pushes.push({ branch, force });
      return { sha: branch === 'main' ? 'mainsha' : 'snapshotsha', fullName: 'rennanbrasileiro/agile-hub-sefaz' };
    },
  };
  const reports = { writeReport: async () => ({}), appendHistory: async () => {} };
  const service = new MigrationService({ github, reports, logger: {}, emit() {} });
  return { root, repositoryDir, snapshotDir, pushes, service };
}

test('legacy Agile Hub checkpoint publishes main then source snapshot for an empty GitHub repo', async () => {
  const fixture = await retryFixture();
  try {
    const result = await fixture.service.retryPublish(fixture.root);
    assert.equal(result.status, 'completed');
    assert.equal(result.githubRepository.initiallyEmpty, true);
    assert.deepEqual(fixture.pushes, [
      { branch: 'main', force: false },
      { branch: 'base44-source', force: false },
    ]);
    assert.equal(result.checkpoint, 'delivered');
  } finally { await fsp.rm(fixture.root, { recursive: true, force: true }); }
});

test('legacy checkpoint refuses to overwrite main created after the initial attempt', async () => {
  const fixture = await retryFixture({ hasMain: true });
  try {
    await assert.rejects(fixture.service.retryPublish(fixture.root), /branch principal recebeu commits/);
    assert.equal(fixture.pushes.length, 0);
  } finally { await fsp.rm(fixture.root, { recursive: true, force: true }); }
});

test('existing repository retains snapshot-first behavior and backups', async () => {
  const fixture = await retryFixture({ hasMain: true, historicallyPreserved: true });
  try {
    const result = await fixture.service.retryPublish(fixture.root);
    assert.equal(result.githubRepository.initiallyEmpty, false);
    assert.deepEqual(fixture.pushes, [
      { branch: 'base44-source', force: true },
      { branch: 'main', force: true },
    ]);
  } finally { await fsp.rm(fixture.root, { recursive: true, force: true }); }
});

test('retry after a successful first main push publishes only the missing snapshot', async () => {
  const fixture = await retryFixture({ alreadyPushedMain: true });
  try {
    const result = await fixture.service.retryPublish(fixture.root);
    assert.equal(result.githubRepository.initiallyEmpty, true);
    assert.deepEqual(fixture.pushes, [{ branch: 'base44-source', force: false }]);
  } finally { await fsp.rm(fixture.root, { recursive: true, force: true }); }
});
