'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BridgeError } = require('../electron/core/errors.cjs');
const { masterKeyFromEnvironment, encryptJson, decryptJson } = require('./vault.cjs');

function safeConnectionId(value) {
  const id = String(value || '');
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new BridgeError('CLOUD_CONNECTION_ID_INVALID', 'Connection ID inválido.');
  return id;
}

class ConnectionStore {
  constructor({ root, masterKey }) {
    this.root = path.resolve(root || process.env.RB_BRIDGE_CLOUD_DATA || path.join(process.cwd(), '.bridge-cloud'));
    this.directory = path.join(this.root, 'connections');
    this.authDirectory = path.join(this.root, 'auth-sessions');
    this.masterKey = masterKey || masterKeyFromEnvironment();
  }

  async init() { await Promise.all([fs.mkdir(this.directory, { recursive: true }), fs.mkdir(this.authDirectory, { recursive: true })]); return this; }
  connectionPath(id) { return path.join(this.directory, `${safeConnectionId(id)}.enc`); }
  authPath(id) { return path.join(this.authDirectory, `${safeConnectionId(id)}.enc`); }

  async create(provider, secret, metadata = {}) {
    await this.init();
    const id = crypto.randomUUID();
    const payload = { id, provider, createdAt: new Date().toISOString(), metadata, secret };
    await fs.writeFile(this.connectionPath(id), encryptJson(payload, this.masterKey), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { id, provider, createdAt: payload.createdAt, metadata };
  }

  async get(id, provider) {
    await this.init();
    const payload = decryptJson(await fs.readFile(this.connectionPath(id), 'utf8'), this.masterKey);
    if (provider && payload.provider !== provider) throw new BridgeError('CLOUD_CONNECTION_PROVIDER_INVALID', `A conexão ${id} não pertence ao provedor ${provider}.`);
    return payload;
  }

  async remove(id) { await fs.rm(this.connectionPath(id), { force: true }); }

  async createAuthSession(payload) {
    await this.init();
    const id = crypto.randomUUID();
    await fs.writeFile(this.authPath(id), encryptJson({ id, ...payload }, this.masterKey), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return id;
  }

  async getAuthSession(id) { return decryptJson(await fs.readFile(this.authPath(id), 'utf8'), this.masterKey); }
  async removeAuthSession(id) { await fs.rm(this.authPath(id), { force: true }); }
}

module.exports = { ConnectionStore, safeConnectionId };
