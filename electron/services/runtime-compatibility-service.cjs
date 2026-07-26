'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { listFiles, pathExists, readJson, writeJson } = require('../core/fs-utils.cjs');
const { BridgeError } = require('../core/errors.cjs');

const ENTITY_METHOD_SUPPORT = Object.freeze({
  list: 'converted', filter: 'converted', get: 'converted', create: 'converted', bulkCreate: 'converted', update: 'converted', delete: 'converted', subscribe: 'converted',
});
const AUTH_METHOD_SUPPORT = Object.freeze({
  me: 'converted', updateMe: 'converted', redirectToLogin: 'converted', loginWithProvider: 'converted', logout: 'converted',
  loginViaEmailPassword: 'converted', isAuthenticated: 'converted', inviteUser: 'bridged', register: 'converted', verifyOtp: 'converted',
  resendOtp: 'converted', resetPasswordRequest: 'converted', resetPassword: 'converted', changePassword: 'converted', setToken: 'unsupported',
});
const USERS_METHOD_SUPPORT = Object.freeze({ inviteUser: 'bridged' });
const APP_LOG_METHOD_SUPPORT = Object.freeze({ logUserInApp: 'emulated' });
const ANALYTICS_METHOD_SUPPORT = Object.freeze({ track: 'emulated' });
const FUNCTION_METHOD_SUPPORT = Object.freeze({ invoke: 'bridged', fetch: 'bridged' });
const CONNECTOR_METHOD_SUPPORT = Object.freeze({ connectAppUser: 'emulated', disconnectAppUser: 'emulated' });
const SERVICE_CONNECTOR_METHOD_SUPPORT = Object.freeze({ getConnection: 'unsupported', getCurrentAppUserConnection: 'unsupported', getAccessToken: 'unsupported' });
const COMPATIBILITY_MARKER = 'RB_RUNTIME_COMPAT_V3';
const LEGACY_COMPATIBILITY_MARKERS = ['RB_RUNTIME_COMPAT_V1', 'RB_RUNTIME_COMPAT_V2'];

const SUPPORTED_ENTITY_METHODS = new Set(Object.entries(ENTITY_METHOD_SUPPORT).filter(([, value]) => value !== 'unsupported').map(([key]) => key));
const SUPPORTED_AUTH_METHODS = new Set(Object.entries(AUTH_METHOD_SUPPORT).filter(([, value]) => value !== 'unsupported').map(([key]) => key));
const SUPPORTED_APP_LOG_METHODS = new Set(Object.keys(APP_LOG_METHOD_SUPPORT));
const SUPPORTED_FUNCTION_METHODS = new Set(Object.keys(FUNCTION_METHOD_SUPPORT));

