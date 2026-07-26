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

class PreviewService {
  constructor({ logger, openExternal }) {
    this.logger = logger;
    this.openExternal = openExternal;
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
        const body = await fs.readFile(target);
        response.writeHead(200, {
          'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; connect-src 'self' https: http://127.0.0.1:*; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:",
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
}

module.exports = { PreviewService };
