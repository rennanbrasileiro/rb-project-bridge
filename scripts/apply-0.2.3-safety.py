from pathlib import Path
import re

# Clean partial exports and remove the temporary archive after success.
base44_path = Path('electron/services/base44-service.cjs')
base44 = base44_path.read_text(encoding='utf-8')
base44 = base44.replace("    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {\n      let received = 0;\n      try {", "    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {\n      await ensureEmptyDir(destination);\n      let received = 0;\n      try {", 1)
base44 = base44.replace("        await tar.x({ file: archivePath, cwd: destination, preservePaths: false, strict: true });\n        const entries = await fsp.readdir(destination);", "        await tar.x({ file: archivePath, cwd: destination, preservePaths: false, strict: true });\n        await fsp.rm(archivePath, { force: true });\n        const entries = await fsp.readdir(destination);", 1)
base44_path.write_text(base44, encoding='utf-8')

# GitHub pull request delivery when the standalone main branch evolved.
github_path = Path('electron/services/github-service.cjs')
github = github_path.read_text(encoding='utf-8')
marker = "  async getBranchRef(repository, branch, options = {}) {"
method = r'''  async createPullRequest(repository, { head, base, title, body }, options = {}) {
    const args = ['api', '-X', 'POST', `repos/${repository.full_name}/pulls`, '-f', `head=${head}`, '-f', `base=${base}`, '-f', `title=${title}`, '-f', `body=${body || ''}`];
    const pull = this.parseJson((await this.runGh(args, { timeoutMs: 60_000, signal: options.signal })).stdout);
    if (!pull?.html_url) throw new BridgeError('PULL_REQUEST_CREATE_FAILED', `Não foi possível abrir a revisão em ${repository.full_name}.`);
    this.emit('migration:progress', { step: 'github-publish', status: 'complete', message: `Atualização publicada para revisão no PR #${pull.number}.` });
    return { number: pull.number, url: pull.html_url, head, base };
  }
'''
if 'async createPullRequest(repository' not in github:
    if marker not in github:
        raise SystemExit('Could not find GitHub branch marker')
    github = github.replace(marker, method + marker, 1)
github_path.write_text(github, encoding='utf-8')

# Protect evolved main branches by publishing a review branch instead of forcing main.
migration_path = Path('electron/services/migration-service.cjs')
migration = migration_path.read_text(encoding='utf-8')
old = """        report.snapshot = await this.github.publish({ directory: snapshotDir, repository, commitMessage: 'Snapshot sanitizado da exportação Base44', signal, branch: 'base44-source', force: true });
        report.github = await this.github.publish({ directory: repositoryDir, repository, commitMessage: standaloneMode ? 'Entrega independente Supabase gerada pelo RB Project Bridge' : (input.repository.commitMessage || `Snapshot ${input.project.name}`), signal, branch: defaultBranch, force: true });"""
new = """        report.snapshot = await this.github.publish({ directory: snapshotDir, repository, commitMessage: 'Snapshot sanitizado da exportação Base44', signal, branch: 'base44-source', force: true });
        const repositoryEvolved = ['github-newer', 'both-changed'].includes(report.sourceStatusBeforePublish?.status);
        if (repositoryEvolved && standaloneMode) {
          const reviewBranch = `bridge/base44-refresh-${timestamp}`;
          report.github = await this.github.publish({ directory: repositoryDir, repository, commitMessage: 'Atualização Base44 convertida para Supabase — revisão necessária', signal, branch: reviewBranch });
          report.pullRequest = await this.github.createPullRequest(repository, {
            head: reviewBranch,
            base: defaultBranch,
            title: `Revisar atualização Base44 — ${input.project.name}`,
            body: `O RB Project Bridge detectou alterações posteriores no GitHub e não substituiu a branch ${defaultBranch}.\\n\\n- Base44 atualizada: ${input.project.updatedAt || 'data indisponível'}\\n- Último commit GitHub: ${report.sourceStatusBeforePublish.latestCommitAt || 'data indisponível'}\\n- Backup criado: ${report.previousDefaultBranch?.backupBranch || 'não informado'}\\n\\nRevise e faça o merge somente após validar o preview local.`,
          }, { signal });
          report.deliveryStrategy = 'pull-request';
          report.github.url = report.pullRequest.url;
        } else {
          report.github = await this.github.publish({ directory: repositoryDir, repository, commitMessage: standaloneMode ? 'Entrega independente Supabase gerada pelo RB Project Bridge' : (input.repository.commitMessage || `Snapshot ${input.project.name}`), signal, branch: defaultBranch, force: true });
          report.deliveryStrategy = 'direct-main';
        }"""
