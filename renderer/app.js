'use strict';

const GITHUB_DEVICE_URL = 'https://github.com/login/device';
const $ = (id) => document.getElementById(id);
let githubDeviceCode = '';
let base44DeviceCode = '';
let base44DeviceUrl = '';
let lastResult = null;
let repositories = [];
let lastRetryJobRoot = null;
let githubConnected = false;
let githubDeliveryReady = false;
let operationRunning = false;

const log = (text) => {
  if (!text) return;
  $('log').textContent += `${String(text).trimEnd()}\n`;
  $('log').scrollTop = $('log').scrollHeight;
};

async function call(promise) {
  const result = await promise;
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
  return result.data;
}

function setResult(title, message = '', kind = 'idle', meta = []) {
  const panel = $('result');
  panel.className = `result-panel ${kind}`;
  $('resultTitle').textContent = title;
  $('resultMessage').textContent = message;
  const metaBox = $('resultMeta');
  metaBox.replaceChildren();
  for (const item of meta.filter(Boolean)) {
    const span = document.createElement('span');
    span.textContent = item;
    metaBox.appendChild(span);
  }
}

function setOperationSummary(title, message, kind = 'idle') {
  $('operationSummary').className = `summary-card ${kind}`;
  $('operationSummaryTitle').textContent = title;
  $('operationSummaryMessage').textContent = message;
}

function stage(step, status, message = '') {
  const item = document.querySelector(`[data-step="${step}"]`);
  if (!item) return;
  item.classList.remove('running', 'complete', 'failed', 'partial');
  if (status) item.classList.add(status);
  if (message) item.title = message;
}

function resetStages() {
  document.querySelectorAll('.pipeline>div').forEach((item) => {
    item.classList.remove('running', 'complete', 'failed', 'partial');
    item.removeAttribute('title');
  });
}

function setRunning(running) {
  operationRunning = running;
  $('start').disabled = running;
  $('retryLast').disabled = running;
  $('cancel').disabled = !running;
  $('start').textContent = running ? 'Processando produto...' : 'Gerar, validar e entregar';
}

function updateConnection(kind, connected, detail = '') {
  const status = $(`${kind}Status`);
  const button = $(`${kind}Login`);
  status.className = `status ${connected ? 'connected' : 'disconnected'}`;
  status.textContent = connected ? (detail || 'Conectado') : 'Não conectado';
  if (kind === 'github') {
    githubConnected = connected;
    button.textContent = connected ? (githubDeliveryReady ? 'GitHub conectado' : 'Completar autorização') : 'Conectar GitHub';
    button.disabled = connected && githubDeliveryReady;
  } else {
    button.textContent = connected ? 'Base44 conectada' : 'Conectar Base44';
    button.disabled = connected;
  }
}

function showGitHubCode(code) {
  githubDeviceCode = code;
  $('githubDeviceCode').textContent = code;
  $('githubAuthBox').classList.remove('hidden');
  setResult('Autorize o GitHub', `Digite o código ${code} na página aberta. O pipeline continuará automaticamente.`, 'attention');
}

function showBase44Authorization(payload) {
  base44DeviceCode = payload.userCode || '';
  base44DeviceUrl = payload.url || '';
  $('base44DeviceCode').textContent = base44DeviceCode || '—';
  $('base44AuthBox').classList.remove('hidden');
  setResult('Autorize a Base44', base44DeviceCode ? `Confirme o código ${base44DeviceCode}.` : 'Conclua a autorização no navegador.', 'attention');
}

async function copyText(text) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

async function projects() {
  const list = await call(window.rbBridge.base44.projects());
  const select = $('project');
  select.replaceChildren();
  for (const project of list) {
    const option = document.createElement('option');
    option.value = project.id;
    option.dataset.name = project.name;
    option.dataset.updatedAt = project.updatedAt || '';
    option.textContent = project.updatedAt ? `${project.name} — ${new Date(project.updatedAt).toLocaleString('pt-BR')}` : project.name;
    select.appendChild(option);
  }
  if ($('owner').selectedOptions[0]) await loadRepositories();
}

async function accounts(options = {}) {
  const data = await call(window.rbBridge.github.accounts());
  const select = $('owner');
  select.replaceChildren();
  for (const account of data.accounts) {
    const option = document.createElement('option');
    option.value = account.login;
    option.dataset.type = account.type;
    option.textContent = account.label;
    select.appendChild(option);
  }
  githubDeliveryReady = Boolean(data.deliveryReady);
  updateConnection('github', true, githubDeliveryReady ? 'Conectado · pronto para entrega' : 'Conectado · autorização pendente');
  if (!options.skipRepositories) await loadRepositories();
}

