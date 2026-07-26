'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  extractRuntimeUsages,
  classifyRuntimeUsage,
  patchGeneratedAdapterSource,
  applyRuntimeCompatibility,
} = require('../electron/services/runtime-compatibility-service.cjs');

const adapterFixture = `const demoMode = true;
const supabase = null;
const DEMO_USER = { id: 'demo' };
function now() { return new Date().toISOString(); }
function decorate(value) { return value; }
function tableFor(value) { return value; }
const entities = new Proxy({}, { get: () => ({}) });
const auth = {};
const Core = {};
export { supabase, demoMode };
export const base44 = { entities, auth, functions: { invoke() {} }, integrations: { Core }, asServiceRole: { entities, integrations: { Core } } };
`;

test('extracts and classifies Base44 runtime contracts', () => {
  const source = `
    base44.entities.Message.subscribe(() => {});
    base44.auth.me();
    base44.appLogs.logUserInApp('Dashboard');
    base44.functions.invoke('hello');
    base44.integrations.Core.UploadFile({});
    base44.analytics.track('x');
  `;
  const usages = extractRuntimeUsages(source, 'src/example.jsx').map(classifyRuntimeUsage);
  assert.equal(usages.find((item) => item.kind === 'entity')?.support, 'converted');
  assert.equal(usages.find((item) => item.kind === 'auth')?.support, 'converted');
  assert.equal(usages.find((item) => item.kind === 'app-logs')?.support, 'emulated');
  assert.equal(usages.find((item) => item.kind === 'functions')?.support, 'bridged');
  assert.equal(usages.find((item) => item.kind === 'integration')?.support, 'bridged');
  assert.equal(usages.find((item) => item.namespace === 'analytics')?.support, 'unsupported');
});

test('patches generated adapter with realtime and app logs compatibility', () => {
  const result = patchGeneratedAdapterSource(adapterFixture);
  assert.equal(result.patched, true);
  assert.match(result.source, /const compatibleEntities = new Proxy/);
  assert.match(result.source, /const appLogs = \{/);
  assert.match(result.source, /logUserInApp/);
  assert.match(result.source, /entities: compatibleEntities, auth, appLogs/);
  const second = patchGeneratedAdapterSource(result.source);
  assert.equal(second.patched, false);
});

test('prepares an evolvable local workspace and runtime inventory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-runtime-'));
  await fs.mkdir(path.join(root, 'src', 'api'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'lib'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'api', 'base44Client.js'), adapterFixture);
  await fs.writeFile(path.join(root, 'src', 'lib', 'NavigationTracker.jsx'), `import { base44 } from '../api/base44Client';\nbase44.appLogs.logUserInApp('Dashboard');\n`);
  await fs.writeFile(path.join(root, 'src', 'main.jsx'), `if ('serviceWorker' in navigator && !import.meta.env.DEV) navigator.serviceWorker.register('/sw.js');\n`);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sample', scripts: {}, dependencies: {} }, null, 2));

  const result = await applyRuntimeCompatibility(root);
  assert.equal(result.unsupported.length, 0);
  assert.equal(result.emulated.length, 1);
  assert.equal(result.workspace.prepared, true);
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['workspace:dev'], 'node scripts/prepare-local-workspace.mjs && vite');
  assert.ok(await fs.stat(path.join(root, 'DEVELOPMENT_WORKSPACE.md')));
  assert.ok(await fs.stat(path.join(root, 'RB-RUNTIME-CONTRACTS.json')));
  assert.match(await fs.readFile(path.join(root, 'src', 'api', 'base44Client.js'), 'utf8'), /logUserInApp/);
  assert.match(await fs.readFile(path.join(root, 'src', 'main.jsx'), 'utf8'), /VITE_RB_DEMO_MODE/);
  await fs.rm(root, { recursive: true, force: true });
});