function dedupeUsages(usages) {
  const seen = new Set();
  return usages.filter((usage) => {
    const key = `${usage.file}|${usage.expression}|${usage.kind}|${usage.entity || ''}|${usage.method || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractEntityMethodUsages(source, filePath = '') {
  const usages = [];
  const pattern = /base44(\.asServiceRole)?\.entities(?:\.([A-Za-z_$][\w$]*)|\[['"]([^'"]+)['"]\])(?:\.|\?\.)([A-Za-z_$][\w$]*)/g;
  for (const match of String(source || '').matchAll(pattern)) {
    usages.push({
      file: filePath,
      kind: match[1] ? 'service-role-entity' : 'entity',
      namespace: match[1] ? 'asServiceRole.entities' : 'entities',
      entity: match[2] || match[3],
      method: match[4],
      expression: match[0],
    });
  }
  return usages;
}

function extractRuntimeUsages(source, filePath = '') {
  const text = String(source || '');
  const usages = [...extractEntityMethodUsages(text, filePath)];
  const patterns = [
    { kind: 'auth', namespace: 'auth', pattern: /base44\.auth(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'users', namespace: 'users', pattern: /base44\.users(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'app-logs', namespace: 'appLogs', pattern: /base44\.appLogs(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'analytics', namespace: 'analytics', pattern: /base44\.analytics(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'functions', namespace: 'functions', pattern: /base44\.functions(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'service-role-functions', namespace: 'asServiceRole.functions', pattern: /base44\.asServiceRole\.functions(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'connectors', namespace: 'connectors', pattern: /base44\.connectors(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'service-role-connectors', namespace: 'asServiceRole.connectors', pattern: /base44\.asServiceRole\.connectors(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'agents', namespace: 'agents', pattern: /base44\.agents(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'integration', namespace: 'integrations.Core', pattern: /base44\.integrations\.Core(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'custom-integration', namespace: 'integrations.custom', pattern: /base44\.integrations\.custom(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
    { kind: 'service-role-integration', namespace: 'asServiceRole.integrations.Core', pattern: /base44\.asServiceRole\.integrations\.Core(?:\.|\?\.)([A-Za-z_$][\w$]*)/g },
  ];
  for (const spec of patterns) {
    for (const match of text.matchAll(spec.pattern)) usages.push({ file: filePath, kind: spec.kind, namespace: spec.namespace, method: match[1], expression: match[0] });
  }

  const functionRoute = /(?:fetch\s*\(\s*|['"])(\/api\/functions\/([A-Za-z0-9_$./-]+))/g;
  for (const match of text.matchAll(functionRoute)) {
    usages.push({ file: filePath, kind: 'function-route', namespace: 'api.functions', method: match[2], expression: match[1] });
  }

  const knownNamespaces = new Set(['entities', 'auth', 'users', 'appLogs', 'analytics', 'functions', 'connectors', 'agents', 'integrations', 'asServiceRole']);
  const generic = /base44(?:\.|\?\.)([A-Za-z_$][\w$]*)(?:\.|\?\.)([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(generic)) {
    if (knownNamespaces.has(match[1])) continue;
    usages.push({ file: filePath, kind: 'unknown', namespace: match[1], method: match[2], expression: match[0] });
  }
  return dedupeUsages(usages);
}

function classifyRuntimeUsage(usage) {
  let support = 'unsupported';
  if (usage.kind === 'entity' || usage.kind === 'service-role-entity') support = ENTITY_METHOD_SUPPORT[usage.method] || 'unsupported';
  else if (usage.kind === 'auth') support = AUTH_METHOD_SUPPORT[usage.method] || 'unsupported';
  else if (usage.kind === 'users') support = USERS_METHOD_SUPPORT[usage.method] || 'unsupported';
  else if (usage.kind === 'app-logs') support = APP_LOG_METHOD_SUPPORT[usage.method] || 'unsupported';
  else if (usage.kind === 'analytics') support = ANALYTICS_METHOD_SUPPORT[usage.method] || 'unsupported';
  else if (usage.kind === 'functions' || usage.kind === 'service-role-functions') support = FUNCTION_METHOD_SUPPORT[usage.method] || 'unsupported';
  else if (usage.kind === 'function-route') support = 'bridged';
  else if (usage.kind === 'connectors') support = CONNECTOR_METHOD_SUPPORT[usage.method] || 'unsupported';
  else if (usage.kind === 'service-role-connectors') support = SERVICE_CONNECTOR_METHOD_SUPPORT[usage.method] || 'unsupported';
  else if (usage.kind === 'integration' || usage.kind === 'custom-integration' || usage.kind === 'service-role-integration') support = 'bridged';
  else if (usage.kind === 'agents') support = 'unsupported';
  return { ...usage, support };
}

function runtimeCompatibilitySource() {
  return `
// ${COMPATIBILITY_MARKER}: generated by RB Project Bridge.
function rbNormalizeRealtimeEvent(payload = {}) {
  const eventType = String(payload.eventType || payload.type || '').toLowerCase();
  const type = eventType === 'insert' ? 'create' : eventType === 'delete' ? 'delete' : eventType === 'update' ? 'update' : eventType;
  const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old || null;
  return { type, id: row?.id || payload.old?.id || null, data: decorate(row), old: decorate(payload.old || null), raw: payload };
}
function rbSubscribeToEntity(entity, callback) {
  if (typeof callback !== 'function') return () => {};
  if (demoMode || !supabase) return () => {};
  const table = tableFor(entity);
  const suffix = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  const channel = supabase.channel('rb-bridge-' + table + '-' + suffix).on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => callback(rbNormalizeRealtimeEvent(payload))).subscribe();
  return () => { try { void supabase.removeChannel(channel); } catch {} };
}
const rbCompatibleEntities = new Proxy(entities, {
  get: (_target, entity) => {
    const adapter = entities[entity];
    return { ...adapter, subscribe: typeof adapter?.subscribe === 'function' ? adapter.subscribe.bind(adapter) : (callback) => rbSubscribeToEntity(String(entity), callback) };
  },
});
function rbReadLocal(key, fallback = []) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function rbWriteLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
async function rbInviteUser(email, role = 'user') {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Informe o e-mail do usuário.');
  if (demoMode || !supabase) {
    const invites = rbReadLocal('rb_demo_user_invites');
    const invitation = { id: globalThis.crypto?.randomUUID?.() || String(Date.now()), email: normalizedEmail, role, status: 'invited', invited_at: now() };
    invites.push(invitation); rbWriteLocal('rb_demo_user_invites', invites.slice(-500));
    const existing = await rbCompatibleEntities.User.filter({ email: normalizedEmail });
    if (!existing.length) await rbCompatibleEntities.User.create({ email: normalizedEmail, full_name: normalizedEmail.split('@')[0], role, status: 'invited' });
    return { success: true, emulated: true, invitation };
  }
  const { data, error } = await supabase.functions.invoke('rb-invite-user', { body: { email: normalizedEmail, role } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
const rbAuth = {
  ...auth,
  async isAuthenticated() { if (demoMode || !supabase) return true; const { data, error } = await supabase.auth.getSession(); if (error) throw error; return Boolean(data.session); },
  async loginViaEmailPassword(email, password) { if (demoMode || !supabase) return { access_token: 'demo-token', user: DEMO_USER }; const { data, error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; return { access_token: data.session?.access_token, user: data.user }; },
  async loginWithProvider(provider, fromUrl = '/') { if (demoMode || !supabase) return DEMO_USER; const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: new URL(fromUrl || '/', window.location.origin).href } }); if (error) throw error; if (data.url) window.location.href = data.url; return data; },
  async register(params = {}) { if (demoMode || !supabase) return { user: { ...DEMO_USER, email: params.email || DEMO_USER.email } }; const { data, error } = await supabase.auth.signUp({ email: params.email, password: params.password, options: { data: params.data || {} } }); if (error) throw error; return data; },
  async verifyOtp(params = {}) { if (demoMode || !supabase) return { user: DEMO_USER }; const { data, error } = await supabase.auth.verifyOtp({ email: params.email, token: params.otpCode || params.token, type: params.type || 'email' }); if (error) throw error; return data; },
  async resendOtp(params = {}) { if (demoMode || !supabase) return { success: true }; const { data, error } = await supabase.auth.resend({ type: params.type || 'signup', email: params.email }); if (error) throw error; return data; },
  async resetPasswordRequest(email) { if (demoMode || !supabase) return { success: true }; const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }); if (error) throw error; return data; },
  async resetPassword(passwordOrParams) { const password = typeof passwordOrParams === 'string' ? passwordOrParams : passwordOrParams?.password; if (demoMode || !supabase) return { success: true }; const { data, error } = await supabase.auth.updateUser({ password }); if (error) throw error; return data; },
  async changePassword(currentOrNew, maybeNew) { return this.resetPassword(maybeNew || currentOrNew); },
  inviteUser: rbInviteUser,
};
const rbUsers = { inviteUser: rbInviteUser };
const rbAppLogs = {
  async logUserInApp(pageName) {
    const event = { pageName: String(pageName || ''), occurredAt: now(), userId: DEMO_USER.id };
    if (typeof localStorage !== 'undefined') { const rows = rbReadLocal('rb_demo_app_logs'); rows.push(event); rbWriteLocal('rb_demo_app_logs', rows.slice(-500)); }
    else console.info('[RB standalone app log]', event);
    return { success: true, emulated: true, event };
  },
};
const rbAnalytics = {
  track(params = {}) {
    const event = { eventName: String(params.eventName || 'event'), properties: params.properties || {}, occurredAt: now() };
    if (typeof localStorage !== 'undefined') { const rows = rbReadLocal('rb_demo_analytics'); rows.push(event); rbWriteLocal('rb_demo_analytics', rows.slice(-1000)); }
    else console.info('[RB standalone analytics]', event);
  },
};
const rbNativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
function rbFunctionName(pathValue) { return String(pathValue || '').replace(/^\\/+/, '').replace(/^api\\/functions\\//, '').split('/').filter(Boolean).join('-'); }
const rbFunctions = {
  async invoke(name, payload = {}) { if (demoMode || !supabase) return { data: { demo: true, functionName: name, payload } }; const { data, error } = await supabase.functions.invoke(name, { body: payload }); if (error) throw error; return { data }; },
  async fetch(pathValue, init = {}) {
    const functionName = rbFunctionName(pathValue);
    if (demoMode || !supabase) return new Response(JSON.stringify({ demo: true, functionName, message: 'Função simulada no sandbox; valide o backend antes da produção.' }), { status: 200, headers: { 'content-type': 'application/json' } });
    const { data: sessionData } = await supabase.auth.getSession();
    const headers = new Headers(init.headers || {});
    headers.set('apikey', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '');
    if (sessionData.session?.access_token) headers.set('authorization', 'Bearer ' + sessionData.session.access_token);
    const endpoint = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\\/$/, '') + '/functions/v1/' + encodeURIComponent(functionName);
    return rbNativeFetch(endpoint, { ...init, headers });
  },
};
const rbConnectors = {
  async connectAppUser(connectorId) { if (demoMode) return window.location.href; throw new Error('Conector OAuth requer configuração específica no ambiente de destino: ' + connectorId); },
  async disconnectAppUser() { if (demoMode) return; throw new Error('Conector OAuth requer configuração específica no ambiente de destino.'); },
};
const rbAgents = new Proxy({}, { get: (_target, method) => async (...args) => { if (demoMode) return { demo: true, method: String(method), args }; throw new Error('Agentes Base44 exigem conversão para um provedor de IA no ambiente de destino.'); } });
const rbCustomIntegrations = new Proxy({}, { get: (_target, method) => async (payload = {}) => invokeIntegration(String(method), payload) });
const rbRuntimeBase44 = {
  entities: rbCompatibleEntities,
  auth: rbAuth,
  users: rbUsers,
  appLogs: rbAppLogs,
  analytics: rbAnalytics,
  functions: rbFunctions,
  connectors: rbConnectors,
  agents: rbAgents,
  integrations: { Core, custom: rbCustomIntegrations },
  asServiceRole: { entities: rbCompatibleEntities, functions: rbFunctions, integrations: { Core, custom: rbCustomIntegrations }, connectors: rbConnectors },
};
if (typeof window !== 'undefined' && rbNativeFetch && !window.__RB_FUNCTION_FETCH_BRIDGE__) {
  window.__RB_FUNCTION_FETCH_BRIDGE__ = true;
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input?.url || '';
    if (/^\\/api\\/functions\\//.test(raw)) return rbFunctions.fetch(raw, init);
    return rbNativeFetch(input, init);
  };
}
`;
}

function patchGeneratedAdapterSource(source) {
  const text = String(source || '');
  const exportMarker = 'export { supabase, demoMode };';
  if (!text.includes(exportMarker) || !text.includes('export const base44 =')) {
    throw new BridgeError('STANDALONE_ADAPTER_PATCH_FAILED', 'O adapter standalone gerado não possui a estrutura esperada para compatibilidade em tempo de execução.');
  }
  if (text.includes(COMPATIBILITY_MARKER) && text.includes('export const base44 = rbRuntimeBase44;')) return { source: text, patched: false, upgradedFromLegacy: false };
  let patched = text;
  patched = patched.replace(exportMarker, `${runtimeCompatibilitySource()}\n${exportMarker}`);
  patched = patched.replace(/export const base44 = \{[^\n]+\};?\s*$/m, 'export const base44 = rbRuntimeBase44;');
  if (!patched.includes('export const base44 = rbRuntimeBase44;')) {
    throw new BridgeError('STANDALONE_ADAPTER_PATCH_FAILED', 'Não foi possível substituir a exportação do cliente Base44 pelo runtime independente.');
  }
  return { source: patched, patched: true, upgradedFromLegacy: LEGACY_COMPATIBILITY_MARKERS.some((marker) => text.includes(marker)) };
}

function patchDemoServiceWorkerSource(source) {
  let patched = String(source || '');
  patched = patched.replace(/if\s*\(\s*'serviceWorker'\s+in\s+navigator\s*&&\s*!import\.meta\.env\.DEV\s*\)/, "if ('serviceWorker' in navigator && !import.meta.env.DEV && import.meta.env.VITE_RB_DEMO_MODE !== 'true')");
  patched = patched.replace(/else\s+if\s*\(\s*'serviceWorker'\s+in\s+navigator\s*&&\s*import\.meta\.env\.DEV\s*\)/, "else if ('serviceWorker' in navigator && (import.meta.env.DEV || import.meta.env.VITE_RB_DEMO_MODE === 'true'))");
  return patched;
}

function inviteFunctionSource() {
  return `import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (request) => {
  const headers = { 'content-type': 'application/json' };
  try {
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceRoleKey) throw new Error('Supabase environment is incomplete.');
    const authorization = request.headers.get('authorization') || '';
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    const admin = createClient(url, serviceRoleKey);
    const { data: profile } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
    if (profile?.role !== 'admin') return new Response(JSON.stringify({ error: 'Admin role required' }), { status: 403, headers });
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const role = String(body.role || 'user');
    if (!email) return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400, headers });
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { role } });
    if (error) throw error;
    if (data.user) await admin.from('profiles').upsert({ id: data.user.id, email, role, updated_at: new Date().toISOString() });
    return new Response(JSON.stringify({ success: true, user: data.user }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || String(error) }), { status: 500, headers });
  }
});
`;
}

function prepareLocalWorkspaceSource() {
  return `import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function run(command, args, options = {}) { const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' }); if (result.error) throw result.error; if (!options.allowFailure && result.status !== 0) throw new Error(options.message || command + ' terminou com código ' + result.status); return result; }
const docker = run(dockerCommand, ['info'], { capture: true, allowFailure: true });
if (docker.status !== 0) { console.error('Docker não está disponível. Abra o Docker Desktop e execute novamente. Para evoluir somente o front-end, use npm run dev:demo.'); process.exit(2); }
function supabase(args, options = {}) { return run(npxCommand, ['--no-install', 'supabase', ...args], options); }
let status = supabase(['status', '--output', 'json'], { capture: true, allowFailure: true });
if (status.status !== 0) { console.log('Iniciando Supabase local...'); supabase(['start']); status = supabase(['status', '--output', 'json'], { capture: true }); }
const raw = String(status.stdout || ''); const jsonStart = raw.indexOf('{'); const data = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw);
const apiUrl = data.API_URL || data.api_url || data.apiUrl; const publishableKey = data.PUBLISHABLE_KEY || data.ANON_KEY || data.publishable_key || data.anon_key;
if (!apiUrl || !publishableKey) throw new Error('O Supabase iniciou, mas não informou API_URL e chave pública. Execute npx supabase status --output json para diagnosticar.');
const env = ['VITE_RB_DEMO_MODE=false', 'VITE_SUPABASE_URL=' + apiUrl, 'VITE_SUPABASE_PUBLISHABLE_KEY=' + publishableKey, ''].join('\\n');
fs.writeFileSync(path.join(root, '.env.local'), env, 'utf8');
console.log('Workspace local preparado em ' + apiUrl + '. As migrations serão usadas pelo Supabase local.');
`;
}

function workspaceDocumentation() {
  return `# Workspace de desenvolvimento independente\n\n## Sandbox imediato\n\nNão exige Docker nem credenciais. Os dados temporários ficam no navegador.\n\n\`\`\`bash\nnpm install\nnpm run dev:demo\n\`\`\`\n\n## Workspace com Supabase local\n\nExige Docker Desktop. O comando inicia o Supabase, cria \`.env.local\` e abre o Vite.\n\n\`\`\`bash\nnpm install\nnpm run workspace:dev\n\`\`\`\n\nComandos úteis: \`workspace:status\`, \`workspace:reset\` e \`supabase:types\`. O reset afeta somente o banco local.\n\nA função \`rb-invite-user\` foi preparada para convites administrativos e exige \`SUPABASE_SERVICE_ROLE_KEY\` apenas no backend. Consulte \`CLIENT_DELIVERY/\` para handoff, implantação e aceite.\n`;
}

