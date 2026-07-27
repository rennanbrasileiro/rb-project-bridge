'use strict';

const crypto = require('node:crypto');

const VERIFICATION_STATUSES = Object.freeze(['passed', 'failed', 'blocked', 'skipped']);

function asList(value) { return Array.isArray(value) ? value : []; }
function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  return VERIFICATION_STATUSES.includes(status) ? status : 'blocked';
}
function normalizeStrings(value) {
  return asList(value).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 100);
}
function ensureLedger(report = {}) {
  if (!Array.isArray(report.verificationLedger)) report.verificationLedger = [];
  return report.verificationLedger;
}
function codeReference(report = {}) {
  return report.github?.sha
    || report.pullRequest?.headSha
    || report.publishPlan?.branch
    || report.sourceManifest?.deliveredAt
    || report.jobId
    || null;
}
function appendVerification(report, input = {}) {
  if (!input.gate) throw new Error('Verification gate is required.');
  const ledger = ensureLedger(report);
  const finishedAt = input.finishedAt || new Date().toISOString();
  const attempt = {
    id: input.id || crypto.randomUUID(),
    gate: String(input.gate),
    status: normalizeStatus(input.status),
    source: String(input.source || 'bridge'),
    executor: String(input.executor || 'automation'),
    startedAt: input.startedAt || finishedAt,
    finishedAt,
    codeRef: input.codeRef || codeReference(report),
    environment: input.environment || null,
    summary: String(input.summary || ''),
    evidence: normalizeStrings(input.evidence),
    errors: normalizeStrings(input.errors),
    artifacts: input.artifacts && typeof input.artifacts === 'object' ? input.artifacts : {},
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
  ledger.push(attempt);
  report.verificationLedger = ledger.slice(-500);
  report.latestVerifications = latestVerificationMap(report);
  return attempt;
}
function latestVerification(report = {}, gate) {
  const ledger = ensureLedger(report);
  for (let index = ledger.length - 1; index >= 0; index -= 1) {
    if (ledger[index]?.gate === gate) return ledger[index];
  }
  return null;
}
function latestVerificationMap(report = {}) {
  const result = {};
  for (const attempt of ensureLedger(report)) result[attempt.gate] = attempt;
  return result;
}
function legacyStatus(value, missing = 'blocked') {
  if (value === true) return 'passed';
  if (value === false) return 'failed';
  return missing;
}
function effectiveStatus(report, gate, fallback, missing = 'blocked') {
  return latestVerification(report, gate)?.status || legacyStatus(fallback, missing);
}
function gatePassed(report, gate, fallback = null) {
  return effectiveStatus(report, gate, fallback) === 'passed';
}
function gateFailed(report, gate, fallback = null) {
  return effectiveStatus(report, gate, fallback) === 'failed';
}
function currentTechnicalGates(report = {}) {
  return {
    build: effectiveStatus(report, 'build', report.build?.status === 'passed'),
    runtime: effectiveStatus(report, 'runtime', report.build?.runtime?.passed),
    standalone: effectiveStatus(report, 'standalone', Boolean(report.standaloneGateAfterPreviewRepair?.passed || report.standaloneGateAfterBuild?.passed || report.standaloneGate?.passed)),
    security: effectiveStatus(report, 'security', (report.securityAfterPreviewRepair?.blocking?.length || report.securityAfterBuild?.blocking?.length || report.security?.blocking?.length || 0) === 0),
    workspace: effectiveStatus(report, 'workspace', report.workspaceValidation?.passed, 'skipped'),
  };
}
function publicationBlockers(report = {}) {
  if (report.options?.deliveryMode === 'snapshot') return [];
  const gates = currentTechnicalGates(report);
  const blockers = [];
  if (gates.build !== 'passed') blockers.push(`Build atual: ${gates.build}`);
  if (gates.runtime !== 'passed') blockers.push(`Runtime atual: ${gates.runtime}`);
  if (gates.standalone !== 'passed') blockers.push(`Independência atual: ${gates.standalone}`);
  if (gates.security !== 'passed') blockers.push(`Segurança atual: ${gates.security}`);
  return blockers;
}
function canPublishCurrentEvidence(report = {}) {
  return publicationBlockers(report).length === 0;
}

module.exports = {
  VERIFICATION_STATUSES,
  appendVerification,
  latestVerification,
  latestVerificationMap,
  effectiveStatus,
  gatePassed,
  gateFailed,
  currentTechnicalGates,
  publicationBlockers,
  canPublishCurrentEvidence,
};
