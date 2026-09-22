'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BridgeError } = require('../electron/core/errors.cjs');
const { masterKeyFromEnvironment, encryptJson, decryptJson } = require('./vault.cjs');

const STATES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);

function safeId(value) {
  const id = String(value || '');
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new BridgeError('CLOUD_JOB_ID_INVALID', 'Job ID inválido.');
  return id;
}

function publicJob(input) {
  const clone = structuredClone(input);
  delete clone.credentials;
  delete clone.secret;
  return clone;
}

class FileJobStore {
  constructor({ root, masterKey }) {
    this.root = path.resolve(root || process.env.RB_BRIDGE_CLOUD_DATA || path.join(process.cwd(), '.bridge-cloud'));
    this.jobsDir = path.join(this.root, 'jobs');
    this.secretsDir = path.join(this.root, 'secrets');
    this.masterKey = masterKey || masterKeyFromEnvironment();
  }

  async init() {
    await Promise.all([fs.mkdir(this.jobsDir, { recursive: true }), fs.mkdir(this.secretsDir, { recursive: true })]);
    return this;
  }

  metadataPath(id) { return path.join(this.jobsDir, `${safeId(id)}.json`); }
  secretPath(id) { return path.join(this.secretsDir, `${safeId(id)}.enc`); }

  async create(input, credentials) {
    await this.init();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = { id, state: 'queued', createdAt: now, updatedAt: now, attempts: 0, input: publicJob(input), progress: [], result: null, error: null };
    await fs.writeFile(this.metadataPath(id), JSON.stringify(job, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.writeFile(this.secretPath(id), encryptJson(credentials || {}, this.masterKey), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return job;
  }

  async get(id) {
    await this.init();
    try { return JSON.parse(await fs.readFile(this.metadataPath(id), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async getCredentials(id) {
    const envelope = await fs.readFile(this.secretPath(id), 'utf8');
    return decryptJson(envelope, this.masterKey);
  }

  async update(id, patch) {
    const current = await this.get(id);
    if (!current) throw new BridgeError('CLOUD_JOB_NOT_FOUND', `Job ${id} não encontrado.`);
    const next = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
    if (!STATES.has(next.state)) throw new BridgeError('CLOUD_JOB_STATE_INVALID', `Estado de job inválido: ${next.state}.`);
    const target = this.metadataPath(id);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(temporary, target);
    return next;
  }

  async appendProgress(id, event) {
    const current = await this.get(id);
    if (!current) return null;
    const progress = [...(current.progress || []), { at: new Date().toISOString(), ...event }].slice(-200);
    return this.update(id, { progress });
  }

  async list(state) {
    await this.init();
    const names = await fs.readdir(this.jobsDir);
    const jobs = [];
    for (const name of names.filter((name) => name.endsWith('.json'))) {
      const job = JSON.parse(await fs.readFile(path.join(this.jobsDir, name), 'utf8'));
      if (!state || job.state === state) jobs.push(job);
    }
    return jobs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async claimNext() {
    const queued = await this.list('queued');
    for (const job of queued) {
      const lock = `${this.metadataPath(job.id)}.lock`;
      try {
        const handle = await fs.open(lock, 'wx', 0o600);
        await handle.close();
        const fresh = await this.get(job.id);
        if (fresh?.state !== 'queued') { await fs.rm(lock, { force: true }); continue; }
        const running = await this.update(job.id, { state: 'running', attempts: Number(fresh.attempts || 0) + 1, startedAt: new Date().toISOString(), error: null });
        return { job: running, release: () => fs.rm(lock, { force: true }) };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    return null;
  }

  async purgeSecrets(id) { await fs.rm(this.secretPath(id), { force: true }); }
}

module.exports = { FileJobStore, STATES, publicJob, safeId };
