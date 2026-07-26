'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runProcess } = require('../core/process-runner.cjs');
const { BridgeError } = require('../core/errors.cjs');

const GITHUB_DEVICE_URL = 'https://github.com/login/device';
const DELIVERY_SCOPES = ['repo', 'read:org', 'gist', 'workflow'];
const AUTH_CACHE_TTL_MS = 45_000;
const DATA_CACHE_TTL_MS = 30_000;

function extractGitHubDeviceCode(text) {
  return String(text).match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/i)?.[0]?.toUpperCase() ?? null;
}

function parseGitHubScopes(text) {
  const source = String(text || '');
  const line = source.split(/\r?\n/).find((entry) => /(?:Token scopes:|x-oauth-scopes:)/i.test(entry)) || '';
  const quoted = [...line.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1].trim()).filter(Boolean);
  if (quoted.length) return [...new Set(quoted)];
  const value = line.split(':').slice(1).join(':');
  return [...new Set(value.split(',').map((scope) => scope.trim()).filter(Boolean))];
}

function missingGitHubScopes(currentScopes, requiredScopes = DELIVERY_SCOPES) {
  const current = new Set((currentScopes || []).map((scope) => String(scope).trim().toLowerCase()));
  return requiredScopes.filter((scope) => !current.has(String(scope).toLowerCase()));
}

function isWorkflowScopeError(error) {
  const detail = `${error?.message || ''} ${error?.details?.stderr || ''}`;
  return /workflow.*scope|refusing to allow an OAuth App to create or update workflow/i.test(detail);
}

function backupBranchName(prefix, sha, now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 17);
  return `${prefix}-${stamp}-${String(sha || 'unknown').slice(0, 7)}`;
}

class GitHubService {
  constructor({ toolchain, logger, emit, sessionDir, openExternal }) {
    this.toolchain = toolchain;
    this.logger = logger;
    this.emit = emit;
    this.openExternal = openExternal;
    this.sessionDir = sessionDir || path.join(os.tmpdir(), 'rb-project-bridge-github');
    this.configDir = path.join(this.sessionDir, 'gh-config');
    this.gitConfigPath = path.join(this.sessionDir, 'gitconfig');
    this.authCache = null;
    this.authStatusPromise = null;
    this.accountsCache = null;
    this.repositoryCache = new Map();
  }

  async ensureSession() { await fs.mkdir(this.configDir, { recursive: true }); }

  sessionEnvironment(extra = {}) {
    return {
      GH_CONFIG_DIR: this.configDir,
      GIT_CONFIG_GLOBAL: this.gitConfigPath,
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: this.sessionDir,
      USERPROFILE: this.sessionDir,
      ...extra,
    };
  }

  async runGh(args, options = {}) {
    await this.ensureSession();
    const gh = await this.toolchain.getGh();
    return runProcess(gh, args, {
      timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
      input: options.input,
      env: this.sessionEnvironment(options.env),
      onOutput: options.onOutput ?? ((entry) => this.emit('github:output', entry)),
      signal: options.signal,
      captureSensitive: Boolean(options.captureSensitive),
    });
  }

  runGhQuiet(args, options = {}) { return this.runGh(args, { ...options, onOutput: () => {} }); }

