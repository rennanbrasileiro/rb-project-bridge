'use strict';

const crypto = require('node:crypto');
const { BridgeError } = require('../electron/core/errors.cjs');

function masterKeyFromEnvironment(env = process.env) {
  const source = String(env.RB_BRIDGE_MASTER_KEY || '').trim();
  if (!source) throw new BridgeError('CLOUD_MASTER_KEY_REQUIRED', 'RB_BRIDGE_MASTER_KEY é obrigatória no Bridge Cloud.');
  let key;
  try { key = Buffer.from(source, 'base64'); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) throw new BridgeError('CLOUD_MASTER_KEY_INVALID', 'RB_BRIDGE_MASTER_KEY deve ser uma chave aleatória de 32 bytes em Base64.');
  return key;
}

function encryptJson(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, alg: 'A256GCM', iv: iv.toString('base64'), tag: tag.toString('base64'), data: ciphertext.toString('base64') });
}

function decryptJson(envelope, key) {
  let payload;
  try { payload = typeof envelope === 'string' ? JSON.parse(envelope) : envelope; }
  catch { throw new BridgeError('CLOUD_SECRET_INVALID', 'O envelope de segredo está corrompido.'); }
  if (payload?.v !== 1 || payload?.alg !== 'A256GCM') throw new BridgeError('CLOUD_SECRET_INVALID', 'Formato de segredo não suportado.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch {
    throw new BridgeError('CLOUD_SECRET_DECRYPT_FAILED', 'Não foi possível descriptografar as credenciais do job.');
  }
}

module.exports = { masterKeyFromEnvironment, encryptJson, decryptJson };
