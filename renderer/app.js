'use strict';
const GITHUB_DEVICE_URL = 'https://github.com/login/device';
const $ = (id) => document.getElementById(id);
let githubDeviceCode = '', base44DeviceCode = '', base44DeviceUrl = '', lastResult = null;
const log = (text) => { $('log').textContent += `${text}\n`; $('log').scrollTop = $('log').scrollHeight; };
async function call(promise) { const result = await promise; if (!result.ok) throw Object.assign(new Error(result.error.message), result.error); return result.data; }
function setResult(text, kind = '') { $('result').className = kind; $('result').textContent = text; }
function stage(step, status) { const item = document.querySelector(`[data-step="${step}"]`); if (!item) return; item.classList.remove('running', 'complete', 'failed'); if (status) item.classList.add(status); }
function resetStages() { document.querySelectorAll('.pipeline>div').forEach((item) => item.classList.remove('running', 'complete', 'failed')); }
function showGitHubCode(code) { githubDeviceCode = code; $('githubDeviceCode').textContent = code; $('githubAuthBox').classList.remove('hidden'); setResult(`Digite o código ${code} na página do GitHub.`); }
function showBase44Authorization(payload) { base44DeviceCode = payload.userCode || ''; base44DeviceUrl = payload.url || ''; $('base44DeviceCode').textContent = base44DeviceCode || '—'; $('base44AuthBox').classList.remove('hidden'); setResult(base44DeviceCode ? `Confirme o código ${base44DeviceCode} na Base44.` : 'Conclua a autorização na Base44.'); }
async function copyText(text) { if (!text) return; try { await navigator.clipboard.writeText(text); } catch { const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); } }
async function projects() { const list = await call(window.rbBridge.base44.projects()); const select = $('project'); select.replaceChildren(); for (const project of list) { const option = document.createElement('option'); option.value = project.id; option.dataset.name = project.name; option.textContent = project.name; select.appendChild(option); } }
async function accounts() { const data = await call(window.rbBridge.github.accounts()); const select = $('owner'); select.replaceChildren(); for (const account of data.accounts) { const option = document.createElement('option'); option.value = account.login; option.dataset.type = account.type; option.textContent = account.label; select.appendChild(option); } }
async function load() { try { const status = await call(window.rbBridge.system.status()); $('version').textContent = `v${status.version}`; $('base44Status').textContent = status.base44?.loggedIn ? 'Conectado' : 'Não conectado'; $('githubStatus').textContent = status.github?.authenticated ? 'Conectado' : 'Não conectado'; if (status.base44?.loggedIn) { $('base44AuthBox').classList.add('hidden'); await projects(); } if (status.github?.authenticated) { $('githubAuthBox').classList.add('hidden'); await accounts(); } } catch (error) { log(error.message); } }
$('base44Login').onclick = async () => { const button = $('base44Login'); try { button.disabled = true; $('base44DeviceCode').textContent = 'Gerando...'; $('base44AuthBox').classList.remove('hidden'); $('base44Status').textContent = 'Aguardando...'; log('Abrindo autorização Base44...'); await call(window.rbBridge.base44.login()); $('base44Status').textContent = 'Conectado'; $('base44AuthBox').classList.add('hidden'); setResult('Base44 conectada.', 'success'); await projects(); } catch (error) { $('base44Status').textContent = 'Não conectado'; setResult(error.message, 'error'); log(`ERRO Base44: ${error.message}`); } finally { button.disabled = false; } };
$('githubLogin').onclick = async () => { const button = $('githubLogin'); try { button.disabled = true; $('githubDeviceCode').textContent = 'Aguardando...'; $('githubAuthBox').classList.remove('hidden'); $('githubStatus').textContent = 'Aguardando...'; await call(window.rbBridge.system.openExternal(GITHUB_DEVICE_URL)); await call(window.rbBridge.github.login()); $('githubStatus').textContent = 'Conectado'; $('githubAuthBox').classList.add('hidden'); setResult('GitHub conectado.', 'success'); await accounts(); } catch (error) { $('githubStatus').textContent = 'Não conectado'; setResult(error.message, 'error'); log(`ERRO GitHub: ${error.message}`); } finally { button.disabled = false; } };
$('copyBase44Code').onclick = () => copyText(base44DeviceCode); $('openBase44Device').onclick = async () => { if (base44DeviceUrl) await call(window.rbBridge.system.openExternal(base44DeviceUrl)); };
$('copyGitHubCode').onclick = () => copyText(githubDeviceCode); $('openGitHubDevice').onclick = () => call(window.rbBridge.system.openExternal(GITHUB_DEVICE_URL));
$('chooseOutput').onclick = async () => { const value = await call(window.rbBridge.system.chooseOutputDirectory()); if (value) $('output').value = value; };
$('cancel').onclick = async () => { await call(window.rbBridge.migration.cancel()); log('Cancelamento solicitado.'); };
$('deliveryMode').onchange = () => { const snapshot = $('deliveryMode').value === 'snapshot'; for (const name of ['standalone', 'supabase', 'build']) document.querySelector(`[data-step="${name}"]`).classList.toggle('disabled', snapshot); };
$('start').onclick = async () => {
  try {
    const projectOption = $('project').selectedOptions[0], ownerOption = $('owner').selectedOptions[0];
    if (!projectOption || !ownerOption) throw new Error('Conecte as contas e selecione projeto e destino.');
    if (!$('output').value) throw new Error('Selecione a pasta de entrega.');
    resetStages(); $('resultActions').classList.add('hidden'); lastResult = null; setResult('');
    const input = { acceptedAuthorization: $('authorization').checked, deliveryMode: $('deliveryMode').value, project: { id: projectOption.value, name: projectOption.dataset.name }, outputDirectory: $('output').value, buildValidation: true, repository: { owner: ownerOption.value, ownerType: ownerOption.dataset.type, name: $('repoName').value || projectOption.dataset.name, description: $('description').value, visibility: 'private', commitMessage: 'Entrega independente gerada pelo RB Project Bridge' } };
    log('Pipeline iniciado...'); $('start').disabled = true;
    lastResult = await call(window.rbBridge.migration.start(input));
    setResult(`Concluído: ${lastResult.github.fullName} (${lastResult.github.sha.slice(0, 7)}).`, 'success'); $('resultActions').classList.remove('hidden');
  } catch (error) { setResult(error.message, 'error'); log(`ERRO: ${error.message}`); } finally { $('start').disabled = false; }
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
