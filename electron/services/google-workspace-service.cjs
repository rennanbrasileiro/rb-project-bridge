'use strict';

const { BridgeError } = require('../core/errors.cjs');

function encodeMessage(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

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

class GoogleWorkspaceService {
  constructor({ accounts, logger }) {
    this.accounts = accounts;
    this.logger = logger;
  }

  async inventory(accountId) {
    const probes = await Promise.allSettled([
      this.#gmailInventory(accountId),
      this.#driveInventory(accountId),
      this.#calendarInventory(accountId),
      this.#contactsInventory(accountId),
    ]);
    const names = ['gmail', 'drive', 'calendar', 'contacts'];
    const services = Object.fromEntries(probes.map((probe, index) => [names[index], probe.status === 'fulfilled'
      ? { ok: true, ...probe.value }
      : { ok: false, error: probe.reason?.message || String(probe.reason) }]));
    const summary = {
      services,
      completedAt: new Date().toISOString(),
      healthyServices: Object.values(services).filter((service) => service.ok).length,
      failedServices: Object.values(services).filter((service) => !service.ok).length,
    };
    await this.accounts.recordSync(accountId, summary);
    this.logger?.info?.('google.workspace.inventory', { accountId, healthyServices: summary.healthyServices });
    return summary;
  }

  async searchMessages(accountId, input = {}) {
    const query = String(input.query || '').trim();
    const maxResults = Math.min(Math.max(Number(input.maxResults || 20), 1), 50);
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('maxResults', String(maxResults));
    if (query) listUrl.searchParams.set('q', query);
    const list = await this.#requestJson(accountId, listUrl, {}, 'GMAIL_SEARCH_FAILED');
    const messages = await Promise.all((list.messages || []).map(async ({ id, threadId }) => {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
      url.searchParams.set('format', 'metadata');
      for (const header of ['From', 'To', 'Cc', 'Subject', 'Date']) url.searchParams.append('metadataHeaders', header);
      const message = await this.#requestJson(accountId, url, {}, 'GMAIL_MESSAGE_READ_FAILED');
      const headers = Object.fromEntries((message.payload?.headers || []).map((item) => [item.name.toLowerCase(), item.value]));
      return {
        id,
        threadId,
        from: headers.from || '',
        to: headers.to || '',
        cc: headers.cc || '',
        subject: headers.subject || '(sem assunto)',
        date: headers.date || '',
        snippet: message.snippet || '',
        labelIds: message.labelIds || [],
      };
    }));
    return { query, resultSizeEstimate: list.resultSizeEstimate || messages.length, messages };
  }

  async sendMessage(accountId, input) {
    const to = sanitizeHeader(input?.to);
    const subject = sanitizeHeader(input?.subject);
    const body = String(input?.body || '');
    if (!to || !to.includes('@')) throw new BridgeError('GMAIL_RECIPIENT_REQUIRED', 'Informe um destinatário válido.');
    if (!subject) throw new BridgeError('GMAIL_SUBJECT_REQUIRED', 'Informe o assunto do e-mail.');
    const headers = [
      `To: ${to}`,
      input?.cc ? `Cc: ${sanitizeHeader(input.cc)}` : null,
      input?.bcc ? `Bcc: ${sanitizeHeader(input.bcc)}` : null,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
    ].filter(Boolean);
    const raw = encodeMessage(`${headers.join('\r\n')}\r\n\r\n${body}`);
    const data = await this.#requestJson(accountId, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    }, 'GMAIL_SEND_FAILED');
    return { id: data.id, threadId: data.threadId, labelIds: data.labelIds || [] };
  }

  async createDocument(accountId, input) {
    const title = String(input?.title || '').trim();
    const content = String(input?.content || '');
    if (!title) throw new BridgeError('GOOGLE_DOC_TITLE_REQUIRED', 'Informe o título do documento.');
    const document = await this.#requestJson(accountId, 'https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }, 'GOOGLE_DOC_CREATE_FAILED');
    if (content) {
      await this.#requestJson(accountId, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(document.documentId)}:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] }),
      }, 'GOOGLE_DOC_WRITE_FAILED');
    }
    return {
      documentId: document.documentId,
      title,
      url: `https://docs.google.com/document/d/${document.documentId}/edit`,
    };
  }

  async #gmailInventory(accountId) {
    const profile = await this.#requestJson(accountId, 'https://gmail.googleapis.com/gmail/v1/users/me/profile', {}, 'GMAIL_PROFILE_FAILED');
    const labels = await this.#requestJson(accountId, 'https://gmail.googleapis.com/gmail/v1/users/me/labels', {}, 'GMAIL_LABELS_FAILED');
    return {
      emailAddress: profile.emailAddress,
      messagesTotal: profile.messagesTotal || 0,
      threadsTotal: profile.threadsTotal || 0,
      historyId: profile.historyId || null,
      labels: (labels.labels || []).length,
    };
  }

  async #driveInventory(accountId) {
    const aboutUrl = 'https://www.googleapis.com/drive/v3/about?fields=user,storageQuota';
    const about = await this.#requestJson(accountId, aboutUrl, {}, 'DRIVE_ABOUT_FAILED');
    let pageToken = null;
    let sampledFiles = 0;
    let pages = 0;
    do {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('pageSize', '1000');
      url.searchParams.set('spaces', 'drive');
      url.searchParams.set('q', 'trashed = false');
      url.searchParams.set('fields', 'nextPageToken,files(id)');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await this.#requestJson(accountId, url, {}, 'DRIVE_LIST_FAILED');
      sampledFiles += (page.files || []).length;
      pageToken = page.nextPageToken || null;
      pages += 1;
    } while (pageToken && pages < 10);
    return {
      user: about.user?.emailAddress || null,
      storageLimit: about.storageQuota?.limit || null,
      storageUsage: about.storageQuota?.usage || null,
      sampledFiles,
      truncated: Boolean(pageToken),
    };
  }

  async #calendarInventory(accountId) {
    let pageToken = null;
    let calendars = 0;
    do {
      const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
      url.searchParams.set('maxResults', '250');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await this.#requestJson(accountId, url, {}, 'CALENDAR_LIST_FAILED');
      calendars += (page.items || []).length;
      pageToken = page.nextPageToken || null;
    } while (pageToken);
    return { calendars };
  }

  async #contactsInventory(accountId) {
    let pageToken = null;
    let connections = 0;
    let pages = 0;
    do {
      const url = new URL('https://people.googleapis.com/v1/people/me/connections');
      url.searchParams.set('personFields', 'names,emailAddresses');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await this.#requestJson(accountId, url, {}, 'CONTACTS_LIST_FAILED');
      connections += (page.connections || []).length;
      pageToken = page.nextPageToken || null;
      pages += 1;
    } while (pageToken && pages < 10);
    return { connections, truncated: Boolean(pageToken) };
  }

  async #requestJson(accountId, url, options, code) {
    return readJson(await this.accounts.authorizedFetch(accountId, url, options), code);
  }
}

module.exports = { GoogleWorkspaceService };
