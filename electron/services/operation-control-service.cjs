'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { BridgeError } = require('../core/errors.cjs');
const { readJson } = require('../core/fs-utils.cjs');
const { VALIDATION_DEFINITIONS, buildOperationSummary } = require('./operation-summary-service.cjs');
const { appendVerification, latestVerificationMap } = require('./verification-ledger-service.cjs');
const {
  createDefect,
  openDefects,
  blockingDefects,
  updateDefect,
  registerRetest,
  resolveGateDefects,
} = require('./defect-service.cjs');

const VALIDATION_STATUSES = Object.freeze(['pending', 'passed', 'failed', 'blocked', 'not_applicable']);

function normalizeText(value, max = 4000) { return String(value || '').trim().slice(0, max); }
function normalizeValidationStatus(input = {}) {
  const explicit = String(input.status || '').toLowerCase();
  if (VALIDATION_STATUSES.includes(explicit)) return explicit;
  if (input.passed === true) return 'passed';
  return 'pending';
}
function validationGate(validationId) { return `validation:${validationId}`; }

class OperationControlService {
  constructor({ reports, logger }) {
    this.reports = reports;
    this.logger = logger;
  }

  validateJobRoot(jobRoot) {
    if (typeof jobRoot !== 'string' || !path.isAbsolute(jobRoot)) {
      throw new BridgeError('INVALID_PATH', 'É necessária uma pasta de operação válida.');
    }
    return path.resolve(jobRoot);
  }

  async readReport(jobRoot) {
    const root = this.validateJobRoot(jobRoot);
    const reportPath = path.join(root, 'RB-BRIDGE-REPORT.json');
    const report = await readJson(reportPath, null);
    if (!report?.paths?.jobRoot) throw new BridgeError('OPERATION_REPORT_NOT_FOUND', 'O relatório completo desta operação não foi encontrado.');
    if (path.resolve(report.paths.jobRoot) !== root) throw new BridgeError('UNSAFE_OPERATION_PATH', 'O relatório não corresponde à pasta de operação informada.');
    return { root, report, reportPath };
  }

  publicState(report) {
    return {
      result: report,
      summary: buildOperationSummary(report),
      validationDefinitions: Object.values(VALIDATION_DEFINITIONS),
      validationStatuses: VALIDATION_STATUSES,
      defects: report.defects || [],
      openDefects: openDefects(report),
      blockingDefects: blockingDefects(report),
      latestVerifications: latestVerificationMap(report),
    };
  }

  async getState(jobRoot) {
    const { report } = await this.readReport(jobRoot);
    return this.publicState(report);
  }

  async persistWithoutArchive(root, report) {
    const repositoryDir = report.paths?.repositoryDir ? path.resolve(report.paths.repositoryDir) : null;
    if (repositoryDir && repositoryDir.startsWith(`${root}${path.sep}`)) {
      report.reportFiles = await this.reports.writeReport(repositoryDir, report, { skipArchive: true });
    }
    await this.reports.writeReport(root, report, { skipArchive: true });
  }