function slug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

function selectedRepository() {
  const option = $('repoChoice').selectedOptions[0];
  if (!option) return null;
  if (option.value === '__new__') return { strategy: 'create', name: $('repoName').value.trim() };
  return { strategy: 'reuse', name: option.value };
}

async function inspectRepositorySelection() {
  const selected = selectedRepository();
  const project = $('project').selectedOptions[0];
  const owner = $('owner').selectedOptions[0];
  $('newRepoLabel').classList.toggle('hidden', selected?.strategy !== 'create');
  if (!selected?.name || selected.strategy === 'create' || !project || !owner) {
    $('repoSyncStatus').querySelector('span').textContent = selected?.strategy === 'create'
      ? 'Um novo repositório privado será criado somente após a validação local.'
      : 'Selecione um repositório existente para comparar com a Base44.';
    return;
  }
  try {
    const status = await call(window.rbBridge.github.sourceStatus({
      owner: owner.value,
      name: selected.name,
      project: { id: project.value, name: project.dataset.name, updatedAt: project.dataset.updatedAt || null },
    }));
    const messages = {
      unlinked: 'Repositório existente sem vínculo registrado. O estado atual será preservado antes da primeira entrega independente.',
      'snapshot-only': 'O snapshot Base44 está salvo, mas a entrega independente ainda não chegou à branch principal. O Bridge continuará com segurança.',
      'base44-newer': 'A Base44 possui alterações mais recentes. Uma nova exportação será realizada.',
      'github-newer': 'O GitHub evoluiu após a última entrega. O estado atual será preservado e a atualização seguirá por revisão.',
      'both-changed': 'Base44 e GitHub mudaram. O Bridge preservará ambos e abrirá uma revisão sem sobrescrever a branch principal.',
      'in-sync': 'Base44 e entrega registrada estão alinhadas.',
    };
    $('repoSyncStatus').querySelector('span').textContent = messages[status.status] || 'Repositório pronto para reutilização segura.';
  } catch (error) {
    $('repoSyncStatus').querySelector('span').textContent = `Comparação temporariamente indisponível: ${error.message}`;
  }
}

async function loadRepositories() {
  const owner = $('owner').selectedOptions[0];
  const choice = $('repoChoice');
  const project = $('project').selectedOptions[0];
  if (!owner) return;
  choice.disabled = true;
  try {
    repositories = await call(window.rbBridge.github.repositories(owner.value, owner.dataset.type));
    choice.replaceChildren();
    for (const repository of repositories) {
      const option = document.createElement('option');
      option.value = repository.name;
      option.textContent = `${repository.name}${repository.private ? ' 🔒' : ' 🌐'}`;
      choice.appendChild(option);
    }
    const create = document.createElement('option');
    create.value = '__new__';
    create.textContent = '＋ Criar novo repositório privado';
    choice.appendChild(create);

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
    if (best) choice.value = best.name;
    else { choice.value = '__new__'; $('repoName').value = suggested; }
    await inspectRepositorySelection();
  } catch (error) {
    choice.replaceChildren();
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Erro ao carregar repositórios';
    choice.appendChild(option);
    log(`GitHub: ${error.message}`);
  } finally { choice.disabled = false; }
}

function retryableHistoryEntry(entry) {
  const recovery = entry?.recovery || entry?.error?.details?.recovery;
  if (recovery?.canRetryPublish && recovery.jobRoot) return { entry, recovery };
  const legacyCode = entry?.error?.code;
  if (entry?.jobRoot && entry?.githubRepository && ['GITHUB_WORKFLOW_SCOPE_REQUIRED', 'GITHUB_DELIVERY_SCOPE_REQUIRED'].includes(legacyCode)) {
    return { entry, recovery: { canRetryPublish: true, jobRoot: entry.jobRoot, repositoryFullName: entry.githubRepository.fullName, previewDir: entry.previewDir || null } };
  }
  return null;
}

function showResumeCard(candidate) {
  const card = $('resumeCard');
  if (!candidate) {
    lastRetryJobRoot = null;
    card.classList.add('hidden');
    $('retryLast').classList.add('hidden');
    return;
  }
  lastRetryJobRoot = candidate.recovery.jobRoot;
  const project = candidate.entry.project?.name || 'Produto';
  const repository = candidate.recovery.repositoryFullName || candidate.entry.githubRepository?.fullName || 'destino configurado';
  $('resumeTitle').textContent = `${project}: entrega pendente`;
  $('resumeMessage').textContent = `Exportação, conversão e build já foram preservados. Continuar publicará apenas o que falta em ${repository}.`;
  card.classList.remove('hidden');
  $('retryLast').classList.remove('hidden');
}

