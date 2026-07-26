'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BridgeError, asBridgeError } = require('../core/errors.cjs');
const { ensureEmptyDir, copyDirectory, safeSlug, readJson, writeJson } = require('../core/fs-utils.cjs');

const RETRYABLE_PUBLISH_CODES = new Set([
  'GITHUB_WORKFLOW_SCOPE_REQUIRED',
  'GITHUB_DELIVERY_SCOPE_REQUIRED',
  'GITHUB_TOKEN_UNAVAILABLE',
  'PROCESS_FAILED',
  'PROCESS_TIMEOUT',
]);

function checkpointRank(checkpoint) {
  return ({ initialized: 0, exported: 1, converted: 2, 'ready-to-publish': 3, 'repository-ready': 4, 'snapshot-published': 5, delivered: 6 })[checkpoint] ?? -1;
}

function canRetryPublish(report, error) {
  if (!report?.githubRepository || !report?.paths?.repositoryDir) return false;
  if (checkpointRank(report.checkpoint) < checkpointRank('ready-to-publish')) return false;
  if (error?.code === 'MIGRATION_CANCELLED') return false;
  return RETRYABLE_PUBLISH_CODES.has(error?.code) || checkpointRank(report.checkpoint) >= checkpointRank('repository-ready');
}

function recoveryFromReport(report, retryable = false) {
  return {
    canRetryPublish: Boolean(retryable),
    checkpoint: report?.checkpoint || null,
    jobRoot: report?.paths?.jobRoot || null,
    repositoryDir: report?.paths?.repositoryDir || null,
    previewDir: report?.paths?.previewDir || report?.build?.preview?.directory || null,
    repositoryUrl: report?.githubRepository?.htmlUrl || report?.github?.url || null,
    repositoryFullName: report?.githubRepository?.fullName || report?.github?.fullName || null,
    snapshotPublished: Boolean(report?.snapshot?.sha),
    buildPassed: report?.build?.status === 'passed',
  };
}

function publishPlanFor(report, repository, timestamp) {
  if (report.publishPlan?.branch) return report.publishPlan;
  const defaultBranch = repository.default_branch || 'main';
  const repositoryEvolved = ['github-newer', 'both-changed'].includes(report.sourceStatusBeforePublish?.status);
  const standaloneMode = report.options?.deliveryMode === 'standalone-supabase';
  if (repositoryEvolved && standaloneMode) {
    return {
      strategy: 'pull-request',
      branch: `bridge/base44-refresh-${timestamp}`,
      base: defaultBranch,
      force: false,
      commitMessage: 'Atualização Base44 convertida para Supabase — revisão necessária',
    };
  }
  return {
    strategy: 'direct-main',
    branch: defaultBranch,
    base: defaultBranch,
    force: Boolean(report.githubRepository?.reused),
    commitMessage: standaloneMode
      ? 'Entrega independente Supabase gerada pelo RB Project Bridge'
      : (report.options?.commitMessage || `Snapshot ${report.project?.name || 'Base44'}`),
  };
}

class MigrationService {
  constructor({ base44, github, security, build, standalone, archive, reports, logger, emit }) {
    Object.assign(this, { base44, github, security, build, standalone, archive, reports, logger, emit });
    this.running = false;
    this.controller = null;
  }

  cancel() {
    if (!this.running || !this.controller) return { cancelled: false, message: 'Nenhuma operação em andamento.' };
    this.controller.abort();
    this.emit('migration:progress', { step: 'job', status: 'failed', message: 'Cancelamento solicitado...' });
    return { cancelled: true };
  }

  assertActive(signal) {
    if (signal.aborted) throw new BridgeError('MIGRATION_CANCELLED', 'A operação foi cancelada.');
  }

  checkpoint(report, value, message) {
    report.checkpoint = value;
    if (message) report.notes.push(message);
  }

  async persistReport(report, directories = []) {
    for (const directory of [...new Set(directories.filter(Boolean))]) {
      await this.reports.writeReport(directory, report).catch(() => null);
    }
  }

