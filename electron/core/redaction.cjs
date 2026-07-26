'use strict';

const KEY_PATTERN = /(token|secret|password|passwd|authorization|api[_-]?key|client[_-]?secret|private[_-]?key)/i;
const TOKEN_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /b44k_[A-Za-z0-9_-]{12,}/g,
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

function redactString(value) {
  let output = String(value);
  for (const pattern of TOKEN_PATTERNS) output = output.replace(pattern, '[REDACTED]');
  return output;
}

function redact(value, key = '') {
  if (KEY_PATTERN.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
}

module.exports = { redact, redactString, TOKEN_PATTERNS };
