from pathlib import Path
import json
import re

# ---------- Base44 network resilience ----------
base44_path = Path('electron/services/base44-service.cjs')
base44 = base44_path.read_text(encoding='utf-8')

helpers = r'''
function safeRequestUrl(input) {
  try {
    const url = new URL(input);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(input || '').split('?')[0];
  }
}

function fetchErrorDetails(error, url, method, attempt, attempts, timedOut = false) {
  const cause = error?.cause || {};
  return {
    url: safeRequestUrl(url),
    method: String(method || 'GET').toUpperCase(),
    attempt,
    attempts,
    timedOut,
    name: error?.name || null,
    message: error?.message || String(error),
    code: cause.code || error?.code || null,
    errno: cause.errno || null,
    syscall: cause.syscall || null,
    hostname: cause.hostname || null,
  };
}

function isRetryableNetworkError(error) {
  if (error instanceof BridgeError && error.code === 'BASE44_NETWORK_FAILED') return true;
  const cause = error?.cause || {};
  const code = String(cause.code || error?.code || '').toUpperCase();
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) return true;
  return (error instanceof TypeError && /fetch failed|network|socket|connect/i.test(error.message || '')) || /terminated|other side closed/i.test(error?.message || '');
}

function retryWait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new BridgeError('PROCESS_ABORTED', 'A operação foi cancelada.'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new BridgeError('PROCESS_ABORTED', 'A operação foi cancelada.'));
    }, { once: true });
  });
}

async function fetchWithRetry(url, options = {}, config = {}) {
  const attempts = Math.max(1, Number(config.attempts || 4));
  const timeoutMs = Math.max(1000, Number(config.timeoutMs || 120000));
  const waits = config.waits || [1500, 3500, 7000];
  const retryStatuses = new Set(config.retryStatuses || [429, 502, 503, 504]);
  const fetchImpl = config.fetchImpl || fetch;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await fetchImpl(url, { ...options, signal });
      if (retryStatuses.has(response.status) && attempt < attempts) {
        await response.body?.cancel?.().catch(() => null);
        config.onRetry?.({ attempt, attempts, status: response.status, url: safeRequestUrl(url) });
        await retryWait(waits[Math.min(attempt - 1, waits.length - 1)] || 7000, options.signal);
        continue;
      }
      return response;
    } catch (error) {
      if (options.signal?.aborted) throw new BridgeError('PROCESS_ABORTED', 'A operação foi cancelada.');
      const timedOut = timeoutSignal.aborted;
      const details = fetchErrorDetails(error, url, options.method, attempt, attempts, timedOut);
      lastError = new BridgeError('BASE44_NETWORK_FAILED', `Falha de comunicação com a Base44 em ${details.url}${details.code ? ` (${details.code})` : ''}.`, details);
      if ((!isRetryableNetworkError(error) && !timedOut) || attempt >= attempts) throw lastError;
      config.onRetry?.(details);
      await retryWait(waits[Math.min(attempt - 1, waits.length - 1)] || 7000, options.signal);
    }
  }
  throw lastError || new BridgeError('BASE44_NETWORK_FAILED', 'Não foi possível comunicar com a Base44.');
}
'''
if 'async function fetchWithRetry' not in base44:
    base44 = base44.replace('\nclass Base44Service {', helpers + '\nclass Base44Service {')

old_oauth = """    const response = await fetch(oauthUrl(relativePath), {
      ...options,
      headers: {
        'User-Agent': 'RB Project Bridge',
        'X-Request-ID': randomUUID(),
        ...(options.headers || {}),
      },
      signal: options.signal,
    });"""
new_oauth = """    const target = oauthUrl(relativePath);
    const response = await fetchWithRetry(target, {
      ...options,
      headers: {
        'User-Agent': 'RB Project Bridge',
        'X-Request-ID': randomUUID(),
        ...(options.headers || {}),
      },
      signal: options.signal,
    }, {
      attempts: 3,
      timeoutMs: 45000,
      onRetry: (details) => this.logger.warn('base44.oauth.retry', details),
    });"""
if old_oauth in base44:
    base44 = base44.replace(old_oauth, new_oauth, 1)

