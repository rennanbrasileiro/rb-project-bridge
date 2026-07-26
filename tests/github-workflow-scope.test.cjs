"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const servicePath = path.join(__dirname, '..', 'electron', 'services', 'github-service.cjs');
const { parseGitHubScopes, isWorkflowScopeError, DELIVERY_SCOPES } = require(servicePath);

test('delivery scopes include workflow', () => { assert.ok(DELIVERY_SCOPES.includes('workflow')); });
test('parses GitHub CLI token scopes', () => { assert.deepEqual(parseGitHubScopes("Token scopes: 'gist', 'read:org', 'repo', 'workflow'"), ['gist','read:org','repo','workflow']); });
test('recognizes OAuth workflow rejection', () => { assert.equal(isWorkflowScopeError({ details: { stderr: 'refusing to allow an OAuth App to create or update workflow without workflow scope' } }), true); });
test('publish preflights workflow scope and renderer supports retry', () => {
  const service = fs.readFileSync(servicePath, 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(service, /ensureDeliveryScopes/);
  assert.match(service, /workflowFiles\.some/);
  assert.match(renderer, /retryPublish/);
  assert.match(html, /id="retryLast"/);
});