async function refreshRetryAction() {
  try {
    const history = await call(window.rbBridge.migration.history());
    showResumeCard(history.map(retryableHistoryEntry).find(Boolean) || null);
  } catch { showResumeCard(null); }
}

function configureResultActions(result = lastResult) {
  const previewDir = result?.paths?.previewDir;
  const jobRoot = result?.paths?.jobRoot;
  const repositoryUrl = result?.pullRequest?.url || result?.github?.url || result?.recovery?.repositoryUrl;
  $('openPreview').classList.toggle('hidden', !previewDir);
  $('openFolder').classList.toggle('hidden', !jobRoot);
  $('openRepo').classList.toggle('hidden', !repositoryUrl);
  $('resultActions').classList.toggle('hidden', !previewDir && !jobRoot && !repositoryUrl);
}

function applyRecovery(error) {
  const recovery = error?.details?.recovery;
  if (!recovery) return null;
  lastResult = {
    status: 'partial',
    recovery,
    paths: { jobRoot: recovery.jobRoot, repositoryDir: recovery.repositoryDir, previewDir: recovery.previewDir },
    github: recovery.repositoryUrl ? { url: recovery.repositoryUrl, fullName: recovery.repositoryFullName } : null,
  };
  configureResultActions(lastResult);
  if (recovery.canRetryPublish && recovery.jobRoot) {
    showResumeCard({ entry: { project: { name: $('project').selectedOptions[0]?.dataset.name || 'Produto' } }, recovery });
  }
  return recovery;
}

async function load() {
  try {
    const status = await call(window.rbBridge.system.status());
    $('version').textContent = `v${status.version}`;
    updateConnection('base44', Boolean(status.base44?.loggedIn));
    githubDeliveryReady = Boolean(status.github?.deliveryReady);
    updateConnection('github', Boolean(status.github?.authenticated), status.github?.authenticated
      ? (githubDeliveryReady ? 'Conectado · pronto para entrega' : 'Conectado · autorização pendente')
      : 'Não conectado');

    if (status.base44?.loggedIn) {
      $('base44AuthBox').classList.add('hidden');
      await projects();
    }
    if (status.github?.authenticated) {
      $('githubAuthBox').classList.add('hidden');
      await accounts();
    }
    await refreshRetryAction();
    setOperationSummary('Pronto para operar', 'Selecione o produto e o destino. O Bridge preserva o original, valida o preview e continua automaticamente de checkpoints.', 'ready');
  } catch (error) {
    setOperationSummary('Não foi possível carregar o ambiente', error.message, 'error');
    log(error.message);
  }
}

$('base44Login').onclick = async () => {
  const button = $('base44Login');
  try {
    button.disabled = true;
    $('base44DeviceCode').textContent = 'Gerando...';
    $('base44AuthBox').classList.remove('hidden');
    updateConnection('base44', false, 'Aguardando autorização');
    setResult('Conectando à Base44', 'Conclua a autorização no navegador.', 'running');
    await call(window.rbBridge.base44.login());
    updateConnection('base44', true);
    $('base44AuthBox').classList.add('hidden');
    setResult('Base44 conectada', 'Os produtos da conta foram carregados.', 'success');
    await projects();
  } catch (error) {
    updateConnection('base44', false);
    setResult('Falha ao conectar a Base44', error.message, 'error');
    log(`Base44: ${error.message}`);
  } finally { if (!$('base44Status').classList.contains('connected')) button.disabled = false; }
};

$('githubLogin').onclick = async () => {
  const button = $('githubLogin');
  try {
    button.disabled = true;
    $('githubDeviceCode').textContent = 'Aguardando...';
    $('githubAuthBox').classList.remove('hidden');
    setResult(githubConnected ? 'Completando autorização do GitHub' : 'Conectando ao GitHub', 'Confirme o código no navegador. Esta autorização será reutilizada nas próximas operações.', 'running');
    if (githubConnected) await call(window.rbBridge.github.ensureDeliveryScopes());
    else await call(window.rbBridge.github.login());
    githubDeliveryReady = true;
    updateConnection('github', true, 'Conectado · pronto para entrega');
    $('githubAuthBox').classList.add('hidden');
    setResult('GitHub pronto', 'A sessão está conectada e possui as permissões necessárias para entregar o produto.', 'success');
    await accounts();
  } catch (error) {
    githubDeliveryReady = false;
    updateConnection('github', githubConnected, githubConnected ? 'Conectado · autorização pendente' : 'Não conectado');
    setResult('Autorização do GitHub incompleta', error.message, 'attention');
    log(`GitHub: ${error.message}`);
  } finally { button.disabled = githubConnected && githubDeliveryReady; }
};

