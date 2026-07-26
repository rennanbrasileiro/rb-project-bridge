'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  COMPATIBILITY_MARKER,
  extractEntityMethodUsages,
  patchGeneratedAdapterSource,
  patchDemoServiceWorkerSource,
  applyRuntimeCompatibility,
} = require('../electron/services/runtime-compatibility-service.cjs');
const { injectDiagnostics, isBlockingConsoleMessage } = require('../electron/services/preview-service.cjs');

function generatedAdapter() {
  return `const demoMode = true;
const supabase = null;
function tableFor(entity) { return entity.toLowerCase(); }
function decorate(row) { return row; }
const entities = new Proxy({}, { get: () => ({ list: async () => [] }) });
const auth = {};
const Core = {};
export { supabase, demoMode };
export const base44 = { entities, auth, functions: { invoke: () => null }, integrations: { Core }, asServiceRole: { entities, integrations: { Core } } };
`;
}

test('runtime compatibility discovers entity method usage', () => {
  const usages = extractEntityMethodUsages('base44.entities.Message.subscribe(cb); base44.entities.Student.list();', 'Dashboard.jsx');
  assert.deepEqual(usages.map(({ entity, method }) => ({ entity, method })), [
    { entity: 'Message', method: 'subscribe' },
    { entity: 'Student', method: 'list' },
  ]);
});

test('generated adapter receives realtime subscribe compatibility', () => {
  const result = patchGeneratedAdapterSource(generatedAdapter());
  assert.equal(result.patched, true);
  assert.match(result.source, new RegExp(COMPATIBILITY_MARKER));
  assert.match(result.source, /rbSubscribeToEntity/);
  assert.match(result.source, /entities: rbCompatibleEntities/);
  assert.equal(patchGeneratedAdapterSource(result.source).patched, false);
});

test('demo build disables production service worker registration', () => {
  const source = "if ('serviceWorker' in navigator && !import.meta.env.DEV) {} else if ('serviceWorker' in navigator && import.meta.env.DEV) {}";
  const result = patchDemoServiceWorkerSource(source);
  assert.match(result, /VITE_RB_DEMO_MODE !== 'true'/);
  assert.match(result, /import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_RB_DEMO_MODE === 'true'/);
});

test('runtime compatibility patches a project and blocks unknown entity methods', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-runtime-'));
  await fs.mkdir(path.join(root, 'src', 'api'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'api', 'base44Client.js'), generatedAdapter());
  await fs.writeFile(path.join(root, 'src', 'main.jsx'), "if ('serviceWorker' in navigator && !import.meta.env.DEV) {} else if ('serviceWorker' in navigator && import.meta.env.DEV) {}");
  await fs.writeFile(path.join(root, 'src', 'Dashboard.jsx'), 'base44.entities.Message.subscribe(() => {});');
  const result = await applyRuntimeCompatibility(root);
  assert.equal(result.adapterPatched, true);
  assert.equal(result.serviceWorkerPatched, true);
  assert.equal(result.unsupported.length, 0);
  assert.match(await fs.readFile(path.join(root, 'src', 'api', 'base44Client.js'), 'utf8'), /rbSubscribeToEntity/);
  await fs.writeFile(path.join(root, 'src', 'Unknown.jsx'), 'base44.entities.Student.exportCsv();');
  await assert.rejects(() => applyRuntimeCompatibility(root), (error) => error.code === 'UNSUPPORTED_BASE44_RUNTIME_METHOD');
  await fs.rm(root, { recursive: true, force: true });
});

test('preview injects visible diagnostics instead of leaving a white page', () => {
  const html = injectDiagnostics('<html><head></head><body><div id="root"></div></body></html>');
  assert.match(html, /data-rb-preview-diagnostics/);
  assert.match(html, /O preview encontrou um erro de execução/);
  assert.equal(injectDiagnostics(html), html);
  assert.equal(isBlockingConsoleMessage('TypeError: x.subscribe is not a function'), true);
  assert.equal(isBlockingConsoleMessage('Failed to load favicon.ico'), false);
});
