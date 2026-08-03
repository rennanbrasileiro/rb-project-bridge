'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { BridgeError } = require('../core/errors.cjs');

async function readJson(response, code) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data?.error?.message || data?.error_description || `HTTP ${response.status}`;
    throw new BridgeError(code, String(message), { status: response.status, response: data });
  }
  return data;
}

function validateNotebookConfiguration(config) {
  const projectNumber = String(config?.notebookProjectNumber || '').trim();
  const location = String(config?.notebookLocation || 'global').trim().toLowerCase();
  if (!/^\d{6,30}$/.test(projectNumber)) {
    throw new BridgeError('NOTEBOOK_PROJECT_NUMBER_REQUIRED', 'Configure o número numérico do projeto Google Cloud do Gemini Notebook Enterprise.');
  }
  if (!['global', 'us', 'eu'].includes(location)) throw new BridgeError('NOTEBOOK_LOCATION_INVALID', 'Localização inválida.');
  return { projectNumber, location };
}

class GoogleAiService {
  constructor({ accounts, logger }) {
    this.accounts = accounts;
    this.logger = logger;
  }

  async testGemini() {
    const config = await this.accounts.getAiConfiguration();
    if (!config.geminiApiKey) throw new BridgeError('GEMINI_API_KEY_REQUIRED', 'Configure uma chave da Gemini Developer API.');
    const model = config.geminiModel || 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;
    const data = await readJson(await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responda apenas: RB HUB OK' }] }], generationConfig: { maxOutputTokens: 20 } }),
    }), 'GEMINI_TEST_FAILED');
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
    return { ok: true, model, response: text, usageMetadata: data.usageMetadata || null };
  }

  async listNotebooks(accountId) {
    const config = validateNotebookConfiguration(await this.accounts.getAiConfiguration());
    const url = `${this.#notebookBase(config)}/notebooks:listRecentlyViewed?pageSize=100`;
    return readJson(await this.accounts.authorizedFetch(accountId, url), 'NOTEBOOK_LIST_FAILED');
  }

  async createNotebook(accountId, input) {
    const config = validateNotebookConfiguration(await this.accounts.getAiConfiguration());
    const title = String(input?.title || '').trim();
    if (!title) throw new BridgeError('NOTEBOOK_TITLE_REQUIRED', 'Informe o título do notebook.');
    return readJson(await this.accounts.authorizedFetch(accountId, `${this.#notebookBase(config)}/notebooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }), 'NOTEBOOK_CREATE_FAILED');
  }

  async addNotebookSources(accountId, input) {
    const config = validateNotebookConfiguration(await this.accounts.getAiConfiguration());
    const notebookId = String(input?.notebookId || '').trim();
    const userContents = Array.isArray(input?.userContents) ? input.userContents : [];
    if (!notebookId || !userContents.length) throw new BridgeError('NOTEBOOK_SOURCES_REQUIRED', 'Informe o notebook e ao menos uma fonte.');
    return readJson(await this.accounts.authorizedFetch(accountId, `${this.#notebookBase(config)}/notebooks/${encodeURIComponent(notebookId)}/sources:batchCreate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userContents }),
    }), 'NOTEBOOK_SOURCE_CREATE_FAILED');
  }

  async uploadNotebookFile(accountId, input) {
    const config = validateNotebookConfiguration(await this.accounts.getAiConfiguration());
    const notebookId = String(input?.notebookId || '').trim();
    const filePath = String(input?.filePath || '').trim();
    const displayName = String(input?.displayName || path.basename(filePath)).trim();
    const contentType = String(input?.contentType || 'application/octet-stream').trim();
    if (!notebookId || !path.isAbsolute(filePath)) throw new BridgeError('NOTEBOOK_FILE_REQUIRED', 'Informe um arquivo local absoluto e o notebook de destino.');
    const bytes = await fsp.readFile(filePath);
    const url = `${this.#notebookUploadBase(config)}/notebooks/${encodeURIComponent(notebookId)}/sources:uploadFile`;
    return readJson(await this.accounts.authorizedFetch(accountId, url, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-Goog-Upload-File-Name': displayName,
        'X-Goog-Upload-Protocol': 'raw',
      },
      body: bytes,
    }), 'NOTEBOOK_FILE_UPLOAD_FAILED');
  }

  #notebookBase({ projectNumber, location }) {
    return `https://${location}-discoveryengine.googleapis.com/v1alpha/projects/${projectNumber}/locations/${location}`;
  }

  #notebookUploadBase({ projectNumber, location }) {
    return `https://${location}-discoveryengine.googleapis.com/upload/v1alpha/projects/${projectNumber}/locations/${location}`;
  }
}

module.exports = { GoogleAiService, validateNotebookConfiguration };
