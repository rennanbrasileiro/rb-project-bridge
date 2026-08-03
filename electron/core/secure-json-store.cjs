'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { BridgeError } = require('./errors.cjs');

class SecureJsonStore {
  constructor({ filePath, safeStorage, logger, defaultValue = {} }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.logger = logger;
    this.defaultValue = defaultValue;
  }

  encryptionAvailable() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  assertEncryption() {
    if (!this.encryptionAvailable()) {
      throw new BridgeError(
        'SECURE_STORAGE_UNAVAILABLE',
        'O armazenamento seguro do sistema operacional não está disponível. Nenhuma credencial foi gravada.',
      );
    }
  }

  async read() {
    try {
      const envelope = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
      if (envelope?.version !== 1 || typeof envelope.ciphertext !== 'string') {
        throw new Error('Formato de cofre desconhecido.');
      }
      this.assertEncryption();
      const plaintext = this.safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
      return JSON.parse(plaintext);
    } catch (error) {
      if (error?.code === 'ENOENT') return structuredClone(this.defaultValue);
      if (error instanceof BridgeError) throw error;
      this.logger?.error?.('secure-store.read-failed', { filePath: this.filePath, message: error.message });
      throw new BridgeError('SECURE_STORE_READ_FAILED', 'Não foi possível abrir o cofre local de credenciais.', { cause: error.message });
    }
  }

  async write(value) {
    this.assertEncryption();
    const ciphertext = this.safeStorage.encryptString(JSON.stringify(value));
    const envelope = JSON.stringify({ version: 1, ciphertext: ciphertext.toString('base64') }, null, 2);
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(temporary, envelope, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temporary, this.filePath);
    await fsp.chmod(this.filePath, 0o600).catch(() => null);
  }
}

module.exports = { SecureJsonStore };
