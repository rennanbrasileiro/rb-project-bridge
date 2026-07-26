'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildDeliveryManifest, writeClientDeliveryPackage, TARGET_PROFILES } = require('../electron/services/delivery-package-service.cjs');
const { createClientArchive } = require('../electron/services/client-archive-service.cjs');

function fixture(jobRoot, repositoryDir) {
  return {
    status: 'completed', project: { id: 'fit', name: 'FitHub' },
    options: { deliveryPackage: 'workspace', targetProfile: 'supabase-cloud-static', clientName: 'Cliente Piloto', deliveryOwner: 'Equipe Técnica', migrationScope: { data: true, users: true, storage: false, integrations: true, deployment: true } },
    paths: { jobRoot, repositoryDir, previewDir: path.join(jobRoot, 'preview'), backupPath: path.join(jobRoot, 'source.zip') },
    backup: { sha256: 'abc' }, security: { blocking: [] }, standaloneGate: { passed: true },
    build: { status: 'passed', runtime: { passed: true }, compatibility: { workspace: { prepared: true } } },
    readiness: { score: 85, level: 'workspace-prepared', label: 'Workspace evolutivo preparado', runtimeContracts: { converted: 5, bridged: 2, emulated: 1, unsupported: 0 }, productionBlockers: ['Stripe requer homologação'], nextActions: ['Validar banco local'] },
    githubRepository: { htmlUrl: 'https://github.com/example/fithub', defaultBranch: 'main' },
  };
}

test('keeps a prepared client workspace pending until its local backend is validated', () => {
  const report = fixture('/tmp/job', '/tmp/job/repository');
  let manifest = buildDeliveryManifest(report);
  assert.equal(manifest.contractedPackage.id, 'workspace');
  assert.equal(manifest.targetProfile.id, 'supabase-cloud-static');
  assert.equal(manifest.client.name, 'Cliente Piloto');
  assert.equal(manifest.acceptance.acceptedByAutomation, false);
  assert.ok(manifest.unresolved.some((item) => /Stripe/.test(item)));
  report.workspaceValidation = { passed: true };
  manifest = buildDeliveryManifest(report);
  assert.equal(manifest.acceptance.acceptedByAutomation, true);
});

test('marks AWS as assessment-only instead of promising automatic Lambda deployment', () => {
  assert.equal(TARGET_PROFILES['aws-custom'].automation, 'assessment-only');
  assert.match(TARGET_PROFILES['aws-custom'].summary, /requer|específico/i);
});

test('writes handoff documents plus a verifiable client ZIP', async () => {
  const jobRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-delivery-'));
  const repositoryDir = path.join(jobRoot, 'repository');
  await fs.mkdir(repositoryDir, { recursive: true });
  await fs.writeFile(path.join(repositoryDir, 'README.md'), '# FitHub\n');
  const report = fixture(jobRoot, repositoryDir);
  const delivery = await writeClientDeliveryPackage(repositoryDir, report);
  for (const name of ['CLIENT_DELIVERY_MANIFEST.json', 'CLIENT_HANDOFF.md', 'ACCEPTANCE_CHECKLIST.md', 'DEPLOYMENT_BLUEPRINT.md', 'CREDENTIALS_HANDOFF.md', 'MIGRATION_BACKLOG.md']) assert.ok(await fs.stat(path.join(delivery.root, name)));
  const archive = await createClientArchive(repositoryDir, report);
  assert.ok(await fs.stat(archive.path));
  assert.ok(await fs.stat(`${archive.path}.sha256`));
  const manifest = JSON.parse(await fs.readFile(path.join(delivery.root, 'CLIENT_DELIVERY_MANIFEST.json'), 'utf8'));
  assert.equal(manifest.artifacts.clientArchive, archive.path);
  assert.equal(manifest.artifacts.clientArchiveSha256, archive.sha256);
  assert.match(await fs.readFile(path.join(delivery.root, 'CLIENT_HANDOFF.md'), 'utf8'), /Como realizar o handoff/);
  await fs.rm(jobRoot, { recursive: true, force: true });
});
