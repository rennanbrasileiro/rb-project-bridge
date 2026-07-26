'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { BridgeError } = require('../core/errors.cjs');
const { ensureEmptyDir, readJson, writeJson, pathExists } = require('../core/fs-utils.cjs');

const BASE_URL = process.env.BASE44_API_URL || 'https://app.base44.com';
const AUTH_CLIENT_ID = 'base44_cli';
const AUTH_SCOPE = 'apps:read apps:write sandbox:write';

function oauthUrl(relativePath) {
  return new URL(relativePath, BASE_URL).href;
}

async function responseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch {
    throw new BridgeError('BASE44_INVALID_RESPONSE', 'A Base44 retornou uma resposta inválida.', {
      status: response.status,
      body: text.slice(0, 500),
    });
  }
}

function validateDeviceCode(data) {
  const deviceCode = data?.device_code;
  const userCode = data?.user_code;
  const verificationUri = data?.verification_uri;
  const expiresIn = Number(data?.expires_in);
  const interval = Number(data?.interval);
  if (!deviceCode || !userCode || !verificationUri || !Number.isFinite(expiresIn) || !Number.isFinite(interval)) {
    throw new BridgeError('BASE44_DEVICE_CODE_INVALID', 'A Base44 não retornou um código de autorização válido.');
  }
  return { deviceCode, userCode, verificationUri, expiresIn, interval };
}

