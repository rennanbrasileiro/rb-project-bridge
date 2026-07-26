'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PreviewRepairService } = require('../electron/services/preview-repair-service.cjs');

const logger = { info() {}, warn() {}, error() {} };

async function fixture(overrides = {}) {
  const jobRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-preview-repair-'));
  const repositoryDir = path.join(jobRoot, 'repository');
  const previewDir = path.join(jobRoot, 'preview');
  await fs.mkdir(repositoryDir, { recursive: true });
  await fs.writeFile(path.join(repositoryDir, 'package.json'), JSON.stringify({ scripts: { 'build:demo': 'vite build --mode demo' } }));
  const report = {
    jobId: 'job-1',
    status: 'completed',
    checkpoint: 'delivered',
    startedAt: '2026-07-26T10:00:00.000Z',
    project: { id: 'app-1', name: 'FitHub' },
    options: { deliveryMode: 'standalone-supabase' },
    paths: { jobRoot, repositoryDir, previewDir },
    notes: [],
    ...overrides,
  };
  await fs.writeFile(path.join(jobRoot, 'RB-BRIDGE-REPORT.json'), JSON.stringify(report, null, 2));
  return { jobRoot, repositoryDir, previewDir, report };
}

function service(calls) {
  return new PreviewRepairService({
    logger,
    emit: (_channel, payload) => calls.events.push(payload),
    build: {
      inspect: async () => ({ valid: true, issues: [] }),
      validateBuild: async (_root, options) => {
        calls.options = options;
        await fs.mkdir(options.previewDestination, { recursive: true });
        await fs.writeFile(path.join(options.previewDestination, 'index.html'), '<div id="root">ok</div>');
        return { status: 'passed', preview: { directory: options.previewDestination }, runtime: { passed: true, rendered: true, errors: [] } };
      },
    },
    standalone: { verify: async () => ({ passed: true, violations: [] }) },
    security: { scan: async () => ({ blocking: [], findings: [] }) },
    reports: {
      writeReport: async (directory, report) => { calls.writes.push({ directory, report }); },
      appendHistory: async (entry) => { calls.history.push(entry); },
    },
  });
}

test('rebuilds and runtime-validates an existing preview without publishing', async () => {
  const data = await fixture();
  const calls = { events: [], writes: [], history: [], options: null };
  const repair = service(calls);
  const result = await repair.repair(data.jobRoot);
  assert.equal(result.previewRepair.status, 'completed');
  assert.equal(result.previewRepair.published, false);
  assert.equal(result.build.runtime.passed, true);
  assert.equal(calls.options.buildScript, 'build:demo');
  assert.equal(calls.options.runtimeValidation, true);
  assert.equal(calls.history[0].previewRepaired, true);
  assert.ok(calls.events.some((event) => event.status === 'complete'));
  await fs.rm(data.jobRoot, { recursive: true, force: true });
});

test('blocks report paths outside the operation directory', async () => {
  const outside = path.join(os.tmpdir(), 'rb-outside-repository');
  const data = await fixture({ paths: { repositoryDir: outside, previewDir: path.join(outside, 'preview') } });
  const calls = { events: [], writes: [], history: [], options: null };
  await assert.rejects(() => service(calls).repair(data.jobRoot), (error) => error.code === 'UNSAFE_PREVIEW_REPAIR_PATH');
  await fs.rm(data.jobRoot, { recursive: true, force: true });
});

test('renderer exposes an explicit rebuild action', async () => {
  const html = await fs.readFile(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const controller = await fs.readFile(path.join(__dirname, '..', 'renderer', 'repair-preview.js'), 'utf8');
  assert.match(html, /id="repairPreview"/);
  assert.match(html, /repair-preview\.js/);
  assert.match(controller, /migration\.repairPreview/);
  assert.match(controller, /GitHub não (?:será|foi) alterado/);
});