async function prepareWorkspaceFiles(root) {
  const packagePath = path.join(root, 'package.json');
  const packageJson = await readJson(packagePath);
  if (!packageJson) return { prepared: false, reason: 'package.json ausente' };
  packageJson.scripts = { ...(packageJson.scripts || {}), 'workspace:prepare': 'node scripts/prepare-local-workspace.mjs', 'workspace:dev': 'node scripts/prepare-local-workspace.mjs && vite', 'workspace:status': 'supabase status', 'workspace:reset': 'supabase db reset' };
  await writeJson(packagePath, packageJson);
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(root, 'scripts', 'prepare-local-workspace.mjs'), prepareLocalWorkspaceSource(), 'utf8');
  await fs.writeFile(path.join(root, 'DEVELOPMENT_WORKSPACE.md'), workspaceDocumentation(), 'utf8');
  if (!(await pathExists(path.join(root, '.env.local.example')))) await fs.writeFile(path.join(root, '.env.local.example'), 'VITE_RB_DEMO_MODE=false\nVITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_PUBLISHABLE_KEY=\n', 'utf8');
  const inviteDir = path.join(root, 'supabase', 'functions', 'rb-invite-user');
  await fs.mkdir(inviteDir, { recursive: true });
  await fs.writeFile(path.join(inviteDir, 'index.ts'), inviteFunctionSource(), 'utf8');
  return { prepared: true, mode: 'supabase-local', scripts: ['workspace:prepare', 'workspace:dev', 'workspace:status', 'workspace:reset'], generatedFunctions: ['rb-invite-user'] };
}

