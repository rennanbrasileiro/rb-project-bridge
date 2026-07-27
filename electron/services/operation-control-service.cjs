'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { BridgeError } = require('../core/errors.cjs');
const { readJson } = require('../core/fs-utils.cjs');
const { VALIDATION_DEFINITIONS, buildOperationSummary } = require('./operation-summary-service.cjs');

function normalizeText(value, max = 2000) { return String(value || '').trim().slice(0, max); }

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
    const passed = Boolean(input.passed);
    report[definition.field] = {
      passed,
      notes: normalizeText(input.notes),
      evidence: normalizeText(input.evidence),
      validatedBy: normalizeText(input.validatedBy, 160) || report.options?.deliveryOwner || report.options?.clientName || null,
      validatedAt: new Date().toISOString(),
    };
    report.packageState = {
      ...(report.packageState || {}),
      dirty: true,
      lastValidationAt: report[definition.field].validatedAt,
    };
    await this.persistWithoutArchive(root, report);
    this.logger?.info('operation.validation.saved', { jobId: report.jobId, validationId: definition.id, passed });
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
    this.logger?.info('operation.package.regenerated', { jobId: report.jobId, archive: report.paths?.clientDeliveryArchive || null });
    return this.publicState(report);
  }
}

module.exports = { OperationControlService };