$('copyBase44Code').onclick = () => copyText(base44DeviceCode);
$('openBase44Device').onclick = async () => { if (base44DeviceUrl) await call(window.rbBridge.system.openExternal(base44DeviceUrl)); };
$('copyGitHubCode').onclick = () => copyText(githubDeviceCode);
$('openGitHubDevice').onclick = () => call(window.rbBridge.system.openExternal(GITHUB_DEVICE_URL));
$('owner').onchange = loadRepositories;
$('project').onchange = loadRepositories;
$('repoChoice').onchange = inspectRepositorySelection;
$('repoName').oninput = inspectRepositorySelection;
$('chooseOutput').onclick = async () => { const value = await call(window.rbBridge.system.chooseOutputDirectory()); if (value) $('output').value = value; };
$('cancel').onclick = async () => { await call(window.rbBridge.migration.cancel()); log('Cancelamento solicitado.'); };
$('deliveryMode').onchange = () => {
  const snapshot = $('deliveryMode').value === 'snapshot';
  for (const name of ['standalone', 'supabase', 'build']) document.querySelector(`[data-step="${name}"]`).classList.toggle('disabled', snapshot);
};

$('start').onclick = async () => {
  try {
    const projectOption = $('project').selectedOptions[0];
    const ownerOption = $('owner').selectedOptions[0];
    if (!projectOption || !ownerOption) throw new Error('Conecte as contas e selecione o produto e o destino.');
    if (!$('output').value) throw new Error('Selecione a pasta de entrega.');
    const repositorySelection = selectedRepository();
    if (!repositorySelection?.name) throw new Error('Selecione um repositório existente ou informe o nome do novo repositório.');
    if (!$('authorization').checked) throw new Error('Confirme que o proprietário autorizou a atualização do destino.');

    resetStages();
    $('resultActions').classList.add('hidden');
    lastResult = null;
    setRunning(true);
    setResult('Pipeline em andamento', 'O Bridge está preparando uma entrega independente e validada. Você pode acompanhar as cinco etapas acima.', 'running');
    setOperationSummary('Processando produto', 'A operação será preservada em checkpoints. Se a publicação for interrompida, o trabalho local não será repetido.', 'running');

    const input = {
      acceptedAuthorization: true,
      deliveryMode: $('deliveryMode').value,
      project: { id: projectOption.value, name: projectOption.dataset.name, updatedAt: projectOption.dataset.updatedAt || null },
      outputDirectory: $('output').value,
      buildValidation: true,
      repository: {
        owner: ownerOption.value,
        ownerType: ownerOption.dataset.type,
        strategy: repositorySelection.strategy,
        name: repositorySelection.name,
        description: $('description').value,
        visibility: 'private',
        commitMessage: 'Entrega independente gerada pelo RB Project Bridge',
      },
    };
    log(`Operação iniciada para ${input.repository.owner}/${input.repository.name}.`);
    lastResult = await call(window.rbBridge.migration.start(input));
    const backup = lastResult.previousDefaultBranch?.backupBranch;
    const repository = lastResult.github?.fullName || lastResult.githubRepository?.fullName;
    const message = lastResult.pullRequest
      ? `A atualização foi publicada para revisão no PR #${lastResult.pullRequest.number}; a branch principal foi preservada.`
      : `A aplicação independente foi publicada em ${repository}.`;
    setResult('Produto gerado e entregue', message, 'success', [lastResult.github?.sha ? `Commit ${lastResult.github.sha.slice(0, 7)}` : null, backup ? `Backup ${backup}` : null, lastResult.paths?.previewDir ? 'Preview local disponível' : null]);
    setOperationSummary('Entrega concluída', 'Código independente, build, preview, snapshot e histórico foram validados.', 'success');
    configureResultActions(lastResult);
    showResumeCard(null);
  } catch (error) {
    const recovery = applyRecovery(error);
    if (recovery?.canRetryPublish) {
      stage('github-publish', 'partial', error.message);
      setResult('Produto gerado; entrega pendente', 'A exportação, a conversão e o build já estão preservados. Use “Continuar do ponto salvo” para concluir somente a publicação.', 'attention', [recovery.buildPassed ? 'Build aprovado' : null, recovery.snapshotPublished ? 'Snapshot publicado' : null, recovery.previewDir ? 'Preview disponível' : null]);
      setOperationSummary('Ação necessária', 'O produto está pronto localmente. A próxima tentativa retomará apenas a entrega pendente.', 'attention');
    } else {
      setResult('Pipeline interrompido', error.message, 'error');
      setOperationSummary('Operação não concluída', 'Consulte a mensagem principal; os detalhes técnicos ficam disponíveis abaixo.', 'error');
    }
    const violations = error.details?.violations || [];
    log(`ERRO: ${error.message}${violations.length ? `\n- ${violations.join('\n- ')}` : ''}`);
    await refreshRetryAction();
  } finally { setRunning(false); }
};

