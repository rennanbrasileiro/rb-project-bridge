'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { encryptJson, decryptJson } = require('../cloud/vault.cjs');
const { rootSnapshot } = require('../cloud/headless-runtime-validator.cjs');
const { normalizeGitLabBaseUrl, projectPath } = require('../electron/services/gitlab-service.cjs');

test('cloud vault encrypts and decrypts without plaintext token', () => {
  const key = crypto.randomBytes(32);
  const secret = { token: 'glpat-super-secret', refresh: 'refresh-secret' };
  const envelope = encryptJson(secret, key);
  assert.equal(envelope.includes(secret.token), false);
  assert.deepEqual(decryptJson(envelope, key), secret);
});

test('headless snapshot detects populated root', () => {
  assert.deepEqual(rootSnapshot('<html><body><div id="root"><main>Hello</main></div></body></html>'), { rootExists: true, rootHtmlLength: 18, rootTextLength: 5 });
  assert.equal(rootSnapshot('<div id="root"></div>').rootHtmlLength, 0);
});

test('gitlab helpers normalize base URL and namespace path', () => {
  assert.equal(normalizeGitLabBaseUrl('https://gitlab.com/anything'), 'https://gitlab.com');
  assert.equal(projectPath('rb-hub/apps', 'agile-hub'), 'rb-hub/apps/agile-hub');
});
