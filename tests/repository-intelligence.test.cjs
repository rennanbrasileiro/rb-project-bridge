const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('repository selector recognizes FitHub Personal Trainer as fithub', () => {
  const source = fs.readFileSync(require.resolve('../renderer/app.js'), 'utf8');
  assert.match(source, /compactProject\.includes\(compactCandidate\)/);
  assert.match(source, /choice\.value = best\.name/);
});

test('export removes temporary tar and resets destination between attempts', () => {
  const source = fs.readFileSync(require.resolve('../electron/services/base44-service.cjs'), 'utf8');
  assert.match(source, /for \(let attempt = 1; attempt <= totalAttempts; attempt \+= 1\) \{\s+await ensureEmptyDir\(destination\)/);
  assert.match(source, /await fsp\.rm\(archivePath, \{ force: true \}\);\s+const entries/);
});

test('evolved repositories are delivered through a pull request', () => {
  const source = fs.readFileSync(require.resolve('../electron/services/migration-service.cjs'), 'utf8');
  assert.match(source, /repositoryEvolved/);
  assert.match(source, /strategy: 'pull-request'/);
  assert.match(source, /publishPlanFor/);
  assert.match(source, /createPullRequest/);
});
