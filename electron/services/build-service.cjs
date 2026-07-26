'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('../core/process-runner.cjs');
const { BridgeError } = require('../core/errors.cjs');
const { pathExists, readJson, copyDirectory } = require('../core/fs-utils.cjs');
const { applyRuntimeCompatibility } = require('./runtime-compatibility-service.cjs');

class BuildService {
  constructor({ logger, emit, runtimeValidator }) {
    this.logger = logger;
    this.emit = emit;
    this.runtimeValidator = runtimeValidator;
  }

  async inspect(root) {
    const packagePath = path.join(root, 'package.json');
    const packageJson = await readJson(packagePath);
    const issues = [];
    if (!packageJson) issues.push({ severity: 'high', code: 'PACKAGE_JSON_MISSING', message: 'package.json was not found or is invalid.' });
    if (packageJson && !packageJson.scripts?.build && !packageJson.scripts?.['build:demo']) issues.push({ severity: 'medium', code: 'BUILD_SCRIPT_MISSING', message: 'No build script is defined.' });
    const sourceCandidates = ['src', 'app', 'pages'];
    const hasSource = (await Promise.all(sourceCandidates.map((item) => pathExists(path.join(root, item))))).some(Boolean);
    if (!hasSource) issues.push({ severity: 'medium', code: 'SOURCE_DIRECTORY_MISSING', message: 'No standard source directory was detected.' });
    return {
      valid: !issues.some((item) => item.severity === 'high'), issues,
      packageManager: await pathExists(path.join(root, 'package-lock.json')) ? 'npm' : await pathExists(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : await pathExists(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm',
      packageJson: packageJson ? { name: packageJson.name, scripts: packageJson.scripts || {}, dependencies: Object.keys(packageJson.dependencies || {}).length } : null,
    };
  }

  resolveNpmCli() {
    try { return path.join(path.dirname(require.resolve('npm/package.json')), 'bin', 'npm-cli.js'); }
    catch (error) { throw new BridgeError('NPM_RUNTIME_MISSING', 'The bundled npm runtime is unavailable.', { cause: error.message }); }
  }

  normalizeOptions(consentOrOptions) {
    if (typeof consentOrOptions === 'object' && consentOrOptions !== null) {
      return {
        consent: Boolean(consentOrOptions.consent),
        buildScript: consentOrOptions.buildScript,
        previewDestination: consentOrOptions.previewDestination,
        syncLockfile: Boolean(consentOrOptions.syncLockfile),
        runtimeValidation: consentOrOptions.runtimeValidation !== false,
      };
    }
    return { consent: Boolean(consentOrOptions), buildScript: null, previewDestination: null, syncLockfile: false, runtimeValidation: true };
  }

  async validateBuild(root, consentOrOptions, signal) {
    const options = this.normalizeOptions(consentOrOptions);
    let compatibility = null;
    if (options.buildScript === 'build:demo' || options.previewDestination) {
      this.emit('migration:progress', { step: 'build', status: 'running', message: 'Verificando compatibilidade do runtime standalone...' });
      compatibility = await applyRuntimeCompatibility(root);
    }

    const inspection = await this.inspect(root);
    if (!inspection.valid) return { status: 'failed', inspection, compatibility, install: null, build: null, runtime: null };
    if (!options.consent) return { status: 'skipped', inspection, compatibility, reason: 'Project code execution was not authorized.' };

    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-project-bridge-build-'));
    const sandboxProject = path.join(sandboxRoot, 'project');
    try {
      await copyDirectory(root, sandboxProject);
      this.emit('migration:progress', { step: 'build', status: 'running', message: 'Instalando dependências em uma cópia isolada...' });
      const npmCli = this.resolveNpmCli();
      const output = (entry) => this.emit('build:output', entry);
      const common = { cwd: sandboxProject, signal, env: { ELECTRON_RUN_AS_NODE: '1', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_ignore_scripts: 'true' }, onOutput: output };
      const hasLockfile = await pathExists(path.join(sandboxProject, 'package-lock.json'));
      const installCommand = hasLockfile ? 'ci' : 'install';
      const install = await runProcess(process.execPath, [npmCli, installCommand, '--ignore-scripts', '--no-audit', '--no-fund'], { ...common, timeoutMs: 30 * 60 * 1000 });
      if (options.syncLockfile && await pathExists(path.join(sandboxProject, 'package-lock.json'))) {
        await fs.copyFile(path.join(sandboxProject, 'package-lock.json'), path.join(root, 'package-lock.json'));
      }
      const script = options.buildScript || (inspection.packageJson?.scripts?.['build:demo'] ? 'build:demo' : inspection.packageJson?.scripts?.build ? 'build' : null);
      let build = null;
      let preview = null;
      let runtime = null;
      if (script) {
        this.emit('migration:progress', { step: 'build', status: 'running', message: `Executando npm run ${script} na cópia isolada...` });
        build = await runProcess(process.execPath, [npmCli, 'run', script], { ...common, timeoutMs: 30 * 60 * 1000, env: { ...common.env, npm_config_ignore_scripts: 'false' } });
        const outputCandidates = ['dist', 'build', 'out'];
        const builtDirectory = (await Promise.all(outputCandidates.map(async (name) => ({ name, exists: await pathExists(path.join(sandboxProject, name)) })))).find((item) => item.exists)?.name;
        if (options.previewDestination && builtDirectory) {
          await fs.rm(options.previewDestination, { recursive: true, force: true });
          await copyDirectory(path.join(sandboxProject, builtDirectory), options.previewDestination);
          preview = { directory: options.previewDestination, sourceDirectory: builtDirectory };
        }
        if (preview && options.runtimeValidation) {
          if (!this.runtimeValidator) {
            runtime = { passed: false, status: 'unavailable', errors: ['O validador Chromium não está disponível neste ambiente.'] };
          } else {
            this.emit('migration:progress', { step: 'build', status: 'running', message: 'Abrindo o bundle em Chromium isolado e confirmando a renderização...' });
            runtime = await this.runtimeValidator(preview.directory, { signal });
          }
          if (!runtime?.passed) {
            throw new BridgeError(
              'PREVIEW_RUNTIME_FAILED',
              `O bundle compilou, mas a aplicação não renderizou corretamente no navegador: ${(runtime?.errors || []).slice(0, 3).join(' | ') || 'a raiz da aplicação permaneceu vazia.'}`,
              { runtime, preview },
            );
          }
        }
      }
      this.logger.info('build.validation.complete', { root, built: Boolean(build), isolated: true, preview: preview?.directory, runtimePassed: runtime?.passed, compatibility });
      this.emit('migration:progress', { step: 'build', status: 'complete', message: runtime?.passed ? 'Build e execução local validados; preview pronto.' : build ? 'Build local concluído e preview preparado.' : 'Validação de dependências concluída.' });
      return { status: 'passed', inspection, compatibility, isolated: true, install: { code: install.code, command: installCommand }, build: build ? { code: build.code, script } : null, preview, runtime };
    } finally {
      await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => null);
    }
  }
}

module.exports = { BuildService };
