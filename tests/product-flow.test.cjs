'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  checkpointRank,
  canRetryPublish,
  recoveryFromReport,
  publishPlanFor,
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
