'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { GitHubService } = require('../electron/services/github-service.cjs');
const {
  reviewRetryBranchName,
  isBridgeReviewBranch,
  availableReviewBranch,
} = require('../electron/patches/review-history-patch.cjs');

function service() {
  return new GitHubService({
    toolchain: {},
    logger: { info() {}, warn() {}, error() {} },
    emit() {},
    sessionDir: '/tmp/rb-project-bridge-review-test',
    openExternal: async () => {},
  });
}

test('review retry branch names are deterministic and preserve the original branch', () => {
  const value = reviewRetryBranchName(
    'bridge/base44-refresh-2026-07-26T23-41-45-346Z',
    new Date('2026-07-27T01:02:03.456Z'),
  );
  assert.equal(value, 'bridge/base44-refresh-2026-07-26T23-41-45-346Z-retry-20260727010203456');
});

test('only Bridge review branches receive base-history handling', () => {
  const repository = { default_branch: 'main' };
  assert.equal(isBridgeReviewBranch('bridge/base44-refresh-2026-07-26', repository), true);
  assert.equal(isBridgeReviewBranch('base44-source', repository), false);
  assert.equal(isBridgeReviewBranch('main', repository), false);
});

test('an existing failed review branch is preserved and replaced by a free successor', async () => {
  const github = service();
  const seen = new Set(['bridge/base44-refresh-old']);
  github.getBranchRef = async (_repository, branch) => (seen.has(branch) ? { object: { sha: 'abc' } } : null);
  const result = await availableReviewBranch(
    github,
    { full_name: 'rb/app', default_branch: 'main' },
    'bridge/base44-refresh-old',
  );
  assert.equal(result.replaced, 'bridge/base44-refresh-old');
  assert.match(result.branch, /^bridge\/base44-refresh-old-retry-\d{17}$/);
});

test('publishing a review branch fetches and resets to main before committing', async () => {
  const github = service();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-review-history-'));
  await fs.writeFile(path.join(root, 'README.md'), '# converted');
  const calls = [];
  github.ensureDirectoryScopes = async () => {};
  github.getAuthenticationToken = async () => 'token';
  github.createAskPass = async () => '/tmp/askpass';
  github.getBranchRef = async () => null;
  github.runGit = async (args) => {
    calls.push(args);
    return args[0] === 'rev-parse' ? { stdout: 'abcdef1234567890\n' } : { stdout: '' };
  };

  const result = await github.publish({
    directory: root,
    repository: {
      full_name: 'rb/app',
      clone_url: 'https://github.com/rb/app.git',
      html_url: 'https://github.com/rb/app',
      default_branch: 'main',
      owner: { login: 'rb' },
    },
    branch: 'bridge/base44-refresh-test',
    commitMessage: 'converted',
  });

  const commands = calls.map((args) => args.join(' '));
  assert.ok(commands.indexOf('remote add origin https://github.com/rb/app.git') < commands.indexOf('fetch --depth 1 origin main'));
  assert.ok(commands.indexOf('fetch --depth 1 origin main') < commands.indexOf('reset --mixed FETCH_HEAD'));
  assert.ok(commands.indexOf('reset --mixed FETCH_HEAD') < commands.indexOf('add --all'));
  assert.equal(result.baseBranch, 'main');
  assert.equal(result.branch, 'bridge/base44-refresh-test');
  await fs.rm(root, { recursive: true, force: true });
});

test('pull request creation uses the actual retry branch selected during publish', async () => {
  const github = service();
  const calls = [];
  github.runGhQuiet = async (args) => {
    calls.push(args);
    return { stdout: JSON.stringify({ number: 8, html_url: 'https://github.com/rb/app/pull/8' }) };
  };
  github.__rbReviewBranchAliases = new Map([
    ['bridge/base44-refresh-old', 'bridge/base44-refresh-old-retry-20260727010203456'],
  ]);

  const result = await github.createPullRequest(
    { full_name: 'rb/app' },
    { head: 'bridge/base44-refresh-old', base: 'main', title: 'Review', body: '' },
  );

  assert.equal(result.head, 'bridge/base44-refresh-old-retry-20260727010203456');
  assert.ok(calls[0].includes('head=bridge/base44-refresh-old-retry-20260727010203456'));
});
