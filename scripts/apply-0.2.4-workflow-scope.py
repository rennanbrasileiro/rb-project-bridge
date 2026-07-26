from pathlib import Path
import json
import re

# GitHub service: request/refresh workflow scope, reduce noisy API logs, and fail clearly.
p = Path('electron/services/github-service.cjs')
s = p.read_text(encoding='utf-8')

s = s.replace("const GITHUB_DEVICE_URL = 'https://github.com/login/device';", "const GITHUB_DEVICE_URL = 'https://github.com/login/device';\nconst DELIVERY_SCOPES = ['repo', 'read:org', 'gist', 'workflow'];")

s = s.replace("function extractGitHubDeviceCode(text) { return String(text).match(/\\b[A-Z0-9]{4}-[A-Z0-9]{4}\\b/i)?.[0]?.toUpperCase() ?? null; }", "function extractGitHubDeviceCode(text) { return String(text).match(/\\b[A-Z0-9]{4}-[A-Z0-9]{4}\\b/i)?.[0]?.toUpperCase() ?? null; }\nfunction parseGitHubScopes(text) {\n  const line = String(text || '').split(/\\r?\\n/).find((entry) => /Token scopes:/i.test(entry)) || '';\n  return [...line.matchAll(/'([^']+)'/g)].map((match) => match[1]);\n}\nfunction isWorkflowScopeError(error) {\n  const detail = `${error?.message || ''} ${error?.details?.stderr || ''}`;\n  return /workflow.*scope|refusing to allow an OAuth App to create or update workflow/i.test(detail);\n}")

old = """  async authStatus() { try { const result = await this.runGh(['auth', 'status', '--hostname', 'github.com'], { timeoutMs: 30_000 }); return { authenticated: true, output: result.stdout || result.stderr }; } catch (error) { return { authenticated: false, output: error.details?.stderr || error.message }; } }
  async login() {
    let opened = false, outputBuffer = '';
    const openDevicePage = async () => { if (opened) return; opened = true; try { await this.openExternal?.(GITHUB_DEVICE_URL); } catch (error) { this.logger.warn('github.auth.browser.failed', { message: error.message }); } };
    await openDevicePage();
    await this.runGh(['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key'], { timeoutMs: 15 * 60 * 1000, onOutput: (entry) => { this.emit('github:output', entry); outputBuffer = `${outputBuffer}${entry.text}`.slice(-4096); const code = extractGitHubDeviceCode(outputBuffer); if (code) this.emit('github:output', { stream: 'stdout', text: `Autorize no navegador usando o código ${code}.\\n` }); if (outputBuffer.includes(GITHUB_DEVICE_URL)) void openDevicePage(); } });
    return this.getAccounts();
  }
"""
new = """  async authStatus() {
    try {
      const result = await this.runGh(['auth', 'status', '--hostname', 'github.com'], { timeoutMs: 30_000, onOutput: () => {} });
      const output = result.stdout || result.stderr || '';
      return { authenticated: true, output, scopes: parseGitHubScopes(output) };
    } catch (error) { return { authenticated: false, output: error.details?.stderr || error.message, scopes: [] }; }
  }
  async interactiveAuth(args, options = {}) {
    let opened = false, outputBuffer = '';
    const openDevicePage = async () => { if (opened) return; opened = true; try { await this.openExternal?.(GITHUB_DEVICE_URL); } catch (error) { this.logger.warn('github.auth.browser.failed', { message: error.message }); } };
    await openDevicePage();
    return this.runGh(args, { timeoutMs: options.timeoutMs ?? 15 * 60 * 1000, signal: options.signal, onOutput: (entry) => {
      this.emit('github:output', entry);
      outputBuffer = `${outputBuffer}${entry.text}`.slice(-4096);
      const code = extractGitHubDeviceCode(outputBuffer);
      if (code) this.emit('github:output', { stream: 'stdout', text: `Autorize no navegador usando o código ${code}.\\n` });
      if (outputBuffer.includes(GITHUB_DEVICE_URL)) void openDevicePage();
    } });
  }
  async login() {
    await this.interactiveAuth(['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key', '--scopes', DELIVERY_SCOPES.join(',')]);
    return this.getAccounts();
  }
  async ensureDeliveryScopes(options = {}) {
    const current = await this.authStatus();
    if (!current.authenticated) throw new BridgeError('GITHUB_NOT_AUTHENTICATED', 'Conecte o GitHub antes de continuar.');
    if (current.scopes.includes('workflow')) return current;
    this.emit('migration:progress', { step: 'github-publish', status: 'running', message: 'O GitHub precisa autorizar a publicação do workflow de validação. Confirme o novo código no navegador.' });
    try {
      await this.interactiveAuth(['auth', 'refresh', '--hostname', 'github.com', '--scopes', 'workflow'], options);
    } catch (error) {
      throw new BridgeError('GITHUB_WORKFLOW_SCOPE_REQUIRED', 'A autorização adicional do GitHub não foi concluída. O código e o build locais foram preservados; autorize e use “Continuar última entrega”.', { cause: error.message, canRetry: true });
    }
    const refreshed = await this.authStatus();
    if (!refreshed.scopes.includes('workflow')) throw new BridgeError('GITHUB_WORKFLOW_SCOPE_REQUIRED', 'O GitHub continua sem a permissão workflow. Reconecte a conta e tente continuar a entrega.', { scopes: refreshed.scopes, canRetry: true });
    this.emit('github:output', { stream: 'stdout', text: 'Permissão workflow autorizada.\\n' });
    return refreshed;
  }
"""
if old not in s:
    raise SystemExit('auth block not found')
