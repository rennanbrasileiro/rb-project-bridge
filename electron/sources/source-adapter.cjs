'use strict';

const REQUIRED_METHODS = Object.freeze(['status', 'listProjects', 'exportProject', 'analyzeCapabilities']);

class SourceAdapter {
  constructor({ id, label, kind = 'platform' }) {
    if (!id || !label) throw new Error('Source adapter requires id and label.');
    this.id = id;
    this.label = label;
    this.kind = kind;
  }

  async status() { throw new Error(`${this.id}.status is not implemented.`); }
  async listProjects() { throw new Error(`${this.id}.listProjects is not implemented.`); }
  async exportProject() { throw new Error(`${this.id}.exportProject is not implemented.`); }
  async analyzeCapabilities() { throw new Error(`${this.id}.analyzeCapabilities is not implemented.`); }

  normalizeManifest(input = {}) {
    return {
      schemaVersion: 1,
      source: { id: this.id, label: this.label, kind: this.kind },
      project: input.project || null,
      capturedAt: input.capturedAt || new Date().toISOString(),
      sourceVersion: input.sourceVersion || null,
      code: input.code || { available: false, method: null },
      backend: input.backend || { available: false, exportable: false },
      data: input.data || { available: false, exportable: false, method: null },
      users: input.users || { available: false, exportable: false, passwordPortable: false },
      storage: input.storage || { available: false, exportable: false },
      functions: input.functions || { available: false, exportable: false },
      secrets: { exportable: false, note: 'Secrets are never copied into the canonical workspace.' },
      limitations: Array.isArray(input.limitations) ? input.limitations : [],
      evidence: Array.isArray(input.evidence) ? input.evidence : [],
    };
  }
}

function assertSourceAdapter(adapter) {
  if (!adapter?.id || !adapter?.label) throw new Error('Invalid source adapter metadata.');
  for (const method of REQUIRED_METHODS) if (typeof adapter[method] !== 'function') throw new Error(`Source adapter ${adapter.id} is missing ${method}.`);
  return adapter;
}

module.exports = { SourceAdapter, assertSourceAdapter, REQUIRED_METHODS };
