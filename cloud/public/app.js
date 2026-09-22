'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  apiKey: sessionStorage.getItem('rbBridgePilotKey') || '',
  base44Connection: null,
  gitConnection: null,
  gitUser: null,
  projects: [],
  selectedProject: null,
  currentJobId: sessionStorage.getItem('rbBridgeJobId') || null,
  pollTimer: null,
};

function setText(id, text, tone = '') {
  const node = $(id);
  node.textContent = text;
  node.classList.toggle('muted', tone === 'muted');
}

function headers(extra = {}) {
  return { Authorization: `Bearer ${state.apiKey}`, ...extra };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: headers(options.headers || {}) });
  let data = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) data = await response.json();
  else data = await response.text();
  if (!response.ok) {
    const message = data?.message || data?.error || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function readyForJob() {
  return Boolean(state.apiKey && state.base44Connection?.id && state.gitConnection?.id && state.selectedProject && $('authorization').checked && $('repoOwner').value.trim() && $('repoName').value.trim());
}

function refreshControls() {
  const authed = Boolean(state.apiKey);
  $('connectBase44').disabled = !authed;
  $('connectGitLab').disabled = !authed;
  $('startJob').disabled = !readyForJob();
}

async function validateAccess() {
  try {
    const caps = await api('/v1/capabilities');
    setText('accessStatus', `Acesso liberado · destino ${caps.destinations.join(', ')} · ${caps.runtimeValidation}`);
    refreshControls();
    if (state.currentJobId) void monitorJob(state.currentJobId);
  } catch (error) {
    setText('accessStatus', error.status === 401 ? 'Chave inválida.' : `Falha ao validar: ${error.message}`);
    state.apiKey = '';
    sessionStorage.removeItem('rbBridgePilotKey');
    refreshControls();
  }
}

async function saveKey() {
  state.apiKey = $('apiKey').value.trim();
  if (!state.apiKey) return setText('accessStatus', 'Informe a chave do piloto.');
  sessionStorage.setItem('rbBridgePilotKey', state.apiKey);
  await validateAccess();
}

async function connectBase44() {
  $('connectBase44').disabled = true;
  setText('base44Status', 'Solicitando autorização à Base44…');
  try {
    const device = await api('/v1/auth/base44/device', { method: 'POST' });
    $('base44Device').classList.remove('hidden');
    $('base44Code').textContent = device.userCode;
    $('base44Link').href = device.verificationUri;
    window.open(device.verificationUri, '_blank', 'noopener');
    setText('base44Status', 'Autorize a conta na janela da Base44. Esta tela continuará automaticamente.');
    await pollBase44(device);
  } catch (error) {
    setText('base44Status', `Falha: ${error.message}`);
    $('connectBase44').disabled = false;
  }
}

async function pollBase44(device) {
  const deadline = Date.now() + Number(device.expiresIn || 600) * 1000;
  let waitMs = Math.max(1500, Number(device.interval || 5) * 1000);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      const result = await api(`/v1/auth/base44/device/${device.sessionId}/poll`, { method: 'POST' });
      if (result.pending) {
        if (result.slowDown) waitMs += 5000;
        continue;
      }
      state.base44Connection = result.connection;
      $('base44Device').classList.add('hidden');
      setText('base44Status', `Base44 conectada: ${result.connection.metadata?.email || 'conta autorizada'}. Carregando projetos…`);
      await loadProjects();
      refreshControls();
      return;
    } catch (error) {
      if (error.status === 410) break;
      if (error.status === 202) continue;
      setText('base44Status', `Falha durante autorização: ${error.message}`);
      break;
    }
  }
  $('connectBase44').disabled = false;
  setText('base44Status', 'A autorização expirou. Clique em conectar novamente.');
}

async function loadProjects() {
  const data = await api(`/v1/base44/projects?connectionId=${encodeURIComponent(state.base44Connection.id)}`);
  state.projects = data.projects || [];
  const select = $('projectSelect');
  select.innerHTML = '<option value="">Selecione o projeto</option>';
  for (const project of state.projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = `${project.name}${project.ejectable === false ? ' · exportação indisponível' : ''}`;
    option.disabled = project.ejectable === false;
    select.appendChild(option);
  }
  select.disabled = false;
  const agile = state.projects.find((project) => /agile\s*hub/i.test(project.name));
  if (agile) {
    select.value = agile.id;
    state.selectedProject = agile;
    setText('base44Status', `Base44 conectada · ${state.projects.length} projeto(s). Agile Hub selecionado automaticamente.`);
  } else {
    setText('base44Status', `Base44 conectada · ${state.projects.length} projeto(s) disponível(is).`);
  }
  refreshControls();
}

function selectProject() {
  state.selectedProject = state.projects.find((item) => item.id === $('projectSelect').value) || null;
  if (state.selectedProject && !$('repoName').dataset.edited) {
    $('repoName').value = state.selectedProject.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'agile-hub';
  }
  refreshControls();
}

async function connectGitLab() {
  const token = $('gitlabToken').value.trim();
  if (!token) return setText('gitlabStatus', 'Informe o token GitLab.');
  $('connectGitLab').disabled = true;
  setText('gitlabStatus', 'Validando token e escopos…');
  try {
    const data = await api('/v1/auth/gitlab/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, baseUrl: $('gitlabUrl').value.trim() || 'https://gitlab.com' }),
    });
    $('gitlabToken').value = '';
    state.gitConnection = data.connection;
    state.gitUser = data.user;
    if (!$('repoOwner').value.trim() && data.user?.username) $('repoOwner').value = data.user.username;
    setText('gitlabStatus', `GitLab conectado: ${data.user?.username || 'conta válida'} · escopos ${data.scopes?.join(', ') || 'validados'}.`);
  } catch (error) {
    setText('gitlabStatus', `Falha: ${error.message}`);
  } finally {
    $('connectGitLab').disabled = false;
    refreshControls();
  }
}

