'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { BridgeError, asBridgeError } = require('../core/errors.cjs');
const { readJson } = require('../core/fs-utils.cjs');
const { appendVerification } = require('./verification-ledger-service.cjs');
const { createDefect, openDefects } = require('./defect-service.cjs');

function runtimeErrors(error) {
  return error?.details?.runtime?.errors
    || error?.details?.build?.runtime?.errors
    || error?.details?.build?.errors
    || [];
}

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

  async persistAttempt(report, jobRoot, repositoryDir) {
    if (repositoryDir) await this.reports.writeReport(repositoryDir, report, { skipArchive: true }).catch(() => null);
    await this.reports.writeReport(jobRoot, report, { skipArchive: true }).catch(() => null);
  }

  async repair(jobRoot) {
    if (this.running) throw new BridgeError('PREVIEW_REPAIR_RUNNING', 'Já existe uma reconstrução de preview em andamento.');
    const resolvedJobRoot = path.resolve(String(jobRoot || ''));
    if (!path.isAbsolute(resolvedJobRoot)) throw new BridgeError('INVALID_PATH', 'A pasta da operação é inválida.');

    this.running = true;
    this.controller = new AbortController();
    const { signal } = this.controller;
    const startedAt = new Date().toISOString();
    let report;
    let repositoryDir = null;
    let previewDir = null;
    try {
      report = await readJson(path.join(resolvedJobRoot, 'RB-BRIDGE-REPORT.json'));
      if (!report?.paths?.repositoryDir) {
        throw new BridgeError('PREVIEW_REPAIR_NOT_AVAILABLE', 'Esta operação não possui uma aplicação standalone preparada para reconstrução.');
      }
      if (report.options?.deliveryMode && report.options.deliveryMode !== 'standalone-supabase') {
        throw new BridgeError('PREVIEW_REPAIR_NOT_AVAILABLE', 'Somente operações standalone Supabase possuem preview reconstruível.');
      }

      repositoryDir = path.resolve(report.paths.repositoryDir);
      previewDir = path.resolve(report.paths.previewDir || path.join(resolvedJobRoot, 'preview'));
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
      appendVerification(report, { gate: 'standalone', status: standaloneGate.passed ? 'passed' : 'failed', source: 'preview-repair', startedAt, finishedAt: repairedAt, summary: standaloneGate.passed ? 'Gate standalone aprovado.' : 'Gate standalone reprovado.' });
      appendVerification(report, { gate: 'build', status: 'passed', source: 'preview-repair', startedAt, finishedAt: repairedAt, summary: 'Build demo recompilado com sucesso.', artifacts: { previewDir } });
      appendVerification(report, { gate: 'runtime', status: 'passed', source: 'preview-repair', startedAt, finishedAt: repairedAt, summary: 'Aplicação montou conteúdo em Chromium.', evidence: build.runtime?.evidence || [], artifacts: { previewDir } });
      appendVerification(report, { gate: 'security', status: 'passed', source: 'preview-repair', startedAt, finishedAt: repairedAt, summary: 'Nenhum segredo bloqueante após a reconstrução.' });
      report.previewRepair = {
        status: 'completed',
        repairedAt,
        published: false,
        message: 'Preview reconstruído localmente sem reexportar a Base44 e sem alterar o GitHub.',
      };
      report.packageState = { ...(report.packageState || {}), dirty: true, lastValidationAt: repairedAt };
      report.notes = Array.isArray(report.notes) ? report.notes : [];
      report.notes.push(`Preview reconstruído e validado em ${repairedAt}; nenhuma publicação GitHub foi executada.`);

      await this.persistAttempt(report, resolvedJobRoot, repositoryDir);
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
        verificationStatus: 'passed',
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
      const failedAt = new Date().toISOString();
      if (report) {
        const failedBuild = bridgeError.details?.build || null;
        const errors = runtimeErrors(bridgeError).map(String);
        if (failedBuild) report.latestFailedBuild = failedBuild;
        appendVerification(report, {
          gate: 'build',
          status: failedBuild?.status === 'passed' ? 'passed' : 'failed',
          source: 'preview-repair',
          startedAt,
          finishedAt: failedAt,
          summary: failedBuild?.status === 'passed' ? 'Build recompilado; runtime ainda reprovado.' : bridgeError.message,
          errors,
          artifacts: { previewDir },
        });
        appendVerification(report, {
          gate: 'runtime',
          status: 'failed',
          source: 'preview-repair',
          startedAt,
          finishedAt: failedAt,
          summary: bridgeError.message,
          errors: errors.length ? errors : [bridgeError.message],
          artifacts: { previewDir },
        });
        report.previewRepair = {
          status: 'failed',
          repairedAt: failedAt,
          published: false,
          code: bridgeError.code,
          message: bridgeError.message,
          errors,
        };
        report.packageState = { ...(report.packageState || {}), dirty: true, lastValidationAt: failedAt };
        if (!openDefects(report, { gate: 'runtime' }).some((item) => item.observed === bridgeError.message)) {
          createDefect(report, {
            gate: 'runtime',
            title: 'Preview não renderiza após reconstrução',
            severity: 'critical',
            expected: 'A aplicação deve montar conteúdo no elemento #root e permanecer navegável sem erro fatal.',
            observed: bridgeError.message,
            reproductionSteps: 'Abrir a operação concluída e executar “Recriar e validar preview”.',
            evidence: errors.join('\n'),
            owner: report.options?.deliveryOwner || null,
          });
        }
        report.notes = Array.isArray(report.notes) ? report.notes : [];
        report.notes.push(`Revalidação reprovada em ${failedAt}; a evidência anterior de runtime foi invalidada.`);
        await this.persistAttempt(report, resolvedJobRoot, repositoryDir);
        await this.reports.appendHistory({
          jobId: report.jobId,
          status: 'failed',
          checkpoint: report.checkpoint,
          startedAt: report.startedAt,
          finishedAt: failedAt,
          project: report.project,
          github: report.github,
          githubRepository: report.githubRepository,
          jobRoot: resolvedJobRoot,
          previewDir,
          previewRepaired: false,
          verificationStatus: 'failed',
          error: { code: bridgeError.code, message: bridgeError.message, errors },
        }).catch(() => null);
      }
      this.emit('migration:progress', { step: 'build', status: 'failed', message: bridgeError.message, code: bridgeError.code });
      throw bridgeError;
    } finally {
      this.running = false;
      this.controller = null;
    }
  }
}

module.exports = { PreviewRepairService };
