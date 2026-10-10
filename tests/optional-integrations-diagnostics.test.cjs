'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const index = read('renderer/index.html');
const google = read('renderer/google-workspace.js');
const googleStyles = read('renderer/google-workspace.css');
const diagnostics = read('renderer/diagnostics-ui.js');
const logger = read('electron/core/logger.cjs');
const main = read('electron/main.cjs');
const reports = read('electron/services/report-service.cjs');

test('Google is optional, appears outside the five migration steps and is collapsed', () => {
  assert.doesNotThrow(() => new vm.Script(google, { filename: 'renderer/google-workspace.js' }));
  assert.match(google, /section\.className = 'card google-optional-card'/);
  assert.match(google, /disclosure\.id = 'googleIntegrationDetails'/);
  assert.match(google, /document\.createElement\('details'\)/);
  assert.match(google, /document\.querySelector\('main'\)\?\.appendChild\(section\)/);
  assert.match(google, /NÃO são necessários para extrair produtos da Base44/);
  assert.doesNotMatch(google, /Repita o processo para a conta pessoal/);
  assert.match(googleStyles, /google-integration-details/);
  assert.match(google, /state\.accounts = status\.accounts \|\| \[\]/);
  for (const id of ['googleClientId','googleClientSecret','saveGoogleOauth','connectGoogleAccount',
    'googleAccountLabel','googleAccounts','geminiApiKey','geminiModel','testGemini',
    'notebookProjectNumber','notebookLocation','notebookAccount','listNotebooks']) {
    assert.match(google, new RegExp('id="' + id + '"'), 'Control missing: ' + id);
  }
});

test('Diagnostics are read-only and do not replace any migration handlers', () => {
  assert.doesNotThrow(() => new vm.Script(diagnostics, { filename: 'renderer/diagnostics-ui.js' }));
  assert.match(index, /src="diagnostics-ui\.js"/);
  assert.match(index, /href="diagnostics-ui\.css"/);
  assert.ok(index.indexOf('src="diagnostics-ui.js"') > index.indexOf('src="flow-guide.js"'));
  assert.doesNotMatch(diagnostics, /\.migration\.(?:start|retryPublish|cancel|clearHistory|saveValidation|regeneratePackage)\(/);
  assert.doesNotMatch(diagnostics, /\.on(?:click|change)\s*=/);
  assert.match(diagnostics, /window\.rbBridge\.migration\.history\(\)/);
  assert.match(diagnostics, /window\.rbBridge\.system\.status\(\)/);
  assert.match(diagnostics, /window\.rbBridge\.system\.openPath/);
  assert.match(diagnostics, /navigator\.clipboard\.writeText/);
  assert.match(diagnostics, /function dateLabel/);
  assert.match(diagnostics, /redact\(logOutput\.textContent\)/);
});

test('Existing disk log and history implementations are not bypassed', () => {
  assert.match(logger, /fs\.appendFileSync\(this\.filePath/);
  assert.match(main, /'migration:history'/);
  assert.match(reports, /async getHistory\(\)/);
  assert.match(reports, /history\.slice\(0, 200\)/);
  assert.match(index, /<pre id="log">/);
});