$('retryLast').onclick = async () => {
  if (!lastRetryJobRoot) return setResult('Nenhum checkpoint disponível', 'Não existe uma entrega pendente que possa ser continuada.', 'error');
  try {
    setRunning(true);
    stage('github-publish', 'running');
    setResult('Continuando do ponto salvo', 'Exportação, conversão, instalação e build não serão repetidos.', 'running');
    setOperationSummary('Retomando entrega', 'Somente as etapas pendentes serão executadas.', 'running');
    log('Retomando a última entrega a partir do checkpoint local...');
    lastResult = await call(window.rbBridge.migration.retryPublish(lastRetryJobRoot));
    stage('github-publish', 'complete');
    setResult('Entrega concluída', `Produto publicado em ${lastResult.github.fullName} (${lastResult.github.sha.slice(0, 7)}).`, 'success', [lastResult.pullRequest ? `PR #${lastResult.pullRequest.number}` : null, lastResult.paths?.previewDir ? 'Preview disponível' : null]);
    setOperationSummary('Entrega concluída', 'O checkpoint foi consumido sem repetir as etapas já aprovadas.', 'success');
    configureResultActions(lastResult);
    showResumeCard(null);
  } catch (error) {
    applyRecovery(error);
    stage('github-publish', 'partial', error.message);
    setResult('Entrega ainda pendente', error.message, 'attention');
    setOperationSummary('Checkpoint preservado', 'Nada foi perdido. A próxima continuação partirá do mesmo ponto.', 'attention');
    log(`Retomada: ${error.message}`);
  } finally { setRunning(false); }
};

$('openPreview').onclick = async () => {
  if (!lastResult?.paths?.previewDir) return setResult('Preview indisponível', 'Esta operação não gerou um preview local.', 'error');
  try {
    const state = await call(window.rbBridge.preview.start(lastResult.paths.previewDir));
    setResult('Preview aberto', `A aplicação está navegável em ${state.url}.`, 'success', ['Modo demo local']);
  } catch (error) { setResult('Não foi possível abrir o preview', error.message, 'error'); }
};
$('stopPreview').onclick = async () => { await call(window.rbBridge.preview.stop()); setResult('Preview encerrado', 'O servidor local foi finalizado.', 'idle'); };
$('openFolder').onclick = () => lastResult?.paths?.jobRoot && call(window.rbBridge.system.openPath(lastResult.paths.jobRoot));
$('openRepo').onclick = () => {
  const url = lastResult?.pullRequest?.url || lastResult?.github?.url || lastResult?.recovery?.repositoryUrl;
  if (url) call(window.rbBridge.system.openExternal(url));
};

for (const channel of ['base44:auth', 'base44:output', 'github:output', 'build:output', 'migration:progress', 'toolchain:progress']) {
  window.rbBridge.on(channel, (event) => {
    if (channel === 'base44:auth') {
      showBase44Authorization(event);
      log(`Código Base44: ${event.userCode}`);
      return;
    }
    const text = event.text || event.message || '';
    if (text) log(text);
    if (channel === 'github:output') {
      const code = String(text).match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/i)?.[0]?.toUpperCase();
      if (code) showGitHubCode(code);
    }
    if (channel === 'migration:progress') {
      const map = {
        'base44-export': 'export',
        sanitize: 'export',
        standalone: 'standalone',
        build: 'build',
        'github-auth': 'github-publish',
        'github-publish': 'github-publish',
        'github-snapshot': 'github-publish',
      };
      const target = map[event.step];
      const normalized = event.status === 'complete' ? 'complete' : event.status === 'failed' ? 'failed' : event.status === 'partial' ? 'partial' : 'running';
      if (target) stage(target, normalized, event.message);
      if (event.step === 'standalone' && event.status === 'complete') stage('supabase', 'complete', event.message);
      if (event.message) setOperationSummary(operationRunning ? 'Processando produto' : 'Estado da operação', event.message, normalized === 'failed' ? 'error' : normalized === 'partial' ? 'attention' : normalized);
    }
  });
}

setRunning(false);
load();