  async runGit(args, options = {}) {
    await this.ensureSession();
    const git = await this.toolchain.getGit();
    return runProcess(git, args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
      env: this.sessionEnvironment(options.env),
      onOutput: options.onOutput ?? ((entry) => this.emit('github:output', entry)),
      signal: options.signal,
    });
  }

  invalidateCaches({ auth = true, data = true } = {}) {
    if (auth) this.authCache = null;
    if (data) {
      this.accountsCache = null;
      this.repositoryCache.clear();
    }
  }

  authSnapshot(authenticated, output, scopes = []) {
    const normalizedScopes = [...new Set(scopes)];
    const missingDeliveryScopes = authenticated ? missingGitHubScopes(normalizedScopes) : [...DELIVERY_SCOPES];
    return {
      authenticated,
      output,
      scopes: normalizedScopes,
      missingDeliveryScopes,
      deliveryReady: authenticated && missingDeliveryScopes.length === 0,
    };
  }

  async authStatus(options = {}) {
    const force = Boolean(options.force);
    const now = Date.now();
    if (!force && this.authCache?.expiresAt > now) return this.authCache.value;
    if (!force && this.authStatusPromise) return this.authStatusPromise;

    this.authStatusPromise = (async () => {
      let value;
      try {
        const result = await this.runGhQuiet(['auth', 'status', '--hostname', 'github.com'], { timeoutMs: 30_000 });
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
        value = this.authSnapshot(true, output, parseGitHubScopes(output));
      } catch (error) {
        const output = `${error?.details?.stdout || ''}\n${error?.details?.stderr || error.message || ''}`.trim();
        value = this.authSnapshot(false, output, []);
      }
      this.authCache = { value, expiresAt: Date.now() + AUTH_CACHE_TTL_MS };
      return value;
    })();

    try { return await this.authStatusPromise; }
    finally { this.authStatusPromise = null; }
  }

  async interactiveAuth(args, options = {}) {
    let opened = false;
    let outputBuffer = '';
    const openDevicePage = async () => {
      if (opened) return;
      opened = true;
      try { await this.openExternal?.(GITHUB_DEVICE_URL); }
      catch (error) { this.logger.warn('github.auth.browser.failed', { message: error.message }); }
    };

    await openDevicePage();
    return this.runGh(args, {
      timeoutMs: options.timeoutMs ?? 15 * 60 * 1000,
      signal: options.signal,
      onOutput: (entry) => {
        this.emit('github:output', entry);
        outputBuffer = `${outputBuffer}${entry.text}`.slice(-4096);
        const code = extractGitHubDeviceCode(outputBuffer);
        if (code) this.emit('github:output', { stream: 'stdout', text: `Autorize no navegador usando o código ${code}.\n` });
        if (outputBuffer.includes(GITHUB_DEVICE_URL)) void openDevicePage();
      },
    });
  }

  async login() {
    const current = await this.authStatus();
    if (current.authenticated) return this.getAccounts();
    await this.interactiveAuth([
      'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key',
      '--scopes', DELIVERY_SCOPES.join(','),
    ]);
    this.invalidateCaches();
    return this.getAccounts({ force: true });
  }

  async ensureDeliveryScopes(options = {}) {
    const requiredScopes = options.requiredScopes || DELIVERY_SCOPES;
    const current = await this.authStatus({ force: Boolean(options.force) });
    if (!current.authenticated) throw new BridgeError('GITHUB_NOT_AUTHENTICATED', 'Conecte o GitHub antes de continuar.');

    const missing = missingGitHubScopes(current.scopes, requiredScopes);
    if (!missing.length) return current;

    this.emit('migration:progress', {
      step: 'github-auth',
      status: 'running',
      message: `Autorização adicional necessária: ${missing.join(', ')}. Confirme o código no navegador.`,
    });

    try {
      await this.interactiveAuth([
        'auth', 'refresh', '--hostname', 'github.com', '--scopes', missing.join(','),
      ], options);
    } catch (error) {
      throw new BridgeError(
        'GITHUB_DELIVERY_SCOPE_REQUIRED',
        'A autorização adicional do GitHub não foi concluída. O trabalho local foi preservado e pode ser continuado do ponto salvo.',
        { cause: error.message, requiredScopes, missingScopes: missing, canRetry: true },
      );
    }

    this.invalidateCaches({ auth: true, data: false });
    const refreshed = await this.authStatus({ force: true });
    const stillMissing = missingGitHubScopes(refreshed.scopes, requiredScopes);
    if (stillMissing.length) {
      throw new BridgeError(
        'GITHUB_DELIVERY_SCOPE_REQUIRED',
        `O GitHub continua sem as permissões necessárias: ${stillMissing.join(', ')}.`,
        { scopes: refreshed.scopes, requiredScopes, missingScopes: stillMissing, canRetry: true },
      );
    }

    this.emit('migration:progress', { step: 'github-auth', status: 'complete', message: 'GitHub autorizado para concluir a entrega.' });
    return refreshed;
  }

  async ensureDirectoryScopes(directory, options = {}) {
    const workflowDirectory = path.join(directory, '.github', 'workflows');
    const workflowFiles = await fs.readdir(workflowDirectory).catch(() => []);
    const requiredScopes = workflowFiles.some((name) => /\.ya?ml$/i.test(name)) ? ['repo', 'workflow'] : ['repo'];
    return this.ensureDeliveryScopes({ ...options, requiredScopes });
  }

  async logout() {
    try { await this.runGhQuiet(['auth', 'logout', '--hostname', 'github.com'], { timeoutMs: 60_000, input: 'Y\n' }); }
    catch {}
    await fs.rm(this.sessionDir, { recursive: true, force: true });
    this.invalidateCaches();
    return { authenticated: false, scopes: [], deliveryReady: false, missingDeliveryScopes: [...DELIVERY_SCOPES] };
  }

  parseJson(output) {
    try { return JSON.parse(output); }
    catch {
      const lines = String(output || '').split(/\r?\n/).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try { return JSON.parse(lines[index]); } catch {}
      }
      return null;
    }
  }

  async getAccounts(options = {}) {
    const now = Date.now();
    if (!options.force && this.accountsCache?.expiresAt > now) return this.accountsCache.value;
    const status = await this.authStatus({ force: Boolean(options.force) });
    if (!status.authenticated) return { authenticated: false, accounts: [], scopes: [] };

    const user = this.parseJson((await this.runGhQuiet(['api', 'user'], { timeoutMs: 60_000 })).stdout);
    let orgs = [];
    try {
      const parsed = this.parseJson((await this.runGhQuiet(['api', 'user/orgs', '--paginate', '--slurp'], { timeoutMs: 60_000 })).stdout) || [];
      orgs = Array.isArray(parsed?.[0]) ? parsed.flat() : (Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      this.logger.warn('github.organizations.unavailable', { message: error.message });
    }
    if (!user?.login) throw new BridgeError('GITHUB_PROFILE_UNAVAILABLE', 'O GitHub não retornou o perfil autenticado.');

    const value = {
      authenticated: true,
      scopes: status.scopes,
      deliveryReady: status.deliveryReady,
      user: { login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url },
      accounts: [
        { login: user.login, type: 'user', label: user.name ? `${user.name} (${user.login})` : user.login },
        ...orgs.map((org) => ({ login: org.login, type: 'organization', label: org.login })),
      ],
    };
    this.accountsCache = { value, expiresAt: Date.now() + DATA_CACHE_TTL_MS };
    return value;
  }

  async listRepositories(owner, ownerType = 'user', options = {}) {
    const key = `${ownerType}:${String(owner).toLowerCase()}`;
    const now = Date.now();
    const cached = this.repositoryCache.get(key);
    if (!options.force && cached?.expiresAt > now) return cached.value;

    const endpoint = ownerType === 'organization'
      ? `orgs/${owner}/repos?per_page=100&sort=updated`
      : 'user/repos?per_page=100&sort=updated&affiliation=owner';
    const parsed = this.parseJson((await this.runGhQuiet(['api', endpoint, '--paginate', '--slurp'], { timeoutMs: 120_000 })).stdout) || [];
    const repositories = Array.isArray(parsed?.[0]) ? parsed.flat() : (Array.isArray(parsed) ? parsed : []);
    const value = repositories
      .filter((repository) => repository?.owner?.login?.toLowerCase() === String(owner).toLowerCase())
      .map((repository) => ({
        name: repository.name,
        fullName: repository.full_name,
        private: Boolean(repository.private),
        defaultBranch: repository.default_branch || 'main',
        description: repository.description || '',
        updatedAt: repository.updated_at || null,
        htmlUrl: repository.html_url,
      }));
    this.repositoryCache.set(key, { value, expiresAt: Date.now() + DATA_CACHE_TTL_MS });
    return value;
  }

  async readRepositoryJson(repository, filePath, branches = ['main', 'base44-source']) {
    for (const branch of [...new Set(branches)]) {
      try {
        const endpoint = `repos/${repository.full_name}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
        const payload = this.parseJson((await this.runGhQuiet(['api', endpoint], { timeoutMs: 30_000 })).stdout);
        if (!payload?.content) continue;
        const text = Buffer.from(String(payload.content).replace(/\s/g, ''), 'base64').toString('utf8');
        return { branch, data: JSON.parse(text) };
      } catch (error) {
        const detail = `${error.message || ''} ${error.details?.stderr || ''}`;
        if (!/404|not found/i.test(detail)) {
          this.logger.warn('github.manifest.read.failed', { repository: repository.full_name, branch, filePath, message: error.message });
        }
      }
    }
    return null;
  }

  async inspectSourceStatus({ owner, name, project }) {
    if (!(await this.repositoryExists(owner, name))) return { exists: false, repository: null, source: null, status: 'new-repository' };
    const repository = await this.getRepository(owner, name);
    const defaultBranch = repository.default_branch || 'main';
    const source = await this.readRepositoryJson(repository, 'RB-BRIDGE-SOURCE.json', [defaultBranch, 'base44-source']);
    let latestCommitAt = null;
    try {
      const commit = this.parseJson((await this.runGhQuiet(['api', `repos/${repository.full_name}/commits/${encodeURIComponent(defaultBranch)}`], { timeoutMs: 30_000 })).stdout);
      latestCommitAt = commit?.commit?.committer?.date || commit?.commit?.author?.date || null;
    } catch {}

    const previousUpdatedAt = source?.data?.base44UpdatedAt || null;
    const currentUpdatedAt = project?.updatedAt || null;
    const base44Changed = Boolean(previousUpdatedAt && currentUpdatedAt && new Date(currentUpdatedAt).getTime() > new Date(previousUpdatedAt).getTime() + 1000);
    const deliveredAt = source?.branch === defaultBranch ? source?.data?.deliveredAt : null;
    const githubChanged = Boolean(deliveredAt && latestCommitAt && new Date(latestCommitAt).getTime() > new Date(deliveredAt).getTime() + 120000);
    const snapshotOnly = Boolean(source && source.branch !== defaultBranch && !deliveredAt);

    return {
      exists: true,
      repository: {
        name: repository.name,
        fullName: repository.full_name,
        private: Boolean(repository.private),
        defaultBranch,
        htmlUrl: repository.html_url,
        updatedAt: repository.updated_at || null,
      },
      source: source ? { branch: source.branch, ...source.data } : null,
      currentBase44UpdatedAt: currentUpdatedAt,
      latestCommitAt,
      base44Changed,
      githubChanged,
      snapshotOnly,
      status: !source ? 'unlinked'
        : snapshotOnly ? 'snapshot-only'
          : base44Changed ? (githubChanged ? 'both-changed' : 'base44-newer')
            : githubChanged ? 'github-newer' : 'in-sync',
    };
  }

  async cloneBase44Source({ owner, name, destination }, options = {}) {
    if (!(await this.repositoryExists(owner, name))) return null;
    const repository = await this.getRepository(owner, name);
    const branches = ['base44-source', repository.default_branch || 'main'];
    const token = await this.getAuthenticationToken();
    const askPass = await this.createAskPass();
    const authEnv = { GIT_ASKPASS: askPass, GIT_TERMINAL_PROMPT: '0', RB_BRIDGE_GH_TOKEN: token };
    try {
      for (const branch of [...new Set(branches)]) {
        const ref = await this.getBranchRef(repository, branch, options);
        if (!ref?.object?.sha) continue;
        await fs.rm(destination, { recursive: true, force: true });
        try {
          await this.runGit(['clone', '--depth', '1', '--single-branch', '--branch', branch, repository.clone_url, destination], { timeoutMs: 10 * 60 * 1000, signal: options.signal, env: authEnv });
          const packageText = await fs.readFile(path.join(destination, 'package.json'), 'utf8').catch(() => '');
          const hasBase44Directory = await fs.stat(path.join(destination, 'base44')).then((entry) => entry.isDirectory()).catch(() => false);
          const looksLikeSource = hasBase44Directory || /@base44\/(sdk|vite-plugin)|"base44"\s*:/.test(packageText);
          if (!looksLikeSource) { await fs.rm(destination, { recursive: true, force: true }); continue; }
          await fs.rm(path.join(destination, '.git'), { recursive: true, force: true });
          const entries = await fs.readdir(destination);
          this.emit('migration:progress', { step: 'base44-export', status: 'complete', message: `Snapshot Base44 reaproveitado de ${repository.full_name}:${branch}.` });
          return { destination, entries: entries.length, source: 'github-fallback', repository: repository.full_name, branch, sha: ref.object.sha };
        } catch (error) {
          await fs.rm(destination, { recursive: true, force: true });
          this.logger.warn('github.source.clone.failed', { repository: repository.full_name, branch, message: error.message });
        }
      }
    } finally { delete authEnv.RB_BRIDGE_GH_TOKEN; }
    return null;
  }

  async repositoryExists(owner, name) {
    try { await this.runGhQuiet(['api', `repos/${owner}/${name}`], { timeoutMs: 30_000 }); return true; }
    catch { return false; }
  }

  async getRepository(owner, name) {
    const parsed = this.parseJson((await this.runGhQuiet(['api', `repos/${owner}/${name}`], { timeoutMs: 30_000 })).stdout);
    if (!parsed?.full_name) throw new BridgeError('REPOSITORY_UNAVAILABLE', `Não foi possível consultar ${owner}/${name}.`);
    return parsed;
  }

  async ensurePrivate(owner, name, options = {}) {
    const current = await this.getRepository(owner, name);
    if (current.private === true) return current;
    await this.runGhQuiet(['api', '-X', 'PATCH', `repos/${owner}/${name}`, '-F', 'private=true'], { timeoutMs: 60_000, signal: options.signal });
    this.invalidateCaches({ auth: false, data: true });
    const verified = await this.getRepository(owner, name);
    if (verified.private !== true) throw new BridgeError('REPOSITORY_PRIVACY_FAILED', `O repositório ${owner}/${name} não ficou privado.`);
    return verified;
  }

  async createRepository({ owner, ownerType, name, description }, options = {}) {
    const endpoint = ownerType === 'organization' ? `orgs/${owner}/repos` : 'user/repos';
    const args = ['api', '-X', 'POST', endpoint, '-f', `name=${name}`, '-F', 'private=true'];
    if (description) args.push('-f', `description=${description}`);
    const repository = this.parseJson((await this.runGhQuiet(args, { timeoutMs: 60_000, signal: options.signal })).stdout);
    if (!repository?.full_name) throw new BridgeError('REPOSITORY_CREATE_FAILED', 'O GitHub não retornou o repositório criado.');
    this.invalidateCaches({ auth: false, data: true });
    return this.ensurePrivate(owner, name, options);
  }

  async resolveRepository(input, options = {}) {
    const exists = await this.repositoryExists(input.owner, input.name);
    if (input.strategy === 'reuse' && !exists) throw new BridgeError('REPOSITORY_NOT_FOUND', `O repositório ${input.owner}/${input.name} não existe mais. Atualize a lista antes de continuar.`);
    if (input.strategy === 'create' && exists) throw new BridgeError('REPOSITORY_ALREADY_EXISTS', `O repositório ${input.owner}/${input.name} já existe. Selecione-o na lista em vez de criar outro.`);
    if (exists) {
      const repository = await this.ensurePrivate(input.owner, input.name, options);
      this.emit('migration:progress', { step: 'github-publish', status: 'running', message: `Reutilizando ${repository.full_name}; nenhuma branch será excluída.` });
      return { repository, reused: true };
    }
    return { repository: await this.createRepository(input, options), reused: false };
  }

  async createPullRequest(repository, { head, base, title, body }, options = {}) {
    const args = ['api', '-X', 'POST', `repos/${repository.full_name}/pulls`, '-f', `head=${head}`, '-f', `base=${base}`, '-f', `title=${title}`, '-f', `body=${body || ''}`];
    const pull = this.parseJson((await this.runGhQuiet(args, { timeoutMs: 60_000, signal: options.signal })).stdout);
    if (!pull?.html_url) throw new BridgeError('PULL_REQUEST_CREATE_FAILED', `Não foi possível abrir a revisão em ${repository.full_name}.`);
    this.emit('migration:progress', { step: 'github-publish', status: 'complete', message: `Atualização publicada para revisão no PR #${pull.number}.` });
    return { number: pull.number, url: pull.html_url, head, base };
  }

  async getBranchRef(repository, branch, options = {}) {
    try {
      const encoded = encodeURIComponent(branch);
      return this.parseJson((await this.runGhQuiet(['api', `repos/${repository.full_name}/git/ref/heads/${encoded}`], { timeoutMs: 30_000, signal: options.signal })).stdout);
    } catch (error) {
      const detail = `${error.message || ''} ${error.details?.stderr || ''}`;
      if (/404|not found|reference does not exist/i.test(detail)) return null;
      throw error;
    }
  }

  async preserveBranch(repository, branch, options = {}) {
    const current = await this.getBranchRef(repository, branch, options);
    const sha = current?.object?.sha;
    if (!sha) return null;
    const backupBranch = backupBranchName(options.prefix || `${branch}-before-bridge`, sha, options.now || new Date());
    await this.runGhQuiet(['api', '-X', 'POST', `repos/${repository.full_name}/git/refs`, '-f', `ref=refs/heads/${backupBranch}`, '-f', `sha=${sha}`], { timeoutMs: 60_000, signal: options.signal });
    this.emit('migration:progress', { step: 'github-snapshot', status: 'complete', message: `Branch ${branch} preservada em ${backupBranch} (${sha.slice(0, 7)}).` });
    return { sourceBranch: branch, backupBranch, sha };
  }

  async getAuthenticationToken() {
    const result = await this.runGh(['auth', 'token', '--hostname', 'github.com'], { timeoutMs: 30_000, captureSensitive: true, onOutput: () => {} });
    const token = result.stdout.trim();
    if (!token || token.includes('[REDACTED]')) throw new BridgeError('GITHUB_TOKEN_UNAVAILABLE', 'A autenticação GitHub não pôde ser preparada para o envio.');
    return token;
  }

  async createAskPass() {
    await this.ensureSession();
    if (process.platform === 'win32') {
      const target = path.join(this.sessionDir, 'git-askpass.cmd');
      await fs.writeFile(target, ['@echo off', 'echo %~1 | findstr /I "Username" >nul', 'if %errorlevel%==0 (', '  echo x-access-token', ') else (', '  echo %RB_BRIDGE_GH_TOKEN%', ')', ''].join('\r\n'), { encoding: 'utf8', mode: 0o700 });
      return target;
    }
    const target = path.join(this.sessionDir, 'git-askpass.sh');
    await fs.writeFile(target, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "x-access-token" ;;\n  *) printf "%s\\n" "$RB_BRIDGE_GH_TOKEN" ;;\nesac\n', { encoding: 'utf8', mode: 0o700 });
    await fs.chmod(target, 0o700);
    return target;
  }

  async publish({ directory, repository, commitMessage, signal, branch = 'main', force = false }) {
    this.emit('migration:progress', {
      step: branch === (repository.default_branch || 'main') ? 'github-publish' : 'github-snapshot',
      status: 'running',
      message: `Publicando ${branch} em ${repository.full_name}...`,
    });
    await this.ensureDirectoryScopes(directory, { signal });
    await fs.rm(path.join(directory, '.git'), { recursive: true, force: true });
    const token = await this.getAuthenticationToken();
    const askPass = await this.createAskPass();
    const authEnv = { GIT_ASKPASS: askPass, GIT_TERMINAL_PROMPT: '0', RB_BRIDGE_GH_TOKEN: token };
    try {
      await this.runGit(['init', '-b', branch], { cwd: directory, signal, env: authEnv });
      const login = repository.owner?.login || repository.full_name.split('/')[0];
      await this.runGit(['config', 'user.name', login], { cwd: directory, signal, env: authEnv });
      await this.runGit(['config', 'user.email', `${login}@users.noreply.github.com`], { cwd: directory, signal, env: authEnv });
      await this.runGit(['add', '--all'], { cwd: directory, signal, env: authEnv });
      await this.runGit(['commit', '-m', commitMessage || 'Initial migration'], { cwd: directory, signal, env: authEnv });
      await this.runGit(['remote', 'add', 'origin', repository.clone_url], { cwd: directory, signal, env: authEnv });
      const pushArgs = ['push', '--set-upstream', 'origin', branch];
      if (force) pushArgs.splice(1, 0, '--force');
      try { await this.runGit(pushArgs, { cwd: directory, timeoutMs: 20 * 60 * 1000, signal, env: authEnv }); }
      catch (error) {
        if (isWorkflowScopeError(error)) {
          this.invalidateCaches({ auth: true, data: false });
          throw new BridgeError('GITHUB_WORKFLOW_SCOPE_REQUIRED', 'O GitHub bloqueou o workflow de validação. O produto local foi preservado e a entrega pode ser continuada.', { cause: error.message, canRetry: true });
        }
        throw error;
      }
      const sha = (await this.runGit(['rev-parse', 'HEAD'], { cwd: directory, signal, env: authEnv })).stdout.trim();
      this.emit('migration:progress', {
        step: branch === (repository.default_branch || 'main') ? 'github-publish' : 'github-snapshot',
        status: 'complete',
        message: `${branch} publicado no commit ${sha.slice(0, 7)}.`,
      });
      return { sha, url: repository.html_url, fullName: repository.full_name, branch };
    } finally { delete authEnv.RB_BRIDGE_GH_TOKEN; }
  }
}

module.exports = {
  GitHubService,
  GITHUB_DEVICE_URL,
  DELIVERY_SCOPES,
  AUTH_CACHE_TTL_MS,
  DATA_CACHE_TTL_MS,
  extractGitHubDeviceCode,
  parseGitHubScopes,
  missingGitHubScopes,
  isWorkflowScopeError,
  backupBranchName,
};
