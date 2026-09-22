'use strict';

const http = require('node:http');
const path = require('node:path');
const { JsonLogger } = require('../electron/core/logger.cjs');
const { Base44Service } = require('../electron/services/base44-service.cjs');
const { GitLabService } = require('../electron/services/gitlab-service.cjs');
const { FileJobStore } = require('./job-store.cjs');
const { ConnectionStore } = require('./connection-store.cjs');

const PORT = Number(process.env.PORT || 8080);
const DATA_ROOT = path.resolve(process.env.RB_BRIDGE_CLOUD_DATA || path.join(process.cwd(), '.bridge-cloud'));
const API_KEY = String(process.env.RB_BRIDGE_API_KEY || '');

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

async function readJson(request, limit = 2 * 1024 * 1024) {
  let received = 0;
  const chunks = [];
  for await (const chunk of request) {
    received += chunk.length;
    if (received > limit) throw Object.assign(new Error('Payload muito grande.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON inválido.'), { statusCode: 400 }); }
}

function authorized(request) {
  if (!API_KEY) return false;
  const header = String(request.headers.authorization || '');
  return header === `Bearer ${API_KEY}`;
}

function validateJobInput(body) {
  if (!body?.project?.id || !body?.project?.name) throw Object.assign(new Error('project.id e project.name são obrigatórios.'), { statusCode: 400 });
  if (!body?.repository?.owner || !body?.repository?.name) throw Object.assign(new Error('repository.owner e repository.name são obrigatórios.'), { statusCode: 400 });
  if ((body.repository.provider || 'gitlab') !== 'gitlab') throw Object.assign(new Error('Bridge Cloud Alpha suporta destino GitLab.'), { statusCode: 400 });
  if (!body?.connections?.base44 || !body?.connections?.git) throw Object.assign(new Error('Conexões Base44 e Git são obrigatórias.'), { statusCode: 400 });
  const clean = structuredClone(body);
  clean.repository.provider = 'gitlab';
  clean.repository.strategy = clean.repository.strategy === 'create' ? 'create' : 'reuse';
  clean.repository.ownerType = clean.repository.ownerType === 'organization' ? 'organization' : 'user';
  clean.repository.visibility = 'private';
  clean.deliveryMode = clean.deliveryMode === 'snapshot' ? 'snapshot' : 'standalone-supabase';
  clean.buildValidation = clean.deliveryMode !== 'snapshot';
  clean.acceptedAuthorization = true;
  return clean;
}

async function main() {
  if (!API_KEY) throw new Error('RB_BRIDGE_API_KEY é obrigatória.');
  const jobs = await new FileJobStore({ root: DATA_ROOT }).init();
  const connections = await new ConnectionStore({ root: DATA_ROOT }).init();
  const logger = new JsonLogger(path.join(DATA_ROOT, 'logs'));
  const base44 = new Base44Service({ logger, emit: () => {}, sessionDir: path.join(DATA_ROOT, 'control-base44'), openExternal: async () => {} });

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true, service: 'rb-project-bridge-cloud', version: '0.6.0-alpha.1' });
      if (!authorized(request)) return json(response, 401, { error: 'unauthorized' });
      if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
        return json(response, 200, { source: ['base44'], destinations: ['gitlab'], modes: ['snapshot', 'standalone-supabase'], runtimeValidation: 'chromium-headless', queue: 'filesystem-alpha', secretsAtRest: 'aes-256-gcm' });
      }
      if (request.method === 'POST' && url.pathname === '/v1/auth/base44/device') {
        const device = await base44.requestDeviceCode();
        const sessionId = await connections.createAuthSession({ provider: 'base44', deviceCode: device.deviceCode, expiresAt: Date.now() + device.expiresIn * 1000, interval: device.interval });
        return json(response, 201, { sessionId, userCode: device.userCode, verificationUri: device.verificationUri, expiresIn: device.expiresIn, interval: device.interval });
      }
      const base44Poll = url.pathname.match(/^\/v1\/auth\/base44\/device\/([a-f0-9-]{36})\/poll$/i);
      if (request.method === 'POST' && base44Poll) {
        const session = await connections.getAuthSession(base44Poll[1]);
        if (Date.now() >= Number(session.expiresAt)) return json(response, 410, { error: 'authorization_expired' });
        const result = await base44.exchangeDeviceCode(session.deviceCode);
        if (result.pending) return json(response, 202, { pending: true, slowDown: result.slowDown });
        const profile = await base44.getUserInfo(result.token.accessToken);
        const auth = { accessToken: result.token.accessToken, refreshToken: result.token.refreshToken, expiresAt: Date.now() + result.token.expiresIn * 1000, email: profile.email, name: profile.name };
        const connection = await connections.create('base44', { auth }, { email: profile.email, name: profile.name });
        await connections.removeAuthSession(base44Poll[1]);
        return json(response, 201, { pending: false, connection });
      }
      if (request.method === 'POST' && url.pathname === '/v1/auth/gitlab/token') {
        const body = await readJson(request);
        const token = String(body.token || '').trim();
        if (!token) return json(response, 400, { error: 'token_required' });
        const baseUrl = body.baseUrl || 'https://gitlab.com';
        const gitlab = new GitLabService({ logger, emit: () => {}, toolchain: null, baseUrl, tokenProvider: async () => token });
        const status = await gitlab.ensureDeliveryScopes();
        const connection = await connections.create('gitlab', { token }, { baseUrl, username: status.user?.username || null, scopes: status.scopes || [] });
        return json(response, 201, { connection, user: status.user ? { username: status.user.username, name: status.user.name } : null, scopes: status.scopes || [] });
      }
      if (request.method === 'POST' && url.pathname === '/v1/jobs') {
        const input = validateJobInput(await readJson(request));
        await connections.get(input.connections.base44, 'base44');
        await connections.get(input.connections.git, 'gitlab');
        const job = await jobs.create(input, { connectionRefs: input.connections });
        return json(response, 202, { job });
      }
      const jobMatch = url.pathname.match(/^\/v1\/jobs\/([a-f0-9-]{36})$/i);
      if (request.method === 'GET' && jobMatch) {
        const job = await jobs.get(jobMatch[1]);
        return job ? json(response, 200, { job }) : json(response, 404, { error: 'job_not_found' });
      }
      if (request.method === 'GET' && url.pathname === '/v1/jobs') {
        return json(response, 200, { jobs: await jobs.list(url.searchParams.get('state') || undefined) });
      }
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      logger.error('cloud.http.error', { method: request.method, url: request.url, message: error.message, code: error.code });
      return json(response, error.statusCode || 500, { error: error.code || 'internal_error', message: error.message });
    }
  });

  server.listen(PORT, '0.0.0.0', () => logger.info('cloud.server.started', { port: PORT, dataRoot: DATA_ROOT }));
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
module.exports = { main, readJson, validateJobInput, authorized };
