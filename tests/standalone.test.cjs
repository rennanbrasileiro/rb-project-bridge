'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { StandaloneService, parseJsonc, snakeCase, propertySqlType, buildEntitySql, removeFunctionCall } = require('../electron/services/standalone-service.cjs');
const { PreviewService } = require('../electron/services/preview-service.cjs');

const logger = { info() {}, warn() {}, error() {} };
const emit = () => {};

test('27 parses JSONC with comments and trailing commas', () => {
  assert.deepEqual(parseJsonc('{ // x\n "name": "Task", "properties": {}, }'), { name: 'Task', properties: {} });
});

test('28 converts names and property types deterministically', () => {
  assert.equal(snakeCase('PhysicalAssessment'), 'physical_assessment');
  assert.equal(propertySqlType({ type: 'array' }), 'jsonb');
  assert.equal(propertySqlType({ type: 'string', format: 'date-time' }), 'timestamptz');
});

test('29 generates conservative SQL and profile mapping', () => {
  const task = buildEntitySql({ name: 'Task', properties: { title: { type: 'string' }, status: { type: 'string', enum: ['open', 'done'] } }, required: ['title'] }, 'base44/entities/Task.jsonc');
  assert.equal(task.table, 'task');
  assert.match(task.sql, /created_by_id uuid references auth\.users/);
  assert.match(task.sql, /enable row level security/);
  assert.match(task.sql, /status.*check/s);
  const user = buildEntitySql({ name: 'User', properties: { role: { type: 'string' } } }, 'base44/entities/User.jsonc');
  assert.equal(user.table, 'profiles');
  assert.match(user.sql, /references auth\.users\(id\)/);
});

test('30 removes Base44 vite plugin call without removing React plugin', () => {
  const source = "plugins: [base44({ legacySDKImports: true }), react()]";
  const result = removeFunctionCall(source, 'base44');
  assert.doesNotMatch(result, /base44\(/);
  assert.match(result, /react\(\)/);
});

test('31 transforms an exported project into a standalone Supabase handoff', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-standalone-'));
  await fs.mkdir(path.join(root, 'base44', 'entities'), { recursive: true });
  await fs.mkdir(path.join(root, 'base44', 'functions', 'hello'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'api'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'lib'), { recursive: true });
  await fs.writeFile(path.join(root, 'base44', 'entities', 'Task.jsonc'), JSON.stringify({ name: 'Task', type: 'object', properties: { title: { type: 'string' }, tags: { type: 'array' } }, required: ['title'] }));
  await fs.writeFile(path.join(root, 'base44', 'entities', 'User.jsonc'), JSON.stringify({ name: 'User', type: 'object', properties: { role: { type: 'string' } } }));
  await fs.writeFile(path.join(root, 'base44', 'functions', 'hello', 'entry.ts'), 'export default async function handler(request, context) { return context.base44.auth.me(); }');
  await fs.writeFile(path.join(root, 'src', 'api', 'base44Client.js'), "import { createClient } from '@base44/sdk';\nexport const base44=createClient({});\n");
  await fs.writeFile(path.join(root, 'src', 'lib', 'app-params.js'), 'export const appParams = {};');
  await fs.writeFile(path.join(root, 'vite.config.js'), "import base44 from '@base44/vite-plugin'\nimport react from '@vitejs/plugin-react'\nexport default { plugins:[base44({ legacySDKImports:true }),react()] };\n");
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sample', scripts: { build: 'vite build' }, dependencies: { '@base44/sdk': '1.0.0' }, devDependencies: { '@base44/vite-plugin': '1.0.0', vite: '6.1.0' } }, null, 2));
  const service = new StandaloneService({ logger, emit });
  const result = await service.transform(root, { projectName: 'Sample' });
  assert.equal(result.gate.passed, true);
  assert.equal(result.entities.length, 2);
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.dependencies['@base44/sdk'], undefined);
  assert.equal(packageJson.dependencies['@supabase/supabase-js'], '2.110.8');
  assert.equal(packageJson.devDependencies.supabase, '2.109.1');
  assert.match(await fs.readFile(path.join(root, 'supabase', 'migrations', (await fs.readdir(path.join(root, 'supabase', 'migrations')))[0]), 'utf8'), /create table if not exists public\."task"/);
  assert.match(await fs.readFile(path.join(root, 'src', 'api', 'base44Client.js'), 'utf8'), /createClient.*supabase-js/s);
  await assert.rejects(fs.access(path.join(root, 'base44')));
  await assert.rejects(fs.access(path.join(root, 'src', 'lib', 'app-params.js')));
  const viteConfig = await fs.readFile(path.join(root, 'vite.config.js'), 'utf8');
  assert.doesNotMatch(viteConfig, /base44/);
  assert.match(viteConfig, /alias:[\s\S]*['"]@['"]:[\s\S]*path\.resolve\(process\.cwd\(\), ['"]src['"]\)/);
  assert.ok(await fs.stat(path.join(root, '.github', 'workflows', 'validate.yml')));
  await fs.rm(root, { recursive: true, force: true });
});

test('32 standalone gate blocks active Base44 runtime imports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-standalone-gate-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'x.js'), "import x from '@base44/sdk';");
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  const service = new StandaloneService({ logger, emit });
  await assert.rejects(() => service.verify(root), (error) => error.code === 'STANDALONE_GATE_FAILED');
  await fs.rm(root, { recursive: true, force: true });
});

test('33 preview service serves SPA fallback from generated dist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-preview-'));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>preview-ok</h1>');
  const preview = new PreviewService({ logger, openExternal: async () => {} });
  const state = await preview.start(root, { open: false });
  const body = await new Promise((resolve, reject) => {
    http.get(`${state.url}/missing/route`, (response) => {
      let text = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { text += chunk; }); response.on('end', () => resolve(text));
    }).on('error', reject);
  });
  assert.match(body, /preview-ok/);
  assert.equal(preview.status().running, true);
  await preview.stop();
  await fs.rm(root, { recursive: true, force: true });
});
