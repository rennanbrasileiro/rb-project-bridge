'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runProcess } = require('../core/process-runner.cjs');
const { BridgeError } = require('../core/errors.cjs');

const DEFAULT_GITLAB_URL = 'https://gitlab.com';
const REQUIRED_SCOPES = ['api', 'write_repository'];

function normalizeGitLabBaseUrl(input = DEFAULT_GITLAB_URL) {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol)) throw new BridgeError('GITLAB_URL_INVALID', 'A URL do GitLab deve usar HTTP ou HTTPS.');
  return url.origin;
}

function projectPath(owner, name) {
  return `${String(owner || '').replace(/^\/+|\/+$/g, '')}/${String(name || '').replace(/^\/+|\/+$/g, '')}`;
}

function encodeProject(value) { return encodeURIComponent(String(value || '')); }

function normalizeRepository(project) {
  if (!project?.path_with_namespace) throw new BridgeError('GITLAB_PROJECT_INVALID', 'O GitLab retornou um projeto inválido.');
  const namespace = project.namespace?.full_path || project.namespace?.path || project.path_with_namespace.split('/').slice(0, -1).join('/');
  return {
    provider: 'gitlab', id: project.id, name: project.path || project.name, full_name: project.path_with_namespace,
    clone_url: project.http_url_to_repo, html_url: project.web_url, private: project.visibility !== 'public',
    default_branch: project.default_branch || 'main', owner: { login: namespace }, visibility: project.visibility, updated_at: project.last_activity_at || null,
  };
}

function backupBranchName(prefix, sha, now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 17);
  return `${prefix}-${stamp}-${String(sha || 'unknown').slice(0, 7)}`;
}

class GitLabService {
  constructor({ toolchain, logger, emit = () => {}, sessionDir, baseUrl, tokenProvider }) {
    this.toolchain = toolchain; this.logger = logger; this.emit = emit;
    this.sessionDir = sessionDir || path.join(os.tmpdir(), 'rb-project-bridge-gitlab');
    this.baseUrl = normalizeGitLabBaseUrl(baseUrl || process.env.GITLAB_URL || DEFAULT_GITLAB_URL);
    this.apiBase = `${this.baseUrl}/api/v4`; this.tokenProvider = tokenProvider;
  }

  async getToken() {
    const supplied = await this.tokenProvider?.();
    const token = String(supplied || process.env.RB_BRIDGE_GITLAB_TOKEN || process.env.GITLAB_TOKEN || '').trim();
    if (!token) throw new BridgeError('GITLAB_TOKEN_UNAVAILABLE', 'Defina um token GitLab para concluir a entrega.');
    return token;
  }

  async request(relativePath, options = {}) {
    const token = await this.getToken();
    const target = new URL(relativePath.replace(/^\//, ''), `${this.apiBase}/`).href;
    const headers = { 'PRIVATE-TOKEN': token, Accept: 'application/json', ...(options.headers || {}) };
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof URLSearchParams) && !Buffer.isBuffer(body)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const response = await fetch(target, { ...options, headers, body, signal: options.signal || AbortSignal.timeout(120000) });
    if (options.allow404 && response.status === 404) return null;
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new BridgeError('GITLAB_API_ERROR', `O GitLab retornou HTTP ${response.status}.`, { status: response.status, path: relativePath, body: detail.slice(0, 1000) });
    }
    if (response.status === 204) return null;
    const text = await response.text(); return text ? JSON.parse(text) : null;
  }

