'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnosticsScript, injectDiagnostics } = require('../electron/services/preview-service.cjs');

test('generated diagnostics script is valid JavaScript', () => {
  const script = diagnosticsScript();
  const javascript = script.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  assert.doesNotThrow(() => new Function(javascript));
  assert.match(javascript, /execução\.\\n\\n/);
});

test('diagnostics are injected only once', () => {
  const html = '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>';
  const once = injectDiagnostics(html);
  const twice = injectDiagnostics(once);
  assert.equal((once.match(/data-rb-preview-diagnostics/g) || []).length, 1);
  assert.equal(twice, once);
});