async function auditRuntimeContracts(root) {
  const files = await listFiles(root, { ignoredDirs: ['node_modules', '.git', 'dist', 'build', 'out', 'release', 'supabase'] });
  const usages = [];
  for (const file of files) {
    if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(file)) continue;
    const relative = path.relative(root, file).split(path.sep).join('/');
    const source = await fs.readFile(file, 'utf8').catch(() => '');
    usages.push(...extractRuntimeUsages(source, relative));
  }
  const classified = dedupeUsages(usages).map(classifyRuntimeUsage);
  return {
    usages: classified,
    converted: classified.filter((usage) => usage.support === 'converted'),
    bridged: classified.filter((usage) => usage.support === 'bridged'),
    emulated: classified.filter((usage) => usage.support === 'emulated'),
    unsupported: classified.filter((usage) => usage.support === 'unsupported'),
  };
}

async function auditEntityMethods(root) {
  const audit = await auditRuntimeContracts(root);
  const usages = audit.usages.filter((usage) => usage.kind === 'entity' || usage.kind === 'service-role-entity');
  return { usages, unsupported: usages.filter((usage) => usage.support === 'unsupported') };
}

function runtimeMarkdown(audit, workspace) {
  const rows = audit.usages.length ? audit.usages.map((item) => `| ${item.namespace}${item.entity ? '.' + item.entity : ''}.${item.method} | ${item.support} | ${item.file} |`).join('\n') : '| Nenhum contrato detectado | — | — |';
  return `# Compatibilidade de runtime\n\n- Convertidos: ${audit.converted.length}\n- Encaminhados por adapter: ${audit.bridged.length}\n- Emulados: ${audit.emulated.length}\n- Não suportados: ${audit.unsupported.length}\n- Workspace local: ${workspace.prepared ? 'preparado' : 'não preparado'}\n\n| Contrato | Tratamento | Arquivo |\n|---|---|---|\n${rows}\n\nContratos emulados funcionam no sandbox, mas exigem decisão antes da produção. Contratos não suportados bloqueiam a aprovação. Chamadas diretas em \`/api/functions/*\` são encaminhadas para Supabase Functions e continuam bloqueadores até a função correspondente ser homologada.\n`;
}