  async authStatus() {
    try {
      const [user, tokenInfo] = await Promise.all([this.request('/user'), this.request('/personal_access_tokens/self', { allow404: true }).catch(() => null)]);
      const scopes = Array.isArray(tokenInfo?.scopes) ? tokenInfo.scopes : [];
      const missing = scopes.length ? REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope)) : [];
      return { authenticated: Boolean(user?.username), user, scopes, missingDeliveryScopes: missing, deliveryReady: Boolean(user?.username) && missing.length === 0 };
    } catch (error) { return { authenticated: false, scopes: [], missingDeliveryScopes: [...REQUIRED_SCOPES], deliveryReady: false, error: error.message }; }
  }

  async ensureDeliveryScopes() {
    const status = await this.authStatus();
    if (!status.authenticated) throw new BridgeError('GITLAB_NOT_AUTHENTICATED', 'O token GitLab não foi aceito.');
    if (status.scopes.length && status.missingDeliveryScopes.length) throw new BridgeError('GITLAB_SCOPE_REQUIRED', `O token GitLab precisa dos escopos: ${status.missingDeliveryScopes.join(', ')}.`, { scopes: status.scopes, requiredScopes: REQUIRED_SCOPES });
    return status;
  }
  async ensureDirectoryScopes(_directory, options = {}) { return this.ensureDeliveryScopes(options); }

  async runGit(args, options = {}) {
    const git = await this.toolchain.getGit();
    return runProcess(git, args, { cwd: options.cwd, timeoutMs: options.timeoutMs ?? 20 * 60 * 1000, env: options.env, onOutput: options.onOutput ?? ((entry) => this.emit('gitlab:output', entry)), signal: options.signal });
  }

  async repositoryExists(owner, name) { return Boolean(await this.request(`/projects/${encodeProject(projectPath(owner, name))}`, { allow404: true })); }
  async getRepository(owner, name) {
    const project = await this.request(`/projects/${encodeProject(projectPath(owner, name))}`, { allow404: true });
    if (!project) throw new BridgeError('REPOSITORY_UNAVAILABLE', `Não foi possível consultar ${projectPath(owner, name)} no GitLab.`);
    return normalizeRepository(project);
  }
  async resolveNamespace(owner) {
    const encodedOwner = encodeURIComponent(String(owner || ''));
    const exact = await this.request(`/namespaces/${encodedOwner}`, { allow404: true }).catch(() => null);
    if (exact?.id) return exact;
    const list = await this.request(`/namespaces?search=${encodedOwner}`);
    const target = (list || []).find((item) => item.full_path === owner || item.path === owner || item.name === owner);
    if (!target?.id) throw new BridgeError('GITLAB_NAMESPACE_NOT_FOUND', `O namespace ${owner} não foi encontrado no GitLab.`);
    return target;
  }
  async createRepository({ owner, name, description }, options = {}) {
    const namespace = await this.resolveNamespace(owner);
    const project = await this.request('/projects', { method: 'POST', signal: options.signal, body: { name, path: name, namespace_id: namespace.id, visibility: 'private', description: description || '' } });
    return normalizeRepository(project);
  }
  async ensurePrivate(owner, name, options = {}) {
    const repository = await this.getRepository(owner, name);
    if (repository.private) return repository;
    return normalizeRepository(await this.request(`/projects/${repository.id}`, { method: 'PUT', signal: options.signal, body: { visibility: 'private' } }));
  }
  async resolveRepository(input, options = {}) {
    const exists = await this.repositoryExists(input.owner, input.name);
    if (input.strategy === 'reuse' && !exists) throw new BridgeError('REPOSITORY_NOT_FOUND', `O repositório ${projectPath(input.owner, input.name)} não existe no GitLab.`);
    if (input.strategy === 'create' && exists) throw new BridgeError('REPOSITORY_ALREADY_EXISTS', `O repositório ${projectPath(input.owner, input.name)} já existe no GitLab.`);
    if (exists) return { repository: await this.ensurePrivate(input.owner, input.name, options), reused: true };
    return { repository: await this.createRepository(input, options), reused: false };
  }
  async getBranch(repository, branch, options = {}) { return this.request(`/projects/${repository.id}/repository/branches/${encodeURIComponent(branch)}`, { signal: options.signal, allow404: true }); }
  async preserveBranch(repository, branch, options = {}) {
    const current = await this.getBranch(repository, branch, options); const sha = current?.commit?.id; if (!sha) return null;
    const backupBranch = backupBranchName(options.prefix || `${branch}-before-bridge`, sha, options.now || new Date());
    const params = new URLSearchParams({ branch: backupBranch, ref: sha });
    await this.request(`/projects/${repository.id}/repository/branches?${params.toString()}`, { method: 'POST', signal: options.signal });
    return { sourceBranch: branch, backupBranch, sha };
  }
  async readRepositoryJson(repository, filePath, branches = ['main', 'base44-source']) {
    for (const branch of [...new Set(branches)]) {
      try {
        const token = await this.getToken();
        const target = `/projects/${repository.id}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(branch)}`;
        const url = new URL(target.replace(/^\//, ''), `${this.apiBase}/`).href;
        const response = await fetch(url, { headers: { 'PRIVATE-TOKEN': token }, signal: AbortSignal.timeout(30000) });
        if (response.status === 404) continue; if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { branch, data: JSON.parse(await response.text()) };
      } catch (error) { this.logger?.warn?.('gitlab.manifest.read.failed', { repository: repository.full_name, branch, filePath, message: error.message }); }
    }
    return null;
  }
  async inspectSourceStatus({ owner, name, project }) {
    if (!(await this.repositoryExists(owner, name))) return { exists: false, repository: null, source: null, status: 'new-repository' };
    const repository = await this.getRepository(owner, name); const defaultBranch = repository.default_branch || 'main';
    const source = await this.readRepositoryJson(repository, 'RB-BRIDGE-SOURCE.json', [defaultBranch, 'base44-source']);
    const latest = await this.request(`/projects/${repository.id}/repository/commits/${encodeURIComponent(defaultBranch)}`, { allow404: true }).catch(() => null);
    const latestCommitAt = latest?.committed_date || latest?.created_at || null; const previousUpdatedAt = source?.data?.base44UpdatedAt || null; const currentUpdatedAt = project?.updatedAt || null;
    const base44Changed = Boolean(previousUpdatedAt && currentUpdatedAt && new Date(currentUpdatedAt).getTime() > new Date(previousUpdatedAt).getTime() + 1000);
    const deliveredAt = source?.branch === defaultBranch ? source?.data?.deliveredAt : null; const gitChanged = Boolean(deliveredAt && latestCommitAt && new Date(latestCommitAt).getTime() > new Date(deliveredAt).getTime() + 120000); const snapshotOnly = Boolean(source && source.branch !== defaultBranch && !deliveredAt);
    return { exists: true, repository: { name: repository.name, fullName: repository.full_name, private: repository.private, defaultBranch, htmlUrl: repository.html_url, updatedAt: repository.updated_at }, source: source ? { branch: source.branch, ...source.data } : null, currentBase44UpdatedAt: currentUpdatedAt, latestCommitAt, base44Changed, githubChanged: gitChanged, snapshotOnly, status: !source ? 'unlinked' : snapshotOnly ? 'snapshot-only' : base44Changed ? (gitChanged ? 'both-changed' : 'base44-newer') : gitChanged ? 'github-newer' : 'in-sync' };
  }
  async createAskPass() {
    await fs.mkdir(this.sessionDir, { recursive: true }); const target = path.join(this.sessionDir, process.platform === 'win32' ? 'gitlab-askpass.cmd' : 'gitlab-askpass.sh');
    if (process.platform === 'win32') await fs.writeFile(target, ['@echo off', 'echo %~1 | findstr /I "Username" >nul', 'if %errorlevel%==0 (', '  echo oauth2', ') else (', '  echo %RB_BRIDGE_GITLAB_TOKEN%', ')', ''].join('\r\n'), { encoding: 'utf8', mode: 0o700 });
    else { await fs.writeFile(target, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "oauth2" ;;\n  *) printf "%s\\n" "$RB_BRIDGE_GITLAB_TOKEN" ;;\nesac\n', { encoding: 'utf8', mode: 0o700 }); await fs.chmod(target, 0o700); }
    return target;
  }
  async authEnvironment() { const token = await this.getToken(); return { GIT_ASKPASS: await this.createAskPass(), GIT_TERMINAL_PROMPT: '0', RB_BRIDGE_GITLAB_TOKEN: token }; }
  async cloneBase44Source({ owner, name, destination }, options = {}) {
    if (!(await this.repositoryExists(owner, name))) return null; const repository = await this.getRepository(owner, name); const branches = ['base44-source', repository.default_branch || 'main']; const env = await this.authEnvironment();
    try {
      for (const branch of [...new Set(branches)]) {
        if (!(await this.getBranch(repository, branch, options))) continue; await fs.rm(destination, { recursive: true, force: true });
        try {
          await this.runGit(['clone', '--depth', '1', '--single-branch', '--branch', branch, repository.clone_url, destination], { signal: options.signal, env });
          const packageText = await fs.readFile(path.join(destination, 'package.json'), 'utf8').catch(() => ''); const hasBase44Directory = await fs.stat(path.join(destination, 'base44')).then((entry) => entry.isDirectory()).catch(() => false);
          if (!hasBase44Directory && !/@base44\/(sdk|vite-plugin)|"base44"\s*:/.test(packageText)) { await fs.rm(destination, { recursive: true, force: true }); continue; }
          const sha = (await this.runGit(['rev-parse', 'HEAD'], { cwd: destination, signal: options.signal, env })).stdout.trim(); await fs.rm(path.join(destination, '.git'), { recursive: true, force: true });
          return { destination, entries: (await fs.readdir(destination)).length, source: 'gitlab-fallback', repository: repository.full_name, branch, sha };
        } catch (error) { await fs.rm(destination, { recursive: true, force: true }); this.logger?.warn?.('gitlab.source.clone.failed', { repository: repository.full_name, branch, message: error.message }); }
      }
    } finally { delete env.RB_BRIDGE_GITLAB_TOKEN; }
    return null;
  }
  async publish({ directory, repository, commitMessage, signal, branch = 'main', force = false }) {
    await this.ensureDeliveryScopes(); await fs.rm(path.join(directory, '.git'), { recursive: true, force: true }); const env = await this.authEnvironment();
    try {
      await this.runGit(['init', '-b', branch], { cwd: directory, signal, env }); const login = repository.owner?.login || repository.full_name.split('/')[0];
      await this.runGit(['config', 'user.name', 'RB Project Bridge'], { cwd: directory, signal, env }); await this.runGit(['config', 'user.email', `bridge@${String(login).replace(/[^a-z0-9.-]/gi, '-')}.local`], { cwd: directory, signal, env });
      await this.runGit(['add', '--all'], { cwd: directory, signal, env }); await this.runGit(['commit', '-m', commitMessage || 'RB Project Bridge migration'], { cwd: directory, signal, env }); await this.runGit(['remote', 'add', 'origin', repository.clone_url], { cwd: directory, signal, env });
      const push = ['push', '--set-upstream', 'origin', branch]; if (force) push.splice(1, 0, '--force'); await this.runGit(push, { cwd: directory, signal, env, timeoutMs: 20 * 60 * 1000 });
      const sha = (await this.runGit(['rev-parse', 'HEAD'], { cwd: directory, signal, env })).stdout.trim(); return { sha, url: repository.html_url, fullName: repository.full_name, branch, provider: 'gitlab' };
    } finally { delete env.RB_BRIDGE_GITLAB_TOKEN; }
  }
  async createPullRequest(repository, { head, base, title, body }, options = {}) {
    const merge = await this.request(`/projects/${repository.id}/merge_requests`, { method: 'POST', signal: options.signal, body: { source_branch: head, target_branch: base, title, description: body || '', remove_source_branch: false } });
    if (!merge?.web_url) throw new BridgeError('MERGE_REQUEST_CREATE_FAILED', `Não foi possível abrir a revisão em ${repository.full_name}.`);
    return { number: merge.iid, url: merge.web_url, head, base, provider: 'gitlab' };
  }
}

module.exports = { GitLabService, DEFAULT_GITLAB_URL, REQUIRED_SCOPES, normalizeGitLabBaseUrl, normalizeRepository, projectPath, backupBranchName };
