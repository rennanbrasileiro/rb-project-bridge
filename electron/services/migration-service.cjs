'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { BridgeError, asBridgeError } = require('../core/errors.cjs');
const { ensureEmptyDir, copyDirectory, safeSlug, readJson } = require('../core/fs-utils.cjs');

class MigrationService {
  constructor({ base44, github, security, build, standalone, archive, reports, logger, emit }) {
    Object.assign(this, { base44, github, security, build, standalone, archive, reports, logger, emit });
    this.running = false; this.controller = null;
  }
  cancel() { if (!this.running || !this.controller) return { cancelled: false, message: 'Nenhuma operação em andamento.' }; this.controller.abort(); this.emit('migration:progress', { step: 'job', status: 'failed', message: 'Cancelamento solicitado...' }); return { cancelled: true }; }
  assertActive(signal) { if (signal.aborted) throw new BridgeError('MIGRATION_CANCELLED', 'A operação foi cancelada.'); }

  async migrate(input) {
    if (this.running) throw new BridgeError('MIGRATION_ALREADY_RUNNING', 'Já existe uma operação em andamento.');
    this.running = true; this.controller = new AbortController(); const { signal } = this.controller;
    const jobId = crypto.randomUUID(); const startedAt = new Date().toISOString(); const slug = safeSlug(input.project.name); const timestamp = startedAt.replace(/[:.]/g, '-');
    const jobRoot = path.join(input.outputDirectory, `${slug}-${timestamp}`); const originalDir = path.join(jobRoot, 'source-backup'); const snapshotDir = path.join(jobRoot, 'base44-snapshot'); const repositoryDir = path.join(jobRoot, 'repository'); const previewDir = path.join(jobRoot, 'preview'); const backupPath = path.join(jobRoot, `${slug}-base44-source.zip`);
    const standaloneMode = input.deliveryMode ? input.deliveryMode !== 'snapshot' : Boolean(this.standalone);
    const report = { schemaVersion: 2, jobId, status: 'running', startedAt, project: { id: input.project.id, name: input.project.name }, options: { deliveryMode: standaloneMode ? 'standalone-supabase' : 'snapshot', buildValidation: standaloneMode ? true : Boolean(input.buildValidation), visibility: 'private', commitMessage: input.repository.commitMessage || '' }, notes: [] };
    await ensureEmptyDir(jobRoot); this.logger.info('migration.start', { jobId, projectId: input.project.id, jobRoot, standaloneMode }); this.emit('migration:progress', { step: 'job', status: 'running', message: `Operação ${jobId.slice(0, 8)} iniciada.` });
    try {
      report.export = await this.base44.exportProject(input.project, originalDir, { signal }); this.assertActive(signal);
      report.exportTree = await this.security.validateExportTree(originalDir, {}, signal); if (!report.exportTree.valid) throw new BridgeError('UNSAFE_EXPORT_TREE', 'A exportação contém links simbólicos ou arquivos não suportados.', { prohibited: report.exportTree.prohibited });
      report.backup = await this.archive.createZip(originalDir, backupPath); this.assertActive(signal);
      await copyDirectory(originalDir, snapshotDir); report.snapshotSanitization = await this.security.sanitize(snapshotDir, signal); report.sanitization = report.snapshotSanitization; report.snapshotSecurity = await this.security.scan(snapshotDir, signal); if (report.snapshotSecurity.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED', 'O snapshot contém possíveis segredos.', { findings: report.snapshotSecurity.blocking });
      await copyDirectory(snapshotDir, repositoryDir);
      report.base44Analysis = await this.security.analyzeBase44Dependencies(repositoryDir, signal);
      if (standaloneMode) report.standalone = await this.standalone.transform(repositoryDir, { projectName: input.project.name, signal });
      report.security = await this.security.scan(repositoryDir, signal); if (report.security.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED', 'A publicação foi bloqueada porque possíveis segredos foram detectados.', { findings: report.security.blocking });
      if (standaloneMode) report.standaloneGate = await this.standalone.verify(repositoryDir);
      report.inspection = await this.build.inspect(repositoryDir); if (!report.inspection.valid) throw new BridgeError('PROJECT_STRUCTURE_INVALID', 'O projeto não passou na validação estrutural.', { issues: report.inspection.issues });
      report.build = await this.build.validateBuild(repositoryDir, { consent: standaloneMode || Boolean(input.buildValidation), buildScript: standaloneMode ? 'build:demo' : null, previewDestination: standaloneMode ? previewDir : null, syncLockfile: standaloneMode }, signal);
      if (report.build.status !== 'passed' && standaloneMode) throw new BridgeError('BUILD_VALIDATION_FAILED', 'O build local independente falhou.', { build: report.build });
      if (standaloneMode) { report.standaloneGateAfterBuild = await this.standalone.verify(repositoryDir); report.securityAfterBuild = await this.security.scan(repositoryDir, signal); if (report.securityAfterBuild.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED', 'O lockfile ou build gerou conteúdo sensível.', { findings: report.securityAfterBuild.blocking }); }
      report.paths = { jobRoot, originalDir, snapshotDir, repositoryDir, previewDir: report.build.preview?.directory || null, backupPath };
      const prePublishReport = { ...report, status: 'ready-to-publish', finishedAt: new Date().toISOString() }; await this.reports.writeReport(repositoryDir, prePublishReport); this.assertActive(signal);
      const repository = await this.github.createRepository({ ...input.repository, visibility: 'private' }, { signal }); report.githubRepository = { fullName: repository.full_name, cloneUrl: repository.clone_url, htmlUrl: repository.html_url, owner: repository.owner, private: repository.private };
      if (repository.private === false) throw new BridgeError('REPOSITORY_NOT_PRIVATE', 'A entrega foi interrompida porque o repositório não está privado.');
      report.github = await this.github.publish({ directory: repositoryDir, repository, commitMessage: standaloneMode ? 'Entrega independente Supabase gerada pelo RB Project Bridge' : (input.repository.commitMessage || `Snapshot ${input.project.name}`), signal, branch: 'main' });
      report.snapshot = await this.github.publish({ directory: snapshotDir, repository, commitMessage: 'Snapshot sanitizado da exportação Base44', signal, branch: 'base44-source' });
      report.status = 'completed'; report.finishedAt = new Date().toISOString(); report.reportFiles = await this.reports.writeReport(repositoryDir, report); await this.reports.writeReport(jobRoot, report);
      await this.reports.appendHistory({ jobId, status: report.status, startedAt, finishedAt: report.finishedAt, project: report.project, github: report.github, jobRoot, previewDir: report.paths.previewDir });
      this.emit('migration:progress', { step: 'job', status: 'complete', message: standaloneMode ? 'Entrega independente concluída: Supabase, build local, preview e GitHub privado.' : 'Snapshot concluído.' });
      return report;
    } catch (error) {
      let bridgeError = asBridgeError(error, 'MIGRATION_FAILED'); if (signal.aborted || bridgeError.code === 'PROCESS_ABORTED') bridgeError = new BridgeError('MIGRATION_CANCELLED', 'A operação foi cancelada.');
      report.status = bridgeError.code === 'MIGRATION_CANCELLED' ? 'cancelled' : 'failed'; report.finishedAt = new Date().toISOString(); bridgeError.details = { ...(bridgeError.details || {}), jobRoot, githubRepository: report.githubRepository }; report.error = { code: bridgeError.code, message: bridgeError.message, details: bridgeError.details }; if (standaloneMode) { report.standaloneGateAfterBuild = await this.standalone.verify(repositoryDir); report.securityAfterBuild = await this.security.scan(repositoryDir, signal); if (report.securityAfterBuild.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED', 'O lockfile ou build gerou conteúdo sensível.', { findings: report.securityAfterBuild.blocking }); }
      report.paths = { jobRoot, originalDir, snapshotDir, repositoryDir, previewDir, backupPath };
      await this.reports.writeReport(jobRoot, report).catch(() => null); await this.reports.appendHistory({ jobId, status: report.status, startedAt, finishedAt: report.finishedAt, project: report.project, githubRepository: report.githubRepository, error: report.error, jobRoot }).catch(() => null); this.emit('migration:progress', { step: 'job', status: 'failed', message: bridgeError.message, code: bridgeError.code }); throw bridgeError;
    } finally { this.running = false; this.controller = null; }
  }

  async retryPublish(jobRoot) {
    if (this.running) throw new BridgeError('MIGRATION_ALREADY_RUNNING', 'Já existe uma operação em andamento.');
    const resolvedJobRoot = path.resolve(jobRoot); const report = await readJson(path.join(resolvedJobRoot, 'RB-BRIDGE-REPORT.json'));
    if (!report?.githubRepository || !report?.paths?.repositoryDir) throw new BridgeError('RETRY_NOT_AVAILABLE', 'Não há publicação disponível para repetição.');
    const repositoryDir = path.resolve(report.paths.repositoryDir); if (repositoryDir !== resolvedJobRoot && !repositoryDir.startsWith(`${resolvedJobRoot}${path.sep}`)) throw new BridgeError('UNSAFE_RETRY_PATH', 'O relatório aponta para fora da pasta da operação.');
    const repository = { full_name: report.githubRepository.fullName, clone_url: report.githubRepository.cloneUrl, html_url: report.githubRepository.htmlUrl, owner: report.githubRepository.owner };
    report.github = await this.github.publish({ directory: repositoryDir, repository, commitMessage: report.options?.commitMessage || 'Retry RB Project Bridge delivery', branch: 'main' }); report.status = 'completed'; report.finishedAt = new Date().toISOString(); delete report.error; await this.reports.writeReport(repositoryDir, report); await this.reports.writeReport(resolvedJobRoot, report); return report;
  }
}
module.exports = { MigrationService };
