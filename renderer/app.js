'use strict';

const $ = (id) => document.getElementById(id);
const log = (text) => {
  $('log').textContent += `${text}\n`;
  $('log').scrollTop = $('log').scrollHeight;
};

async function call(promise) {
  const result = await promise;
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
  return result.data;
}

function showAuthInstruction(provider, text) {
  const url = String(text).match(/https:\/\/[^\s<>"']+/i)?.[0];
  if (url) void call(window.rbBridge.system.openExternal(url)).catch((error) => log(`Não foi possível abrir o navegador: ${error.message}`));
  const code = String(text).match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/i)?.[0]?.toUpperCase();
  if (!code) return;
  $('result').className = 'success';
  $('result').textContent = `${provider}: use o código ${code} na página de autorização aberta no navegador.`;
}

async function load() {
  try {
    const status = await call(window.rbBridge.system.status());
    $('base44Status').textContent = status.base44?.loggedIn ? 'Conectado' : 'Não conectado';
    $('githubStatus').textContent = status.github?.authenticated ? 'Conectado' : 'Não conectado';
    if (status.base44?.loggedIn) await projects();
    if (status.github?.authenticated) await accounts();
  } catch (error) {
    log(error.message);
  }
}

async function projects() {
  const list = await call(window.rbBridge.base44.projects());
  $('project').innerHTML = list.map((project) => `<option value="${project.id}" data-name="${project.name.replaceAll('"', '&quot;')}">${project.name}</option>`).join('');
}

async function accounts() {
  const data = await call(window.rbBridge.github.accounts());
  $('owner').innerHTML = data.accounts.map((account) => `<option value="${account.login}" data-type="${account.type}">${account.label}</option>`).join('');
}

$('base44Login').onclick = async () => {
  const button = $('base44Login');
  try {
    button.disabled = true;
    $('base44Status').textContent = 'Aguardando autorização...';
    $('result').className = '';
    $('result').textContent = 'Conclua a autorização Base44 na janela do navegador.';
    log('Abrindo autorização Base44...');
    await call(window.rbBridge.base44.login());
    $('base44Status').textContent = 'Conectado';
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
    $('githubStatus').textContent = 'Aguardando autorização...';
    $('result').className = '';
    $('result').textContent = 'O navegador será aberto. Copie o código exibido no log para concluir a autorização.';
    log('Abrindo autorização GitHub...');
    await call(window.rbBridge.system.openExternal('https://github.com/login/device'));
    await call(window.rbBridge.github.login());
    $('githubStatus').textContent = 'Conectado';
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
