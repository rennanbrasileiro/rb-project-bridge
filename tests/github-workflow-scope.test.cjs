'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const servicePath = path.join(__dirname, '..', 'electron', 'services', 'github-service.cjs');
const {
  parseGitHubScopes,
  missingGitHubScopes,
  isWorkflowScopeError,
  DELIVERY_SCOPES,
  AUTH_CACHE_TTL_MS,
} = require(servicePath);

test('delivery scopes include workflow and are cached', () => {
  assert.ok(DELIVERY_SCOPES.includes('workflow'));
  assert.ok(AUTH_CACHE_TTL_MS >= 30_000);
});

test('parses GitHub CLI scopes from stderr-style and header-style output', () => {
  assert.deepEqual(parseGitHubScopes("Token scopes: 'gist', 'read:org', 'repo', 'workflow'"), ['gist', 'read:org', 'repo', 'workflow']);
  assert.deepEqual(parseGitHubScopes('x-oauth-scopes: repo, workflow'), ['repo', 'workflow']);
});

test('reports only missing capabilities', () => {
  assert.deepEqual(missingGitHubScopes(['repo', 'workflow'], ['repo', 'workflow']), []);
  assert.deepEqual(missingGitHubScopes(['repo'], ['repo', 'workflow']), ['workflow']);
});

test('recognizes OAuth workflow rejection', () => {
  assert.equal(isWorkflowScopeError({ details: { stderr: 'refusing to allow an OAuth App to create or update workflow without workflow scope' } }), true);
});

test('service silences background API output and avoids duplicate auth', () => {
  const source = fs.readFileSync(servicePath, 'utf8');
  assert.match(source, /runGhQuiet/);
  assert.match(source, /authStatusPromise/);
  assert.match(source, /if \(current\.authenticated\) return this\.getAccounts/);
  assert.match(source, /ensureDirectoryScopes/);
});
