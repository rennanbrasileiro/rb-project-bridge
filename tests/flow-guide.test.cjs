'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
const guidedJs = fs.readFileSync(path.join(root, 'renderer/flow-guide.js'), 'utf8');
const guidedCss = fs.readFileSync(path.join(root, 'renderer/flow-guide.css'), 'utf8');

test('as cinco etapas e todos os controles operacionais continuam no HTML', () => {
  const ids = [
    'base44Login', 'githubLogin', 'base44AuthBox', 'githubAuthBox',
    'project', 'clientName', 'deliveryOwner', 'output', 'chooseOutput',
    'deliveryPackage', 'targetProfile', 'migrationScope', 'pipeline',
    'owner', 'repoChoice', 'repoName', 'repoSyncStatus', 'authorization',
    'start', 'cancel', 'retryLast', 'resumeCard', 'completedCard',
    'result', 'resultActions', 'log', 'openPreview', 'repairPreview',
    'openFolder', 'openDelivery', 'openRepo', 'stopPreview',
    'operationDecision', 'decisionScopeBody', 'decisionValidations',
    'decisionGuidance', 'decisionNextActions', 'decisionEvolution',
    'regeneratePackageDecision'
  ];
  for (const id of ids) {
    assert.match(html, new RegExp('id="' + id + '"'), 'Controle ausente: ' + id);
  }
  assert.equal((html.match(/class="card(?: execution-card)?"/g) || []).length, 5);
});

test('a camada guiada só inicia após os controladores existentes', () => {
  assert.match(html, /href="flow-guide\.css"/);
  assert.match(html, /src="flow-guide\.js"/);
  assert.ok(html.indexOf('src="flow-guide.js"') > html.indexOf('src="operation-decision-ui.js"'));
  assert.ok(html.indexOf('href="flow-guide.css"') > html.indexOf('href="operation-decision-ui.css"'));
});

test('a navegação adicional não substitui comandos de migração ou publicação', () => {
  new vm.Script(guidedJs, { filename: 'renderer/flow-guide.js' });
  assert.doesNotMatch(guidedJs, /window\.rbBridge|\.onclick\s*=|\.innerHTML\s*=/);
  assert.match(guidedJs, /document\.body\.classList\.add\('bridge-guided'\)/);
  assert.match(guidedJs, /document\.body\.classList\.toggle\('bridge-all'/);
  assert.match(guidedCss, /\.bridge-guided main>\.bridge-flow-section:not\(\.flow-active\)/);
});

test('sem estrutura esperada, a camada opcional não interfere no aplicativo', () => {
  assert.doesNotThrow(() => vm.runInNewContext(guidedJs, {
    document: { querySelector: () => null },
  }));
});
