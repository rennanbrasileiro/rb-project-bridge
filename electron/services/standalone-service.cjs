'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { listFiles, pathExists, readJson, writeJson, safeSlug } = require('../core/fs-utils.cjs');
const { BridgeError } = require('../core/errors.cjs');

const SUPABASE_JS_VERSION = '2.110.8';
const SUPABASE_CLI_VERSION = '2.109.1';

function stripJsonComments(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const current = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (current === '\n') { lineComment = false; output += current; }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') { blockComment = false; i += 1; }
      else if (current === '\n') output += '\n';
      continue;
    }
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) inString = false;
      continue;
    }
    if (current === '"' || current === "'") { inString = true; quote = current; output += current; continue; }
    if (current === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (current === '/' && next === '*') { blockComment = true; i += 1; continue; }
    output += current;
  }
  return output.replace(/,\s*([}\]])/g, '$1');
}

function parseJsonc(text, filePath = '') {
  try { return JSON.parse(stripJsonComments(text)); }
  catch (error) {
    throw new BridgeError('BASE44_SCHEMA_INVALID', `Não foi possível interpretar ${filePath || 'um schema Base44'}.`, { filePath, cause: error.message });
  }
}

function snakeCase(input) {
  return String(input ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function quoteIdent(input) {
  return `"${String(input).replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function propertySqlType(property = {}) {
  if (Array.isArray(property.type)) {
    const nonNull = property.type.find((value) => value !== 'null');
    return propertySqlType({ ...property, type: nonNull || 'string' });
  }
  switch (property.type) {
    case 'integer': return 'bigint';
    case 'number': return 'numeric';
    case 'boolean': return 'boolean';
    case 'object':
    case 'array': return 'jsonb';
    case 'string':
    default:
      if (property.format === 'date') return 'date';
      if (property.format === 'date-time' || property.format === 'datetime') return 'timestamptz';
      return 'text';
  }
}

function propertyDefault(property = {}) {
  if (!Object.prototype.hasOwnProperty.call(property, 'default')) return '';
  if (property.type === 'object' || property.type === 'array') return ` default ${sqlLiteral(JSON.stringify(property.default))}::jsonb`;
  return ` default ${sqlLiteral(property.default)}`;
}

function entityTableName(entityName) {
  return entityName === 'User' ? 'profiles' : snakeCase(entityName);
}

function buildEntitySql(entity, sourcePath) {
  const name = entity.name || path.basename(sourcePath, path.extname(sourcePath));
  const table = entityTableName(name);
  const required = new Set(entity.required || []);
  const isProfile = name === 'User';
  const columns = [];
  columns.push(isProfile
    ? '  id uuid primary key references auth.users(id) on delete cascade'
    : '  id uuid primary key default gen_random_uuid()');
  if (!isProfile) columns.push('  created_by_id uuid references auth.users(id) on delete set null');
  columns.push('  created_at timestamptz not null default now()');
  columns.push('  updated_at timestamptz not null default now()');

  const checks = [];
  const mapping = {};
  for (const [propertyName, property] of Object.entries(entity.properties || {})) {
    if (['id', 'created_at', 'updated_at', 'created_date', 'updated_date', 'created_by_id'].includes(propertyName)) continue;
    const column = snakeCase(propertyName);
    mapping[propertyName] = column;
    const notNull = required.has(propertyName) ? ' not null' : '';
    columns.push(`  ${quoteIdent(column)} ${propertySqlType(property)}${notNull}${propertyDefault(property)}`);
    if (Array.isArray(property.enum) && property.enum.length) {
      checks.push(`  constraint ${quoteIdent(`${table}_${column}_check`)} check (${quoteIdent(column)} in (${property.enum.map(sqlLiteral).join(', ')}))`);
    }
  }
  const definitions = [...columns, ...checks].join(',\n');
  const policies = isProfile
    ? `alter table public.${quoteIdent(table)} enable row level security;\ncreate policy ${quoteIdent(`${table}_select_own`)} on public.${quoteIdent(table)} for select to authenticated using (id = auth.uid());\ncreate policy ${quoteIdent(`${table}_update_own`)} on public.${quoteIdent(table)} for update to authenticated using (id = auth.uid()) with check (id = auth.uid());`
    : `alter table public.${quoteIdent(table)} enable row level security;\ncreate policy ${quoteIdent(`${table}_select_own`)} on public.${quoteIdent(table)} for select to authenticated using (created_by_id = auth.uid());\ncreate policy ${quoteIdent(`${table}_insert_own`)} on public.${quoteIdent(table)} for insert to authenticated with check (created_by_id = auth.uid());\ncreate policy ${quoteIdent(`${table}_update_own`)} on public.${quoteIdent(table)} for update to authenticated using (created_by_id = auth.uid()) with check (created_by_id = auth.uid());\ncreate policy ${quoteIdent(`${table}_delete_own`)} on public.${quoteIdent(table)} for delete to authenticated using (created_by_id = auth.uid());`;

  return {
    name,
    table,
    mapping,
    sql: `-- Source: ${sourcePath.replaceAll('\\', '/')}\ncreate table if not exists public.${quoteIdent(table)} (\n${definitions}\n);\n\n${policies}\n\n`,
  };
}

function removeFunctionCall(source, functionName) {
  const marker = `${functionName}(`;
  let index = source.indexOf(marker);
  if (index < 0) return source;
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;
  let end = index;
  for (let i = index; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { inString = true; quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  while (/[\s,]/.test(source[end] || '')) end += 1;
  return source.slice(0, index) + source.slice(end);
}

function standaloneClientSource(entityMap) {
  return `import { createClient } from '@supabase/supabase-js';\n\nconst entityMap = ${JSON.stringify(entityMap, null, 2)};\nconst demoMode = import.meta.env.VITE_RB_DEMO_MODE === 'true' || !import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;\nconst supabase = demoMode ? null : createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);\nconst DEMO_USER = { id: '00000000-0000-4000-8000-000000000001', email: 'demo@local.test', full_name: 'Usuário de demonstração', role: 'admin' };\n\nfunction normalizeField(field) { return ({ created_date: 'created_at', updated_date: 'updated_at', created_by: 'created_by_id' })[field] || field; }\nfunction tableFor(entity) { return entityMap[entity]?.table || entity.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(); }\nfunction storeKey(entity) { return 'rb_demo_' + tableFor(entity); }\nfunction demoRows(entity) { try { return JSON.parse(localStorage.getItem(storeKey(entity)) || '[]'); } catch { return []; } }\nfunction saveDemo(entity, rows) { localStorage.setItem(storeKey(entity), JSON.stringify(rows)); }\nfunction sortRows(rows, sort) { if (!sort) return rows; const desc = String(sort).startsWith('-'); const key = normalizeField(desc ? String(sort).slice(1) : String(sort)); return [...rows].sort((a,b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (desc ? -1 : 1)); }\nfunction applyFilter(rows, query = {}) { return rows.filter((row) => Object.entries(query || {}).every(([key,value]) => { const actual = row[normalizeField(key)]; if (Array.isArray(value)) return value.includes(actual); if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(actual); return actual === value; })); }\nfunction now() { return new Date().toISOString(); }\nfunction decorate(row) { if (!row) return row; return { ...row, created_date: row.created_date || row.created_at, updated_date: row.updated_date || row.updated_at, created_by: row.created_by || row.created_by_id }; }\nfunction mapPayload(data = {}) { const out = {}; for (const [key,value] of Object.entries(data)) out[normalizeField(key)] = value; return out; }\nfunction createDemo(entity, data) { const rows = demoRows(entity); const row = { id: crypto.randomUUID(), created_at: now(), updated_at: now(), created_by_id: DEMO_USER.id, ...data }; rows.push(row); saveDemo(entity, rows); return row; }\nasync function currentUserId() { const { data } = await supabase.auth.getUser(); return data.user?.id || null; }\nfunction throwIf(error) { if (error) throw error; }\n\nfunction demoEntity(entity) { return {\n  async list(sort, limit) { const rows = sortRows(demoRows(entity), sort); return (limit ? rows.slice(0, limit) : rows).map(decorate); },\n  async filter(query, sort, limit) { const rows = sortRows(applyFilter(demoRows(entity), query), sort); return (limit ? rows.slice(0, limit) : rows).map(decorate); },\n  async get(id) { return decorate(demoRows(entity).find((row) => row.id === id) || null); },\n  async create(data) { return decorate(createDemo(entity, mapPayload(data))); },\n  async bulkCreate(items) { return (await Promise.all(items.map((item) => createDemo(entity, mapPayload(item))))).map(decorate); },\n  async update(id, data) { const rows = demoRows(entity); const index = rows.findIndex((row) => row.id === id); if (index < 0) throw new Error('Registro não encontrado'); rows[index] = { ...rows[index], ...mapPayload(data), updated_at: now() }; saveDemo(entity, rows); return decorate(rows[index]); },\n  async delete(id) { const rows = demoRows(entity); const selected = rows.find((row) => row.id === id) || null; saveDemo(entity, rows.filter((row) => row.id !== id)); return decorate(selected); },\n}; }\n\nfunction remoteEntity(entity) { const table = tableFor(entity); return {\n  async list(sort, limit) { let query = supabase.from(table).select('*'); if (sort) { const desc = String(sort).startsWith('-'); query = query.order(normalizeField(desc ? String(sort).slice(1) : String(sort)), { ascending: !desc }); } if (limit) query = query.limit(limit); const { data, error } = await query; throwIf(error); return (data || []).map(decorate); },\n  async filter(filters = {}, sort, limit) { let query = supabase.from(table).select('*'); for (const [key,value] of Object.entries(filters)) { const field = normalizeField(key); if (Array.isArray(value)) query = query.in(field, value); else if (value && typeof value === 'object' && '$in' in value) query = query.in(field, value.$in); else query = query.eq(field, value); } if (sort) { const desc = String(sort).startsWith('-'); query = query.order(normalizeField(desc ? String(sort).slice(1) : String(sort)), { ascending: !desc }); } if (limit) query = query.limit(limit); const { data, error } = await query; throwIf(error); return (data || []).map(decorate); },\n  async get(id) { const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle(); throwIf(error); return decorate(data); },\n  async create(data) { const userId = await currentUserId(); const mapped = mapPayload(data); const payload = entity === 'User' ? mapped : { created_by_id: userId, ...mapped }; const { data: row, error } = await supabase.from(table).insert(payload).select().single(); throwIf(error); return decorate(row); },\n  async bulkCreate(items) { const userId = await currentUserId(); const mappedItems = items.map(mapPayload); const payload = entity === 'User' ? mappedItems : mappedItems.map((item) => ({ created_by_id: userId, ...item })); const { data, error } = await supabase.from(table).insert(payload).select(); throwIf(error); return (data || []).map(decorate); },\n  async update(id, data) { const { data: row, error } = await supabase.from(table).update({ ...mapPayload(data), updated_at: now() }).eq('id', id).select().single(); throwIf(error); return decorate(row); },\n  async delete(id) { const { data: row, error } = await supabase.from(table).delete().eq('id', id).select().maybeSingle(); throwIf(error); return decorate(row); },\n}; }\n\nconst entities = new Proxy({}, { get: (_target, entity) => demoMode ? demoEntity(String(entity)) : remoteEntity(String(entity)) });\nconst auth = {\n  async me() { if (demoMode) return DEMO_USER; const { data: { user }, error } = await supabase.auth.getUser(); throwIf(error); if (!user) return null; const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(); return { ...user, ...(profile || {}) }; },\n  async login(email) { if (demoMode) return DEMO_USER; if (!email) throw new Error('Informe o e-mail para autenticação.'); const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } }); throwIf(error); return { email }; },\n  async redirectToLogin() { if (demoMode) return DEMO_USER; const email = window.prompt('Informe seu e-mail para receber o link de acesso:'); if (!email) return null; return this.login(email); },\n  async logout() { if (!demoMode) { const { error } = await supabase.auth.signOut(); throwIf(error); } return true; },\n  async updateMe(data) { if (demoMode) return { ...DEMO_USER, ...data }; const user = await this.me(); if (!user) throw new Error('Usuário não autenticado.'); const { data: profile, error } = await supabase.from('profiles').upsert({ id: user.id, ...data, updated_at: now() }).select().single(); throwIf(error); return { ...user, ...profile }; },\n};\n\nasync function invokeIntegration(name, payload) { if (demoMode) { console.info('[RB demo integration]', name, payload); return { data: { demo: true, name } }; } const { data, error } = await supabase.functions.invoke('integration-' + name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(), { body: payload }); throwIf(error); return data; }\nconst Core = new Proxy({}, { get: (_target, name) => async (payload = {}) => {\n  if (name === 'UploadFile' && payload.file && !demoMode) { const file = payload.file; const fileName = (crypto.randomUUID ? crypto.randomUUID() : Date.now()) + '-' + file.name; const { error } = await supabase.storage.from('uploads').upload(fileName, file); throwIf(error); const { data } = supabase.storage.from('uploads').getPublicUrl(fileName); return { file_url: data.publicUrl }; }\n  return invokeIntegration(String(name), payload);\n} });\n\nexport { supabase, demoMode };\nexport const base44 = { entities, auth, functions: { invoke: (name, payload) => demoMode ? Promise.resolve({ data: { demo: true, name } }) : supabase.functions.invoke(name, { body: payload }) }, integrations: { Core }, asServiceRole: { entities, integrations: { Core } } };\n`;
}

function standaloneAuthContextSource() {
  return `import React, { createContext, useContext, useEffect, useState } from 'react';\nimport { base44, demoMode } from '@/api/base44Client';\n\nconst AuthContext = createContext();\nexport const AuthProvider = ({ children }) => {\n  const [user,setUser]=useState(null);\n  const [isAuthenticated,setAuthenticated]=useState(false);\n  const [isLoadingAuth,setLoadingAuth]=useState(true);\n  const [authError,setAuthError]=useState(null);\n  const appPublicSettings={ id:'standalone-supabase', public_settings:{}, demoMode };\n  const checkAppState=async()=>{ setLoadingAuth(true); setAuthError(null); try { const current=await base44.auth.me(); setUser(current); setAuthenticated(Boolean(current)); if (!current && !demoMode) setAuthError({type:'auth_required',message:'Authentication required'}); } catch(error) { setUser(null); setAuthenticated(false); setAuthError({type:'unknown',message:error.message}); } finally { setLoadingAuth(false); } };\n  useEffect(()=>{ void checkAppState(); },[]);\n  const logout=async()=>{ await base44.auth.logout(); setUser(null); setAuthenticated(false); };\n  const navigateToLogin=async()=>{ await base44.auth.redirectToLogin(window.location.href); };\n  return <AuthContext.Provider value={{user,isAuthenticated,isLoadingAuth,isLoadingPublicSettings:false,authError,appPublicSettings,logout,navigateToLogin,checkAppState}}>{children}</AuthContext.Provider>;\n};\nexport const useAuth=()=>{ const context=useContext(AuthContext); if(!context) throw new Error('useAuth must be used within an AuthProvider'); return context; };\n`;
}

function previewServerSource() {
  return `import http from 'node:http';\nimport fs from 'node:fs/promises';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'));\nconst mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon' };\nconst server = http.createServer(async (req,res) => { try { const url = new URL(req.url, 'http://127.0.0.1'); let target = path.join(root, decodeURIComponent(url.pathname)); if (url.pathname === '/' || !(await fs.stat(target).catch(()=>null))?.isFile()) target = path.join(root, 'index.html'); if (!target.startsWith(root)) throw new Error('invalid path'); const body = await fs.readFile(target); res.writeHead(200, {'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(body); } catch (error) { res.writeHead(404); res.end('Not found'); } });\nserver.listen(Number(process.env.PORT||4173), '127.0.0.1', () => console.log('Preview local: http://127.0.0.1:' + server.address().port));\n`;
}

function verificationScriptSource() {
  return `import fs from 'node:fs';\nimport path from 'node:path';\nconst root = process.cwd();\nconst ignored = new Set(['node_modules','.git','dist','build','coverage']);\nconst failures = [];\nfunction walk(dir) { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) { if (ignored.has(entry.name)) continue; const file = path.join(dir,entry.name); if (entry.isDirectory()) walk(file); else if (/\\.(js|jsx|ts|tsx|json|jsonc|mjs|cjs)$/.test(entry.name)) { const text=fs.readFileSync(file,'utf8'); if (/@base44\\/(sdk|vite-plugin)|from ['\"]base44['\"]/.test(text)) failures.push(path.relative(root,file)); } } }\nwalk(root);\nconst packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));\nfor (const name of Object.keys({...packageJson.dependencies,...packageJson.devDependencies})) if (name === 'base44' || name.startsWith('@base44/')) failures.push('package.json:' + name);\nif (!fs.existsSync(path.join(root,'supabase','config.toml'))) failures.push('supabase/config.toml missing');\nif (!fs.existsSync(path.join(root,'.env.example'))) failures.push('.env.example missing');\nif (failures.length) { console.error('Standalone gate failed:', failures); process.exit(1); }\nconsole.log('Standalone gate passed: zero Base44 runtime dependencies.');\n`;
}

function workflowSource() {
  return `name: Validate standalone application\non:\n  push:\n    branches: [main]\n  pull_request:\npermissions:\n  contents: read\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: npm\n      - run: npm ci --ignore-scripts --no-audit --no-fund\n      - run: npm run check:standalone\n      - run: npm run lint --if-present\n      - run: npm run typecheck --if-present\n      - run: npm run build:demo\n      - uses: actions/upload-artifact@v4\n        with:\n          name: local-preview\n          path: dist\n          if-no-files-found: error\n`;
}

function supabaseConfig(projectId) {
  return `project_id = "${safeSlug(projectId, 'rb-standalone')}"\n\n[api]\nenabled = true\nport = 54321\nschemas = ["public", "graphql_public"]\nextra_search_path = ["public", "extensions"]\nmax_rows = 1000\n\n[db]\nport = 54322\nmajor_version = 17\n\n[studio]\nenabled = true\nport = 54323\n\n[inbucket]\nenabled = true\nport = 54324\n\n[auth]\nenabled = true\nsite_url = "http://localhost:5173"\nadditional_redirect_urls = ["http://127.0.0.1:5173", "http://localhost:4173"]\njwt_expiry = 3600\nenable_signup = true\n`;
}

function setupDocumentation(entityResults, blockers) {
  return `# Supabase e execução local\n\nEste repositório foi preparado pelo RB Project Bridge para funcionar sem runtime Base44.\n\n## Preview imediato, sem banco remoto\n\n\`\`\`bash\nnpm install\nnpm run dev:demo\n\`\`\`\n\nO modo demo usa armazenamento local do navegador. Ele existe para validar telas, navegação e build antes de conectar o banco.\n\n## Supabase local completo\n\nRequisitos: Node.js 22+, Docker Desktop e portas 54321–54324 disponíveis.\n\n\`\`\`bash\nnpm install\nnpm run supabase:start\nnpm run supabase:reset\ncp .env.example .env.local\nnpm run dev\n\`\`\`\n\nApós \`supabase start\`, copie a URL e a publishable/anon key exibidas pelo CLI para \`.env.local\`.\n\n## Estrutura gerada\n\n- ${entityResults.length} entidades convertidas em migrations PostgreSQL.\n- RLS habilitada com políticas conservadoras por proprietário.\n- Cliente compatível em \`src/api/base44Client.js\`, implementado sobre Supabase.\n- Preview estático produzido por \`npm run build:demo\`.\n\n## Itens que exigem revisão\n\n${blockers.length ? blockers.map((item) => `- ${item}`).join('\n') : '- Nenhum bloqueador estrutural detectado.'}\n`;
}

class StandaloneService {
  constructor({ logger, emit }) { this.logger = logger; this.emit = emit; }

  async inventory(root) {
    const files = await listFiles(root, { ignoredDirs: ['node_modules', '.git', 'dist', 'build', 'release'] });
    const entityFiles = files.filter((file) => /[\\/]base44[\\/]entities[\\/].+\.jsonc?$/i.test(file));
    const functionFiles = files.filter((file) => /[\\/]base44[\\/]functions[\\/].+[\\/]entry\.(ts|js)$/i.test(file));
    const runtimeFiles = [];
    for (const file of files) {
      if (!/\.(js|jsx|ts|tsx|mjs|cjs|json)$/i.test(file)) continue;
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      if (/@base44\/(sdk|vite-plugin)|from\s+['"]base44['"]/.test(text)) runtimeFiles.push(path.relative(root, file));
    }
    return { entityFiles, functionFiles, runtimeFiles };
  }

  async convertEntities(root, entityFiles) {
    const results = [];
    for (const file of entityFiles) {
      const relative = path.relative(root, file);
      const parsed = parseJsonc(await fs.readFile(file, 'utf8'), relative);
      results.push(buildEntitySql(parsed, relative));
    }
    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  async updatePackageJson(root) {
    const packagePath = path.join(root, 'package.json');
    const packageJson = await readJson(packagePath);
    if (!packageJson) throw new BridgeError('PACKAGE_JSON_MISSING', 'O projeto exportado não possui package.json válido.');
    packageJson.dependencies = packageJson.dependencies || {};
    packageJson.devDependencies = packageJson.devDependencies || {};
    for (const collection of [packageJson.dependencies, packageJson.devDependencies]) {
      for (const key of Object.keys(collection)) if (key === 'base44' || key.startsWith('@base44/')) delete collection[key];
    }
    packageJson.dependencies['@supabase/supabase-js'] = SUPABASE_JS_VERSION;
    packageJson.devDependencies.supabase = SUPABASE_CLI_VERSION;
    packageJson.scripts = {
      ...packageJson.scripts,
      'dev:demo': 'vite --mode demo',
      'build:demo': 'vite build --mode demo',
      'preview:local': 'node scripts/preview-server.mjs',
      'check:standalone': 'node scripts/verify-standalone.mjs',
      'supabase:start': 'supabase start',
      'supabase:stop': 'supabase stop',
      'supabase:reset': 'supabase db reset',
      'supabase:types': 'supabase gen types typescript --local > src/platform/database.types.ts',
    };
    await writeJson(packagePath, packageJson);
    return packageJson;
  }

  async updateViteConfig(root) {
    const candidates = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts'];
    for (const candidate of candidates) {
      const file = path.join(root, candidate);
      if (!(await pathExists(file))) continue;
      let source = await fs.readFile(file, 'utf8');
      source = source.split(/\r?\n/).filter((line) => !line.includes('@base44/vite-plugin')).join('\n');
      source = removeFunctionCall(source, 'base44');
      await fs.writeFile(file, `${source.trim()}\n`, 'utf8');
      return candidate;
    }
    return null;
  }

  async rewriteKnownRuntimeFiles(root) {
    const authContext = path.join(root, 'src', 'lib', 'AuthContext.jsx');
    if (await pathExists(authContext)) {
      const source = await fs.readFile(authContext, 'utf8');
      if (source.includes('@base44/sdk') || source.includes('appParams')) {
        await fs.writeFile(authContext, standaloneAuthContextSource(), 'utf8');
      }
    }
  }

  async convertFunctions(root, functionFiles) {
    const converted = [];
    const blockers = [];
    for (const file of functionFiles) {
      const relative = path.relative(path.join(root, 'base44', 'functions'), file).replaceAll('\\', '/');
      const functionName = relative.replace(/\/entry\.(ts|js)$/i, '').replaceAll('/', '-');
      const destination = path.join(root, 'supabase', 'functions', functionName, 'source.base44.ts');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(file, destination);
      const source = await fs.readFile(file, 'utf8');
      const wrapper = `// Generated handoff wrapper. Review source.base44.ts before production deployment.\nimport "jsr:@supabase/functions-js/edge-runtime.d.ts";\nDeno.serve(async () => new Response(JSON.stringify({ error: "Function ${functionName} requires reviewed conversion from Base44." }), { status: 501, headers: { "content-type": "application/json" } }));\n`;
      await fs.writeFile(path.join(root, 'supabase', 'functions', functionName, 'index.ts'), wrapper, 'utf8');
      converted.push({ name: functionName, source: relative });
      if (/context\.base44|context\.secrets|request\.rawBody/.test(source)) blockers.push(`Função ${functionName}: código original preservado, mas requer revisão antes do deploy.`);
    }
    return { converted, blockers };
  }

  async transform(root, options = {}) {
    this.emit('migration:progress', { step: 'standalone', status: 'running', message: 'Gerando aplicação independente com Supabase...' });
    const inventory = await this.inventory(root);
    const entities = await this.convertEntities(root, inventory.entityFiles);
    if (!entities.length) throw new BridgeError('BASE44_ENTITIES_MISSING', 'Nenhuma entidade Base44 foi encontrada para gerar o banco Supabase.');
    const entityMap = Object.fromEntries(entities.map((entity) => [entity.name, { table: entity.table, fields: entity.mapping }]));
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const migrationPath = path.join(root, 'supabase', 'migrations', `${timestamp}_base44_schema.sql`);
    await fs.mkdir(path.dirname(migrationPath), { recursive: true });
    const header = `create extension if not exists pgcrypto;\n\ncreate or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;\n\n`;
    const triggerSql = entities.map((entity) => `drop trigger if exists ${quoteIdent(`${entity.table}_updated_at`)} on public.${quoteIdent(entity.table)};\ncreate trigger ${quoteIdent(`${entity.table}_updated_at`)} before update on public.${quoteIdent(entity.table)} for each row execute function public.set_updated_at();`).join('\n\n');
    await fs.writeFile(migrationPath, `${header}${entities.map((entity) => entity.sql).join('\n')}${triggerSql}\n`, 'utf8');
    await fs.writeFile(path.join(root, 'supabase', 'seed.sql'), '-- Adicione dados de desenvolvimento seguros aqui.\n', 'utf8');
    await fs.writeFile(path.join(root, 'supabase', 'config.toml'), supabaseConfig(options.projectName || path.basename(root)), 'utf8');

    const functionResult = await this.convertFunctions(root, inventory.functionFiles);
    await fs.mkdir(path.join(root, 'src', 'api'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'api', 'base44Client.js'), standaloneClientSource(entityMap), 'utf8');
    await fs.mkdir(path.join(root, 'src', 'platform'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'platform', 'entity-map.json'), JSON.stringify(entityMap, null, 2), 'utf8');
    await fs.writeFile(path.join(root, 'src', 'platform', 'database.types.ts'), 'export type Database = Record<string, never>; // execute npm run supabase:types after starting Supabase local\n', 'utf8');
    await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(root, 'scripts', 'preview-server.mjs'), previewServerSource(), 'utf8');
    await fs.writeFile(path.join(root, 'scripts', 'verify-standalone.mjs'), verificationScriptSource(), 'utf8');
    await fs.mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(root, '.github', 'workflows', 'validate.yml'), workflowSource(), 'utf8');
    await fs.mkdir(path.join(root, '.devcontainer'), { recursive: true });
    await fs.writeFile(path.join(root, '.devcontainer', 'devcontainer.json'), JSON.stringify({ name: 'Standalone Supabase App', image: 'mcr.microsoft.com/devcontainers/javascript-node:22', features: { 'ghcr.io/devcontainers/features/docker-in-docker:2': {} }, forwardPorts: [5173, 54321, 54323], postCreateCommand: 'npm install --ignore-scripts --no-audit --no-fund' }, null, 2), 'utf8');
    await fs.writeFile(path.join(root, '.env.example'), 'VITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_PUBLISHABLE_KEY=\nVITE_RB_DEMO_MODE=false\n', 'utf8');
    await fs.writeFile(path.join(root, '.env.demo'), 'VITE_RB_DEMO_MODE=true\n', 'utf8');
    await this.updateViteConfig(root);
    await this.rewriteKnownRuntimeFiles(root);
    const packageJson = await this.updatePackageJson(root);
    for (const lockName of ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']) {
      const lockPath = path.join(root, lockName);
      if (await pathExists(lockPath)) await fs.rm(lockPath, { force: true });
    }

    const base44Directory = path.join(root, 'base44');
    if (await pathExists(base44Directory)) await fs.rm(base44Directory, { recursive: true, force: true });
    const legacyParams = path.join(root, 'src', 'lib', 'app-params.js');
    if (await pathExists(legacyParams)) await fs.rm(legacyParams, { force: true });

    const report = {
      mode: 'standalone-supabase',
      generatedAt: new Date().toISOString(),
      entities: entities.map(({ name, table }) => ({ name, table })),
      functions: functionResult.converted,
      blockers: functionResult.blockers,
      packages: { supabaseJs: SUPABASE_JS_VERSION, supabaseCli: SUPABASE_CLI_VERSION },
      runtimeImportsBefore: inventory.runtimeFiles,
      migrationPath: path.relative(root, migrationPath).replaceAll('\\', '/'),
    };
    await writeJson(path.join(root, 'RB-STANDALONE-REPORT.json'), report);
    await fs.writeFile(path.join(root, 'MIGRATION_REPORT.md'), `# Relatório de desacoplamento\n\n- Entidades convertidas: ${entities.length}\n- Funções preservadas para revisão: ${functionResult.converted.length}\n- Dependências Base44 removidas do package.json.\n- Cliente runtime substituído por adapter Supabase/demo.\n\n## Bloqueadores de produção\n\n${functionResult.blockers.length ? functionResult.blockers.map((item) => `- ${item}`).join('\n') : '- Nenhum.'}\n`, 'utf8');
    await fs.writeFile(path.join(root, 'SUPABASE_SETUP.md'), setupDocumentation(entities, functionResult.blockers), 'utf8');
    await fs.writeFile(path.join(root, 'README.md'), `# ${options.projectName || packageJson.name || 'Aplicação'}\n\nAplicação exportada e preparada pelo RB Project Bridge para continuidade independente com Supabase.\n\n## Preview local imediato\n\n\`\`\`bash\nnpm install\nnpm run dev:demo\n\`\`\`\n\n## Banco local\n\nConsulte [SUPABASE_SETUP.md](SUPABASE_SETUP.md).\n`, 'utf8');

    const gate = await this.verify(root);
    this.logger.info('standalone.transform.complete', { root, entities: entities.length, functions: functionResult.converted.length });
    this.emit('migration:progress', { step: 'standalone', status: 'complete', message: `Supabase preparado: ${entities.length} entidades e preview demo configurado.` });
    return { ...report, gate };
  }

  async verify(root) {
    const files = await listFiles(root, { ignoredDirs: ['node_modules', '.git', 'dist', 'build', 'release'] });
    const violations = [];
    for (const file of files) {
      if (!/\.(js|jsx|ts|tsx|mjs|cjs|json)$/i.test(file)) continue;
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      if (/@base44\/(sdk|vite-plugin)|from\s+['"]base44['"]/.test(text)) violations.push(path.relative(root, file));
    }
    const packageJson = await readJson(path.join(root, 'package.json'), {});
    for (const key of Object.keys({ ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) })) {
      if (key === 'base44' || key.startsWith('@base44/')) violations.push(`package.json:${key}`);
    }
    const required = ['supabase/config.toml', '.env.example', 'src/api/base44Client.js', 'scripts/verify-standalone.mjs'];
    for (const item of required) if (!(await pathExists(path.join(root, item)))) violations.push(`missing:${item}`);
    if (violations.length) throw new BridgeError('STANDALONE_GATE_FAILED', 'A aplicação ainda possui dependências Base44 ou arquivos obrigatórios ausentes.', { violations });
    return { passed: true, violations: [] };
  }
}

module.exports = {
  StandaloneService,
  stripJsonComments,
  parseJsonc,
  snakeCase,
  propertySqlType,
  buildEntitySql,
  removeFunctionCall,
};