s = s.replace(old, new, 1)

# Silence JSON API payloads that previously flooded the visible log.
s = s.replace("{ timeoutMs: 60_000 })).stdout", "{ timeoutMs: 60_000, onOutput: () => {} })).stdout")
s = s.replace("{ timeoutMs: 120_000 })).stdout", "{ timeoutMs: 120_000, onOutput: () => {} })).stdout")
s = s.replace("{ timeoutMs: 30_000 })).stdout", "{ timeoutMs: 30_000, onOutput: () => {} })).stdout")
s = s.replace("{ timeoutMs: 30_000 }); return true;", "{ timeoutMs: 30_000, onOutput: () => {} }); return true;")
s = s.replace("{ timeoutMs: 60_000, signal: options.signal });", "{ timeoutMs: 60_000, signal: options.signal, onOutput: () => {} });")

old_publish = """  async publish({ directory, repository, commitMessage, signal, branch = 'main', force = false }) {
    this.emit('migration:progress', { step: branch === (repository.default_branch || 'main') ? 'github-publish' : 'github-snapshot', status: 'running', message: `Publicando ${branch} em ${repository.full_name}...` });
    await fs.rm(path.join(directory, '.git'), { recursive: true, force: true });
    const token = await this.getAuthenticationToken(); const askPass = await this.createAskPass(); const authEnv = { GIT_ASKPASS: askPass, GIT_TERMINAL_PROMPT: '0', RB_BRIDGE_GH_TOKEN: token };
    try {
      await this.runGit(['init', '-b', branch], { cwd: directory, signal, env: authEnv }); const login = repository.owner?.login || repository.full_name.split('/')[0];
      await this.runGit(['config', 'user.name', login], { cwd: directory, signal, env: authEnv }); await this.runGit(['config', 'user.email', `${login}@users.noreply.github.com`], { cwd: directory, signal, env: authEnv });
      await this.runGit(['add', '--all'], { cwd: directory, signal, env: authEnv }); await this.runGit(['commit', '-m', commitMessage || 'Initial migration'], { cwd: directory, signal, env: authEnv });
      await this.runGit(['remote', 'add', 'origin', repository.clone_url], { cwd: directory, signal, env: authEnv });
      const pushArgs = ['push', '--set-upstream', 'origin', branch]; if (force) pushArgs.splice(1, 0, '--force');
      await this.runGit(pushArgs, { cwd: directory, timeoutMs: 20 * 60 * 1000, signal, env: authEnv });
      const sha = (await this.runGit(['rev-parse', 'HEAD'], { cwd: directory, signal, env: authEnv })).stdout.trim();
      this.emit('migration:progress', { step: branch === (repository.default_branch || 'main') ? 'github-publish' : 'github-snapshot', status: 'complete', message: `${branch} publicado no commit ${sha.slice(0, 7)}.` });
      return { sha, url: repository.html_url, fullName: repository.full_name, branch };
    } finally { delete authEnv.RB_BRIDGE_GH_TOKEN; }
  }
"""
new_publish = """  async publish({ directory, repository, commitMessage, signal, branch = 'main', force = false }) {
    this.emit('migration:progress', { step: branch === (repository.default_branch || 'main') ? 'github-publish' : 'github-snapshot', status: 'running', message: `Publicando ${branch} em ${repository.full_name}...` });
    const workflowDirectory = path.join(directory, '.github', 'workflows');
    const workflowFiles = await fs.readdir(workflowDirectory).catch(() => []);
    if (workflowFiles.some((name) => /\\.ya?ml$/i.test(name))) await this.ensureDeliveryScopes({ signal });
    await fs.rm(path.join(directory, '.git'), { recursive: true, force: true });
    const token = await this.getAuthenticationToken(); const askPass = await this.createAskPass(); const authEnv = { GIT_ASKPASS: askPass, GIT_TERMINAL_PROMPT: '0', RB_BRIDGE_GH_TOKEN: token };
    try {
      await this.runGit(['init', '-b', branch], { cwd: directory, signal, env: authEnv }); const login = repository.owner?.login || repository.full_name.split('/')[0];
      await this.runGit(['config', 'user.name', login], { cwd: directory, signal, env: authEnv }); await this.runGit(['config', 'user.email', `${login}@users.noreply.github.com`], { cwd: directory, signal, env: authEnv });
      await this.runGit(['add', '--all'], { cwd: directory, signal, env: authEnv }); await this.runGit(['commit', '-m', commitMessage || 'Initial migration'], { cwd: directory, signal, env: authEnv });
      await this.runGit(['remote', 'add', 'origin', repository.clone_url], { cwd: directory, signal, env: authEnv });
      const pushArgs = ['push', '--set-upstream', 'origin', branch]; if (force) pushArgs.splice(1, 0, '--force');
      try { await this.runGit(pushArgs, { cwd: directory, timeoutMs: 20 * 60 * 1000, signal, env: authEnv }); }
      catch (error) { if (isWorkflowScopeError(error)) throw new BridgeError('GITHUB_WORKFLOW_SCOPE_REQUIRED', 'O GitHub bloqueou o workflow de validação. O código local foi preservado; autorize a permissão workflow e continue a entrega.', { cause: error.message, canRetry: true }); throw error; }
      const sha = (await this.runGit(['rev-parse', 'HEAD'], { cwd: directory, signal, env: authEnv })).stdout.trim();
      this.emit('migration:progress', { step: branch === (repository.default_branch || 'main') ? 'github-publish' : 'github-snapshot', status: 'complete', message: `${branch} publicado no commit ${sha.slice(0, 7)}.` });
      return { sha, url: repository.html_url, fullName: repository.full_name, branch };
    } finally { delete authEnv.RB_BRIDGE_GH_TOKEN; }
  }
"""
if old_publish not in s:
    raise SystemExit('publish block not found')
