'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { BridgeError, asBridgeError } = require('../core/errors.cjs');
const { readJson } = require('../core/fs-utils.cjs');

class PreviewRepairService {
  constructor({ build, standalone, security, reports, logger, emit }) {
    Object.assign(this, { build, standalone, security, reports, logger, emit });
    this.running = false;
    this.controller = null;
  }

  cancel() {
    if (!this.running || !this.controller) return { cancelled: false };
    this.controller.abort();
    return { cancelled: true };
  }

  async repair(jobRoot) {
    if (this.running) throw new BridgeError('PREVIEW_REPAIR_RUNNING', 'Já existe uma reconstrução de preview em andamento.');
    const resolvedJobRoot = path.resolve(String(jobRoot || ''));
    if (!path.isAbsolute(resolvedJobRoot)) throw new BridgeError('INVALID_PATH', 'A pasta da operação é inválida.');

    this.running = true;
    this.controller = new AbortController();
    const { signal } = this.controller;
    let report;
    try {
      report = await readJson(path.join(resolvedJobRoot, 'RB-BRIDGE-REPORT.json'));
      if (!report?.paths?.repositoryDir) {
        throw new BridgeError('PREVIEW_REPAIR_NOT_AVAILABLE', 'Esta operação não possui uma aplicação standalone preparada para reconstrução.');
      }
      if (report.options?.deliveryMode && report.options.deliveryMode !== 'standalone-supabase') {
        throw new BridgeError('PREVIEW_REPAIR_NOT_AVAILABLE', 'Somente operações standalone Supabase possuem preview reconstruível.');
      }

      const repositoryDir = path.resolve(report.paths.repositoryDir);
      const previewDir = path.resolve(report.paths.previewDir || path.join(resolvedJobRoot, 'preview'));
      for (const target of [repositoryDir, previewDir]) {
        if (target !== resolvedJobRoot && !target.startsWith(`${resolvedJobRoot}${path.sep}`)) {
          throw new BridgeError('UNSAFE_PREVIEW_REPAIR_PATH', 'O relatório aponta para fora da pasta da operação.');
        }
      }
      await fs.stat(repositoryDir).catch(() => {
        throw new BridgeError('PREVIEW_REPAIR_FILES_MISSING', 'A pasta da aplicação convertida não existe mais.');
      });

      this.emit('migration:progress', {
        step: 'build',
        status: 'running',
        message: 'Corrigindo compatibilidade, reconstruindo e revalidando o preview existente...',
      });

      const inspection = await this.build.inspect(repositoryDir);
      if (!inspection.valid) {
        throw new BridgeError('PROJECT_STRUCTURE_INVALID', 'A aplicação salva não passou na validação estrutural.', { issues: inspection.issues });
      }

      const standaloneGate = await this.standalone.verify(repositoryDir);
      const build = await this.build.validateBuild(repositoryDir, {
        consent: true,
        buildScript: 'build:demo',
        previewDestination: previewDir,
        syncLockfile: true,
        runtimeValidation: true,
      }, signal);
      if (build.status !== 'passed' || !build.runtime?.passed) {
        throw new BridgeError('PREVIEW_RUNTIME_FAILED', 'O preview reconstruído não passou na validação de execução.', { build });
      }

      const security = await this.security.scan(repositoryDir, signal);
      if (security.blocking.length) {
        throw new BridgeError('SECURITY_SCAN_BLOCKED', 'A reconstrução foi bloqueada porque possíveis segredos foram detectados.', { findings: security.blocking });
      }

      const repairedAt = new Date().toISOString();
      report.paths.previewDir = previewDir;
      report.inspection = inspection;
      report.standaloneGateAfterPreviewRepair = standaloneGate;
      report.build = build;
      report.securityAfterPreviewRepair = security;
      report.previewRepair = {
        status: 'completed',
        repairedAt,
        published: false,
        message: 'Preview reconstruído localmente sem reexportar a Base44 e sem alterar o GitHub.',
      };
      report.notes = Array.isArray(report.notes) ? report.notes : [];
      report.notes.push(`Preview reconstruído e validado em ${repairedAt}; nenhuma publicação GitHub foi executada.`);

      await this.reports.writeReport(repositoryDir, report);
      await this.reports.writeReport(resolvedJobRoot, report);
      await this.reports.appendHistory({
        jobId: report.jobId,
        status: report.status || 'completed',
        checkpoint: report.checkpoint,
        startedAt: report.startedAt,
        finishedAt: repairedAt,
        project: report.project,
        github: report.github,
        githubRepository: report.githubRepository,
        jobRoot: resolvedJobRoot,
        previewDir,
        previewRepaired: true,
      });

      this.logger.info('preview.repair.completed', { jobRoot: resolvedJobRoot, previewDir, repairedAt });
      this.emit('migration:progress', {
        step: 'build',
        status: 'complete',
        message: 'Preview reconstruído e validado em Chromium; GitHub não foi alterado.',
      });
      return report;
    } catch (error) {
      const bridgeError = asBridgeError(error, 'PREVIEW_REPAIR_FAILED');
      this.emit('migration:progress', { step: 'build', status: 'failed', message: bridgeError.message, code: bridgeError.code });
      throw bridgeError;
    } finally {
      this.running = false;
      this.controller = null;
    }
  }
}

module.exports = { PreviewRepairService };
