'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BridgeError } = require('../core/errors.cjs');
const { pathExists } = require('../core/fs-utils.cjs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function diagnosticsScript() {
  return `<script data-rb-preview-diagnostics>
(() => {
  const errors = window.__RB_PREVIEW_ERRORS__ = window.__RB_PREVIEW_ERRORS__ || [];
  const describe = (value) => value instanceof Error ? (value.stack || value.message) : String(value ?? 'Erro desconhecido');
  const show = (message) => {
    if (document.getElementById('rb-preview-error')) return;
    const panel = document.createElement('div');
    panel.id = 'rb-preview-error';
    panel.style.cssText = 'position:fixed;inset:16px;z-index:2147483647;overflow:auto;padding:22px;border:2px solid #ef4444;border-radius:12px;background:#190b0d;color:#fee2e2;font:14px/1.55 Segoe UI,Arial,sans-serif;white-space:pre-wrap;box-shadow:0 18px 60px #0009';
    panel.textContent = 'O preview encontrou um erro de execução.\\n\\n' + message + '\\n\\nCopie esta mensagem e consulte os detalhes técnicos no RB Project Bridge.';
    document.body.appendChild(panel);
  };
  window.addEventListener('error', (event) => { const message = describe(event.error || event.message); errors.push(message); show(message); });
  window.addEventListener('unhandledrejection', (event) => { const message = describe(event.reason); errors.push(message); show(message); });
  window.setTimeout(() => {
    const root = document.getElementById('root');
    if (!root || root.childElementCount === 0) {
      const message = 'A aplicação não montou conteúdo no elemento #root.';
      errors.push(message);
      show(message);
    }
  }, 5000);
})();
</script>`;
}

function injectDiagnostics(html) {
  const source = String(html || '');
  if (source.includes('data-rb-preview-diagnostics')) return source;
  const script = diagnosticsScript();
  return /<\/head>/i.test(source) ? source.replace(/<\/head>/i, `${script}\n</head>`) : `${script}\n${source}`;
}

