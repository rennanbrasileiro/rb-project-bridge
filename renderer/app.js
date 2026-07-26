'use strict';
const GITHUB_DEVICE_URL = 'https://github.com/login/device';
const $ = (id) => document.getElementById(id);
let githubDeviceCode = '', base44DeviceCode = '', base44DeviceUrl = '', lastResult = null, repositories = [];
const log = (text) => { $('log').textContent += `${text}\n`; $('log').scrollTop = $('log').scrollHeight; };
async function call(promise) { const result = await promise; if (!result.ok) throw Object.assign(new Error(result.error.message), result.error); return result.data; }
function setResult(text, kind = '') { $('result').className = kind; $('result').textContent = text; }
function stage(step, status) { const item = document.querySelector(`[data-step="${step}"]`); if (!item) return; item.classList.remove('running', 'complete', 'failed'); if (status) item.classList.add(status); }
function resetStages() { document.querySelectorAll('.pipeline>div').forEach((item) => item.classList.remove('running', 'complete', 'failed')); }
function showGitHubCode(code) { githubDeviceCode = code; $('githubDeviceCode').textContent = code; $('githubAuthBox').classList.remove('hidden'); setResult(`Digite o código ${code} na página do GitHub.`); }
function showBase44Authorization(payload) { base44DeviceCode = payload.userCode || ''; base44DeviceUrl = payload.url || ''; $('base44DeviceCode').textContent = base44DeviceCode || '—'; $('base44AuthBox').classList.remove('hidden'); setResult(base44DeviceCode ? `Confirme o código ${base44DeviceCode} na Base44.` : 'Conclua a autorização na Base44.'); }
async function copyText(text) { if (!text) return; try { await navigator.clipboard.writeText(text); } catch { const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); } }
async function projects() { const list = await call(window.rbBridge.base44.projects()); const select = $('project'); select.replaceChildren(); for (const project of list) { const option = document.createElement('option'); option.value = project.id; option.dataset.name = project.name; option.dataset.updatedAt = project.updatedAt || ''; option.textContent = project.updatedAt ? `${project.name} — ${new Date(project.updatedAt).toLocaleString('pt-BR')}` : project.name; select.appendChild(option); } await loadRepositories(); }
async function accounts() { const data = await call(window.rbBridge.github.accounts()); const select = $('owner'); select.replaceChildren(); for (const account of data.accounts) { const option = document.createElement('option'); option.value = account.login; option.dataset.type = account.type; option.textContent = account.label; select.appendChild(option); } await loadRepositories(); }
function slug(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100); }
function selectedRepository() { const option = $('repoChoice').selectedOptions[0]; if (!option) return null; if (option.value === '__new__') return { strategy: 'create', name: $('repoName').value.trim() }; return { strategy: 'reuse', name: option.value }; }
async function inspectRepositorySelection() {
  const selected = selectedRepository(), project = $('project').selectedOptions[0], owner = $('owner').selectedOptions[0];
  $('newRepoLabel').classList.toggle('hidden', selected?.strategy !== 'create');
  if (!selected?.name || selected.strategy === 'create' || !project || !owner) { $('repoSyncStatus').querySelector('span').textContent = selected?.strategy === 'create' ? 'Um novo repositório privado será criado somente após confirmação explícita.' : 'Selecione um repositório existente para comparar com a Base44.'; return; }
  try {
    const status = await call(window.rbBridge.github.sourceStatus({ owner: owner.value, name: selected.name, project: { id: project.value, name: project.dataset.name, updatedAt: project.dataset.updatedAt || null } }));
    const messages = {
      unlinked: 'Repositório existente sem vínculo registrado. O estado atual será preservado antes da primeira entrega independente.',
      'base44-newer': 'A Base44 possui alterações mais recentes que o último snapshot. Uma nova exportação será feita.',
      'github-newer': 'O GitHub evoluiu depois da última migração. O estado atual será preservado antes de qualquer atualização.',
      'both-changed': 'Base44 e GitHub mudaram. O Bridge preservará o GitHub e registrará a divergência para revisão.',
      'in-sync': 'Base44 e snapshot registrado estão alinhados.',
    };
    $('repoSyncStatus').querySelector('span').textContent = messages[status.status] || 'Repositório pronto para reutilização segura.';
  } catch (error) { $('repoSyncStatus').querySelector('span').textContent = `Não foi possível comparar agora: ${error.message}`; }
}
async function loadRepositories() {
  const owner = $('owner').selectedOptions[0], choice = $('repoChoice'), project = $('project').selectedOptions[0];
  if (!owner) return;
  try {
    repositories = await call(window.rbBridge.github.repositories(owner.value, owner.dataset.type));
    choice.replaceChildren();
    for (const repository of repositories) { const option = document.createElement('option'); option.value = repository.name; option.textContent = `${repository.name}${repository.private ? ' 🔒' : ' 🌐'}`; choice.appendChild(option); }
    const create = document.createElement('option'); create.value = '__new__'; create.textContent = '＋ Criar novo repositório privado'; choice.appendChild(create);
    const suggested = slug(project?.dataset.name || '');
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
    if (best) choice.value = best.name; else { choice.value = '__new__'; $('repoName').value = suggested; }
    await inspectRepositorySelection();
  } catch (error) { choice.replaceChildren(); const option = document.createElement('option'); option.value = ''; option.textContent = 'Erro ao carregar repositórios'; choice.appendChild(option); log(`ERRO GitHub: ${error.message}`); }
}
async function load() { try { const status = await call(window.rbBridge.system.status()); $('version').textContent = `v${status.version}`; $('base44Status').textContent = status.base44?.loggedIn ? 'Conectado' : 'Não conectado'; $('githubStatus').textContent = status.github?.authenticated ? 'Conectado' : 'Não conectado'; if (status.base44?.loggedIn) { $('base44AuthBox').classList.add('hidden'); await projects(); } if (status.github?.authenticated) { $('githubAuthBox').classList.add('hidden'); await accounts(); } } catch (error) { log(error.message); } }
$('base44Login').onclick = async () => { const button = $('base44Login'); try { button.disabled = true; $('base44DeviceCode').textContent = 'Gerando...'; $('base44AuthBox').classList.remove('hidden'); $('base44Status').textContent = 'Aguardando...'; log('Abrindo autorização Base44...'); await call(window.rbBridge.base44.login()); $('base44Status').textContent = 'Conectado'; $('base44AuthBox').classList.add('hidden'); setResult('Base44 conectada.', 'success'); await projects(); } catch (error) { $('base44Status').textContent = 'Não conectado'; setResult(error.message, 'error'); log(`ERRO Base44: ${error.message}`); } finally { button.disabled = false; } };
$('githubLogin').onclick = async () => { const button = $('githubLogin'); try { button.disabled = true; $('githubDeviceCode').textContent = 'Aguardando...'; $('githubAuthBox').classList.remove('hidden'); $('githubStatus').textContent = 'Aguardando...'; await call(window.rbBridge.system.openExternal(GITHUB_DEVICE_URL)); await call(window.rbBridge.github.login()); $('githubStatus').textContent = 'Conectado'; $('githubAuthBox').classList.add('hidden'); setResult('GitHub conectado.', 'success'); await accounts(); } catch (error) { $('githubStatus').textContent = 'Não conectado'; setResult(error.message, 'error'); log(`ERRO GitHub: ${error.message}`); } finally { button.disabled = false; } };
$('copyBase44Code').onclick = () => copyText(base44DeviceCode); $('openBase44Device').onclick = async () => { if (base44DeviceUrl) await call(window.rbBridge.system.openExternal(base44DeviceUrl)); };
$('copyGitHubCode').onclick = () => copyText(githubDeviceCode); $('openGitHubDevice').onclick = () => call(window.rbBridge.system.openExternal(GITHUB_DEVICE_URL));
$('owner').onchange = loadRepositories; $('project').onchange = loadRepositories; $('repoChoice').onchange = inspectRepositorySelection; $('repoName').oninput = inspectRepositorySelection;
$('chooseOutput').onclick = async () => { const value = await call(window.rbBridge.system.chooseOutputDirectory()); if (value) $('output').value = value; };
$('cancel').onclick = async () => { await call(window.rbBridge.migration.cancel()); log('Cancelamento solicitado.'); };
$('deliveryMode').onchange = () => { const snapshot = $('deliveryMode').value === 'snapshot'; for (const name of ['standalone', 'supabase', 'build']) document.querySelector(`[data-step="${name}"]`).classList.toggle('disabled', snapshot); };
$('start').onclick = async () => {
  try {
    const projectOption = $('project').selectedOptions[0], ownerOption = $('owner').selectedOptions[0];
    if (!projectOption || !ownerOption) throw new Error('Conecte as contas e selecione projeto e destino.');
    if (!$('output').value) throw new Error('Selecione a pasta de entrega.');
    const repositorySelection = selectedRepository();
    if (!repositorySelection?.name) throw new Error('Selecione um repositório existente ou informe o nome do novo repositório.');
    resetStages(); $('resultActions').classList.add('hidden'); lastResult = null; setResult('');
    const input = { acceptedAuthorization: $('authorization').checked, deliveryMode: $('deliveryMode').value, project: { id: projectOption.value, name: projectOption.dataset.name, updatedAt: projectOption.dataset.updatedAt || null }, outputDirectory: $('output').value, buildValidation: true, repository: { owner: ownerOption.value, ownerType: ownerOption.dataset.type, strategy: repositorySelection.strategy, name: repositorySelection.name, description: $('description').value, visibility: 'private', commitMessage: 'Entrega independente gerada pelo RB Project Bridge' } };
    log(`Pipeline iniciado para ${input.repository.owner}/${input.repository.name}. Se já existir, o repositório será reutilizado com backup das branches.`); $('start').disabled = true;
    lastResult = await call(window.rbBridge.migration.start(input));
    const reused = lastResult.githubRepository?.reused;
    const backup = lastResult.previousDefaultBranch?.backupBranch;
    setResult(lastResult.pullRequest ? `Alterações preservadas. Revise o PR #${lastResult.pullRequest.number} antes do merge.` : reused ? `Atualizado com segurança: ${lastResult.github.fullName}. Backup: ${backup}.` : `Criado e concluído: ${lastResult.github.fullName} (${lastResult.github.sha.slice(0, 7)}).`, 'success');
    $('resultActions').classList.remove('hidden');
  } catch (error) { const violations = error.details?.violations || []; const suffix = violations.length ? `\nViolações detectadas:\n- ${violations.join('\n- ')}` : ''; setResult(error.message, 'error'); log(`ERRO: ${error.message}${suffix}`); } finally { $('start').disabled = false; }
};
$('openPreview').onclick = async () => { if (!lastResult?.paths?.previewDir) return setResult('Esta entrega não possui preview local.', 'error'); const state = await call(window.rbBridge.preview.start(lastResult.paths.previewDir)); setResult(`Preview local aberto em ${state.url}`, 'success'); };
$('stopPreview').onclick = async () => { await call(window.rbBridge.preview.stop()); setResult('Preview local encerrado.', 'success'); };
$('openFolder').onclick = () => lastResult?.paths?.jobRoot && call(window.rbBridge.system.openPath(lastResult.paths.jobRoot));
$('openRepo').onclick = () => lastResult?.github?.url && call(window.rbBridge.system.openExternal(lastResult.github.url));
for (const channel of ['base44:auth', 'base44:output', 'github:output', 'build:output', 'migration:progress', 'toolchain:progress']) window.rbBridge.on(channel, (event) => {
  if (channel === 'base44:auth') { showBase44Authorization(event); log(`Código Base44: ${event.userCode}`); return; }
  const text = event.text || event.message || JSON.stringify(event); log(text);
  if (channel === 'github:output') { const code = String(text).match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/i)?.[0]?.toUpperCase(); if (code) showGitHubCode(code); }
  if (channel === 'migration:progress') { const map = { 'base44-export': 'export', sanitize: 'export', standalone: 'standalone', build: 'build', 'github-publish': 'github-publish', 'github-snapshot': 'github-publish' }; const target = map[event.step]; if (target) stage(target, event.status === 'complete' ? 'complete' : event.status === 'failed' ? 'failed' : 'running'); if (event.step === 'standalone' && event.status === 'complete') stage('supabase', 'complete'); }
});
load();
