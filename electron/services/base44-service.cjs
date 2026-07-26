'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { BridgeError } = require('../core/errors.cjs');
const { redactString } = require('../core/redaction.cjs');
const { ensureEmptyDir, readJson, pathExists } = require('../core/fs-utils.cjs');

const BASE_URL = process.env.BASE44_API_URL || 'https://app.base44.com';

function resolvePackagedCliPath(resolvedPath) {
  return String(resolvedPath).replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

function extractHttpsUrls(text) {
  return String(text).match(/https:\/\/[^\s<>"']+/gi) ?? [];
}

function runUtilityModule(modulePath, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const utilityProcess = options.utilityProcess;
    if (!utilityProcess?.fork) {
      reject(new BridgeError('UTILITY_PROCESS_UNAVAILABLE', 'Electron utility process support is unavailable. Reinstall RB Project Bridge.'));
      return;
    }
    if (options.signal?.aborted) {
      reject(new BridgeError('PROCESS_ABORTED', 'Base44 CLI was cancelled.'));
      return;
    }

    let child;
    try {
      child = utilityProcess.fork(modulePath, args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        serviceName: 'RB Project Bridge Base44 CLI',
      });
    } catch (error) {
      reject(new BridgeError('PROCESS_START_FAILED', error.message, { modulePath: redactString(modulePath) }));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let timer = null;

    const emit = (stream, chunk) => {
      const text = redactString(chunk.toString());
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      options.onOutput?.({ stream, text });
    };

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortHandler);
      if (error) reject(error);
      else resolve(result);
    };

    const terminate = () => {
      try { child.kill(); } catch {}
    };

    const abortHandler = () => {
      aborted = true;
      terminate();
    };

    child.stdout?.on('data', (chunk) => emit('stdout', chunk));
    child.stderr?.on('data', (chunk) => emit('stderr', chunk));
    child.on('error', (type, location) => {
      finish(new BridgeError('PROCESS_START_FAILED', `Base44 utility process failed: ${type}`, { location }));
    });
    child.on('exit', (code) => {
      const details = { modulePath: redactString(modulePath), args: args.map(redactString), code, stdout, stderr };
      if (aborted) finish(new BridgeError('PROCESS_ABORTED', 'Base44 CLI was cancelled.', details));
      else if (timedOut) finish(new BridgeError('PROCESS_TIMEOUT', 'Base44 CLI exceeded the time limit.', { ...details, timeoutMs: options.timeoutMs }));
      else if (code === 0 || options.acceptCodes?.includes(code)) finish(null, { code, stdout, stderr, safeStdout: stdout, safeStderr: stderr });
      else finish(new BridgeError('PROCESS_FAILED', `Base44 CLI exited with code ${code}`, details));
    });

    if (options.signal) options.signal.addEventListener('abort', abortHandler, { once: true });
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, options.timeoutMs);
      timer.unref?.();
    }
  });
}

class Base44Service {
  constructor({ logger, emit, sessionDir, openExternal, utilityProcess }) {
    this.logger = logger;
    this.emit = emit;
    this.openExternal = openExternal;
    this.utilityProcess = utilityProcess;
    this.sessionDir = sessionDir || path.join(os.tmpdir(), 'rb-project-bridge-base44');
  }

  getAuthPath() {
    return path.join(this.sessionDir, '.base44', 'auth', 'auth.json');
  }

  sessionEnvironment(extra = {}) {
    return {
      HOME: this.sessionDir,
      USERPROFILE: this.sessionDir,
      XDG_CONFIG_HOME: path.join(this.sessionDir, '.config'),
      ...extra,
    };
  }

  resolveCliPath() {
    try {
      const resolved = require.resolve('base44/bin/run.js');
      const executablePath = resolvePackagedCliPath(resolved);
      if (!fs.existsSync(executablePath)) throw new Error(`Base44 CLI entrypoint not found at ${executablePath}`);
      return executablePath;
    } catch (error) {
      throw new BridgeError('BASE44_CLI_MISSING', 'The bundled Base44 CLI is unavailable. Reinstall RB Project Bridge.', { cause: error.message });
    }
  }

  async openAuthorizationUrl(url, openedUrls) {
    try {
      const parsed = new URL(url);
      const allowed = parsed.protocol === 'https:'
        && (parsed.hostname === 'base44.com' || parsed.hostname.endsWith('.base44.com'));
      if (!allowed || openedUrls.has(parsed.href)) return;
      openedUrls.add(parsed.href);
      this.emit('base44:auth', { url: parsed.href });
      await this.openExternal?.(parsed.href);
      this.logger.info('base44.auth.browser.opened', { host: parsed.hostname });
    } catch (error) {
      this.logger.warn('base44.auth.browser.failed', { message: error.message });
    }
  }

  async runCli(args, options = {}) {
    await fsp.mkdir(this.sessionDir, { recursive: true });
    const cliPath = this.resolveCliPath();
    const output = options.onOutput ?? ((entry) => this.emit('base44:output', entry));
    this.logger.info('base44.cli.start', { args, cliPath });
    const result = await runUtilityModule(cliPath, args, {
      utilityProcess: this.utilityProcess,
      env: this.sessionEnvironment(options.env),
      timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
      onOutput: output,
      signal: options.signal,
    });
    this.logger.info('base44.cli.finish', { args, code: result.code });
    return result;
  }

