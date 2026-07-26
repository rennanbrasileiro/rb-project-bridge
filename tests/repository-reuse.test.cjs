'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GitHubService, backupBranchName } = require('../electron/services/github-service.cjs');

function service() {
  return new GitHubService({
    toolchain: {},
    logger: { info() {}, warn() {}, error() {} },
    emit() {},
    sessionDir: '/tmp/rb-project-bridge-test',
    openExternal: async () => {},
  });
}

test('34 creates deterministic dated backup branch names', () => {
  const name = backupBranchName('main-before-standalone', 'abcdef1234567890', new Date('2026-07-26T12:34:56.789Z'));
  assert.equal(name, 'main-before-standalone-20260726123456789-abcdef1');
});

test('35 reuses and privatizes an existing repository instead of creating another', async () => {
  const github = service();
  const repository = { full_name: 'rennanbrasileiro/fithub', private: true, default_branch: 'main' };
  github.repositoryExists = async () => true;
  github.ensurePrivate = async () => repository;
  github.createRepository = async () => { throw new Error('createRepository must not be called'); };
  const result = await github.resolveRepository({ owner: 'rennanbrasileiro', name: 'fithub', ownerType: 'user' });
  assert.equal(result.reused, true);
  assert.equal(result.repository, repository);
});

test('36 preserves a branch by creating a new ref without deleting or moving the source', async () => {
  const github = service();
  const calls = [];
  github.getBranchRef = async () => ({ object: { sha: '1234567890abcdef' } });
  github.runGh = async (args) => { calls.push(args); return { stdout: '{}' }; };
  const result = await github.preserveBranch(
    { full_name: 'rennanbrasileiro/fithub' },
    'main',
    { prefix: 'main-before-standalone', now: new Date('2026-07-26T12:34:56.789Z') },
  );
  assert.equal(result.sourceBranch, 'main');
  assert.equal(result.sha, '1234567890abcdef');
  assert.equal(result.backupBranch, 'main-before-standalone-20260726123456789-1234567');
  assert.deepEqual(calls[0], [
    'api', '-X', 'POST', 'repos/rennanbrasileiro/fithub/git/refs',
    '-f', 'ref=refs/heads/main-before-standalone-20260726123456789-1234567',
    '-f', 'sha=1234567890abcdef',
  ]);
});
