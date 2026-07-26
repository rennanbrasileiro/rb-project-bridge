'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('../core/process-runner.cjs');
const { BridgeError } = require('../core/errors.cjs');
const { pathExists, readJson, copyDirectory } = require('../core/fs-utils.cjs');

class BuildService {
  constructor({ logger, emit }) {
    this.logger = logger;
    this.emit = emit;
  }

  async inspect(root) {
    const packagePath = path.join(root, 'package.json');
    const packageJson = await readJson(packagePath);
    const issues = [];
    if (!packageJson) issues.push({ severity: 'high', code: 'PACKAGE_JSON_MISSING', message: 'package.json was not found or is invalid.' });
    if (packageJson && !packageJson.scripts?.build) issues.push({ severity: 'medium', code: 'BUILD_SCRIPT_MISSING', message: 'No build script is defined.' });
    const sourceCandidates = ['src', 'app', 'pages'];
    const hasSource = (await Promise.all(sourceCandidates.map((item) => pathExists(path.join(root, item))))).some(Boolean);
    if (!hasSource) issues.push({ severity: 'medium', code: 'SOURCE_DIRECTORY_MISSING', message: 'No standard source directory was detected.' });
    return {
      valid: !issues.some((item) => item.severity === 'high'),
      issues,
      packageManager: await pathExists(path.join(root, 'package-lock.json')) ? 'npm' :
        await pathExists(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' :
        await pathExists(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm',
      packageJson: packageJson ? { name: packageJson.name, scripts: packageJson.scripts || {}, dependencies: Object.keys(packageJson.dependencies || {}).length } : null,
    };
  }

  resolveNpmCli() {
    try { return path.join(path.dirname(require.resolve('npm/package.json')), 'bin', 'npm-cli.js'); }
    catch (error) { throw new BridgeError('NPM_RUNTIME_MISSING', 'The bundled npm runtime is unavailable.', { cause: error.message }); }
  }

  async validateBuild(root, consentToExecute, signal) {
    const inspection = await this.inspect(root);
    if (!inspection.valid) return { status: 'failed', inspection, install: null, build: null };
    if (!consentToExecute) return { status: 'skipped', inspection, reason: 'Project code execution was not authorized.' };

    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-project-bridge-build-'));
    const sandboxProject = path.join(sandboxRoot, 'project');
    try {
      await copyDirectory(root, sandboxProject);
      this.emit('migration:progress', { step: 'build', status: 'running', message: 'Installing dependencies in an isolated validation copy...' });
      const npmCli = this.resolveNpmCli();
      const output = (entry) => this.emit('build:output', entry);
      const common = {
        cwd: sandboxProject,
        signal,
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          npm_config_audit: 'false',
          npm_config_fund: 'false',
          npm_config_ignore_scripts: 'true',
        },
        onOutput: output,
      };
      const hasLockfile = await pathExists(path.join(sandboxProject, 'package-lock.json'));
      const installCommand = hasLockfile ? 'ci' : 'install';
      const install = await runProcess(process.execPath, [npmCli, installCommand, '--ignore-scripts', '--no-audit', '--no-fund'], {
        ...common,
        timeoutMs: 20 * 60 * 1000,
      });
      let build = null;
      if (inspection.packageJson?.scripts?.build) {
        this.emit('migration:progress', { step: 'build', status: 'running', message: 'Running the project build script inside the isolated copy...' });
        build = await runProcess(process.execPath, [npmCli, 'run', 'build'], {
          ...common,
          timeoutMs: 20 * 60 * 1000,
          env: { ...common.env, npm_config_ignore_scripts: 'false' },
        });
      }
      this.logger.info('build.validation.complete', { root, built: Boolean(build), isolated: true });
      this.emit('migration:progress', { step: 'build', status: 'complete', message: build ? 'Isolated build completed successfully.' : 'Dependency validation completed in isolation.' });
      return {
        status: 'passed',
        inspection,
        isolated: true,
        install: { code: install.code, command: installCommand },
        build: build ? { code: build.code } : null,
      };
    } finally {
      await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => null);
    }
  }
}

module.exports = { BuildService };
