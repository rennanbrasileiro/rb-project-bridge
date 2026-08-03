'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scopesForServices } = require('../electron/services/google-account-service.cjs');
const { validateNotebookConfiguration } = require('../electron/services/google-ai-service.cjs');

test('Google scopes are deduplicated and always include profile', () => {
  const scopes = scopesForServices(['gmail', 'gmail', 'drive']);
  assert.equal(new Set(scopes).size, scopes.length);
  assert.ok(scopes.includes('openid'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.modify'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/drive'));
});

test('Notebook configuration accepts supported multiregions', () => {
  assert.deepEqual(validateNotebookConfiguration({ notebookProjectNumber: '123456789012', notebookLocation: 'global' }), {
    projectNumber: '123456789012',
    location: 'global',
  });
});

test('Notebook configuration rejects project ids instead of project numbers', () => {
  assert.throws(() => validateNotebookConfiguration({ notebookProjectNumber: 'rb-hub-project', notebookLocation: 'global' }));
});
