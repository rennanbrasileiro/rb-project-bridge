'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessMigrationReadiness, readinessMarkdown } = require('../electron/services/readiness-service.cjs');

function baseReport() {
  return {
    options: { deliveryPackage: 'workspace', targetProfile: 'supabase-cloud-static', migrationScope: {} },
    backup: { sha256: 'abc' },
    standaloneGateAfterBuild: { passed: true },
    standalone: { blockers: ['Converter função de pagamento'] },
    build: {
      status: 'passed',
      runtime: { passed: true },
      compatibility: { workspace: { prepared: true }, converted: [{ method: 'list' }], bridged: [{ method: 'invoke' }], emulated: [{ method: 'logUserInApp' }], unsupported: [] },
    },
  };
}

test('classifies a runnable app with a prepared but not yet accepted local workspace', () => {
  const report = baseReport();
  let readiness = assessMigrationReadiness(report);
  assert.equal(readiness.score, 85);
  assert.equal(readiness.level, 'workspace-prepared');
  assert.equal(readiness.recommendedPackage, 'Workspace');
  assert.equal(readiness.contractedPackagePassed, false);
  assert.equal(readiness.stages.sandbox.status, 'passed');
  assert.equal(readiness.stages.workspace.status, 'prepared');
  assert.equal(readiness.stages.production.status, 'blocked');
  assert.equal(readiness.runtimeContracts.emulated, 1);
  assert.match(readinessMarkdown(readiness), /Workspace evolutivo/);
  report.workspaceValidation = { passed: true };
  readiness = assessMigrationReadiness(report);
  assert.equal(readiness.contractedPackagePassed, true);
  assert.equal(readiness.stages.workspace.status, 'passed');
});

test('requires explicit backend, scope and production evidence before production candidate', () => {
  const report = baseReport();
  report.options = { deliveryPackage: 'production', targetProfile: 'supabase-cloud-static', migrationScope: { data: true, users: true, storage: true, integrations: true, deployment: true } };
  report.standalone.blockers = [];
  report.build.compatibility.emulated = [];
  let readiness = assessMigrationReadiness(report);
  assert.equal(readiness.level, 'workspace-prepared');
  assert.equal(readiness.contractedPackagePassed, false);
  assert.ok(readiness.nextActions.some((item) => /dados históricos/i.test(item)));
  report.backendValidation = { passed: true };
  report.dataMigrationValidation = { passed: true };
  report.userMigrationValidation = { passed: true };
  report.storageMigrationValidation = { passed: true };
  report.deploymentValidation = { passed: true };
  report.productionValidation = { passed: true };
  readiness = assessMigrationReadiness(report);
  assert.equal(readiness.score, 100);
  assert.equal(readiness.level, 'production-candidate');
  assert.equal(readiness.contractedPackagePassed, true);
  assert.equal(readiness.stages.production.status, 'candidate');
});

test('does not call a compiled but broken bundle an executable sandbox', () => {
  const report = baseReport(); report.build.runtime.passed = false;
  const readiness = assessMigrationReadiness(report);
  assert.notEqual(readiness.level, 'sandbox-ready');
  assert.equal(readiness.stages.sandbox.status, 'blocked');
  assert.ok(readiness.nextActions.some((item) => item.includes('Chromium')));
});

test('states that AWS is only an architecture blueprint', () => {
  const report = baseReport(); report.options.targetProfile = 'aws-custom';
  const readiness = assessMigrationReadiness(report);
  assert.ok(readiness.nextActions.some((item) => /AWS/.test(item) && /blueprint/.test(item)));
});
