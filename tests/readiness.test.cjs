'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessMigrationReadiness, readinessMarkdown } = require('../electron/services/readiness-service.cjs');

function baseReport() {
  return {
    backup: { sha256: 'abc' },
    standaloneGateAfterBuild: { passed: true },
    standalone: { blockers: ['Converter função de pagamento'] },
    build: {
      status: 'passed',
      runtime: { passed: true },
      compatibility: {
        workspace: { prepared: true },
        converted: [{ method: 'list' }],
        bridged: [{ method: 'invoke' }],
        emulated: [{ method: 'logUserInApp' }],
        unsupported: [],
      },
    },
  };
}

test('classifies a runnable app with local workspace and production blockers', () => {
  const readiness = assessMigrationReadiness(baseReport());
  assert.equal(readiness.score, 85);
  assert.equal(readiness.level, 'workspace-prepared');
  assert.equal(readiness.recommendedPackage, 'Workspace');
  assert.equal(readiness.stages.sandbox.status, 'passed');
  assert.equal(readiness.stages.workspace.status, 'prepared');
  assert.equal(readiness.stages.production.status, 'blocked');
  assert.equal(readiness.runtimeContracts.emulated, 1);
  assert.match(readinessMarkdown(readiness), /Workspace evolutivo/);
});

test('classifies a fully converted app as production candidate', () => {
  const report = baseReport();
  report.standalone.blockers = [];
  report.build.compatibility.emulated = [];
  const readiness = assessMigrationReadiness(report);
  assert.equal(readiness.score, 100);
  assert.equal(readiness.level, 'production-candidate');
  assert.equal(readiness.recommendedPackage, 'Migração completa');
  assert.equal(readiness.stages.production.status, 'candidate');
});

test('does not call a compiled but broken bundle an executable sandbox', () => {
  const report = baseReport();
  report.build.runtime.passed = false;
  const readiness = assessMigrationReadiness(report);
  assert.notEqual(readiness.level, 'sandbox-ready');
  assert.equal(readiness.stages.sandbox.status, 'blocked');
  assert.ok(readiness.nextActions.some((item) => item.includes('Chromium')));
});