api_pattern = re.compile(r"  async apiFetch\(relativePath, options = \{\}, retry = true\) \{.*?\n  \}\n\n  async listProjects", re.S)
api_replacement = r'''  async apiFetch(relativePath, options = {}, retry = true) {
    const auth = await this.freshAuth({ signal: options.signal });
    const { timeoutMs, attempts, operation, signal: callerSignal, ...fetchOptions } = options;
    const target = new URL(relativePath, BASE_URL).href;
    const response = await fetchWithRetry(target, {
      ...fetchOptions,
      signal: callerSignal,
      headers: {
        'User-Agent': 'RB Project Bridge',
        Authorization: `Bearer ${auth.accessToken}`,
        ...(options.headers ?? {}),
      },
    }, {
      timeoutMs: timeoutMs ?? 120000,
      attempts: attempts ?? 4,
      onRetry: (details) => {
        this.logger.warn('base44.api.retry', { operation: operation || relativePath, ...details });
        this.emit('migration:progress', { step: 'base44-export', status: 'running', message: `Conexão Base44 instável. Nova tentativa ${Math.min((details.attempt || 0) + 1, details.attempts || 4)}/${details.attempts || 4}...` });
      },
    });
    if (response.status === 401 && retry) {
      const renewed = await this.refreshToken(auth.refreshToken, { signal: callerSignal });
      await writeJson(this.getAuthPath(), {
        ...auth,
        accessToken: renewed.accessToken,
        refreshToken: renewed.refreshToken,
        expiresAt: Date.now() + renewed.expiresIn * 1000,
      });
      return this.apiFetch(relativePath, options, false);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new BridgeError('BASE44_API_ERROR', `A Base44 retornou HTTP ${response.status}.`, {
        url: safeRequestUrl(target),
        status: response.status,
        body: body.slice(0, 1000),
      });
    }
    return response;
  }

  async listProjects'''
base44, api_count = api_pattern.subn(api_replacement, base44, count=1)
if api_count != 1:
    raise SystemExit('Could not patch apiFetch')

export_pattern = re.compile(r"  async exportProject\(project, destination, options = \{\}\) \{.*?\n  \}\n\}\n\nmodule\.exports", re.S)
export_replacement = r'''  async exportProject(project, destination, options = {}) {
    if (!project?.id) throw new BridgeError('PROJECT_REQUIRED', 'Selecione um projeto Base44.');
    await ensureEmptyDir(destination);
    const archivePath = path.join(destination, '.rb-bridge-export.tar');
    const maxArchiveBytes = 1_000_000_000;
    const totalAttempts = 4;
    this.emit('migration:progress', { step: 'base44-export', status: 'running', message: `Baixando ${project.name}...` });
    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      let received = 0;
      try {
        const response = await this.apiFetch(`/api/apps/${encodeURIComponent(project.id)}/eject`, {
          method: 'GET',
          signal: options.signal,
          timeoutMs: 5 * 60 * 1000,
          attempts: 2,
          operation: `export:${project.id}`,
        });
        if (!response.body) throw new BridgeError('BASE44_EMPTY_EXPORT', 'A Base44 retornou uma exportação vazia.');
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > maxArchiveBytes) throw new BridgeError('BASE44_EXPORT_TOO_LARGE', 'A exportação ultrapassa o limite de segurança de 1 GB.', { contentLength });
        const limiter = new Transform({
          transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (received > maxArchiveBytes) callback(new BridgeError('BASE44_EXPORT_TOO_LARGE', 'A exportação ultrapassou o limite de 1 GB durante o download.'));
            else callback(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(archivePath), { signal: options.signal });
        const tar = require('tar');
        await tar.x({ file: archivePath, cwd: destination, preservePaths: false, strict: true });
        const entries = await fsp.readdir(destination);
        if (entries.length === 0) throw new BridgeError('BASE44_EMPTY_EXPORT', 'O projeto exportado não contém arquivos.');
        this.logger.info('base44.export.complete', { projectId: project.id, destination, entries: entries.length, received, attempt });
        this.emit('migration:progress', { step: 'base44-export', status: 'complete', message: 'Exportação Base44 concluída.' });
        return { destination, entries: entries.length, bytes: received, source: 'base44', attempt };
      } catch (error) {
        await fsp.rm(archivePath, { force: true }).catch(() => null);
        if (options.signal?.aborted || error?.code === 'PROCESS_ABORTED') throw error;
        const retryable = isRetryableNetworkError(error) || error?.code === 'BASE44_NETWORK_FAILED';
        const details = error?.details || fetchErrorDetails(error, `${BASE_URL}/api/apps/${project.id}/eject`, 'GET', attempt, totalAttempts);
        this.logger.warn('base44.export.attempt.failed', { projectId: project.id, attempt, retryable, ...details });
        if (!retryable || attempt >= totalAttempts) {
          throw new BridgeError('BASE44_EXPORT_FAILED', `Não foi possível baixar ${project.name} após ${attempt} tentativa(s).`, { ...details, projectId: project.id, attempts: attempt });
        }
        this.emit('migration:progress', { step: 'base44-export', status: 'running', message: `Download interrompido. Tentando novamente (${attempt + 1}/${totalAttempts})...` });
        await retryWait([1500, 3500, 7000][attempt - 1] || 7000, options.signal);
      }
    }
    throw new BridgeError('BASE44_EXPORT_FAILED', `Não foi possível baixar ${project.name}.`);
  }
}

module.exports'''
base44, export_count = export_pattern.subn(export_replacement, base44, count=1)
if export_count != 1:
    raise SystemExit('Could not patch exportProject')

