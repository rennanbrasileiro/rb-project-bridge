'use strict';

const path = require('node:path');
const { readJson } = require('../core/fs-utils.cjs');
const { BridgeError } = require('../core/errors.cjs');
const { MigrationService } = require('../services/migration-service.cjs');
const { publicationBlockers } = require('../services/verification-ledger-service.cjs');

const PATCH_FLAG = Symbol.for('rb.bridge.verification.integrity.patch');

async function assertCurrentVerification(jobRoot) {
  const resolvedJobRoot = path.resolve(String(jobRoot || ''));
  const report = await readJson(path.join(resolvedJobRoot, 'RB-BRIDGE-REPORT.json'), null);
  if (!report) throw new BridgeError('OPERATION_REPORT_NOT_FOUND', 'O relatório da operação não foi encontrado para verificar a publicação.');
  const blockers = publicationBlockers(report);
  if (blockers.length) {
    throw new BridgeError(
      'CURRENT_VERIFICATION_FAILED',
      'A publicação foi bloqueada porque a evidência técnica mais recente está reprovada. Corrija e execute um novo reteste antes de continuar.',
      {
        blockers,
        jobRoot: resolvedJobRoot,
        latestVerifications: report.latestVerifications || null,
        recovery: {
          canRetryPublish: false,
          jobRoot: resolvedJobRoot,
          repositoryDir: report.paths?.repositoryDir || null,
          previewDir: report.paths?.previewDir || null,
          repositoryUrl: report.githubRepository?.htmlUrl || report.github?.url || null,
          repositoryFullName: report.githubRepository?.fullName || report.github?.fullName || null,
        },
      },
    );
  }
  return report;
}

if (!MigrationService.prototype[PATCH_FLAG]) {
  const originalRetryPublish = MigrationService.prototype.retryPublish;
  MigrationService.prototype.retryPublish = async function retryPublishWithVerificationIntegrity(jobRoot) {
    await assertCurrentVerification(jobRoot);
    return originalRetryPublish.call(this, jobRoot);
  };
  Object.defineProperty(MigrationService.prototype, PATCH_FLAG, { value: true, enumerable: false });
}

module.exports = { assertCurrentVerification };
