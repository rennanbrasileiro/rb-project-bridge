'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runProcess } = require('../electron/core/process-runner.cjs');
const { BridgeError } = require('../electron/core/errors.cjs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

async function findExecutable(name) {
  try { return (await runProcess('which', [name], { timeoutMs: 5000, onOutput: () => {} })).stdout.trim().split(/\r?\n/)[0] || null; }
  catch { return null; }
}

async function resolveChromium() {
  if (process.env.RB_BRIDGE_CHROMIUM) return process.env.RB_BRIDGE_CHROMIUM;
  for (const candidate of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const resolved = await findExecutable(candidate);
    if (resolved) return resolved;
  }
  throw new BridgeError('CHROMIUM_MISSING', 'Chromium/Chrome não está disponível no worker Cloud.');
}

async function startStaticServer(root) {
  const resolved = path.resolve(root);
  const server = http.createServer(async (request, response) => {
    try {
      const parsed = new URL(request.url || '/', 'http://127.0.0.1');
      const relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
      let target = path.resolve(resolved, relative || 'index.html');
      if (!target.startsWith(`${resolved}${path.sep}`) && target !== path.join(resolved, 'index.html')) throw new Error('invalid path');
      const stat = await fs.stat(target).catch(() => null);
      if (!stat?.isFile()) target = path.join(resolved, 'index.html');
      const body = await fs.readFile(target);
      response.writeHead(200, { 'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function rootSnapshot(dom) {
  const match = String(dom || '').match(/<([a-z][\w:-]*)[^>]*id=["']root["'][^>]*>([\s\S]*?)<\/\1>/i);
  const html = match?.[2]?.trim() || '';
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { rootExists: Boolean(match), rootHtmlLength: html.length, rootTextLength: text.length };
}

async function validateHeadlessRuntime(root, options = {}) {
  const chromium = await resolveChromium();
  const { server, url } = await startStaticServer(root);
  try {
    const result = await runProcess(chromium, [
      '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-background-networking',
      '--disable-default-apps', '--disable-extensions', '--disable-sync', '--metrics-recording-only', '--no-first-run',
      '--virtual-time-budget=6000', '--dump-dom', url,
    ], { timeoutMs: options.timeoutMs || 30000, signal: options.signal, onOutput: () => {} });
    const snapshot = rootSnapshot(result.stdout);
    const rendered = snapshot.rootExists && snapshot.rootHtmlLength > 0;
    const errors = [];
    if (!snapshot.rootExists) errors.push('O bundle não contém o elemento #root após a renderização.');
    else if (!snapshot.rootHtmlLength) errors.push('O elemento #root permaneceu vazio após a renderização.');
    const stderr = String(result.stderr || '');
    const fatal = stderr.split(/\r?\n/).filter((line) => /uncaught|unhandled|syntaxerror|referenceerror|typeerror/i.test(line)).slice(0, 10);
    errors.push(...fatal);
    return { passed: rendered && errors.length === 0, status: rendered && errors.length === 0 ? 'passed' : 'failed', url, rendered, snapshot, errors };
  } catch (error) {
    return { passed: false, status: 'failed', rendered: false, snapshot: null, errors: [error.message || String(error)] };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { validateHeadlessRuntime, resolveChromium, rootSnapshot, startStaticServer };