base44 = base44.replace("  validateToken,\n};", "  validateToken,\n  safeRequestUrl,\n  fetchErrorDetails,\n  isRetryableNetworkError,\n  fetchWithRetry,\n};")
base44_path.write_text(base44, encoding='utf-8')

# ---------- GitHub repository intelligence and source fallback ----------
github_path = Path('electron/services/github-service.cjs')
github = github_path.read_text(encoding='utf-8')

insert_after_accounts = """  async getAccounts() { const status = await this.authStatus(); if (!status.authenticated) return { authenticated: false, accounts: [] }; const user = this.parseJson((await this.runGh(['api', 'user'], { timeoutMs: 60_000 })).stdout); let orgs = []; try { const parsed = this.parseJson((await this.runGh(['api', 'user/orgs', '--paginate', '--slurp'], { timeoutMs: 60_000 })).stdout) || []; orgs = Array.isArray(parsed[0]) ? parsed.flat() : parsed; } catch (error) { this.logger.warn('github.organizations.unavailable', { message: error.message }); } if (!user?.login) throw new BridgeError('GITHUB_PROFILE_UNAVAILABLE', 'GitHub did not return the authenticated profile.'); return { authenticated: true, user: { login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url }, accounts: [{ login: user.login, type: 'user', label: user.name ? `${user.name} (${user.login})` : user.login }, ...orgs.map((org) => ({ login: org.login, type: 'organization', label: org.login }))] }; }
"""
repo_methods = r'''  async listRepositories(owner, ownerType = 'user') {
    const endpoint = ownerType === 'organization'
      ? `orgs/${owner}/repos?per_page=100&sort=updated`
      : 'user/repos?per_page=100&sort=updated&affiliation=owner';
    const parsed = this.parseJson((await this.runGh(['api', endpoint, '--paginate', '--slurp'], { timeoutMs: 120_000 })).stdout) || [];
    const repositories = Array.isArray(parsed?.[0]) ? parsed.flat() : (Array.isArray(parsed) ? parsed : []);
    return repositories
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
  }
  async readRepositoryJson(repository, filePath, branches = ['base44-source', 'main']) {
    for (const branch of branches) {
      try {
        const endpoint = `repos/${repository.full_name}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
        const payload = this.parseJson((await this.runGh(['api', endpoint], { timeoutMs: 30_000 })).stdout);
        if (!payload?.content) continue;
        const text = Buffer.from(String(payload.content).replace(/\s/g, ''), 'base64').toString('utf8');
        return { branch, data: JSON.parse(text) };
      } catch (error) {
        const detail = `${error.message || ''} ${error.details?.stderr || ''}`;
        if (!/404|not found/i.test(detail)) this.logger.warn('github.manifest.read.failed', { repository: repository.full_name, branch, filePath, message: error.message });
      }
    }
    return null;
  }
  async inspectSourceStatus({ owner, name, project }) {
    if (!(await this.repositoryExists(owner, name))) return { exists: false, repository: null, source: null, status: 'new-repository' };
    const repository = await this.getRepository(owner, name);
    const source = await this.readRepositoryJson(repository, 'RB-BRIDGE-SOURCE.json');
    let latestCommitAt = null;
    try {
      const commit = this.parseJson((await this.runGh(['api', `repos/${repository.full_name}/commits/${encodeURIComponent(repository.default_branch || 'main')}`], { timeoutMs: 30_000 })).stdout);
      latestCommitAt = commit?.commit?.committer?.date || commit?.commit?.author?.date || null;
    } catch {}
    const previousUpdatedAt = source?.data?.base44UpdatedAt || null;
    const currentUpdatedAt = project?.updatedAt || null;
    const base44Changed = Boolean(previousUpdatedAt && currentUpdatedAt && new Date(currentUpdatedAt).getTime() > new Date(previousUpdatedAt).getTime() + 1000);
    const githubChanged = Boolean(source?.data?.deliveredAt && latestCommitAt && new Date(latestCommitAt).getTime() > new Date(source.data.deliveredAt).getTime() + 120000);
    return {
      exists: true,
      repository: { name: repository.name, fullName: repository.full_name, private: Boolean(repository.private), defaultBranch: repository.default_branch || 'main', htmlUrl: repository.html_url, updatedAt: repository.updated_at || null },
      source: source ? { branch: source.branch, ...source.data } : null,
      currentBase44UpdatedAt: currentUpdatedAt,
      latestCommitAt,
      base44Changed,
      githubChanged,
      status: !source ? 'unlinked' : base44Changed ? (githubChanged ? 'both-changed' : 'base44-newer') : githubChanged ? 'github-newer' : 'in-sync',
    };
  }
  async cloneBase44Source({ owner, name, destination }, options = {}) {
    if (!(await this.repositoryExists(owner, name))) return null;
    const repository = await this.getRepository(owner, name);
    const branches = ['base44-source', repository.default_branch || 'main'];
    const token = await this.getAuthenticationToken(); const askPass = await this.createAskPass(); const authEnv = { GIT_ASKPASS: askPass, GIT_TERMINAL_PROMPT: '0', RB_BRIDGE_GH_TOKEN: token };
    try {
      for (const branch of [...new Set(branches)]) {
        const ref = await this.getBranchRef(repository, branch, options);
        if (!ref?.object?.sha) continue;
        await fs.rm(destination, { recursive: true, force: true });
        try {
          await this.runGit(['clone', '--depth', '1', '--single-branch', '--branch', branch, repository.clone_url, destination], { timeoutMs: 10 * 60 * 1000, signal: options.signal, env: authEnv });
          const packagePath = path.join(destination, 'package.json');
          const packageText = await fs.readFile(packagePath, 'utf8').catch(() => '');
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
'''
if 'async listRepositories(owner' not in github:
    if insert_after_accounts not in github:
        raise SystemExit('Could not find getAccounts method')
    github = github.replace(insert_after_accounts, insert_after_accounts + repo_methods, 1)

