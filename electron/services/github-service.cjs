'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runProcess } = require('../core/process-runner.cjs');
const { BridgeError } = require('../core/errors.cjs');

const GITHUB_DEVICE_URL = 'https://github.com/login/device';

function extractGitHubDeviceCode(text) {
  return String(text).match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/i)?.[0]?.toUpperCase() ?? null;
}

class GitHubService {
  constructor({ toolchain, logger, emit, sessionDir, openExternal }) {
    this.toolchain = toolchain;
    this.logger = logger;
    this.emit = emit;
    this.openExternal = openExternal;
    this.sessionDir = sessionDir || path.join(os.tmpdir(), 'rb-project-bridge-github');
    this.configDir = path.join(this.sessionDir, 'gh-config');
    this.gitConfigPath = path.join(this.sessionDir, 'gitconfig');
  }

  async ensureSession() { await fs.mkdir(this.configDir, { recursive: true }); }

  sessionEnvironment(extra = {}) {
    return {
      GH_CONFIG_DIR: this.configDir,
      GIT_CONFIG_GLOBAL: this.gitConfigPath,
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: this.sessionDir,
      USERPROFILE: this.sessionDir,
      ...extra,
    };
  }

  async runGh(args, options = {}) {
    await this.ensureSession();
    const gh = await this.toolchain.getGh();
    return runProcess(gh, args, {
      timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
      input: options.input,
      env: this.sessionEnvironment(options.env),
      onOutput: options.onOutput ?? ((entry) => this.emit('github:output', entry)),
      signal: options.signal,
      captureSensitive: Boolean(options.captureSensitive),
    });
  }