async function startJob() {
  if (!readyForJob()) return;
  $('startJob').disabled = true;
  setText('startStatus', 'Criando job de migração…');
  const body = {
    project: state.selectedProject,
    repository: {
      provider: 'gitlab', owner: $('repoOwner').value.trim(), name: $('repoName').value.trim(),
      strategy: $('repoStrategy').value, ownerType: 'user', description: 'Agile Hub migrado da Base44 pelo RB Project Bridge',
    },
    connections: { base44: state.base44Connection.id, git: state.gitConnection.id },
    deliveryMode: $('deliveryMode').value,
    deliveryContext: {
      deliveryPackage: $('deliveryPackage').value,
      targetProfile: $('deliveryMode').value === 'snapshot' ? 'repository-only' : 'supabase-cloud-static',
      clientName: 'RB HUB', deliveryOwner: 'RB Project Bridge Cloud Pilot',
      migrationScope: { data: true, users: true, storage: true, integrations: true, deployment: false },
    },
  };
  try {
    const data = await api('/v1/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    state.currentJobId = data.job.id;
    sessionStorage.setItem('rbBridgeJobId', data.job.id);
    $('jobPanel').classList.remove('hidden');
    setText('startStatus', `Job ${data.job.id.slice(0, 8)} criado. O worker assumirá a execução.`);
    await monitorJob(data.job.id);
  } catch (error) {
    setText('startStatus', `Não foi possível iniciar: ${error.message}`);
    refreshControls();
  }
}

function renderJob(job) {
  $('jobPanel').classList.remove('hidden');
  $('jobState').textContent = job.state;
  const project = job.input?.project?.name || 'projeto';
  const repo = `${job.input?.repository?.owner || ''}/${job.input?.repository?.name || ''}`;
  setText('jobSummary', `${project} → GitLab ${repo} · tentativa ${job.attempts || 0}`);
  const progress = $('progress');
  progress.innerHTML = '';
  for (const event of job.progress || []) {
    const item = document.createElement('div');
    item.className = 'entry';
    const step = event.step || event.channel || 'bridge';
    const message = event.message || event.text || JSON.stringify(event);
    item.innerHTML = `<strong>${escapeHtml(step)}</strong> · ${escapeHtml(message)}`;
    progress.appendChild(item);
  }
  if (job.error) {
    const item = document.createElement('div');
    item.className = 'entry';
    item.innerHTML = `<strong>erro</strong> · ${escapeHtml(job.error.message || job.error.code)}`;
    progress.appendChild(item);
  }
  const repository = job.result?.repository;
  $('repositoryLink').classList.toggle('hidden', !repository);
  if (repository) $('repositoryLink').href = repository;
  $('downloadArtifact').classList.toggle('hidden', !(job.state === 'completed' && job.result?.downloadPath));
  progress.scrollTop = progress.scrollHeight;
}

async function monitorJob(id) {
  clearTimeout(state.pollTimer);
  try {
    const data = await api(`/v1/jobs/${id}`);
    renderJob(data.job);
    if (['completed', 'failed', 'cancelled'].includes(data.job.state)) {
      refreshControls();
      if (data.job.state === 'completed') setText('startStatus', 'Migração concluída. Revise o GitLab e baixe o pacote de entrega.');
      else setText('startStatus', `Migração encerrada como ${data.job.state}. Veja o erro abaixo.`);
      return;
    }
    state.pollTimer = setTimeout(() => monitorJob(id), 2500);
  } catch (error) {
    setText('jobSummary', `Falha ao consultar job: ${error.message}`);
    state.pollTimer = setTimeout(() => monitorJob(id), 5000);
  }
}

async function downloadArtifact() {
  if (!state.currentJobId) return;
  const response = await fetch(`/v1/jobs/${state.currentJobId}/download`, { headers: headers() });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return setText('startStatus', `Download indisponível: ${data.message || data.error || response.status}`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'rb-project-bridge-delivery.zip';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function checkHealth() {
  try {
    const response = await fetch('/health');
    const data = await response.json();
    $('healthBadge').textContent = data.ok ? `online · ${data.version}` : 'indisponível';
  } catch { $('healthBadge').textContent = 'offline'; }
}

$('saveKey').addEventListener('click', saveKey);
$('apiKey').addEventListener('keydown', (event) => { if (event.key === 'Enter') void saveKey(); });
$('connectBase44').addEventListener('click', connectBase44);
$('projectSelect').addEventListener('change', selectProject);
$('connectGitLab').addEventListener('click', connectGitLab);
$('authorization').addEventListener('change', refreshControls);
$('repoOwner').addEventListener('input', refreshControls);
$('repoName').addEventListener('input', () => { $('repoName').dataset.edited = '1'; refreshControls(); });
$('startJob').addEventListener('click', startJob);
$('downloadArtifact').addEventListener('click', downloadArtifact);

$('apiKey').value = state.apiKey;
refreshControls();
void checkHealth();
if (state.apiKey) void validateAccess();