old_resolve = """  async resolveRepository(input, options = {}) {
    if (await this.repositoryExists(input.owner, input.name)) {
      const repository = await this.ensurePrivate(input.owner, input.name, options);
      this.emit('migration:progress', { step: 'github-publish', status: 'running', message: `Reutilizando ${repository.full_name}; nenhuma branch será excluída.` });
      return { repository, reused: true };
    }
    return { repository: await this.createRepository(input, options), reused: false };
  }"""
new_resolve = """  async resolveRepository(input, options = {}) {
    const exists = await this.repositoryExists(input.owner, input.name);
    if (input.strategy === 'reuse' && !exists) throw new BridgeError('REPOSITORY_NOT_FOUND', `O repositório ${input.owner}/${input.name} não existe mais. Atualize a lista antes de continuar.`);
    if (input.strategy === 'create' && exists) throw new BridgeError('REPOSITORY_ALREADY_EXISTS', `O repositório ${input.owner}/${input.name} já existe. Selecione-o na lista em vez de criar outro.`);
    if (exists) {
      const repository = await this.ensurePrivate(input.owner, input.name, options);
      this.emit('migration:progress', { step: 'github-publish', status: 'running', message: `Reutilizando ${repository.full_name}; nenhuma branch será excluída.` });
      return { repository, reused: true };
    }
    return { repository: await this.createRepository(input, options), reused: false };
  }"""