function validateToken(data, fallbackRefreshToken = '') {
  const accessToken = data?.access_token;
  const refreshToken = data?.refresh_token || fallbackRefreshToken;
  const expiresIn = Number(data?.expires_in);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn)) {
    throw new BridgeError('BASE44_TOKEN_INVALID', 'A Base44 não retornou uma sessão válida.');
  }
  return { accessToken, refreshToken, expiresIn, scope: data?.scope || '' };
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BridgeError('PROCESS_ABORTED', 'Autorização Base44 cancelada.'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new BridgeError('PROCESS_ABORTED', 'Autorização Base44 cancelada.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

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

class Base44Service {
  constructor({ logger, emit, sessionDir, openExternal }) {
    this.logger = logger;
    this.emit = emit;
    this.openExternal = openExternal;
    this.sessionDir = sessionDir || path.join(os.tmpdir(), 'rb-project-bridge-base44');
  }

  getAuthPath() {
    return path.join(this.sessionDir, '.base44', 'auth', 'auth.json');
  }

  emitOutput(text, stream = 'stdout') {
    this.emit('base44:output', { stream, text: `${text}\n` });
  }

  async oauthRequest(relativePath, options = {}) {
    const target = oauthUrl(relativePath);
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
    });
    const data = await responseJson(response);
    return { response, data };
  }

  async requestDeviceCode(options = {}) {
    const { response, data } = await this.oauthRequest('/oauth/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: AUTH_CLIENT_ID, scope: AUTH_SCOPE }),
      signal: options.signal,
    });
    if (!response.ok) {
      throw new BridgeError('BASE44_DEVICE_CODE_FAILED', `A Base44 recusou a geração do código (HTTP ${response.status}).`, {
        status: response.status,
        error: data?.error,
      });
    }
    return validateDeviceCode(data);
  }

  async exchangeDeviceCode(deviceCode, options = {}) {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: AUTH_CLIENT_ID,
    });
    const { response, data } = await this.oauthRequest('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: options.signal,
    });
    if (!response.ok) {
      if (data?.error === 'authorization_pending' || data?.error === 'slow_down') {
        return { pending: true, slowDown: data.error === 'slow_down' };
      }
      throw new BridgeError('BASE44_AUTH_FAILED', data?.error_description || data?.error || `Falha na autorização Base44 (HTTP ${response.status}).`, {
        status: response.status,
      });
    }
    return { pending: false, token: validateToken(data) };
  }

  async refreshToken(refreshToken, options = {}) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: AUTH_CLIENT_ID,
    });
    const { response, data } = await this.oauthRequest('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: options.signal,
    });
    if (!response.ok) {
      throw new BridgeError('BASE44_REFRESH_FAILED', data?.error_description || data?.error || 'Não foi possível renovar a sessão Base44.', {
        status: response.status,
      });
    }
    return validateToken(data, refreshToken);
  }

  async getUserInfo(accessToken, options = {}) {
    const { response, data } = await this.oauthRequest('/oauth/userinfo', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: options.signal,
    });
    if (!response.ok || !data?.email) {
      throw new BridgeError('BASE44_PROFILE_FAILED', 'Não foi possível carregar o perfil da conta Base44.', {
        status: response.status,
      });
    }
    return { email: data.email, name: data.name || data.email };
  }

  async login(options = {}) {
    await fsp.mkdir(this.sessionDir, { recursive: true });
    const device = await this.requestDeviceCode(options);
    this.logger.info('base44.oauth.device.created', {
      verificationHost: new URL(device.verificationUri).hostname,
      expiresIn: device.expiresIn,
    });
    this.emit('base44:auth', {
      url: device.verificationUri,
      userCode: device.userCode,
      expiresIn: device.expiresIn,
    });
    this.emitOutput(`Código Base44: ${device.userCode}`);
    this.emitOutput(`Abra para autorizar: ${device.verificationUri}`);
    await this.openExternal?.(device.verificationUri);

    const deadline = Date.now() + device.expiresIn * 1000;
    let intervalMs = Math.max(1000, device.interval * 1000);
    while (Date.now() < deadline) {
      await delay(intervalMs, options.signal);
      const result = await this.exchangeDeviceCode(device.deviceCode, options);
      if (result.pending) {
        if (result.slowDown) intervalMs += 5000;
        continue;
      }
      const profile = await this.getUserInfo(result.token.accessToken, options);
      const auth = {
        accessToken: result.token.accessToken,
        refreshToken: result.token.refreshToken,
        expiresAt: Date.now() + result.token.expiresIn * 1000,
        email: profile.email,
        name: profile.name,
      };
      await writeJson(this.getAuthPath(), auth);
      this.logger.info('base44.oauth.login.complete', { email: profile.email });
      this.emitOutput(`Base44 conectada: ${profile.email}`);
      return { loggedIn: true, email: profile.email, name: profile.name };
    }
    throw new BridgeError('BASE44_AUTH_EXPIRED', 'O código de autorização Base44 expirou. Tente novamente.');
  }

  async logout() {
    await fsp.rm(path.join(this.sessionDir, '.base44'), { recursive: true, force: true });
    return { loggedIn: false };
  }

  async whoami() {
    if (!(await pathExists(this.getAuthPath()))) return { loggedIn: false };
    try {
      const auth = await this.freshAuth();
      return { loggedIn: true, email: auth.email, name: auth.name };
    } catch (error) {
      this.logger.warn('base44.whoami.failed', { message: error.message });
      return { loggedIn: false, error: error.message };
    }
  }

  async freshAuth(options = {}) {
    const auth = await readJson(this.getAuthPath());
    if (!auth?.accessToken || !auth?.refreshToken) {
      throw new BridgeError('BASE44_NOT_AUTHENTICATED', 'Conecte uma conta Base44 antes de continuar.');
    }
    if (Number(auth.expiresAt) > Date.now() + 60_000) return auth;
    const token = await this.refreshToken(auth.refreshToken, options);
    const renewed = {
      ...auth,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: Date.now() + token.expiresIn * 1000,
    };
    await writeJson(this.getAuthPath(), renewed);
    return renewed;
  }

  async apiFetch(relativePath, options = {}, retry = true) {
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
      name: project.name || 'Projeto sem nome',
      description: project.user_description || '',
      updatedAt: project.updated_date || null,
      ejectable: project.is_managed_source_code !== false,
    }));
  }

  async exportProject(project, destination, options = {}) {
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

module.exports = {
  Base44Service,
  AUTH_CLIENT_ID,
  AUTH_SCOPE,
  validateDeviceCode,
  validateToken,
  safeRequestUrl,
  fetchErrorDetails,
  isRetryableNetworkError,
  fetchWithRetry,
};
