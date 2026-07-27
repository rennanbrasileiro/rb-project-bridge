'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { StandaloneService } = require('../services/standalone-service.cjs');
const { readJson, writeJson } = require('../core/fs-utils.cjs');

const PATCH_FLAG = Symbol.for('rb.bridge.functional.workspace.patch');

function verificationMigrationSql() {
  return `-- RB Project Bridge functional verification infrastructure.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'role', 'user'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists rb_create_profile_after_signup on auth.users;
create trigger rb_create_profile_after_signup
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create table if not exists public.rb_bridge_smoke (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null references auth.users(id) on delete cascade,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rb_bridge_smoke enable row level security;
drop policy if exists rb_bridge_smoke_select_own on public.rb_bridge_smoke;
drop policy if exists rb_bridge_smoke_insert_own on public.rb_bridge_smoke;
drop policy if exists rb_bridge_smoke_update_own on public.rb_bridge_smoke;
drop policy if exists rb_bridge_smoke_delete_own on public.rb_bridge_smoke;
create policy rb_bridge_smoke_select_own on public.rb_bridge_smoke for select to authenticated using (created_by_id = auth.uid());
create policy rb_bridge_smoke_insert_own on public.rb_bridge_smoke for insert to authenticated with check (created_by_id = auth.uid());
create policy rb_bridge_smoke_update_own on public.rb_bridge_smoke for update to authenticated using (created_by_id = auth.uid()) with check (created_by_id = auth.uid());
create policy rb_bridge_smoke_delete_own on public.rb_bridge_smoke for delete to authenticated using (created_by_id = auth.uid());
`;
}

function verifierSource() {
  return `import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const outputPath = path.join(root, 'RB-FUNCTIONAL-VERIFICATION.json');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const startedAt = new Date().toISOString();
const steps = [];
let admin = null;
let firstUserId = null;
let secondUserId = null;
let smokeId = null;

function run(args, options = {}) {
  const result = spawnSync(npx, ['--no-install', 'supabase', ...args], { cwd: root, encoding: 'utf8', stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', timeout: options.timeout || 240000 });
  if (result.error) throw result.error;
  if (!options.allowFailure && result.status !== 0) throw new Error((result.stderr || result.stdout || 'Supabase CLI failed').trim());
  return result;
}
function parseStatus(raw) { const text = String(raw || ''); const start = text.indexOf('{'); if (start < 0) throw new Error('Supabase status did not return JSON.'); return JSON.parse(text.slice(start)); }
function pick(data, names) { for (const name of names) if (data?.[name]) return data[name]; return null; }
async function check(id, label, action) {
  const step = { id, label, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, detail: null };
  steps.push(step);
  try { const detail = await action(); step.status = 'passed'; step.detail = detail || null; return detail; }
  catch (error) { step.status = 'failed'; step.detail = error.message; throw error; }
  finally { step.finishedAt = new Date().toISOString(); }
}
function writeResult(status, error = null) {
  const result = { schemaVersion: 1, status, startedAt, finishedAt: new Date().toISOString(), environment: 'supabase-local', steps, error: error ? { message: error.message, stack: String(error.stack || '').split('\\n').slice(0, 8) } : null };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log('RB_FUNCTIONAL_VERIFICATION=' + JSON.stringify(result));
  return result;
}

try {
  let statusRun = run(['status', '--output', 'json'], { capture: true, allowFailure: true });
  if (statusRun.status !== 0) { run(['start'], { timeout: 360000 }); statusRun = run(['status', '--output', 'json'], { capture: true }); }
  await check('migrations', 'Aplicar migrations em banco local limpo', async () => { run(['db', 'reset'], { timeout: 360000 }); return 'Supabase local iniciado e migrations aplicadas.'; });
  const status = parseStatus(run(['status', '--output', 'json'], { capture: true }).stdout);
  const url = pick(status, ['API_URL', 'api_url', 'apiUrl']);
  const anonKey = pick(status, ['PUBLISHABLE_KEY', 'ANON_KEY', 'publishable_key', 'anon_key']);
  const serviceKey = pick(status, ['SERVICE_ROLE_KEY', 'service_role_key', 'serviceRoleKey']);
  if (!url || !anonKey || !serviceKey) throw new Error('Supabase local did not provide API URL, public key and service role key.');
  admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anonymous = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const first = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const second = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = crypto.randomUUID().slice(0, 8);
  const password = 'RbVerify!' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const firstEmail = 'rb.verify.' + suffix + '.one@example.test';
  const secondEmail = 'rb.verify.' + suffix + '.two@example.test';

  await check('create-users', 'Criar usuários temporários', async () => {
    const one = await admin.auth.admin.createUser({ email: firstEmail, password, email_confirm: true, user_metadata: { role: 'admin' } });
    if (one.error) throw one.error; firstUserId = one.data.user.id;
    const two = await admin.auth.admin.createUser({ email: secondEmail, password, email_confirm: true, user_metadata: { role: 'user' } });
    if (two.error) throw two.error; secondUserId = two.data.user.id;
    return 'Dois usuários temporários criados.';
  });
  await check('login', 'Autenticar com e-mail e senha', async () => { const signed = await first.auth.signInWithPassword({ email: firstEmail, password }); if (signed.error || !signed.data.session) throw signed.error || new Error('Session not created.'); const secondSigned = await second.auth.signInWithPassword({ email: secondEmail, password }); if (secondSigned.error || !secondSigned.data.session) throw secondSigned.error || new Error('Second session not created.'); return 'Sessões reais criadas para dois usuários.'; });
  await check('profiles', 'Confirmar criação automática de profiles', async () => { const profile = await first.from('profiles').select('id,role').eq('id', firstUserId).single(); if (profile.error) throw profile.error; if (profile.data.role !== 'admin') throw new Error('Profile role was not copied from user metadata.'); return 'Profile criado automaticamente após signup.'; });
  await check('crud-create', 'Criar registro autenticado', async () => { const inserted = await first.from('rb_bridge_smoke').insert({ created_by_id: firstUserId, value: 'created' }).select().single(); if (inserted.error) throw inserted.error; smokeId = inserted.data.id; return 'Registro criado pelo proprietário.'; });
  await check('rls-anonymous', 'Bloquear leitura anônima', async () => { const result = await anonymous.from('rb_bridge_smoke').select('*').eq('id', smokeId); if (result.error) throw result.error; if (result.data.length !== 0) throw new Error('Anonymous client read protected data.'); return 'Cliente anônimo não acessou o registro.'; });
  await check('rls-other-user', 'Isolar dados entre usuários', async () => { const result = await second.from('rb_bridge_smoke').select('*').eq('id', smokeId); if (result.error) throw result.error; if (result.data.length !== 0) throw new Error('Second user read first user data.'); const update = await second.from('rb_bridge_smoke').update({ value: 'intrusion' }).eq('id', smokeId).select(); if (update.error) throw update.error; if (update.data.length !== 0) throw new Error('Second user updated first user data.'); return 'Outro usuário não leu nem alterou o registro.'; });
  await check('crud-update', 'Atualizar registro próprio', async () => { const updated = await first.from('rb_bridge_smoke').update({ value: 'updated' }).eq('id', smokeId).select().single(); if (updated.error) throw updated.error; if (updated.data.value !== 'updated') throw new Error('Updated value was not persisted.'); return 'Atualização persistida.'; });
  await check('crud-delete', 'Excluir registro próprio', async () => { const removed = await first.from('rb_bridge_smoke').delete().eq('id', smokeId).select().single(); if (removed.error) throw removed.error; smokeId = null; return 'Registro excluído.'; });
  writeResult('passed');
} catch (error) {
  writeResult('failed', error);
  process.exitCode = 1;
} finally {
  if (admin) {
    if (smokeId) await admin.from('rb_bridge_smoke').delete().eq('id', smokeId).catch(() => null);
    if (firstUserId) await admin.auth.admin.deleteUser(firstUserId).catch(() => null);
    if (secondUserId) await admin.auth.admin.deleteUser(secondUserId).catch(() => null);
  }
}
`;
}