if old_resolve in github:
    github = github.replace(old_resolve, new_resolve, 1)
github_path.write_text(github, encoding='utf-8')

# ---------- Migration fallback and source manifest ----------
migration_path = Path('electron/services/migration-service.cjs')
migration = migration_path.read_text(encoding='utf-8')
migration = migration.replace("const { ensureEmptyDir, copyDirectory, safeSlug, readJson } = require('../core/fs-utils.cjs');", "const { ensureEmptyDir, copyDirectory, safeSlug, readJson, writeJson } = require('../core/fs-utils.cjs');")
migration = migration.replace("project: { id: input.project.id, name: input.project.name }", "project: { id: input.project.id, name: input.project.name, updatedAt: input.project.updatedAt || null }")
old_export = """      report.export = await this.base44.exportProject(input.project, originalDir, { signal }); this.assertActive(signal);
      report.exportTree = await this.security.validateExportTree(originalDir, {}, signal);"""
new_export = """      try {
        report.export = await this.base44.exportProject(input.project, originalDir, { signal });
      } catch (error) {
        if (!['BASE44_EXPORT_FAILED', 'BASE44_NETWORK_FAILED'].includes(error?.code)) throw error;
        this.emit('migration:progress', { step: 'base44-export', status: 'running', message: 'Base44 indisponível. Procurando o último snapshot válido no GitHub...' });
        const fallback = await this.github.cloneBase44Source({ owner: input.repository.owner, name: input.repository.name, destination: originalDir }, { signal });
        if (!fallback) throw error;
        report.export = fallback;
        report.notes.push(`A Base44 não respondeu durante esta execução. Foi usado o snapshot ${fallback.repository}:${fallback.branch}@${fallback.sha.slice(0, 7)}.`);
      }
      this.assertActive(signal);
      report.exportTree = await this.security.validateExportTree(originalDir, {}, signal);"""
if old_export not in migration:
    raise SystemExit('Could not patch migration export')
migration = migration.replace(old_export, new_export, 1)
old_snapshot = """      await copyDirectory(originalDir, snapshotDir); report.snapshotSanitization = await this.security.sanitize(snapshotDir, signal); report.sanitization = report.snapshotSanitization; report.snapshotSecurity = await this.security.scan(snapshotDir, signal); if (report.snapshotSecurity.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED', 'O snapshot contém possíveis segredos.', { findings: report.snapshotSecurity.blocking });
      await copyDirectory(snapshotDir, repositoryDir);"""
new_snapshot = """      await copyDirectory(originalDir, snapshotDir); report.snapshotSanitization = await this.security.sanitize(snapshotDir, signal); report.sanitization = report.snapshotSanitization; report.snapshotSecurity = await this.security.scan(snapshotDir, signal); if (report.snapshotSecurity.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED', 'O snapshot contém possíveis segredos.', { findings: report.snapshotSecurity.blocking });
      report.sourceManifest = {
        schemaVersion: 1,
        projectId: input.project.id,
        projectName: input.project.name,
        base44UpdatedAt: input.project.updatedAt || null,
        exportedAt: new Date().toISOString(),
        deliveredAt: null,
        source: report.export.source || 'base44',
        fallbackRepository: report.export.repository || null,
        fallbackBranch: report.export.branch || null,
        fallbackSha: report.export.sha || null,
      };
      await writeJson(path.join(snapshotDir, 'RB-BRIDGE-SOURCE.json'), report.sourceManifest);
      await copyDirectory(snapshotDir, repositoryDir);"""
