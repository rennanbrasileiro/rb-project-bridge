'use strict';

const { SourceAdapter } = require('./source-adapter.cjs');

class Base44SourceAdapter extends SourceAdapter {
  constructor({ service }) {
    super({ id: 'base44', label: 'Base44', kind: 'managed-app-builder' });
    this.service = service;
  }

  status() { return this.service.whoami(); }
  listProjects() { return this.service.listProjects(); }
  exportProject(project, destination, options) { return this.service.exportProject(project, destination, options); }

  async analyzeCapabilities(project = {}) {
    return this.normalizeManifest({
      project,
      sourceVersion: project.updatedAt || null,
      code: { available: true, method: 'platform-export-or-cli-eject' },
      backend: { available: true, exportable: true, note: 'Functions can be preserved, but platform context must be converted.' },
      data: { available: true, exportable: true, method: 'separate-csv-export' },
      users: { available: true, exportable: 'partial', passwordPortable: false, note: 'Accounts and password hashes require recreation or identity migration.' },
      storage: { available: true, exportable: 'manual-or-api-dependent' },
      functions: { available: true, exportable: true },
      limitations: [
        'Code export does not prove database, users or storage migration.',
        'CLI eject creates an independent project with an empty database.',
        'Functions using Base44 context, secrets or raw request contracts require reviewed conversion.',
      ],
    });
  }
}

module.exports = { Base44SourceAdapter };