async function enhanceWorkspace(root, report) {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const migrationPath = path.join(root, 'supabase', 'migrations', `${timestamp}_rb_functional_verification.sql`);
  await fs.mkdir(path.dirname(migrationPath), { recursive: true });
  await fs.writeFile(migrationPath, verificationMigrationSql(), 'utf8');
  const scriptPath = path.join(root, 'scripts', 'rb-verify-workspace.mjs');
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, verifierSource(), 'utf8');
  const packagePath = path.join(root, 'package.json');
  const packageJson = await readJson(packagePath, {});
  packageJson.scripts = {
    ...(packageJson.scripts || {}),
    'rb:demo': packageJson.scripts?.['dev:demo'] || 'vite --mode demo',
    'rb:workspace': packageJson.scripts?.['workspace:dev'] || 'vite',
    'rb:verify': 'node scripts/rb-verify-workspace.mjs',
    'rb:package': packageJson.scripts?.['build'] || 'vite build',
  };
  await writeJson(packagePath, packageJson);
  const docs = `# Verificação funcional do workspace\n\nExecute \`npm run rb:verify\` com Docker Desktop disponível. O comando inicia o Supabase local, reaplica migrations e testa automaticamente:\n\n- criação de usuários temporários;\n- login real com e-mail e senha;\n- criação automática do profile;\n- CRUD autenticado;\n- bloqueio de acesso anônimo;\n- isolamento RLS entre dois usuários.\n\nO resultado é gravado em \`RB-FUNCTIONAL-VERIFICATION.json\`. Nenhuma senha, service role key ou token é persistido no relatório. O banco usado é exclusivamente o Supabase local e é recriado durante o teste.\n`;
  await fs.writeFile(path.join(root, 'WORKSPACE_VERIFICATION.md'), docs, 'utf8');
  report.functionalVerification = {
    prepared: true,
    command: 'npm run rb:verify',
    migrationPath: path.relative(root, migrationPath).replaceAll('\\', '/'),
    scriptPath: path.relative(root, scriptPath).replaceAll('\\', '/'),
    resultPath: 'RB-FUNCTIONAL-VERIFICATION.json',
  };
  await writeJson(path.join(root, 'RB-STANDALONE-REPORT.json'), report);
  return report;
}

if (!StandaloneService.prototype[PATCH_FLAG]) {
  const originalTransform = StandaloneService.prototype.transform;
  StandaloneService.prototype.transform = async function transformWithFunctionalWorkspace(root, options = {}) {
    const report = await originalTransform.call(this, root, options);
    return enhanceWorkspace(root, report);
  };
  Object.defineProperty(StandaloneService.prototype, PATCH_FLAG, { value: true, enumerable: false });
}

module.exports = { verificationMigrationSql, verifierSource, enhanceWorkspace };