  async login() {
    const openedUrls = new Set();
    let outputBuffer = '';
    await this.runCli(['login'], {
      timeoutMs: 15 * 60 * 1000,
      onOutput: (entry) => {
        this.emit('base44:output', entry);
        outputBuffer = `${outputBuffer}${entry.text}`.slice(-8192);
        for (const url of extractHttpsUrls(outputBuffer)) void this.openAuthorizationUrl(url, openedUrls);
      },
    });
    return this.whoami();
  }

  async logout() {
    try { await this.runCli(['logout'], { timeoutMs: 60_000 }); } catch {}
    await fsp.rm(path.join(this.sessionDir, '.base44'), { recursive: true, force: true });
    return { loggedIn: false };
  }

  async whoami() {
    if (!(await pathExists(this.getAuthPath()))) return { loggedIn: false };
    try {
      const result = await this.runCli(['--json', 'whoami'], { timeoutMs: 60_000 });
      const parsed = this.parseJsonOutput(result.stdout);
      return { loggedIn: true, ...(parsed ?? {}) };
    } catch (error) {
      this.logger.warn('base44.whoami.failed', { message: error.message });
      return { loggedIn: false, error: error.message };
    }
  }

  parseJsonOutput(output) {
    const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try { return JSON.parse(lines[index]); } catch {}
    }
    try { return JSON.parse(output); } catch { return null; }
  }

  async freshAuth() {
    await this.runCli(['--json', 'whoami'], { timeoutMs: 60_000 });
    const auth = await readJson(this.getAuthPath());
    if (!auth?.accessToken) throw new BridgeError('BASE44_NOT_AUTHENTICATED', 'Connect a Base44 account before continuing.');
    return auth;
  }

  async apiFetch(relativePath, options = {}, retry = true) {
    const auth = await this.freshAuth();
    const { timeoutMs, signal: callerSignal, ...fetchOptions } = options;
    const timeoutSignal = AbortSignal.timeout(timeoutMs ?? 30 * 60 * 1000);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(new URL(relativePath, BASE_URL), {
      ...fetchOptions,
      signal,
      headers: {
        'User-Agent': 'RB Project Bridge',
        Authorization: `Bearer ${auth.accessToken}`,
        ...(options.headers ?? {}),
      },
    });
    if (response.status === 401 && retry) {
      await this.runCli(['--json', 'whoami'], { timeoutMs: 60_000 });
      return this.apiFetch(relativePath, options, false);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new BridgeError('BASE44_API_ERROR', `Base44 returned HTTP ${response.status}.`, { status: response.status, body: body.slice(0, 1000) });
    }
    return response;
  }

  async listProjects() {
    const params = new URLSearchParams({
      sort: '-updated_date',
      fields: 'id,name,user_description,is_managed_source_code,updated_date',
      limit: '50',
    });
    const response = await this.apiFetch(`/api/apps?${params.toString()}`);
    const data = await response.json();
    const projects = Array.isArray(data) ? data : (data?.apps ?? data?.data ?? []);
    return projects.map((project) => ({
      id: project.id,
      name: project.name || 'Untitled project',
      description: project.user_description || '',
      updatedAt: project.updated_date || null,
      ejectable: project.is_managed_source_code !== false,
    }));
  }

  async exportProject(project, destination, options = {}) {
    if (!project?.id) throw new BridgeError('PROJECT_REQUIRED', 'Select a Base44 project.');
    await ensureEmptyDir(destination);
    const archivePath = path.join(destination, '.rb-bridge-export.tar');
    this.emit('migration:progress', { step: 'base44-export', status: 'running', message: `Downloading ${project.name}...` });
    const response = await this.apiFetch(`/api/apps/${encodeURIComponent(project.id)}/eject`, { method: 'GET', signal: options.signal });
    if (!response.body) throw new BridgeError('BASE44_EMPTY_EXPORT', 'Base44 returned an empty export.');
    const contentLength = Number(response.headers.get('content-length') || 0);
    const maxArchiveBytes = 1_000_000_000;
    if (contentLength > maxArchiveBytes) throw new BridgeError('BASE44_EXPORT_TOO_LARGE', 'The Base44 export exceeds the 1 GB safety limit.', { contentLength });
    let received = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > maxArchiveBytes) callback(new BridgeError('BASE44_EXPORT_TOO_LARGE', 'The Base44 export exceeded the 1 GB safety limit during download.'));
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(archivePath), { signal: options.signal });
      const tar = require('tar');
      await tar.x({ file: archivePath, cwd: destination, preservePaths: false, strict: true });
    } finally {
      await fsp.rm(archivePath, { force: true }).catch(() => null);
    }
    const entries = await fsp.readdir(destination);
    if (entries.length === 0) throw new BridgeError('BASE44_EMPTY_EXPORT', 'The exported project contains no files.');
    this.logger.info('base44.export.complete', { projectId: project.id, destination, entries: entries.length });
    this.emit('migration:progress', { step: 'base44-export', status: 'complete', message: 'Base44 export completed.' });
    return { destination, entries: entries.length };
  }
}

module.exports = { Base44Service, resolvePackagedCliPath, extractHttpsUrls, runUtilityModule };
