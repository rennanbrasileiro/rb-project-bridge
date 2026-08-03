'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { BridgeError } = require('../core/errors.cjs');
const { SecureJsonStore } = require('../core/secure-json-store.cjs');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const CALLBACK_PATH = '/oauth2/callback';

const SERVICE_SCOPES = Object.freeze({
  profile: ['openid', 'email', 'profile'],
  gmail: ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'],
  drive: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/presentations',
  ],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  contacts: ['https://www.googleapis.com/auth/contacts'],
  notebook: ['https://www.googleapis.com/auth/cloud-platform'],
});

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function normalizeServices(input) {
  const services = new Set(Array.isArray(input) && input.length ? input : ['gmail', 'drive', 'calendar', 'contacts']);
  services.add('profile');
  for (const service of services) {
    if (!SERVICE_SCOPES[service]) throw new BridgeError('GOOGLE_SERVICE_INVALID', `Serviço Google desconhecido: ${service}`);
  }
  return [...services];
}
function scopesForServices(services) {
  return [...new Set(normalizeServices(services).flatMap((service) => SERVICE_SCOPES[service]))];
}
function publicAccount(account) {
  return {
    id: account.id,
    email: account.email,
    name: account.name || account.email,
    label: account.label || null,
    services: account.services || [],
    scopes: account.scopes || [],
    connectedAt: account.connectedAt,
    updatedAt: account.updatedAt,
    lastSyncAt: account.lastSyncAt || null,
    lastSync: account.lastSync || null,
    hasRefreshToken: Boolean(account.token?.refreshToken),
  };
}
async function readJson(response, code) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data?.error_description || data?.error?.message || data?.error || `HTTP ${response.status}`;
    throw new BridgeError(code, String(message), { status: response.status, response: data });
  }
  return data;
}

class GoogleAccountService {
  constructor({ userDataDir, safeStorage, logger, openExternal }) {
    this.logger = logger;
    this.openExternal = openExternal;
    const dir = path.join(userDataDir, 'google');
    this.accountsStore = new SecureJsonStore({
      filePath: path.join(dir, 'accounts.v1.enc.json'), safeStorage, logger,
      defaultValue: { version: 1, accounts: [] },
    });
    this.configStore = new SecureJsonStore({
      filePath: path.join(dir, 'configuration.v1.enc.json'), safeStorage, logger,
      defaultValue: { version: 1, oauth: {}, ai: {} },
    });
  }

  async status() {
    const [vault, config] = await Promise.all([this.accountsStore.read(), this.configStore.read()]);
    return {
      encryptionAvailable: this.accountsStore.encryptionAvailable(),
      configured: Boolean(config.oauth?.clientId),
      oauth: {
        clientIdSuffix: config.oauth?.clientId ? String(config.oauth.clientId).slice(-18) : null,
        hasClientSecret: Boolean(config.oauth?.clientSecret),
      },
      accounts: (vault.accounts || []).map(publicAccount),
      ai: {
        geminiConfigured: Boolean(config.ai?.geminiApiKey),
        geminiModel: config.ai?.geminiModel || 'gemini-2.5-flash',
        notebookConfigured: Boolean(config.ai?.notebookProjectNumber),
        notebookProjectNumber: config.ai?.notebookProjectNumber || null,
        notebookLocation: config.ai?.notebookLocation || 'global',
      },
    };
  }

  async saveOAuthConfiguration(input) {
    const clientId = String(input?.clientId || '').trim();
    const clientSecret = String(input?.clientSecret || '').trim();
    if (!clientId.endsWith('.apps.googleusercontent.com')) {
      throw new BridgeError('GOOGLE_CLIENT_ID_INVALID', 'Informe um OAuth Client ID do tipo Aplicativo para computador.');
    }
    const config = await this.configStore.read();
    config.oauth = { clientId, clientSecret: clientSecret || null, updatedAt: new Date().toISOString() };
    await this.configStore.write(config);
    return this.status();
  }

  async saveAiConfiguration(input) {
    const config = await this.configStore.read();
    const location = String(input?.notebookLocation || config.ai?.notebookLocation || 'global').trim().toLowerCase();
    if (!['global', 'us', 'eu'].includes(location)) {
      throw new BridgeError('NOTEBOOK_LOCATION_INVALID', 'A localização deve ser global, us ou eu.');
    }
    const projectNumber = String(input?.notebookProjectNumber || config.ai?.notebookProjectNumber || '').trim();
    if (projectNumber && !/^\d+$/.test(projectNumber)) {
      throw new BridgeError('NOTEBOOK_PROJECT_NUMBER_INVALID', 'Use o número numérico do projeto Google Cloud, não o project ID textual.');
    }
    config.ai = {
      geminiApiKey: String(input?.geminiApiKey || config.ai?.geminiApiKey || '').trim() || null,
      geminiModel: String(input?.geminiModel || config.ai?.geminiModel || 'gemini-2.5-flash').trim(),
      notebookProjectNumber: projectNumber || null,
      notebookLocation: location,
      updatedAt: new Date().toISOString(),
    };
    await this.configStore.write(config);
    return this.status();
  }

  async getAiConfiguration() { return (await this.configStore.read()).ai || {}; }
  async listAccounts() { return (await this.accountsStore.read()).accounts?.map(publicAccount) || []; }

