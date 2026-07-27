'use strict';

const crypto = require('node:crypto');

const DEFECT_STATUSES = Object.freeze(['open', 'in_progress', 'ready_for_retest', 'resolved', 'accepted_risk']);
const DEFECT_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);

function asList(value) { return Array.isArray(value) ? value : []; }
function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  return DEFECT_STATUSES.includes(status) ? status : 'open';
}
function normalizeSeverity(value) {
  const severity = String(value || '').toLowerCase();
  return DEFECT_SEVERITIES.includes(severity) ? severity : 'medium';
}
function text(value, max = 4000) { return String(value || '').trim().slice(0, max); }
function ensureDefects(report = {}) {
  if (!Array.isArray(report.defects)) report.defects = [];
  return report.defects;
}
function createDefect(report, input = {}) {
  if (!input.gate) throw new Error('Defect gate is required.');
  const expected = text(input.expected);
  const observed = text(input.observed);
  if (!expected || !observed) throw new Error('Expected and observed behavior are required for a rejected validation.');
  const now = new Date().toISOString();
  const defect = {
    id: input.id || `RB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    gate: String(input.gate),
    journeyId: input.journeyId || null,
    title: text(input.title, 220) || `Falha em ${input.gate}`,
    severity: normalizeSeverity(input.severity),
    status: 'open',
    expected,
    observed,
    reproductionSteps: text(input.reproductionSteps),
    evidence: text(input.evidence),
    notes: text(input.notes),
    owner: text(input.owner, 180) || null,
    codeRef: input.codeRef || report.github?.sha || report.publishPlan?.branch || report.jobId || null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    resolution: null,
    retests: [],
  };
  ensureDefects(report).push(defect);
  return defect;
}
function findDefect(report = {}, defectId) {
  return ensureDefects(report).find((item) => item.id === defectId) || null;
}
function openDefects(report = {}, options = {}) {
  const statuses = new Set(['open', 'in_progress', 'ready_for_retest']);
  return ensureDefects(report).filter((item) => statuses.has(item.status) && (!options.gate || item.gate === options.gate));
}
function blockingDefects(report = {}) {
  return openDefects(report).filter((item) => ['high', 'critical'].includes(item.severity));
}
function updateDefect(report, defectId, input = {}) {
  const defect = findDefect(report, defectId);
  if (!defect) throw new Error('Defect not found.');
  if (input.status) defect.status = normalizeStatus(input.status);
  if (input.severity) defect.severity = normalizeSeverity(input.severity);
  if (input.owner !== undefined) defect.owner = text(input.owner, 180) || null;
  if (input.notes !== undefined) defect.notes = text(input.notes);
  if (input.resolution !== undefined) defect.resolution = text(input.resolution);
  defect.updatedAt = new Date().toISOString();
  if (['resolved', 'accepted_risk'].includes(defect.status)) defect.resolvedAt = defect.updatedAt;
  else defect.resolvedAt = null;
  return defect;
}
function registerRetest(report, input = {}) {
  const defect = findDefect(report, input.defectId);
  if (!defect) throw new Error('Defect not found.');
  const status = String(input.status || '').toLowerCase();
  if (!['passed', 'failed', 'blocked'].includes(status)) throw new Error('Invalid retest status.');
  const retest = {
    id: crypto.randomUUID(),
    status,
    attemptedAt: new Date().toISOString(),
    evidence: text(input.evidence),
    notes: text(input.notes),
    codeRef: input.codeRef || report.github?.sha || report.publishPlan?.branch || report.jobId || null,
    executor: text(input.executor, 180) || null,
  };
  defect.retests = asList(defect.retests);
  defect.retests.push(retest);
  defect.updatedAt = retest.attemptedAt;
  if (status === 'passed') {
    defect.status = 'resolved';
    defect.resolvedAt = retest.attemptedAt;
    defect.resolution = text(input.resolution) || 'Resolvido por reteste aprovado.';
  } else {
    defect.status = status === 'blocked' ? 'ready_for_retest' : 'open';
    defect.resolvedAt = null;
  }
  return { defect, retest };
}
function resolveGateDefects(report, gate, input = {}) {
  const resolved = [];
  for (const defect of openDefects(report, { gate })) {
    const result = registerRetest(report, {
      defectId: defect.id,
      status: 'passed',
      evidence: input.evidence,
      notes: input.notes,
      resolution: input.resolution,
      executor: input.executor,
      codeRef: input.codeRef,
    });
    resolved.push(result.defect);
  }
  return resolved;
}

module.exports = {
  DEFECT_STATUSES,
  DEFECT_SEVERITIES,
  createDefect,
  findDefect,
  openDefects,
  blockingDefects,
  updateDefect,
  registerRetest,
  resolveGateDefects,
};