s = s.replace(old_publish, new_publish, 1)
s = s.replace("module.exports = { GitHubService, GITHUB_DEVICE_URL, extractGitHubDeviceCode, backupBranchName };", "module.exports = { GitHubService, GITHUB_DEVICE_URL, DELIVERY_SCOPES, extractGitHubDeviceCode, parseGitHubScopes, isWorkflowScopeError, backupBranchName };")
p.write_text(s, encoding='utf-8')

# Main/preload: expose scope preflight.
p = Path('electron/main.cjs'); s = p.read_text(encoding='utf-8')
s = s.replace("handle('github:status', () => services.github.authStatus()); handle('github:login', () => services.github.login()); handle('github:logout', () => services.github.logout()); handle('github:accounts', () => services.github.getAccounts());", "handle('github:status', () => services.github.authStatus()); handle('github:login', () => services.github.login()); handle('github:logout', () => services.github.logout()); handle('github:accounts', () => services.github.getAccounts()); handle('github:ensure-delivery-scopes', () => services.github.ensureDeliveryScopes());")
p.write_text(s, encoding='utf-8')

p = Path('electron/preload.cjs'); s = p.read_text(encoding='utf-8')
s = s.replace("sourceStatus: (input) => ipcRenderer.invoke('github:source-status', input) }", "sourceStatus: (input) => ipcRenderer.invoke('github:source-status', input), ensureDeliveryScopes: () => ipcRenderer.invoke('github:ensure-delivery-scopes') }")
p.write_text(s, encoding='utf-8')

# Migration retry: record success and keep report actions usable.
p = Path('electron/services/migration-service.cjs'); s = p.read_text(encoding='utf-8')
old_retry = "report.github = await this.github.publish({ directory: repositoryDir, repository, commitMessage: report.options?.commitMessage || 'Retry RB Project Bridge delivery', branch: repository.default_branch, force: Boolean(report.githubRepository.reused) }); report.status = 'completed'; report.finishedAt = new Date().toISOString(); delete report.error; await this.reports.writeReport(repositoryDir, report); await this.reports.writeReport(resolvedJobRoot, report); return report;"
new_retry = "report.github = await this.github.publish({ directory: repositoryDir, repository, commitMessage: report.options?.commitMessage || 'Retry RB Project Bridge delivery', branch: repository.default_branch, force: Boolean(report.githubRepository.reused) }); report.status = 'completed'; report.finishedAt = new Date().toISOString(); delete report.error; await this.reports.writeReport(repositoryDir, report); await this.reports.writeReport(resolvedJobRoot, report); await this.reports.appendHistory({ jobId: report.jobId, status: 'completed', startedAt: report.startedAt, finishedAt: report.finishedAt, project: report.project, github: report.github, jobRoot: resolvedJobRoot, previewDir: report.paths?.previewDir, resumed: true }); return report;"
if old_retry not in s: raise SystemExit('retry block not found')
s = s.replace(old_retry, new_retry, 1)
p.write_text(s, encoding='utf-8')

