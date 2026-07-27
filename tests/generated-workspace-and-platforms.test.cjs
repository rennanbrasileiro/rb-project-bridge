'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeJson } = require('../electron/core/fs-utils.cjs');
const {
  VERIFICATION_MIGRATION,
  verifierSource,
  enhanceWorkspace,
} = require('../electron/patches/functional-workspace-patch.cjs');
const { SourceAdapter, assertSourceAdapter } = require('../electron/sources/source-adapter.cjs');
const { PlatformCapabilityService } = require('../electron/services/platform-capability-service.cjs');

class TestAdapter extends SourceAdapter {
  constructor() { super({ id: 'test', label: 'Test Platform' }); }
  async status() { return { connected: true }; }
  async listProjects() { return []; }
  async exportProject() { return { ok: true }; }
  async analyzeCapabilities(project) { return this.normalizeManifest({ project, code: { available: true, method: 'test' } }); }
}

test('generated rb:verify script is valid executable module syntax', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-generated-verifier-'));
  const file = path.join(root, 'rb-verify-workspace.mjs');
  await fs.writeFile(file, verifierSource(), 'utf8');
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const source = await fs.readFile(file, 'utf8');
  assert.match(source, /import crypto from 'node:crypto'/);
  assert.match(source, /safeCleanup/);
  assert.doesNotMatch(source, /\.eq\('id', smokeId\)\.catch/);
});

test('functional workspace enhancement is idempotent and keeps one deterministic migration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-idempotent-workspace-'));
  const migrations = path.join(root, 'supabase', 'migrations');
  await fs.mkdir(migrations, { recursive: true });
  await fs.writeFile(path.join(migrations, '20260727000000_rb_functional_verification.sql'), '-- stale', 'utf8');
  await writeJson(path.join(root, 'package.json'), { name: 'pilot', scripts: { build: 'vite build', 'dev:demo': 'vite --mode demo' } });
  await enhanceWorkspace(root, {});
  await enhanceWorkspace(root, {});
  const files = (await fs.readdir(migrations)).filter((name) => /_rb_functional_verification\.sql$/.test(name));
  assert.deepEqual(files, [VERIFICATION_MIGRATION]);
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['rb:verify'], 'node scripts/rb-verify-workspace.mjs');
});

test('source adapter produces a normalized platform-neutral manifest', async () => {
  const adapter = assertSourceAdapter(new TestAdapter());
  const manifest = await adapter.analyzeCapabilities({ id: 'p1', name: 'Pilot' });
  assert.equal(manifest.source.id, 'test');
  assert.equal(manifest.project.name, 'Pilot');
  assert.equal(manifest.code.available, true);
  assert.equal(manifest.secrets.exportable, false);
});

test('platform matrix is honest about Lovable import and supports Emergent and Bolt continuation', () => {
  const service = new PlatformCapabilityService();
  const lovable = service.assess('lovable', 'round-trip');
  const emergent = service.assess('emergent', 'workspace');
  const bolt = service.assess('bolt', 'workspace');
  assert.equal(lovable.supported, false);
  assert.match(lovable.blockers.join(' '), /cannot import an arbitrary repository/i);
  assert.equal(emergent.platform.githubImport, 'supported');
  assert.equal(bolt.platform.githubImport, 'supported');
  assert.ok(service.get('base44').limitations.some((item) => /users/i.test(item)));
  assert.ok(service.get('github').roles.includes('canonical'));
});
