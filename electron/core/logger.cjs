'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { redact } = require('./redaction.cjs');

class JsonLogger {
  constructor(logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    this.filePath = path.join(logDir, `bridge-${new Date().toISOString().slice(0, 10)}.jsonl`);
  }
  log(level, event, data = {}) {
    const record = redact({ timestamp: new Date().toISOString(), level, event, ...data });
    fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
  }
  info(event, data) { this.log('info', event, data); }
  warn(event, data) { this.log('warn', event, data); }
  error(event, data) { this.log('error', event, data); }
}

module.exports = { JsonLogger };
