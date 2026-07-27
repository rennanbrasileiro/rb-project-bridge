'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { BridgeError } = require('../core/errors.cjs');
const {
  GitHubService,
  isWorkflowScopeError,
} = require('../services/github-service.cjs');

const PATCH_MARKER = Symbol.for('rb-project-bridge.review-history-patch.v1');
const REVIEW_BRANCH_PREFIX = 'bridge/base44-refresh-';

function branchStamp(now = new Date()) {
  return now.toISOString().replace(/\D/g, '').slice(0, 17);
}

function reviewRetryBranchName(branch, now = new Date()) {
  return `${branch}-retry-${branchStamp(now)}`;
}

function isBridgeReviewBranch(branch, repository) {
  const defaultBranch = repository?.default_branch || 'main';
  return Boolean(branch && branch !== defaultBranch && String(branch).startsWith(REVIEW_BRANCH_PREFIX));
}

async function availableReviewBranch(service, repository, requestedBranch, options = {}) {
  const existing = await service.getBranchRef(repository, requestedBranch, options);
  if (!existing?.object?.sha) return { branch: requestedBranch, replaced: null };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const now = new Date(Date.now() + attempt);
    const candidate = reviewRetryBranchName(requestedBranch, now);
    const collision = await service.getBranchRef(repository, candidate, options);
    if (!collision?.object?.sha) return { branch: candidate, replaced: requestedBranch };
  }

  throw new BridgeError(
    'REVIEW_BRANCH_ALLOCATION_FAILED',
    'Não foi possível reservar uma nova branch de revisão sem sobrescrever o histórico existente.',
    { requestedBranch, canRetry: true },
  );
}

function installReviewHistoryPatch() {
  const prototype = GitHubService.prototype;
  if (prototype[PATCH_MARKER]) return;

  const originalCreatePullRequest = prototype.createPullRequest;

  prototype.publish = async function publishWithComparableHistory({
    directory,
    repository,
    commitMessage,
    signal,
    branch = 'main',
    force = false,
  }) {
    const reviewBranch = isBridgeReviewBranch(branch, repository);
    const baseBranch = reviewBranch ? (repository.default_branch || 'main') : null;
    let actualBranch = branch;

    if (reviewBranch) {
      const allocation = await availableReviewBranch(this, repository, branch, { signal });
      actualBranch = allocation.branch;
      this.__rbReviewBranchAliases ??= new Map();
      this.__rbReviewBranchAliases.set(branch, actualBranch);
      if (allocation.replaced) {
        this.emit('migration:progress', {
          step: 'github-publish',
          status: 'running',
          message: `A branch ${allocation.replaced} foi preservada. A retomada seguirá em ${actualBranch}.`,
        });
      }
    }

    this.emit('migration:progress', {
      step: actualBranch === (repository.default_branch || 'main') ? 'github-publish' : 'github-snapshot',
      status: 'running',
      message: `Publicando ${actualBranch} em ${repository.full_name}...`,
    });

    await this.ensureDirectoryScopes(directory, { signal });
    await fs.rm(path.join(directory, '.git'), { recursive: true, force: true });
    const token = await this.getAuthenticationToken();
    const askPass = await this.createAskPass();
    const authEnv = {
      GIT_ASKPASS: askPass,
      GIT_TERMINAL_PROMPT: '0',
      RB_BRIDGE_GH_TOKEN: token,
    };

    try {
      await this.runGit(['init', '-b', actualBranch], { cwd: directory, signal, env: authEnv });
      const login = repository.owner?.login || repository.full_name.split('/')[0];
      await this.runGit(['config', 'user.name', login], { cwd: directory, signal, env: authEnv });
      await this.runGit(['config', 'user.email', `${login}@users.noreply.github.com`], { cwd: directory, signal, env: authEnv });
      await this.runGit(['remote', 'add', 'origin', repository.clone_url], { cwd: directory, signal, env: authEnv });

      if (reviewBranch) {
        this.emit('migration:progress', {
          step: 'github-publish',
          status: 'running',
          message: `Vinculando a revisão à branch ${baseBranch} antes do envio...`,
        });
        await this.runGit(['fetch', '--depth', '1', 'origin', baseBranch], {
          cwd: directory,
          timeoutMs: 20 * 60 * 1000,
          signal,
          env: authEnv,
        });
        await this.runGit(['reset', '--mixed', 'FETCH_HEAD'], { cwd: directory, signal, env: authEnv });
      }

      await this.runGit(['add', '--all'], { cwd: directory, signal, env: authEnv });
      await this.runGit(['commit', '-m', commitMessage || 'Initial migration'], { cwd: directory, signal, env: authEnv });
      const pushArgs = ['push', '--set-upstream', 'origin', actualBranch];
      if (force && !reviewBranch) pushArgs.splice(1, 0, '--force');

      try {
        await this.runGit(pushArgs, {
          cwd: directory,
          timeoutMs: 20 * 60 * 1000,
          signal,
          env: authEnv,
        });
      } catch (error) {
        if (isWorkflowScopeError(error)) {
          this.invalidateCaches({ auth: true, data: false });
          throw new BridgeError(
            'GITHUB_WORKFLOW_SCOPE_REQUIRED',
            'O GitHub bloqueou o workflow de validação. O produto local foi preservado e a entrega pode ser continuada.',
            { cause: error.message, canRetry: true },
          );
        }
        throw error;
      }

      const sha = (await this.runGit(['rev-parse', 'HEAD'], {
        cwd: directory,
        signal,
        env: authEnv,
      })).stdout.trim();

      this.emit('migration:progress', {
        step: actualBranch === (repository.default_branch || 'main') ? 'github-publish' : 'github-snapshot',
        status: 'complete',
        message: `${actualBranch} publicado no commit ${sha.slice(0, 7)}.`,
      });

      return {
        sha,
        url: repository.html_url,
        fullName: repository.full_name,
        branch: actualBranch,
        requestedBranch: branch,
        baseBranch,
      };
    } finally {
      delete authEnv.RB_BRIDGE_GH_TOKEN;
    }
  };

  prototype.createPullRequest = async function createPullRequestWithResolvedHead(repository, input, options = {}) {
    const resolvedHead = this.__rbReviewBranchAliases?.get(input.head) || input.head;
    const result = await originalCreatePullRequest.call(this, repository, { ...input, head: resolvedHead }, options);
    return { ...result, requestedHead: input.head, head: resolvedHead };
  };

  Object.defineProperty(prototype, PATCH_MARKER, { value: true });
}

installReviewHistoryPatch();

module.exports = {
  PATCH_MARKER,
  REVIEW_BRANCH_PREFIX,
  branchStamp,
  reviewRetryBranchName,
  isBridgeReviewBranch,
  availableReviewBranch,
  installReviewHistoryPatch,
};