# Renderer: retry button and preflight before expensive work.
p = Path('renderer/index.html'); s = p.read_text(encoding='utf-8')
s = s.replace('<div class="row"><button id="start" class="primary">Executar pipeline completo</button><button id="cancel">Cancelar</button></div>', '<div class="row"><button id="start" class="primary">Executar pipeline completo</button><button id="retryLast" class="hidden">Continuar última entrega</button><button id="cancel">Cancelar</button></div>')
p.write_text(s, encoding='utf-8')

p = Path('renderer/app.js'); s = p.read_text(encoding='utf-8')
s = s.replace("lastResult = null, repositories = [];", "lastResult = null, repositories = [], lastRetryJobRoot = null;")
s = s.replace("async function load() { try {", "async function refreshRetryAction() { try { const history = await call(window.rbBridge.migration.history()); const failed = history.find((entry) => entry.status === 'failed' && entry.jobRoot); lastRetryJobRoot = failed?.jobRoot || null; $('retryLast').classList.toggle('hidden', !lastRetryJobRoot); } catch { lastRetryJobRoot = null; $('retryLast').classList.add('hidden'); } }\nasync function load() { try {")
s = s.replace("if (status.github?.authenticated) { $('githubAuthBox').classList.add('hidden'); await accounts(); } } catch", "if (status.github?.authenticated) { $('githubAuthBox').classList.add('hidden'); await accounts(); } await refreshRetryAction(); } catch")
s = s.replace("resetStages(); $('resultActions').classList.add('hidden'); lastResult = null; setResult('');", "resetStages(); $('resultActions').classList.add('hidden'); lastResult = null; setResult(''); log('Validando permissões de entrega no GitHub...'); await call(window.rbBridge.github.ensureDeliveryScopes());")
s = s.replace("$('resultActions').classList.remove('hidden');", "$('resultActions').classList.remove('hidden'); lastRetryJobRoot = null; $('retryLast').classList.add('hidden');", 1)
s = s.replace("} catch (error) { const violations", "} catch (error) { await refreshRetryAction(); const violations", 1)
insert = """
$('retryLast').onclick = async () => {
  const button = $('retryLast');
  if (!lastRetryJobRoot) return setResult('Não existe uma entrega pendente para continuar.', 'error');
  try {
    button.disabled = true;
    log('Continuando a última entrega sem repetir exportação, conversão ou build...');
    await call(window.rbBridge.github.ensureDeliveryScopes());
    lastResult = await call(window.rbBridge.migration.retryPublish(lastRetryJobRoot));
    setResult(`Entrega concluída em ${lastResult.github.fullName} (${lastResult.github.sha.slice(0, 7)}).`, 'success');
    $('resultActions').classList.remove('hidden');
    lastRetryJobRoot = null;
    button.classList.add('hidden');
  } catch (error) { setResult(error.message, 'error'); log(`ERRO ao continuar: ${error.message}`); }
  finally { button.disabled = false; }
};
"""
s = s.replace("$('openPreview').onclick", insert + "$('openPreview').onclick", 1)
p.write_text(s, encoding='utf-8')

# Version/workflow.
p = Path('package.json'); data = json.loads(p.read_text(encoding='utf-8')); data['version'] = '0.2.4'; p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
p = Path('.github/workflows/build.yml'); s = p.read_text(encoding='utf-8').replace('0.2.3', '0.2.4'); p.write_text(s, encoding='utf-8')

# Regression tests.
Path('tests/github-workflow-scope.test.cjs').write_text(r'''"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const servicePath = path.join(__dirname, '..', 'electron', 'services', 'github-service.cjs');
const { parseGitHubScopes, isWorkflowScopeError, DELIVERY_SCOPES } = require(servicePath);

test('delivery scopes include workflow', () => { assert.ok(DELIVERY_SCOPES.includes('workflow')); });
test('parses GitHub CLI token scopes', () => { assert.deepEqual(parseGitHubScopes("Token scopes: 'gist', 'read:org', 'repo', 'workflow'"), ['gist','read:org','repo','workflow']); });
test('recognizes OAuth workflow rejection', () => { assert.equal(isWorkflowScopeError({ details: { stderr: 'refusing to allow an OAuth App to create or update workflow without workflow scope' } }), true); });
test('publish preflights workflow scope and renderer supports retry', () => {
  const service = fs.readFileSync(servicePath, 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(service, /ensureDeliveryScopes/);
  assert.match(service, /workflowFiles\.some/);
  assert.match(renderer, /retryPublish/);
  assert.match(html, /id="retryLast"/);
});
''', encoding='utf-8')