  async connect(input = {}) {
    const config = await this.configStore.read();
    if (!config.oauth?.clientId) throw new BridgeError('GOOGLE_OAUTH_NOT_CONFIGURED', 'Configure primeiro o OAuth Client ID do Google Cloud.');
    const services = normalizeServices(input.services);
    const scopes = scopesForServices(services);
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const callback = await this.#callbackServer(state);
    const redirectUri = `http://127.0.0.1:${callback.port}${CALLBACK_PATH}`;
    const auth = new URL(AUTH_URL);
    auth.search = new URLSearchParams({
      client_id: config.oauth.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent select_account',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    await this.openExternal(auth.href);
    try {
      const code = await callback.waitForCode();
      const body = new URLSearchParams({
        client_id: config.oauth.clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      if (config.oauth.clientSecret) body.set('client_secret', config.oauth.clientSecret);
      const token = await readJson(await fetch(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      }), 'GOOGLE_TOKEN_EXCHANGE_FAILED');
      const user = await readJson(await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      }), 'GOOGLE_USERINFO_FAILED');
      const vault = await this.accountsStore.read();
      const accounts = vault.accounts || [];
      const index = accounts.findIndex((item) => item.id === user.sub);
      const previous = index >= 0 ? accounts[index] : null;
      const now = new Date().toISOString();
      const account = {
        id: user.sub,
        email: user.email,
        name: user.name || user.email,
        label: String(input.label || previous?.label || '').trim() || null,
        services: [...new Set([...(previous?.services || []), ...services])],
        scopes: [...new Set([...(previous?.scopes || []), ...scopes, ...String(token.scope || '').split(/\s+/).filter(Boolean)])],
        connectedAt: previous?.connectedAt || now,
        updatedAt: now,
        lastSyncAt: previous?.lastSyncAt || null,
        lastSync: previous?.lastSync || null,
        token: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token || previous?.token?.refreshToken || null,
          expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
        },
      };
      if (!account.token.refreshToken) {
        throw new BridgeError('GOOGLE_REFRESH_TOKEN_MISSING', 'O Google não retornou refresh token. Revogue o consentimento anterior e conecte novamente.');
      }
      if (index >= 0) accounts[index] = account; else accounts.push(account);
      await this.accountsStore.write({ version: 1, accounts });
      this.logger?.info?.('google.oauth.completed', { email: account.email, services: account.services });
      return publicAccount(account);
    } finally { callback.close(); }
  }

  async disconnect(accountId) {
    const vault = await this.accountsStore.read();
    const account = (vault.accounts || []).find((item) => item.id === accountId);
    if (!account) throw new BridgeError('GOOGLE_ACCOUNT_NOT_FOUND', 'Conta Google não encontrada.');
    const token = account.token?.refreshToken || account.token?.accessToken;
    if (token) await fetch(REVOKE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }).catch(() => null);
    await this.accountsStore.write({ version: 1, accounts: vault.accounts.filter((item) => item.id !== accountId) });
    return { disconnected: true, accountId };
  }

  async authorizedFetch(accountId, url, options = {}) {
    const { account, vault } = await this.#getAccount(accountId);
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${await this.#accessToken(account, vault)}`);
    let response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      headers.set('Authorization', `Bearer ${await this.#accessToken(account, vault, true)}`);
      response = await fetch(url, { ...options, headers });
    }
    return response;
  }

  async recordSync(accountId, summary) {
    const { account, vault } = await this.#getAccount(accountId);
    account.lastSyncAt = new Date().toISOString();
    account.lastSync = summary;
    account.updatedAt = account.lastSyncAt;
    await this.accountsStore.write(vault);
    return publicAccount(account);
  }

  async #getAccount(accountId) {
    const vault = await this.accountsStore.read();
    const account = (vault.accounts || []).find((item) => item.id === accountId);
    if (!account) throw new BridgeError('GOOGLE_ACCOUNT_NOT_FOUND', 'Conta Google não encontrada.');
    return { account, vault };
  }

  async #accessToken(account, vault, force = false) {
    if (!force && account.token?.accessToken && Number(account.token.expiresAt || 0) > Date.now() + 90_000) return account.token.accessToken;
    if (!account.token?.refreshToken) throw new BridgeError('GOOGLE_REAUTH_REQUIRED', `A conta ${account.email} precisa ser conectada novamente.`);
    const config = await this.configStore.read();
    const body = new URLSearchParams({
      client_id: config.oauth?.clientId || '', refresh_token: account.token.refreshToken, grant_type: 'refresh_token',
    });
    if (config.oauth?.clientSecret) body.set('client_secret', config.oauth.clientSecret);
    const token = await readJson(await fetch(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    }), 'GOOGLE_TOKEN_REFRESH_FAILED');
    account.token.accessToken = token.access_token;
    account.token.expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;
    account.updatedAt = new Date().toISOString();
    await this.accountsStore.write(vault);
    return account.token.accessToken;
  }

  async #callbackServer(expectedState) {
    let resolveCode;
    let rejectCode;
    let settled = false;
    const promise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
    const server = http.createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH) { response.writeHead(404); response.end('Not found'); return; }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state');
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      });
      if (error || state !== expectedState || !code) {
        response.end('<h1>Autorização não concluída</h1><p>Volte ao RB Project Bridge.</p>');
        if (!settled) { settled = true; rejectCode(new BridgeError('GOOGLE_OAUTH_CALLBACK_INVALID', error || 'Retorno OAuth inválido.')); }
        return;
      }
      response.end('<h1>Conta conectada</h1><p>Você pode fechar esta janela.</p>');
      if (!settled) { settled = true; resolveCode(code); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const timer = setTimeout(() => {
      if (!settled) { settled = true; rejectCode(new BridgeError('GOOGLE_OAUTH_TIMEOUT', 'A autorização Google expirou.')); }
      server.close();
    }, 300_000);
    timer.unref?.();
    return {
      port: server.address().port,
      waitForCode: () => promise,
      close: () => { clearTimeout(timer); server.close(); },
    };
  }
}

module.exports = { GoogleAccountService, SERVICE_SCOPES, scopesForServices };
