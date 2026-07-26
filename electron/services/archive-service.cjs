'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { sha256File } = require('../core/fs-utils.cjs');

class ArchiveService {
  constructor({ emit }) { this.emit = emit; }

  async createZip(source, target) {
    this.emit('migration:progress', { step: 'backup', status: 'running', message: 'Creating immutable source backup...' });
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addLocalFolder(source);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await new Promise((resolve, reject) => {
      zip.writeZip(target, (error) => error ? reject(error) : resolve());
    });
    const sha256 = await sha256File(target);
    await fs.writeFile(`${target}.sha256`, `${sha256}  ${path.basename(target)}\n`, 'utf8');
    this.emit('migration:progress', { step: 'backup', status: 'complete', message: 'Backup ZIP created and hashed.' });
    return { path: target, sha256 };
  }
}

module.exports = { ArchiveService };
