'use strict';

const GITHUB_DEVICE_URL = 'https://github.com/login/device';
const $ = (id) => document.getElementById(id);
let githubDeviceCode = '';

const log = (text) => {
  $('log').textContent += `${text}\n`;
  $('log').scrollTop = $('log').scrollHeight;
};

async function call(promise) {
  const result = await promise;
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
  return result.data;
}

function showGitHubCode(code) {
  githubDeviceCode = code;
  $('githubDeviceCode').textContent = code;
  $('githubAuthBox').classList.remove('hidden');
  $('result').className = '';
  $('result').textContent = `Digite o código ${code} na página de autorização do GitHub.`;
}

function showAuthInstruction(provider, text) {
  const content = String(text);
  const code = content.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/i)?.[0]?.toUpperCase();
  if (provider === 'GitHub' && code) showGitHubCode(code);
  if (provider === 'Base44' && /https:\/\/[^\s<>"']+/i.test(content)) {
    $('base44AuthBox').classList.remove('hidden');
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

async function load() {
  try {
    const status = await call(window.rbBridge.system.status());
    $('base44Status').textContent = status.base44?.loggedIn ? 'Conectado' : 'Não conectado';
    $('githubStatus').textContent = status.github?.authenticated ? 'Conectado' : 'Não conectado';
    if (status.base44?.loggedIn) await projects();
    if (status.github?.authenticated) {
      $('githubAuthBox').classList.add('hidden');
      await accounts();
    }
  } catch (error) {
    log(error.message);
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
    option.textContent = project.name;
    select.appendChild(option);
  }
}

async function accounts() {
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
}

$('base44Login').onclick = async () => {
  const button = $('base44Login');
  try {
    button.disabled = true;
    $('base44Status').textContent = 'Aguardando autorização...';
    $('base44AuthBox').classList.add('hidden');
    $('result').className = '';
    $('result').textContent = 'Aguarde a abertura da autorização Base44 no navegador.';
    log('Abrindo autorização Base44...');
    await call(window.rbBridge.base44.login());
    $('base44Status').textContent = 'Conectado';
    $('base44AuthBox').classList.add('hidden');
    $('result').className = 'success';
    $('result').textContent = 'Base44 conectado com sucesso.';
    await projects();
  } catch (error) {
    $('base44Status').textContent = 'Não conectado';
    $('result').className = 'error';
    $('result').textContent = error.message;
    log(`ERRO Base44: ${error.message}`);
  } finally {
    button.disabled = false;
  }
};

$('githubLogin').onclick = async () => {
  const button = $('githubLogin');
  try {
    button.disabled = true;
    githubDeviceCode = '';
    $('githubDeviceCode').textContent = 'Aguardando código...';
    $('githubAuthBox').classList.remove('hidden');
    $('githubStatus').textContent = 'Aguardando autorização...';
    $('result').className = '';
    $('result').textContent = 'A página do GitHub será aberta. O código aparecerá em destaque acima.';
    log('Abrindo autorização GitHub...');
    await call(window.rbBridge.system.openExternal(GITHUB_DEVICE_URL));
    await call(window.rbBridge.github.login());
    $('githubStatus').textContent = 'Conectado';
    $('githubAuthBox').classList.add('hidden');
    $('result').className = 'success';
    $('result').textContent = 'GitHub conectado com sucesso.';
    await accounts();
  } catch (error) {
    $('githubStatus').textContent = 'Não conectado';
    $('result').className = 'error';
    $('result').textContent = error.message;
    log(`ERRO GitHub: ${error.message}`);
  } finally {
    button.disabled = false;
  }
};

$('copyGitHubCode').onclick = async () => {
  if (!githubDeviceCode) return;
  await copyText(githubDeviceCode);
  $('result').className = 'success';
  $('result').textContent = `Código ${githubDeviceCode} copiado.`;
};

$('openGitHubDevice').onclick = async () => {
  await call(window.rbBridge.system.openExternal(GITHUB_DEVICE_URL));
};

$('chooseOutput').onclick = async () => {
  const value = await call(window.rbBridge.system.chooseOutputDirectory());
  if (value) $('output').value = value;
};

$('cancel').onclick = async () => {
  await call(window.rbBridge.migration.cancel());
  log('Cancelamento solicitado.');
};

$('start').onclick = async () => {
  try {
    const projectOption = $('project').selectedOptions[0];
    const ownerOption = $('owner').selectedOptions[0];
    if (!projectOption || !ownerOption) throw new Error('Conecte as contas e selecione projeto e destino.');
    $('result').textContent = '';
    const input = {
      acceptedAuthorization: $('authorization').checked,
      project: { id: projectOption.value, name: projectOption.dataset.name },
      outputDirectory: $('output').value,
      buildValidation: $('buildValidation').checked,
      repository: {
        owner: ownerOption.value,
        ownerType: ownerOption.dataset.type,
        name: $('repoName').value || projectOption.dataset.name,
        description: $('description').value,
        visibility: $('publicRepo').checked ? 'public' : 'private',
        commitMessage: 'Migração inicial do Base44',
      },
    };
    log('Migração iniciada...');
    const result = await call(window.rbBridge.migration.start(input));
    $('result').className = 'success';
    $('result').textContent = `Concluído: ${result.github.fullName} (${result.github.sha.slice(0, 7)})`;
    if (result.github.url) await call(window.rbBridge.system.openExternal(result.github.url));
  } catch (error) {
    $('result').className = 'error';
    $('result').textContent = error.message;
    log(`ERRO: ${error.message}`);
  }
};

for (const channel of ['base44:output', 'github:output', 'build:output', 'migration:progress', 'toolchain:progress']) {
  window.rbBridge.on(channel, (event) => {
    const text = event.text || event.message || JSON.stringify(event);
    log(text);
    if (channel === 'github:output') showAuthInstruction('GitHub', text);
    if (channel === 'base44:output') showAuthInstruction('Base44', text);
  });
}

load();