if old_snapshot not in migration:
    raise SystemExit('Could not patch snapshot manifest')
migration = migration.replace(old_snapshot, new_snapshot, 1)
old_resolved = """      const resolved = await this.github.resolveRepository({ ...input.repository, visibility: 'private' }, { signal });"""
new_resolved = """      report.sourceStatusBeforePublish = await this.github.inspectSourceStatus({ owner: input.repository.owner, name: input.repository.name, project: input.project }).catch(() => null);
      report.sourceManifest.deliveredAt = new Date().toISOString();
      await writeJson(path.join(snapshotDir, 'RB-BRIDGE-SOURCE.json'), report.sourceManifest);
      await writeJson(path.join(repositoryDir, 'RB-BRIDGE-SOURCE.json'), report.sourceManifest);
      const resolved = await this.github.resolveRepository({ ...input.repository, visibility: 'private' }, { signal });"""
if old_resolved not in migration:
    raise SystemExit('Could not patch resolve section')
migration = migration.replace(old_resolved, new_resolved, 1)
migration_path.write_text(migration, encoding='utf-8')

# ---------- IPC and renderer repository selector ----------
preload_path = Path('electron/preload.cjs')
preload = preload_path.read_text(encoding='utf-8')
preload = preload.replace("github: { status: () => ipcRenderer.invoke('github:status'), login: () => ipcRenderer.invoke('github:login'), logout: () => ipcRenderer.invoke('github:logout'), accounts: () => ipcRenderer.invoke('github:accounts') }", "github: { status: () => ipcRenderer.invoke('github:status'), login: () => ipcRenderer.invoke('github:login'), logout: () => ipcRenderer.invoke('github:logout'), accounts: () => ipcRenderer.invoke('github:accounts'), repositories: (owner, ownerType) => ipcRenderer.invoke('github:repositories', owner, ownerType), sourceStatus: (input) => ipcRenderer.invoke('github:source-status', input) }")
preload_path.write_text(preload, encoding='utf-8')

main_path = Path('electron/main.cjs')
main = main_path.read_text(encoding='utf-8')
main = main.replace("handle('github:status', () => services.github.authStatus()); handle('github:login', () => services.github.login()); handle('github:logout', () => services.github.logout()); handle('github:accounts', () => services.github.getAccounts());", "handle('github:status', () => services.github.authStatus()); handle('github:login', () => services.github.login()); handle('github:logout', () => services.github.logout()); handle('github:accounts', () => services.github.getAccounts()); handle('github:repositories', (owner, ownerType) => services.github.listRepositories(owner, ownerType)); handle('github:source-status', (input) => services.github.inspectSourceStatus(input));")
main = main.replace("repo.name = safeSlug(repo.name, safeSlug(input.project.name));", "repo.strategy = repo.strategy === 'create' ? 'create' : 'reuse';\n  repo.name = safeSlug(repo.name, safeSlug(input.project.name));")
main_path.write_text(main, encoding='utf-8')

index_path = Path('renderer/index.html')
index = index_path.read_text(encoding='utf-8')
old_repo_ui = '<div class="grid two"><label>Conta GitHub<select id="owner"></select></label><label>Nome do repositório<input id="repoName" placeholder="meu-produto"></label></div>\n       <label>Descrição<input id="description" placeholder="Aplicação independente preparada pelo RB Project Bridge"></label>'
new_repo_ui = '<div class="grid two"><label>Conta GitHub<select id="owner"></select></label><label>Destino<select id="repoChoice"><option value="">Conecte o GitHub para carregar</option></select></label></div>\n       <label id="newRepoLabel" class="hidden">Nome do novo repositório<input id="repoName" placeholder="meu-produto"></label>\n       <div id="repoSyncStatus" class="private-lock"><strong>Seleção inteligente</strong><span>Escolha um repositório existente ou selecione “Criar novo”. O Bridge não criará outro repositório por erro de digitação.</span></div>\n       <label>Descrição<input id="description" placeholder="Aplicação independente preparada pelo RB Project Bridge"></label>'
if old_repo_ui not in index:
    raise SystemExit('Could not patch repository UI')