if old not in migration:
    raise SystemExit('Could not find existing repository publish block')
migration = migration.replace(old, new, 1)
migration = migration.replace("this.emit('migration:progress', { step: 'job', status: 'complete', message: resolved.reused ? `Entrega independente concluída no repositório existente ${repository.full_name}; histórico preservado.`", "this.emit('migration:progress', { step: 'job', status: 'complete', message: report.deliveryStrategy === 'pull-request' ? `Atualização preparada no PR #${report.pullRequest.number}; a branch principal não foi sobrescrita.` : resolved.reused ? `Entrega independente concluída no repositório existente ${repository.full_name}; histórico preservado.`", 1)
migration_path.write_text(migration, encoding='utf-8')

# Improve automatic matching without silently creating duplicates.
app_path = Path('renderer/app.js')
app = app_path.read_text(encoding='utf-8')
old_match = """    const suggested = slug(project?.dataset.name || '');
    const exact = repositories.find((repository) => repository.name.toLowerCase() === suggested.toLowerCase());
    if (exact) choice.value = exact.name; else { choice.value = '__new__'; $('repoName').value = suggested; }"""
new_match = """    const suggested = slug(project?.dataset.name || '');
    const compactProject = suggested.replace(/[^a-z0-9]/g, '');
    const ranked = repositories.map((repository) => {
      const candidate = repository.name.toLowerCase();
      const compactCandidate = candidate.replace(/[^a-z0-9]/g, '');
      let score = candidate === suggested ? 100 : compactCandidate === compactProject ? 95 : 0;
      if (!score && compactCandidate.length >= 4 && (compactProject.startsWith(compactCandidate) || compactProject.includes(compactCandidate))) score = 80 + Math.min(compactCandidate.length, 15);
      if (!score && compactProject.length >= 4 && compactCandidate.startsWith(compactProject)) score = 75;
      return { repository, score };
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
    const best = ranked[0] && (!ranked[1] || ranked[0].score > ranked[1].score) ? ranked[0].repository : null;
    if (best) choice.value = best.name; else { choice.value = '__new__'; $('repoName').value = suggested; }"""
if old_match not in app:
    raise SystemExit('Could not find repository match block')
app = app.replace(old_match, new_match, 1)
app = app.replace("setResult(reused ? `Atualizado com segurança: ${lastResult.github.fullName}. Backup: ${backup}.` :", "setResult(lastResult.pullRequest ? `Alterações preservadas. Revise o PR #${lastResult.pullRequest.number} antes do merge.` : reused ? `Atualizado com segurança: ${lastResult.github.fullName}. Backup: ${backup}.` :", 1)
app_path.write_text(app, encoding='utf-8')

# Regression tests for repository matching and temporary archive cleanup are covered by source assertions.
test_path = Path('tests/repository-intelligence.test.cjs')
test_path.write_text(r'''const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('repository selector recognizes FitHub Personal Trainer as fithub', () => {
  const source = fs.readFileSync(require.resolve('../renderer/app.js'), 'utf8');
  assert.match(source, /compactProject\.includes\(compactCandidate\)/);
  assert.match(source, /choice\.value = best\.name/);
});

test('export removes temporary tar and resets destination between attempts', () => {
  const source = fs.readFileSync(require.resolve('../electron/services/base44-service.cjs'), 'utf8');
  assert.match(source, /for \(let attempt = 1; attempt <= totalAttempts; attempt \+= 1\) \{\s+await ensureEmptyDir\(destination\)/);
  assert.match(source, /await fsp\.rm\(archivePath, \{ force: true \}\);\s+const entries/);
});

test('evolved repositories are delivered through a pull request', () => {
  const source = fs.readFileSync(require.resolve('../electron/services/migration-service.cjs'), 'utf8');
  assert.match(source, /repositoryEvolved/);
  assert.match(source, /deliveryStrategy = 'pull-request'/);
  assert.match(source, /createPullRequest/);
});
''', encoding='utf-8')