  async saveValidation(jobRoot, input = {}) {
    const { root, report } = await this.readReport(jobRoot);
    const definition = VALIDATION_DEFINITIONS[input.validationId];
    if (!definition) throw new BridgeError('INVALID_VALIDATION', 'A etapa de homologação informada não existe.');
    const status = normalizeValidationStatus(input);
    const validatedAt = new Date().toISOString();
    const validatedBy = normalizeText(input.validatedBy, 160) || report.options?.deliveryOwner || report.options?.clientName || null;
    const gate = validationGate(definition.id);
    const evidence = normalizeText(input.evidence);
    const notes = normalizeText(input.notes);
    const expected = normalizeText(input.expected);
    const observed = normalizeText(input.observed);
    const reproductionSteps = normalizeText(input.reproductionSteps);
    let defect = null;

    if (['failed', 'blocked'].includes(status)) {
      if (status === 'failed' && (!expected || !observed)) {
        throw new BridgeError('REJECTION_DETAILS_REQUIRED', 'Para reprovar, informe o comportamento esperado e o comportamento observado.');
      }
      defect = createDefect(report, {
        gate,
        journeyId: input.journeyId || null,
        title: normalizeText(input.title, 220) || `${definition.label}: ${status === 'failed' ? 'reprovado' : 'bloqueado'}`,
        severity: input.severity || (status === 'failed' ? 'high' : 'medium'),
        expected: expected || `Concluir ${definition.label.toLowerCase()} conforme o critério de aceite.`,
        observed: observed || notes || 'A validação não pôde ser executada por um bloqueio registrado.',
        reproductionSteps,
        evidence,
        notes,
        owner: normalizeText(input.owner, 180) || validatedBy,
      });
      appendVerification(report, {
        gate,
        status,
        source: 'human-validation',
        executor: validatedBy || 'operator',
        startedAt: validatedAt,
        finishedAt: validatedAt,
        summary: defect.title,
        evidence: [evidence],
        errors: [defect.observed],
        metadata: { defectId: defect.id, severity: defect.severity },
      });
    } else if (status === 'passed') {
      const resolved = resolveGateDefects(report, gate, {
        evidence,
        notes,
        resolution: normalizeText(input.resolution) || 'Critério aprovado em novo reteste.',
        executor: validatedBy,
      });
      appendVerification(report, {
        gate,
        status: 'passed',
        source: 'human-validation',
        executor: validatedBy || 'operator',
        startedAt: validatedAt,
        finishedAt: validatedAt,
        summary: `${definition.label} aprovado${resolved.length ? `; ${resolved.length} defeito(s) resolvido(s) por reteste` : ''}.`,
        evidence: [evidence],
        metadata: { resolvedDefectIds: resolved.map((item) => item.id) },
      });
    } else if (status === 'not_applicable') {
      appendVerification(report, {
        gate,
        status: 'skipped',
        source: 'human-validation',
        executor: validatedBy || 'operator',
        startedAt: validatedAt,
        finishedAt: validatedAt,
        summary: `${definition.label} marcado como não aplicável.`,
        evidence: [evidence],
      });
    }

    report[definition.field] = {
      status,
      passed: status === 'passed' || status === 'not_applicable',
      notes,
      evidence,
      expected,
      observed,
      reproductionSteps,
      severity: input.severity || null,
      validatedBy,
      validatedAt,
      defectId: defect?.id || null,
    };
    report.packageState = {
      ...(report.packageState || {}),
      dirty: true,
      lastValidationAt: validatedAt,
    };
    await this.persistWithoutArchive(root, report);
    this.logger?.info('operation.validation.saved', { jobId: report.jobId, validationId: definition.id, status, defectId: defect?.id || null });
    return this.publicState(report);
  }

  async updateDefect(jobRoot, defectId, input = {}) {
    const { root, report } = await this.readReport(jobRoot);
    const defect = updateDefect(report, defectId, input);
    report.packageState = { ...(report.packageState || {}), dirty: true, lastValidationAt: defect.updatedAt };
    await this.persistWithoutArchive(root, report);
    return this.publicState(report);
  }

  async retestDefect(jobRoot, defectId, input = {}) {
    const { root, report } = await this.readReport(jobRoot);
    const result = registerRetest(report, {
      ...input,
      defectId,
      executor: normalizeText(input.executor, 180) || report.options?.deliveryOwner || null,
    });
    appendVerification(report, {
      gate: result.defect.gate,
      status: result.retest.status,
      source: 'defect-retest',
      executor: result.retest.executor || 'operator',
      startedAt: result.retest.attemptedAt,
      finishedAt: result.retest.attemptedAt,
      summary: `${result.defect.title}: reteste ${result.retest.status}.`,
      evidence: [result.retest.evidence],
      errors: result.retest.status === 'passed' ? [] : [result.retest.notes || result.defect.observed],
      metadata: { defectId: result.defect.id, retestId: result.retest.id },
    });
    report.packageState = { ...(report.packageState || {}), dirty: true, lastValidationAt: result.retest.attemptedAt };
    await this.persistWithoutArchive(root, report);
    return this.publicState(report);
  }

  async regeneratePackage(jobRoot) {
    const { root, report } = await this.readReport(jobRoot);
    const repositoryDir = report.paths?.repositoryDir ? path.resolve(report.paths.repositoryDir) : null;
    if (!repositoryDir || !repositoryDir.startsWith(`${root}${path.sep}`)) {
      throw new BridgeError('OPERATION_REPOSITORY_NOT_FOUND', 'A pasta do workspace desta operação não está disponível.');
    }
    await fs.stat(repositoryDir).catch(() => { throw new BridgeError('OPERATION_REPOSITORY_NOT_FOUND', 'A pasta do workspace desta operação não está disponível.'); });
    report.packageState = {
      ...(report.packageState || {}),
      dirty: false,
      generatedAt: new Date().toISOString(),
    };
    report.reportFiles = await this.reports.writeReport(repositoryDir, report);
    await this.reports.writeReport(root, report, { skipArchive: true });
    this.logger?.info('operation.package.regenerated', { jobId: report.jobId, archive: report.paths?.clientDeliveryArchive || null, openDefects: openDefects(report).length });
    return this.publicState(report);
  }
}

module.exports = { OperationControlService, VALIDATION_STATUSES, validationGate, normalizeValidationStatus };