index = index.replace(old_repo_ui, new_repo_ui, 1)
index_path.write_text(index, encoding='utf-8')

app_path = Path('renderer/app.js')
app = app_path.read_text(encoding='utf-8')
app = app.replace("let githubDeviceCode = '', base44DeviceCode = '', base44DeviceUrl = '', lastResult = null;", "let githubDeviceCode = '', base44DeviceCode = '', base44DeviceUrl = '', lastResult = null, repositories = [];")
app = app.replace("async function projects() { const list = await call(window.rbBridge.base44.projects()); const select = $('project'); select.replaceChildren(); for (const project of list) { const option = document.createElement('option'); option.value = project.id; option.dataset.name = project.name; option.textContent = project.name; select.appendChild(option); } }", "async function projects() { const list = await call(window.rbBridge.base44.projects()); const select = $('project'); select.replaceChildren(); for (const project of list) { const option = document.createElement('option'); option.value = project.id; option.dataset.name = project.name; option.dataset.updatedAt = project.updatedAt || ''; option.textContent = project.updatedAt ? `${project.name} — ${new Date(project.updatedAt).toLocaleString('pt-BR')}` : project.name; select.appendChild(option); } await loadRepositories(); }")
app = app.replace("async function accounts() { const data = await call(window.rbBridge.github.accounts()); const select = $('owner'); select.replaceChildren(); for (const account of data.accounts) { const option = document.createElement('option'); option.value = account.login; option.dataset.type = account.type; option.textContent = account.label; select.appendChild(option); } }", "async function accounts() { const data = await call(window.rbBridge.github.accounts()); const select = $('owner'); select.replaceChildren(); for (const account of data.accounts) { const option = document.createElement('option'); option.value = account.login; option.dataset.type = account.type; option.textContent = account.label; select.appendChild(option); } await loadRepositories(); }")
helper_marker = "async function load() {"
repo_helpers = r'''function slug(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100); }
function selectedRepository() { const option = $('repoChoice').selectedOptions[0]; if (!option) return null; if (option.value === '__new__') return { strategy: 'create', name: $('repoName').value.trim() }; return { strategy: 'reuse', name: option.value }; }
async function inspectRepositorySelection() {
  const selected = selectedRepository(), project = $('project').selectedOptions[0], owner = $('owner').selectedOptions[0];
  $('newRepoLabel').classList.toggle('hidden', selected?.strategy !== 'create');
  if (!selected?.name || selected.strategy === 'create' || !project || !owner) { $('repoSyncStatus').querySelector('span').textContent = selected?.strategy === 'create' ? 'Um novo repositório privado será criado somente após confirmação explícita.' : 'Selecione um repositório existente para comparar com a Base44.'; return; }
  try {
    const status = await call(window.rbBridge.github.sourceStatus({ owner: owner.value, name: selected.name, project: { id: project.value, name: project.dataset.name, updatedAt: project.dataset.updatedAt || null } }));
    const messages = {
      unlinked: 'Repositório existente sem vínculo registrado. O estado atual será preservado antes da primeira entrega independente.',
      'base44-newer': 'A Base44 possui alterações mais recentes que o último snapshot. Uma nova exportação será feita.',
      'github-newer': 'O GitHub evoluiu depois da última migração. O estado atual será preservado antes de qualquer atualização.',
      'both-changed': 'Base44 e GitHub mudaram. O Bridge preservará o GitHub e registrará a divergência para revisão.',
      'in-sync': 'Base44 e snapshot registrado estão alinhados.',
    };
    $('repoSyncStatus').querySelector('span').textContent = messages[status.status] || 'Repositório pronto para reutilização segura.';
  } catch (error) { $('repoSyncStatus').querySelector('span').textContent = `Não foi possível comparar agora: ${error.message}`; }
}
async function loadRepositories() {
  const owner = $('owner').selectedOptions[0], choice = $('repoChoice'), project = $('project').selectedOptions[0];
  if (!owner) return;
  try {
    repositories = await call(window.rbBridge.github.repositories(owner.value, owner.dataset.type));
    choice.replaceChildren();
    for (const repository of repositories) { const option = document.createElement('option'); option.value = repository.name; option.textContent = `${repository.name}${repository.private ? ' 🔒' : ' 🌐'}`; choice.appendChild(option); }
    const create = document.createElement('option'); create.value = '__new__'; create.textContent = '＋ Criar novo repositório privado'; choice.appendChild(create);
    const suggested = slug(project?.dataset.name || '');
    const exact = repositories.find((repository) => repository.name.toLowerCase() === suggested.toLowerCase());
    if (exact) choice.value = exact.name; else { choice.value = '__new__'; $('repoName').value = suggested; }
    await inspectRepositorySelection();
  } catch (error) { choice.replaceChildren(); const option = document.createElement('option'); option.value = ''; option.textContent = 'Erro ao carregar repositórios'; choice.appendChild(option); log(`ERRO GitHub: ${error.message}`); }
}
'''
if repo_helpers not in app:
    app = app.replace(helper_marker, repo_helpers + helper_marker, 1)
