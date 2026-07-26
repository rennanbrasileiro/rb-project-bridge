'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { extractRuntimeUsages, classifyRuntimeUsage, patchGeneratedAdapterSource, applyRuntimeCompatibility } = require('../electron/services/runtime-compatibility-service.cjs');

const adapterFixture = `const demoMode = true;
const supabase = null;
const DEMO_USER = { id: 'demo', email: 'demo@example.com' };
function now() { return new Date().toISOString(); }
function decorate(value) { return value; }
function tableFor(value) { return value; }
function invokeIntegration() { return Promise.resolve({}); }
const entities = new Proxy({}, { get: () => ({ list: async () => [], filter: async () => [], create: async (data) => data }) });
const auth = {};
const Core = {};
export { supabase, demoMode };
export const base44 = { entities, auth, functions: { invoke() {} }, integrations: { Core }, asServiceRole: { entities, integrations: { Core } } };
`;

test('extracts and classifies expanded Base44 runtime contracts', () => {
  const source = `
    base44.entities.Message.subscribe(() => {});
    base44.auth.isAuthenticated();
    base44.users.inviteUser('a@example.com', 'admin');
    base44.appLogs.logUserInApp('Dashboard');
    base44.analytics.track({ eventName: 'open' });
    base44.functions.invoke('hello');
    base44.integrations.Core.UploadFile({});
    base44.agents.run({});
    fetch('/api/functions/stripe/createCheckout', { method: 'POST' });
  `;
  const usages = extractRuntimeUsages(source, 'src/example.jsx').map(classifyRuntimeUsage);
  assert.equal(usages.find((item) => item.kind === 'entity')?.support, 'converted');
  assert.equal(usages.find((item) => item.kind === 'auth')?.support, 'converted');
  assert.equal(usages.find((item) => item.kind === 'users')?.support, 'bridged');
  assert.equal(usages.find((item) => item.kind === 'app-logs')?.support, 'emulated');
  assert.equal(usages.find((item) => item.kind === 'analytics')?.support, 'emulated');
  assert.equal(usages.find((item) => item.kind === 'functions')?.support, 'bridged');
  assert.equal(usages.find((item) => item.kind === 'integration')?.support, 'bridged');
  assert.equal(usages.find((item) => item.kind === 'agents')?.support, 'unsupported');
  assert.equal(usages.find((item) => item.kind === 'function-route')?.support, 'bridged');
});

test('keeps unsafe service-role connector access blocked', () => {
  const usages = extractRuntimeUsages(`base44.asServiceRole.connectors.getAccessToken('x')`, 'src/server.ts').map(classifyRuntimeUsage);
  assert.equal(usages[0]?.support, 'unsupported');
});

test('patches generated adapter with auth, users, functions and observability compatibility', () => {
  const result = patchGeneratedAdapterSource(adapterFixture);
  assert.equal(result.patched, true);
  assert.match(result.source, /RB_RUNTIME_COMPAT_V3/);
  assert.match(result.source, /const rbCompatibleEntities = new Proxy/);
  assert.match(result.source, /async isAuthenticated/);
  assert.match(result.source, /const rbUsers = \{ inviteUser: rbInviteUser \}/);
  assert.match(result.source, /const rbAnalytics/);
  assert.match(result.source, /__RB_FUNCTION_FETCH_BRIDGE__/);
  assert.match(result.source, /export const base44 = rbRuntimeBase44/);
  const second = patchGeneratedAdapterSource(result.source);
  assert.equal(second.patched, false);
});

test('prepares FitHub contracts, local workspace and secure invitation function', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-runtime-'));
  await fs.mkdir(path.join(root, 'src', 'api'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'pages'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'api', 'base44Client.js'), adapterFixture);
  await fs.writeFile(path.join(root, 'src', 'pages', 'Pricing.jsx'), `import { base44 } from '../api/base44Client';\nbase44.auth.isAuthenticated();\nfetch('/api/functions/stripe/createCheckout');\n`);
  await fs.writeFile(path.join(root, 'src', 'pages', 'SystemSettings.jsx'), `import { base44 } from '../api/base44Client';\nbase44.users.inviteUser('a@example.com', 'admin');\n`);
  await fs.writeFile(path.join(root, 'src', 'main.jsx'), `if ('serviceWorker' in navigator && !import.meta.env.DEV) navigator.serviceWorker.register('/sw.js');\n`);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sample', scripts: {}, dependencies: {} }, null, 2));

  const result = await applyRuntimeCompatibility(root);
  assert.equal(result.unsupported.length, 0);
  assert.equal(result.workspace.prepared, true);
  assert.ok(result.converted.some((item) => item.method === 'isAuthenticated'));
  assert.ok(result.bridged.some((item) => item.method === 'inviteUser'));
  assert.ok(result.bridged.some((item) => item.kind === 'function-route'));
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['workspace:dev'], 'node scripts/prepare-local-workspace.mjs && vite');
  assert.ok(await fs.stat(path.join(root, 'DEVELOPMENT_WORKSPACE.md')));
  assert.ok(await fs.stat(path.join(root, 'RB-RUNTIME-CONTRACTS.json')));
  const inviteSource = await fs.readFile(path.join(root, 'supabase', 'functions', 'rb-invite-user', 'index.ts'), 'utf8');
  assert.match(inviteSource, /inviteUserByEmail/);
  assert.match(inviteSource, /Admin role required/);
  assert.match(await fs.readFile(path.join(root, 'src', 'api', 'base44Client.js'), 'utf8'), /rbInviteUser/);
  assert.match(await fs.readFile(path.join(root, 'src', 'main.jsx'), 'utf8'), /VITE_RB_DEMO_MODE/);
  await fs.rm(root, { recursive: true, force: true });
});
