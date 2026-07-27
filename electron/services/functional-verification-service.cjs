'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BridgeError, asBridgeError } = require('../core/errors.cjs');
const { readJson } = require('../core/fs-utils.cjs');
const { appendVerification } = require('./verification-ledger-service.cjs');
const { createDefect, openDefects, resolveGateDefects } = require('./defect-service.cjs');

function npmCommand() { return process.platform === 'win32' ? 'npm.cmd' : 'npm'; }
function severityFor(stepId) {
  if (['migrations', 'login', 'profiles', 'rls-anonymous', 'rls-other-user'].includes(stepId)) return 'critical';
  if (String(stepId).startsWith('crud-')) return 'high';
  return 'medium';
}
function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env || process.env, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const limit = 2 * 1024 * 1024;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new BridgeError('FUNCTIONAL_VERIFICATION_TIMEOUT', 'Os testes funcionais excederam o limite de execução.'));
    }, options.timeout || 12 * 60 * 1000);
    child.stdout.on('data', (chunk) => { const text = chunk.toString(); stdout = (stdout + text).slice(-limit); options.onOutput?.(text); });
    child.stderr.on('data', (chunk) => { const text = chunk.toString(); stderr = (stderr + text).slice(-limit); options.onOutput?.(text); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

class FunctionalVerificationService {
  constructor({ reports, logger, emit }) {
    Object.assign(this, { reports, logger, emit });
    this.running = false;
    this.child = null;
  }

  cancel() {
    if (!this.running || !this.child) return { cancelled: false };
    this.child.kill('SIGTERM');
    return { cancelled: true };
  }

  async persist(report, root, repositoryDir) {
    await this.reports.writeReport(repositoryDir, report, { skipArchive: true });
    await this.reports.writeReport(root, report, { skipArchive: true });
  }

  async verify(jobRoot) {
    if (this.running) throw new BridgeError('FUNCTIONAL_VERIFICATION_RUNNING', 'Já existe uma verificação funcional em andamento.');
    const root = path.resolve(String(jobRoot || ''));
    const report = await readJson(path.join(root, 'RB-BRIDGE-REPORT.json'), null);
    if (!report?.paths?.repositoryDir) throw new BridgeError('OPERATION_REPORT_NOT_FOUND', 'A operação não possui workspace para testes funcionais.');
    const repositoryDir = path.resolve(report.paths.repositoryDir);
    if (repositoryDir !== root && !repositoryDir.startsWith(`${root}${path.sep}`)) throw new BridgeError('UNSAFE_OPERATION_PATH', 'O workspace está fora da pasta segura da operação.');
    const packageJson = await readJson(path.join(repositoryDir, 'package.json'), null);
    if (!packageJson?.scripts?.['rb:verify']) throw new BridgeError('FUNCTIONAL_VERIFIER_NOT_PREPARED', 'Este workspace ainda não possui o comando rb:verify. Reconstrua o preview com a versão atual do Bridge.');
    const resultPath = path.join(repositoryDir, 'RB-FUNCTIONAL-VERIFICATION.json');
    await fs.rm(resultPath, { force: true }).catch(() => null);
    const startedAt = new Date().toISOString();
    this.running = true;
    this.emit('migration:progress', { step: 'workspace', status: 'running', message: 'Iniciando Supabase local e testando migrations, autenticação, CRUD e RLS...' });
    this.logger?.info('functional.verification.start', { jobRoot: root, repositoryDir });

    try {
      const processResult = await runProcess(npmCommand(), ['run', 'rb:verify'], {
        cwd: repositoryDir,
        timeout: 12 * 60 * 1000,
        onOutput: (text) => this.emit('build:output', { text }),
      });
      const result = await readJson(resultPath, null);
      if (!result) throw new BridgeError('FUNCTIONAL_VERIFICATION_RESULT_MISSING', 'O verificador terminou sem gerar RB-FUNCTIONAL-VERIFICATION.json.', { processResult });
      const overallPassed = processResult.code === 0 && result.status === 'passed';
      const finishedAt = result.finishedAt || new Date().toISOString();
      report.workspaceValidation = {
        passed: overallPassed,
        status: overallPassed ? 'passed' : 'failed',
        startedAt: result.startedAt || startedAt,
        validatedAt: finishedAt,
        source: 'rb:verify',
        result,
      };
      appendVerification(report, {
        gate: 'workspace',
        status: overallPassed ? 'passed' : 'failed',
        source: 'functional-verification',
        executor: 'automation',
        startedAt,
        finishedAt,
        summary: overallPassed ? 'Workspace funcional aprovado: Supabase, autenticação, CRUD e RLS.' : 'Workspace funcional reprovado.',
        evidence: result.steps?.filter((step) => step.status === 'passed').map((step) => `${step.id}: ${step.detail || step.label}`),
        errors: result.steps?.filter((step) => step.status === 'failed').map((step) => `${step.id}: ${step.detail}`),
        artifacts: { resultPath },
      });
      for (const step of result.steps || []) {
        const gate = `workspace:${step.id}`;
        appendVerification(report, {
          gate,
          status: step.status === 'passed' ? 'passed' : 'failed',
          source: 'functional-verification',
          executor: 'automation',
          startedAt: step.startedAt || startedAt,
          finishedAt: step.finishedAt || finishedAt,
          summary: step.label,
          evidence: step.status === 'passed' ? [step.detail] : [],
          errors: step.status === 'failed' ? [step.detail] : [],
          artifacts: { resultPath },
        });
        if (step.status === 'passed') {
          resolveGateDefects(report, gate, { evidence: step.detail, notes: 'Resolvido por verificação automática.', executor: 'automation' });
        } else if (!openDefects(report, { gate }).length) {
          createDefect(report, {
            gate,
            title: `${step.label} falhou`,
            severity: severityFor(step.id),
            expected: `${step.label} deve concluir com sucesso no ambiente Supabase local limpo.`,
            observed: step.detail || result.error?.message || 'O teste funcional falhou.',
            reproductionSteps: 'Na operação, executar “Testar banco, login e CRUD”.',
            evidence: resultPath,
            owner: report.options?.deliveryOwner || null,
          });
        }
      }
      if (overallPassed) resolveGateDefects(report, 'workspace', { evidence: resultPath, notes: 'Workspace aprovado pelo verificador automático.', executor: 'automation' });
      else if (!openDefects(report, { gate: 'workspace' }).length) {
        createDefect(report, {
          gate: 'workspace',
          title: 'Workspace funcional reprovado',
          severity: 'critical',
          expected: 'Supabase local, migrations, login, profiles, CRUD e RLS devem ser aprovados.',
          observed: result.error?.message || 'Um ou mais testes funcionais falharam.',
          reproductionSteps: 'Executar o verificador funcional pelo Bridge.',
          evidence: resultPath,
          owner: report.options?.deliveryOwner || null,
        });
      }
      report.packageState = { ...(report.packageState || {}), dirty: true, lastValidationAt: finishedAt };
      await this.persist(report, root, repositoryDir);
      await this.reports.appendHistory({
        jobId: report.jobId,
        status: overallPassed ? 'completed' : 'failed',
        checkpoint: report.checkpoint,
        startedAt: report.startedAt,
        finishedAt,
        project: report.project,
        github: report.github,
        githubRepository: report.githubRepository,
        jobRoot: root,
        previewDir: report.paths?.previewDir,
        functionalVerification: overallPassed ? 'passed' : 'failed',
      }).catch(() => null);
      this.emit('migration:progress', { step: 'workspace', status: overallPassed ? 'complete' : 'failed', message: overallPassed ? 'Banco, login, profiles, CRUD e RLS aprovados.' : 'Os testes funcionais identificaram defeitos que precisam de correção.' });
      this.logger?.info('functional.verification.complete', { jobRoot: root, status: result.status, steps: result.steps?.length || 0 });
      if (!overallPassed) throw new BridgeError('FUNCTIONAL_VERIFICATION_FAILED', 'O workspace não passou nos testes funcionais. Consulte os defeitos e o resultado gerado.', { result, resultPath });
      return report;
    } catch (error) {
      const bridgeError = asBridgeError(error, 'FUNCTIONAL_VERIFICATION_FAILED');
      this.emit('migration:progress', { step: 'workspace', status: 'failed', message: bridgeError.message, code: bridgeError.code });
      throw bridgeError;
    } finally {
      this.running = false;
      this.child = null;
    }
  }
}

module.exports = { FunctionalVerificationService, runProcess, severityFor };