  async migrate(input) {
    if (this.running) throw new BridgeError('MIGRATION_ALREADY_RUNNING', 'Já existe uma operação em andamento.');
    this.running = true;
    this.controller = new AbortController();
    const { signal } = this.controller;
    const jobId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const slug = safeSlug(input.project.name);
    const timestamp = startedAt.replace(/[:.]/g, '-');
    const jobRoot = path.join(input.outputDirectory, `${slug}-${timestamp}`);
    const originalDir = path.join(jobRoot, 'source-backup');
    const snapshotDir = path.join(jobRoot, 'base44-snapshot');
    const repositoryDir = path.join(jobRoot, 'repository');
    const previewDir = path.join(jobRoot, 'preview');
    const backupPath = path.join(jobRoot, `${slug}-base44-source.zip`);
    const standaloneMode = input.deliveryMode ? input.deliveryMode !== 'snapshot' : Boolean(this.standalone);
    const report = {
      schemaVersion: 3,
      jobId,
      status: 'running',
      checkpoint: 'initialized',
      startedAt,
      project: { id: input.project.id, name: input.project.name, updatedAt: input.project.updatedAt || null },
      options: {
        deliveryMode: standaloneMode ? 'standalone-supabase' : 'snapshot',
        buildValidation: standaloneMode ? true : Boolean(input.buildValidation),
        visibility: 'private',
        repositoryStrategy: input.repository.strategy || 'reuse-or-create',
        commitMessage: input.repository.commitMessage || '',
      },
      notes: [],
    };

    await ensureEmptyDir(jobRoot);
    report.paths = { jobRoot, originalDir, snapshotDir, repositoryDir, previewDir: null, backupPath };
    this.logger.info('migration.start', { jobId, projectId: input.project.id, jobRoot, standaloneMode });
    this.emit('migration:progress', { step: 'job', status: 'running', message: `Operação ${jobId.slice(0, 8)} iniciada.` });

    try {
      try {
        report.export = await this.base44.exportProject(input.project, originalDir, { signal });
      } catch (error) {
        if (!['BASE44_EXPORT_FAILED', 'BASE44_NETWORK_FAILED'].includes(error?.code)) throw error;
        this.emit('migration:progress', { step: 'base44-export', status: 'running', message: 'Base44 indisponível. Procurando o último snapshot válido no GitHub...' });
        const fallback = await this.github.cloneBase44Source({ owner: input.repository.owner, name: input.repository.name, destination: originalDir }, { signal });
        if (!fallback) throw error;
        report.export = fallback;
        report.notes.push(`A Base44 não respondeu. Foi usado o snapshot ${fallback.repository}:${fallback.branch}@${fallback.sha.slice(0, 7)}.`);
      }
      this.checkpoint(report, 'exported');
      this.assertActive(signal);

      report.exportTree = await this.security.validateExportTree(originalDir, {}, signal);
      if (!report.exportTree.valid) throw new BridgeError('UNSAFE_EXPORT_TREE', 'A exportação contém links simbólicos ou arquivos não suportados.', { prohibited: report.exportTree.prohibited });
      report.backup = await this.archive.createZip(originalDir, backupPath);
      this.assertActive(signal);

      await copyDirectory(originalDir, snapshotDir);
      report.snapshotSanitization = await this.security.sanitize(snapshotDir, signal);
      report.sanitization = report.snapshotSanitization;
      report.snapshotSecurity = await this.security.scan(snapshotDir, signal);
      if (report.snapshotSecurity.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED', 'O snapshot contém possíveis segredos.', { findings: report.snapshotSecurity.blocking });

      report.sourceManifest = {
        schemaVersion: 2,
        projectId: input.project.id,
        projectName: input.project.name,
        base44UpdatedAt: input.project.updatedAt || null,
        exportedAt: new Date().toISOString(),
        snapshotPublishedAt: null,
        deliveredAt: null,
        source: report.export.source || 'base44',
        fallbackRepository: report.export.repository || null,
        fallbackBranch: report.export.branch || null,
        fallbackSha: report.export.sha || null,
      };
      await writeJson(path.join(snapshotDir, 'RB-BRIDGE-SOURCE.json'), report.sourceManifest);
      await copyDirectory(snapshotDir, repositoryDir);
      report.base44Analysis = await this.security.analyzeBase44Dependencies(repositoryDir, signal);
      if (standaloneMode) report.standalone = await this.standalone.transform(repositoryDir, { projectName: input.project.name, signal });
      report.security = await this.security.scan(repositoryDir, signal);
      if (report.security.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED', 'A publicação foi bloqueada porque possíveis segredos foram detectados.', { findings: report.security.blocking });
      if (standaloneMode) report.standaloneGate = await this.standalone.verify(repositoryDir);
      this.checkpoint(report, 'converted');

      await this.github.ensureDirectoryScopes(repositoryDir, { signal });
      this.assertActive(signal);

      report.inspection = await this.build.inspect(repositoryDir);
      if (!report.inspection.valid) throw new BridgeError('PROJECT_STRUCTURE_INVALID', 'O projeto não passou na validação estrutural.', { issues: report.inspection.issues });
      report.build = await this.build.validateBuild(repositoryDir, {
        consent: standaloneMode || Boolean(input.buildValidation),
        buildScript: standaloneMode ? 'build:demo' : null,
        previewDestination: standaloneMode ? previewDir : null,
        syncLockfile: standaloneMode,
      }, signal);
      if (report.build.status !== 'passed' && standaloneMode) throw new BridgeError('BUILD_VALIDATION_FAILED', 'O build local independente falhou.', { build: report.build });
      if (standaloneMode) {
        report.standaloneGateAfterBuild = await this.standalone.verify(repositoryDir);
        report.securityAfterBuild = await this.security.scan(repositoryDir, signal);
        if (report.securityAfterBuild.blocking.length) throw new BridgeError('SECURITY_SCAN_BLOCKED', 'O lockfile ou build gerou conteúdo sensível.', { findings: report.securityAfterBuild.blocking });
      }

      report.paths.previewDir = report.build.preview?.directory || null;
      this.checkpoint(report, 'ready-to-publish');
      const prePublishReport = { ...report, status: 'ready-to-publish', finishedAt: new Date().toISOString() };
      await this.reports.writeReport(repositoryDir, prePublishReport);
      await this.reports.writeReport(jobRoot, prePublishReport);
      this.assertActive(signal);

      report.sourceStatusBeforePublish = await this.github.inspectSourceStatus({ owner: input.repository.owner, name: input.repository.name, project: input.project }).catch(() => null);
      const resolved = await this.github.resolveRepository({ ...input.repository, visibility: 'private' }, { signal });
      const repository = resolved.repository;
      const defaultBranch = repository.default_branch || 'main';
      report.githubRepository = {
        fullName: repository.full_name,
        cloneUrl: repository.clone_url,
        htmlUrl: repository.html_url,
        owner: repository.owner,
        private: repository.private,
        reused: resolved.reused,
        defaultBranch,
      };
      if (repository.private === false) throw new BridgeError('REPOSITORY_NOT_PRIVATE', 'A entrega foi interrompida porque o repositório não está privado.');
      this.checkpoint(report, 'repository-ready');

      if (resolved.reused) {
        report.previousDefaultBranch = await this.github.preserveBranch(repository, defaultBranch, { prefix: `${defaultBranch}-before-standalone`, signal });
        report.previousSnapshotBranch = await this.github.preserveBranch(repository, 'base44-source', { prefix: 'base44-source-before-refresh', signal });
        if (!report.previousDefaultBranch) throw new BridgeError('REPOSITORY_BACKUP_FAILED', `Não foi possível preservar a branch ${defaultBranch} antes da atualização.`);
      }

      report.publishPlan = publishPlanFor(report, repository, timestamp);
      report.sourceManifest.snapshotPublishedAt = new Date().toISOString();
      await writeJson(path.join(snapshotDir, 'RB-BRIDGE-SOURCE.json'), report.sourceManifest);
      await writeJson(path.join(repositoryDir, 'RB-BRIDGE-SOURCE.json'), report.sourceManifest);
      report.snapshot = await this.github.publish({
        directory: snapshotDir,
        repository,
        commitMessage: 'Snapshot sanitizado da exportação Base44',
        signal,
        branch: 'base44-source',
        force: resolved.reused,
      });
      this.checkpoint(report, 'snapshot-published');
      await this.persistReport(report, [jobRoot, repositoryDir]);

      report.sourceManifest.deliveredAt = new Date().toISOString();
      await writeJson(path.join(repositoryDir, 'RB-BRIDGE-SOURCE.json'), report.sourceManifest);
      report.github = await this.github.publish({
        directory: repositoryDir,
        repository,
        commitMessage: report.publishPlan.commitMessage,
        signal,
        branch: report.publishPlan.branch,
        force: report.publishPlan.force,
      });

      if (report.publishPlan.strategy === 'pull-request') {
        report.pullRequest = await this.github.createPullRequest(repository, {
          head: report.publishPlan.branch,
          base: report.publishPlan.base,
          title: `Revisar atualização Base44 — ${input.project.name}`,
          body: `O RB Project Bridge detectou alterações posteriores no GitHub e não substituiu a branch ${defaultBranch}.\n\n- Base44 atualizada: ${input.project.updatedAt || 'data indisponível'}\n- Último commit GitHub: ${report.sourceStatusBeforePublish?.latestCommitAt || 'data indisponível'}\n- Backup criado: ${report.previousDefaultBranch?.backupBranch || 'não informado'}\n\nRevise e faça o merge somente após validar o preview local.`,
        }, { signal });
        report.github.url = report.pullRequest.url;
      }
      report.deliveryStrategy = report.publishPlan.strategy;
      this.checkpoint(report, 'delivered');
      report.status = 'completed';
      report.finishedAt = new Date().toISOString();
      report.reportFiles = await this.reports.writeReport(repositoryDir, report);
      await this.reports.writeReport(jobRoot, report);
      await this.reports.appendHistory({
        jobId,
        status: report.status,
        checkpoint: report.checkpoint,
        startedAt,
        finishedAt: report.finishedAt,
        project: report.project,
        github: report.github,
        jobRoot,
        previewDir: report.paths.previewDir,
      });
      this.emit('migration:progress', {
        step: 'job',
        status: 'complete',
        message: report.deliveryStrategy === 'pull-request'
          ? `Atualização preparada no PR #${report.pullRequest.number}; a branch principal não foi sobrescrita.`
          : resolved.reused
            ? `Entrega independente concluída em ${repository.full_name}; histórico preservado.`
            : 'Entrega independente concluída: Supabase, build local, preview e GitHub privado.',
      });
      return report;
    } catch (error) {
      let bridgeError = asBridgeError(error, 'MIGRATION_FAILED');
      if (signal.aborted || bridgeError.code === 'PROCESS_ABORTED') bridgeError = new BridgeError('MIGRATION_CANCELLED', 'A operação foi cancelada.');
      const retryable = canRetryPublish(report, bridgeError);
      report.status = bridgeError.code === 'MIGRATION_CANCELLED' ? 'cancelled' : retryable ? 'partial' : 'failed';
      report.finishedAt = new Date().toISOString();
      const recovery = recoveryFromReport(report, retryable);
      bridgeError.details = { ...(bridgeError.details || {}), jobRoot, githubRepository: report.githubRepository, recovery };
      report.error = { code: bridgeError.code, message: bridgeError.message, details: bridgeError.details };
      await this.persistReport(report, [jobRoot, checkpointRank(report.checkpoint) >= checkpointRank('ready-to-publish') ? repositoryDir : null]);
      await this.reports.appendHistory({
        jobId,
        status: report.status,
        checkpoint: report.checkpoint,
        startedAt,
        finishedAt: report.finishedAt,
        project: report.project,
        githubRepository: report.githubRepository,
        error: report.error,
        recovery,
        jobRoot,
        previewDir: recovery.previewDir,
      }).catch(() => null);
      this.emit('migration:progress', { step: 'job', status: retryable ? 'partial' : 'failed', message: bridgeError.message, code: bridgeError.code, recovery });
      throw bridgeError;
    } finally {
      this.running = false;
      this.controller = null;
    }
  }

  async retryPublish(jobRoot) {
    if (this.running) throw new BridgeError('MIGRATION_ALREADY_RUNNING', 'Já existe uma operação em andamento.');
    this.running = true;
    this.controller = new AbortController();
    const { signal } = this.controller;
    const resolvedJobRoot = path.resolve(jobRoot);
    let report;
    try {
      report = await readJson(path.join(resolvedJobRoot, 'RB-BRIDGE-REPORT.json'));
      if (!report?.githubRepository || !report?.paths?.repositoryDir) throw new BridgeError('RETRY_NOT_AVAILABLE', 'Não há uma publicação preparada para continuar.');
      const repositoryDir = path.resolve(report.paths.repositoryDir);
      if (repositoryDir !== resolvedJobRoot && !repositoryDir.startsWith(`${resolvedJobRoot}${path.sep}`)) throw new BridgeError('UNSAFE_RETRY_PATH', 'O relatório aponta para fora da pasta da operação.');
      await fs.stat(repositoryDir).catch(() => { throw new BridgeError('RETRY_FILES_MISSING', 'A pasta preparada para publicação não existe mais.'); });

      const repository = {
        full_name: report.githubRepository.fullName,
        clone_url: report.githubRepository.cloneUrl,
        html_url: report.githubRepository.htmlUrl,
        owner: report.githubRepository.owner,
        default_branch: report.githubRepository.defaultBranch || 'main',
      };
      this.emit('migration:progress', { step: 'job', status: 'running', message: 'Retomando do ponto salvo; exportação, conversão e build não serão repetidos.' });
      await this.github.ensureDirectoryScopes(repositoryDir, { signal });

      const timestamp = String(report.startedAt || new Date().toISOString()).replace(/[:.]/g, '-');
      report.publishPlan = publishPlanFor(report, repository, timestamp);
      if (!report.snapshot?.sha && report.paths?.snapshotDir) {
        const snapshotDir = path.resolve(report.paths.snapshotDir);
        await fs.stat(snapshotDir).catch(() => { throw new BridgeError('RETRY_SNAPSHOT_MISSING', 'O snapshot preparado não existe mais.'); });
        report.sourceManifest = report.sourceManifest || await readJson(path.join(snapshotDir, 'RB-BRIDGE-SOURCE.json'), {});
        report.sourceManifest.snapshotPublishedAt = new Date().toISOString();
        await writeJson(path.join(snapshotDir, 'RB-BRIDGE-SOURCE.json'), report.sourceManifest);
        report.snapshot = await this.github.publish({
          directory: snapshotDir,
          repository,
          commitMessage: 'Snapshot sanitizado da exportação Base44',
          signal,
          branch: 'base44-source',
          force: Boolean(report.githubRepository.reused),
        });
        report.checkpoint = 'snapshot-published';
      }

      report.sourceManifest = report.sourceManifest || await readJson(path.join(repositoryDir, 'RB-BRIDGE-SOURCE.json'), {});
      report.sourceManifest.deliveredAt = new Date().toISOString();
      await writeJson(path.join(repositoryDir, 'RB-BRIDGE-SOURCE.json'), report.sourceManifest);
      report.github = await this.github.publish({
        directory: repositoryDir,
        repository,
        commitMessage: report.publishPlan.commitMessage,
        signal,
        branch: report.publishPlan.branch,
        force: report.publishPlan.force,
      });
      if (report.publishPlan.strategy === 'pull-request' && !report.pullRequest) {
        report.pullRequest = await this.github.createPullRequest(repository, {
          head: report.publishPlan.branch,
          base: report.publishPlan.base,
          title: `Revisar atualização Base44 — ${report.project?.name || 'produto'}`,
          body: 'Entrega retomada pelo RB Project Bridge a partir do checkpoint local validado. Revise o preview antes do merge.',
        }, { signal });
        report.github.url = report.pullRequest.url;
      }
      report.deliveryStrategy = report.publishPlan.strategy;
      report.checkpoint = 'delivered';
      report.status = 'completed';
      report.finishedAt = new Date().toISOString();
      delete report.error;
      await this.reports.writeReport(repositoryDir, report);
      await this.reports.writeReport(resolvedJobRoot, report);
      await this.reports.appendHistory({
        jobId: report.jobId,
        status: 'completed',
        checkpoint: report.checkpoint,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        project: report.project,
        github: report.github,
        jobRoot: resolvedJobRoot,
        previewDir: report.paths?.previewDir,
        resumed: true,
      });
      this.emit('migration:progress', { step: 'job', status: 'complete', message: 'Entrega retomada e concluída sem repetir as etapas já validadas.' });
      return report;
    } catch (error) {
      const bridgeError = asBridgeError(error, 'RETRY_PUBLISH_FAILED');
      if (report) {
        report.status = 'partial';
        report.finishedAt = new Date().toISOString();
        const recovery = recoveryFromReport(report, true);
        bridgeError.details = { ...(bridgeError.details || {}), recovery };
        report.error = { code: bridgeError.code, message: bridgeError.message, details: bridgeError.details };
        await this.persistReport(report, [resolvedJobRoot, report.paths?.repositoryDir]);
      }
      this.emit('migration:progress', { step: 'job', status: 'partial', message: bridgeError.message, code: bridgeError.code, recovery: bridgeError.details?.recovery });
      throw bridgeError;
    } finally {
      this.running = false;
      this.controller = null;
    }
  }
}

module.exports = {
  MigrationService,
  RETRYABLE_PUBLISH_CODES,
  checkpointRank,
  canRetryPublish,
  recoveryFromReport,
  publishPlanFor,
};