async function applyRuntimeCompatibility(root) {
  const adapterPath = path.join(root, 'src', 'api', 'base44Client.js');
  if (!(await pathExists(adapterPath))) return { applied: false, adapter: null, serviceWorkerPatched: false, workspace: { prepared: false }, usages: [], converted: [], bridged: [], emulated: [], unsupported: [] };
  const adapterSource = await fs.readFile(adapterPath, 'utf8');
  const adapter = patchGeneratedAdapterSource(adapterSource);
  if (adapter.patched) await fs.writeFile(adapterPath, adapter.source, 'utf8');
  let serviceWorkerPatched = false;
  for (const candidate of ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/main.ts']) {
    const file = path.join(root, candidate); if (!(await pathExists(file))) continue;
    const source = await fs.readFile(file, 'utf8'); const patched = patchDemoServiceWorkerSource(source);
    if (patched !== source) { await fs.writeFile(file, patched, 'utf8'); serviceWorkerPatched = true; }
    break;
  }
  const workspace = await prepareWorkspaceFiles(root);
  const audit = await auditRuntimeContracts(root);
  const inventory = { schemaVersion: 2, generatedAt: new Date().toISOString(), workspace, usages: audit.usages, summary: { converted: audit.converted.length, bridged: audit.bridged.length, emulated: audit.emulated.length, unsupported: audit.unsupported.length } };
  await writeJson(path.join(root, 'RB-RUNTIME-CONTRACTS.json'), inventory);
  await fs.writeFile(path.join(root, 'RUNTIME_COMPATIBILITY.md'), runtimeMarkdown(audit, workspace), 'utf8');
  if (audit.unsupported.length) {
    throw new BridgeError('UNSUPPORTED_BASE44_RUNTIME_METHOD', `A aplicação usa contratos Base44 ainda não convertidos: ${audit.unsupported.slice(0, 8).map((item) => `${item.namespace}.${item.method} em ${item.file}`).join(', ')}${audit.unsupported.length > 8 ? '…' : ''}`, { unsupported: audit.unsupported, registry: { entities: ENTITY_METHOD_SUPPORT, auth: AUTH_METHOD_SUPPORT, users: USERS_METHOD_SUPPORT, appLogs: APP_LOG_METHOD_SUPPORT, analytics: ANALYTICS_METHOD_SUPPORT, functions: FUNCTION_METHOD_SUPPORT, connectors: CONNECTOR_METHOD_SUPPORT } });
  }
  return { applied: adapter.patched || serviceWorkerPatched || workspace.prepared, adapter: path.relative(root, adapterPath).split(path.sep).join('/'), adapterPatched: adapter.patched, upgradedFromLegacy: adapter.upgradedFromLegacy, serviceWorkerPatched, workspace, usages: audit.usages, converted: audit.converted, bridged: audit.bridged, emulated: audit.emulated, unsupported: [] };
}

module.exports = {
  ENTITY_METHOD_SUPPORT, AUTH_METHOD_SUPPORT, USERS_METHOD_SUPPORT, APP_LOG_METHOD_SUPPORT, ANALYTICS_METHOD_SUPPORT, FUNCTION_METHOD_SUPPORT, CONNECTOR_METHOD_SUPPORT,
  SUPPORTED_ENTITY_METHODS, SUPPORTED_AUTH_METHODS, SUPPORTED_APP_LOG_METHODS, SUPPORTED_FUNCTION_METHODS, COMPATIBILITY_MARKER,
  extractEntityMethodUsages, extractRuntimeUsages, classifyRuntimeUsage, patchGeneratedAdapterSource, patchDemoServiceWorkerSource, prepareWorkspaceFiles, auditRuntimeContracts, auditEntityMethods, applyRuntimeCompatibility,
};
