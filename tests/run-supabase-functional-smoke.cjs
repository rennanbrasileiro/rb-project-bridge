'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { enhanceWorkspace } = require('../electron/patches/functional-workspace-patch.cjs');
const { writeJson, readJson } = require('../electron/core/fs-utils.cjs');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function tail(value, limit = 12000) {
  const text = String(value || '').trim();
  return text.length > limit ? text.slice(-limit) : text;
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 15 * 60 * 1000,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (options.verbose) {
    if (result.stdout) process.stdout.write(tail(result.stdout));
    if (result.stderr) process.stderr.write(tail(result.stderr));
  }
  if (!options.allowFailure && result.status !== 0) {
    const detail = tail(result.stderr || result.stdout || `${command} failed`);
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}:\n${detail}`);
  }
  return result;
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-bridge-supabase-smoke-'));
  let initialized = false;
  try {
    await writeJson(path.join(root, 'package.json'), {
      name: 'rb-bridge-functional-smoke',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: { build: 'node --version', 'dev:demo': 'node --version' },
      dependencies: { '@supabase/supabase-js': '^2.0.0' },
    });
    run(npx, ['--yes', 'supabase', 'init'], root, { timeout: 240000 });
    initialized = true;
    const migrations = path.join(root, 'supabase', 'migrations');
    await fs.mkdir(migrations, { recursive: true });
    await fs.writeFile(path.join(migrations, '20260101000000_profiles.sql'), `create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
`, 'utf8');
    await enhanceWorkspace(root, { entities: [{ name: 'User', table: 'profiles' }] });
    run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error'], root, { timeout: 360000 });
    run(npm, ['run', 'rb:verify'], root, { timeout: 15 * 60 * 1000 });
    const result = await readJson(path.join(root, 'RB-FUNCTIONAL-VERIFICATION.json'), null);
    if (!result || result.status !== 'passed') throw new Error(`Functional verifier did not pass:\n${JSON.stringify(result, null, 2)}`);
    const required = ['migrations', 'create-users', 'login', 'profiles', 'crud-create', 'rls-anonymous', 'rls-other-user', 'crud-update', 'crud-delete'];
    for (const id of required) {
      const step = result.steps.find((item) => item.id === id);
      if (!step || step.status !== 'passed') throw new Error(`Required functional step did not pass: ${id}`);
    }
    process.stdout.write(`RB functional smoke passed: ${required.join(', ')}\n`);
  } catch (error) {
    const result = await readJson(path.join(root, 'RB-FUNCTIONAL-VERIFICATION.json'), null).catch(() => null);
    if (result) process.stderr.write(`RB-FUNCTIONAL-VERIFICATION.json:\n${JSON.stringify(result, null, 2)}\n`);
    throw error;
  } finally {
    if (initialized) run(npx, ['--yes', 'supabase', 'stop', '--no-backup'], root, { allowFailure: true, timeout: 240000 });
    await fs.rm(root, { recursive: true, force: true }).catch(() => null);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