app = app.replace("$('chooseOutput').onclick", "$('owner').onchange = loadRepositories; $('project').onchange = loadRepositories; $('repoChoice').onchange = inspectRepositorySelection; $('repoName').oninput = inspectRepositorySelection;\n$('chooseOutput').onclick", 1)
app = app.replace("    if (!$('repoName').value.trim()) throw new Error('Informe o nome exato do repositório que será criado ou reutilizado.');", "    const repositorySelection = selectedRepository();\n    if (!repositorySelection?.name) throw new Error('Selecione um repositório existente ou informe o nome do novo repositório.');")
app = app.replace("project: { id: projectOption.value, name: projectOption.dataset.name }", "project: { id: projectOption.value, name: projectOption.dataset.name, updatedAt: projectOption.dataset.updatedAt || null }")
app = app.replace("repository: { owner: ownerOption.value, ownerType: ownerOption.dataset.type, name: $('repoName').value.trim(), description:", "repository: { owner: ownerOption.value, ownerType: ownerOption.dataset.type, strategy: repositorySelection.strategy, name: repositorySelection.name, description:")
app_path.write_text(app, encoding='utf-8')

# ---------- Tests ----------
test_path = Path('tests/base44-network.test.cjs')
test_path.write_text(r'''const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchWithRetry, isRetryableNetworkError, safeRequestUrl } = require('../electron/services/base44-service.cjs');

test('Base44 network retry recovers after transient fetch failures', async () => {
  let calls = 0;
  const response = await fetchWithRetry('https://app.base44.com/api/apps/test/eject?secret=x', { method: 'GET' }, {
    attempts: 4,
    timeoutMs: 1000,
    waits: [1, 1, 1],
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) { const error = new TypeError('fetch failed'); error.cause = { code: 'ECONNRESET' }; throw error; }
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
});

test('Base44 network retry exposes useful final diagnostics', async () => {
  await assert.rejects(() => fetchWithRetry('https://app.base44.com/api/apps/test/eject', {}, {
    attempts: 2,
    timeoutMs: 1000,
    waits: [1],
    fetchImpl: async () => { const error = new TypeError('fetch failed'); error.cause = { code: 'ENOTFOUND', hostname: 'app.base44.com' }; throw error; },
  }), (error) => error.code === 'BASE44_NETWORK_FAILED' && error.details.code === 'ENOTFOUND' && error.details.attempt === 2);
  assert.equal(isRetryableNetworkError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })), true);
  assert.equal(safeRequestUrl('https://app.base44.com/api/apps/x/eject?token=secret'), 'https://app.base44.com/api/apps/x/eject');
});
''', encoding='utf-8')

# Version and permanent workflow.
package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
package['version'] = '0.2.3'
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

workflow_path = Path('.github/workflows/release.yml')
workflow = workflow_path.read_text(encoding='utf-8').replace('0.2.2', '0.2.3')
workflow_path.write_text(workflow, encoding='utf-8')