function isBlockingConsoleMessage(message) {
  const text = String(message || '');
  if (!text) return false;
  if (/favicon|source map|Download the React DevTools/i.test(text)) return false;
  return /uncaught|unhandled|typeerror|referenceerror|syntaxerror|rangeerror|failed to (?:fetch|load module)|is not a function|cannot read propert/i.test(text);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

class PreviewService {
  constructor({ logger, openExternal, emit, createBrowserWindow }) {
    this.logger = logger;
    this.openExternal = openExternal;
    this.emit = emit;
    this.createBrowserWindow = createBrowserWindow;
    this.server = null;
    this.root = null;
    this.url = null;
  }

  async stop() {
    if (!this.server) return { running: false };
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null; this.root = null; this.url = null;
    return { running: false };
  }

  status() { return { running: Boolean(this.server), root: this.root, url: this.url }; }

  async start(root, options = {}) {
    const resolved = path.resolve(String(root || ''));
    if (!(await pathExists(path.join(resolved, 'index.html')))) {
      throw new BridgeError('PREVIEW_NOT_FOUND', 'O build local não possui um index.html para preview.', { root: resolved });
    }
    await this.stop();
    this.root = resolved;
    this.server = http.createServer(async (request, response) => {
      try {
        const parsed = new URL(request.url || '/', 'http://127.0.0.1');
        let relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
        let target = path.resolve(resolved, relative || 'index.html');
        if (!target.startsWith(`${resolved}${path.sep}`) && target !== path.join(resolved, 'index.html')) {
          throw new BridgeError('INVALID_PREVIEW_PATH', 'Caminho de preview inválido.');
        }
        const stat = await fs.stat(target).catch(() => null);
        if (!stat?.isFile()) target = path.join(resolved, 'index.html');
        const extension = path.extname(target).toLowerCase();
        let body = await fs.readFile(target);
        if (extension === '.html') body = Buffer.from(injectDiagnostics(body.toString('utf8')), 'utf8');
        response.writeHead(200, {
          'content-type': MIME[extension] || 'application/octet-stream',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; connect-src 'self' https: http://127.0.0.1:*; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:",
        });
        response.end(body);
      } catch (error) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Preview não encontrado.');
      }
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    this.url = `http://127.0.0.1:${address.port}`;
    this.logger.info('preview.started', { root: resolved, url: this.url });
    if (options.open !== false) await this.openExternal?.(this.url);
    return { running: true, root: resolved, url: this.url };
  }

  async validateRuntime(root, options = {}) {
    if (!this.createBrowserWindow) {
      return { passed: false, status: 'unavailable', errors: ['O Chromium de validação não está disponível.'] };
    }
    const settleMs = options.settleMs ?? 3500;
    const timeoutMs = options.timeoutMs ?? 20_000;
    const errors = [];
    let validationWindow = null;
    let aborted = false;
    const abort = () => { aborted = true; if (validationWindow && !validationWindow.isDestroyed()) validationWindow.destroy(); };
    options.signal?.addEventListener('abort', abort, { once: true });

    try {
      const state = await this.start(root, { open: false });
      if (options.signal?.aborted) throw new BridgeError('MIGRATION_CANCELLED', 'A operação foi cancelada.');
      const partition = `rb-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      validationWindow = this.createBrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        backgroundColor: '#ffffff',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
          partition,
        },
      });

      validationWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (level >= 2 && isBlockingConsoleMessage(message)) errors.push(`${message}${sourceId ? ` (${sourceId}:${line || 0})` : ''}`);
      });
      validationWindow.webContents.on('did-fail-load', (_event, code, description, validatedUrl, isMainFrame) => {
        if (isMainFrame !== false) errors.push(`Falha ao carregar ${validatedUrl || state.url}: ${description} (${code}).`);
      });
      validationWindow.webContents.on('render-process-gone', (_event, details) => {
        errors.push(`O processo de renderização foi encerrado: ${details.reason}.`);
      });

      await Promise.race([
        validationWindow.loadURL(state.url),
        new Promise((_, reject) => setTimeout(() => reject(new BridgeError('PREVIEW_RUNTIME_TIMEOUT', 'O preview não carregou dentro do tempo limite.')), timeoutMs)),
      ]);
      await delay(settleMs);
      if (aborted || options.signal?.aborted) throw new BridgeError('MIGRATION_CANCELLED', 'A operação foi cancelada.');

      const snapshot = await validationWindow.webContents.executeJavaScript(`(() => {
        const root = document.getElementById('root');
        return {
          title: document.title,
          rootExists: Boolean(root),
          rootChildren: root?.childElementCount || 0,
          rootTextLength: (root?.innerText || '').trim().length,
          rootHtmlLength: (root?.innerHTML || '').trim().length,
          errors: Array.isArray(window.__RB_PREVIEW_ERRORS__) ? window.__RB_PREVIEW_ERRORS__.map(String) : [],
          location: window.location.href,
        };
      })()`, true);
      for (const message of snapshot.errors || []) if (!errors.includes(message)) errors.push(message);
      const rendered = snapshot.rootExists && snapshot.rootChildren > 0 && snapshot.rootHtmlLength > 0;
      const passed = rendered && errors.length === 0;
      const result = { passed, status: passed ? 'passed' : 'failed', url: state.url, rendered, snapshot, errors };
      this.logger.info('preview.runtime.validation', result);
      this.emit?.('migration:progress', {
        step: 'build',
        status: passed ? 'complete' : 'failed',
        message: passed ? 'Aplicação renderizada com sucesso no Chromium isolado.' : `Falha de execução detectada: ${errors[0] || 'a raiz da aplicação permaneceu vazia.'}`,
      });
      return result;
    } catch (error) {
      if (error?.code === 'MIGRATION_CANCELLED') throw error;
      const message = error?.message || String(error);
      errors.push(message);
      return { passed: false, status: 'failed', rendered: false, snapshot: null, errors };
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (validationWindow && !validationWindow.isDestroyed()) validationWindow.destroy();
      await this.stop().catch(() => null);
    }
  }
}

module.exports = { PreviewService, diagnosticsScript, injectDiagnostics, isBlockingConsoleMessage };