  async runGit(args, options = {}) {
    await this.ensureSession();
    const git = await this.toolchain.getGit();
    return runProcess(git, args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
      env: this.sessionEnvironment(options.env),
      onOutput: options.onOutput ?? ((entry) => this.emit('github:output', entry)),
      signal: options.signal,
    });
  }

  async authStatus() {
    try {
      const result = await this.runGh(['auth', 'status', '--hostname', 'github.com'], { timeoutMs: 30_000 });
      return { authenticated: true, output: result.stdout || result.stderr };
    } catch (error) {
      return { authenticated: false, output: error.details?.stderr || error.message };
    }
  }

  async login() {
    let opened = false;
    let outputBuffer = '';
    const openDevicePage = async () => {
      if (opened) return;
      opened = true;
      try {
        await this.openExternal?.(GITHUB_DEVICE_URL);
        this.logger.info('github.auth.browser.opened');
      } catch (error) {
        this.logger.warn('github.auth.browser.failed', { message: error.message });
      }
    };

    await openDevicePage();
    await this.runGh(
      ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key'],
      {
        timeoutMs: 15 * 60 * 1000,
        onOutput: (entry) => {
          this.emit('github:output', entry);
          outputBuffer = `${outputBuffer}${entry.text}`.slice(-4096);
          const code = extractGitHubDeviceCode(outputBuffer);
          if (code) {
            this.emit('github:output', {
              stream: 'stdout',
              text: `Autorize no navegador usando o código ${code}.\n`,
            });
          }
          if (outputBuffer.includes(GITHUB_DEVICE_URL)) void openDevicePage();
        },
      },
    );
    return this.getAccounts();
  }

  async logout() {
    try { await this.runGh(['auth', 'logout', '--hostname', 'github.com'], { timeoutMs: 60_000, input: 'Y\n' }); } catch {}
    await fs.rm(this.sessionDir, { recursive: true, force: true });
    return { authenticated: false };
  }

  parseJson(output) {
    try { return JSON.parse(output); } catch {
      const lines = output.split(/\r?\n/).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try { return JSON.parse(lines[index]); } catch {}
      }
      return null;
    }
  }

  async getAccounts() {
    const status = await this.authStatus();
    if (!status.authenticated) return { authenticated: false, accounts: [] };
    const user = this.parseJson((await this.runGh(['api', 'user'], { timeoutMs: 60_000 })).stdout);
    let orgs = [];
    try {
      const parsed = this.parseJson((await this.runGh(['api', 'user/orgs', '--paginate', '--slurp'], { timeoutMs: 60_000 })).stdout) || [];
      orgs = Array.isArray(parsed[0]) ? parsed.flat() : parsed;
    } catch (error) {
      this.logger.warn('github.organizations.unavailable', { message: error.message });
    }
    if (!user?.login) throw new BridgeError('GITHUB_PROFILE_UNAVAILABLE', 'GitHub did not return the authenticated profile.');
    return {
      authenticated: true,
      user: { login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url },
      accounts: [
        { login: user.login, type: 'user', label: user.name ? `${user.name} (${user.login})` : user.login },
        ...orgs.map((org) => ({ login: org.login, type: 'organization', label: org.login })),
      ],
    };
  }

  async repositoryExists(owner, name) {
    try { await this.runGh(['api', `repos/${owner}/${name}`], { timeoutMs: 30_000 }); return true; } catch { return false; }
  }

  async createRepository({ owner, ownerType, name, description, visibility }, options = {}) {
    if (await this.repositoryExists(owner, name)) throw new BridgeError('REPOSITORY_EXISTS', `The repository ${owner}/${name} already exists.`);
    const endpoint = ownerType === 'organization' ? `orgs/${owner}/repos` : 'user/repos';
    const args = ['api', '-X', 'POST', endpoint, '-f', `name=${name}`, '-F', `private=${visibility !== 'public'}`];
    if (description) args.push('-f', `description=${description}`);
    const repository = this.parseJson((await this.runGh(args, { timeoutMs: 60_000, signal: options.signal })).stdout);
    if (!repository?.full_name) throw new BridgeError('REPOSITORY_CREATE_FAILED', 'GitHub did not return the created repository.');
    return repository;
  }

  async getAuthenticationToken() {
    const result = await this.runGh(['auth', 'token', '--hostname', 'github.com'], { timeoutMs: 30_000, captureSensitive: true, onOutput: () => {} });
    const token = result.stdout.trim();
    if (!token || token.includes('[REDACTED]')) throw new BridgeError('GITHUB_TOKEN_UNAVAILABLE', 'GitHub authentication could not be prepared for the push.');
    return token;
  }

  async createAskPass() {
    await this.ensureSession();
    if (process.platform === 'win32') {
      const target = path.join(this.sessionDir, 'git-askpass.cmd');
      await fs.writeFile(target, ['@echo off', 'echo %~1 | findstr /I "Username" >nul', 'if %errorlevel%==0 (', '  echo x-access-token', ') else (', '  echo %RB_BRIDGE_GH_TOKEN%', ')', ''].join('\r\n'), { encoding: 'utf8', mode: 0o700 });
      return target;
    }
    const target = path.join(this.sessionDir, 'git-askpass.sh');
    await fs.writeFile(target, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "x-access-token" ;;\n  *) printf "%s\\n" "$RB_BRIDGE_GH_TOKEN" ;;\nesac\n', { encoding: 'utf8', mode: 0o700 });
    await fs.chmod(target, 0o700);
    return target;
  }

  async publish({ directory, repository, commitMessage, signal }) {
    this.emit('migration:progress', { step: 'github-publish', status: 'running', message: `Publishing to ${repository.full_name}...` });
    await fs.rm(path.join(directory, '.git'), { recursive: true, force: true });
    const token = await this.getAuthenticationToken();
    const askPass = await this.createAskPass();
    const authEnv = { GIT_ASKPASS: askPass, GIT_TERMINAL_PROMPT: '0', RB_BRIDGE_GH_TOKEN: token };
    try {
      await this.runGit(['init', '-b', 'main'], { cwd: directory, signal, env: authEnv });
      const login = repository.owner?.login || repository.full_name.split('/')[0];
      await this.runGit(['config', 'user.name', login], { cwd: directory, signal, env: authEnv });
      await this.runGit(['config', 'user.email', `${login}@users.noreply.github.com`], { cwd: directory, signal, env: authEnv });
      await this.runGit(['add', '--all'], { cwd: directory, signal, env: authEnv });
      await this.runGit(['commit', '-m', commitMessage || 'Initial Base44 migration'], { cwd: directory, signal, env: authEnv });
      await this.runGit(['remote', 'add', 'origin', repository.clone_url], { cwd: directory, signal, env: authEnv });
      let pushError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await this.runGit(['push', '--set-upstream', 'origin', 'main'], { cwd: directory, timeoutMs: 20 * 60 * 1000, signal, env: authEnv });
          pushError = null;
          break;
        } catch (error) {
          pushError = error;
          if (attempt < 3 && !signal?.aborted) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        }
      }
      if (pushError) throw pushError;
      const sha = (await this.runGit(['rev-parse', 'HEAD'], { cwd: directory, signal, env: authEnv })).stdout.trim();
      this.emit('migration:progress', { step: 'github-publish', status: 'complete', message: `Published commit ${sha.slice(0, 7)}.` });
      return { sha, url: repository.html_url, fullName: repository.full_name };
    } finally {
      delete authEnv.RB_BRIDGE_GH_TOKEN;
    }
  }
}

module.exports = { GitHubService, GITHUB_DEVICE_URL, extractGitHubDeviceCode };
