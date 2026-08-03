'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = { status: null, accounts: [] };

  function mountPanel() {
    if ($('googleWorkspaceCard')) return;
    const section = document.createElement('section');
    section.id = 'googleWorkspaceCard';
    section.className = 'card';
    section.innerHTML = `
      <div class="section-heading"><div><span class="eyebrow">Integração transversal</span><h2>Google Workspace, Gemini e notebooks</h2></div><p>Conecte várias contas sem substituir as existentes. Credenciais ficam somente no cofre criptografado deste computador.</p></div>
      <div class="google-status-row"><span id="googleVaultStatus" class="status disconnected">Verificando cofre</span><span id="googleOauthStatus" class="status disconnected">OAuth pendente</span><span id="geminiStatus" class="status disconnected">Gemini API pendente</span><span id="notebookStatus" class="status disconnected">Notebook pendente</span></div>
      <div class="google-grid">
        <div class="google-panel">
          <h3>1. Identidade OAuth da RB HUB</h3>
          <p>Use um Client ID do Google Cloud do tipo Aplicativo para computador. A senha da conta Google nunca passa pelo Bridge.</p>
          <label>OAuth Client ID<input id="googleClientId" autocomplete="off" placeholder="000000000000-...apps.googleusercontent.com"></label>
          <label>Client Secret opcional<input id="googleClientSecret" type="password" autocomplete="new-password" placeholder="Armazenado somente no cofre local"></label>
          <button id="saveGoogleOauth" type="button">Salvar OAuth com segurança</button>
          <div class="google-warning">Para uso privado, mantenha o aplicativo OAuth em teste e cadastre suas duas contas como usuários de teste. Distribuição pública exige revisão dos escopos pelo Google.</div>
        </div>
        <div class="google-panel">
          <h3>2. Adicionar conta Google</h3>
          <p>Repita o processo para a conta pessoal e para <strong>rbhubsolucoes@gmail.com</strong>.</p>
          <label>Rótulo da conta<input id="googleAccountLabel" placeholder="Pessoal ou RB HUB"></label>
          <div class="google-service-grid">
            <label><input data-google-service type="checkbox" value="gmail" checked> Gmail</label>
            <label><input data-google-service type="checkbox" value="drive" checked> Drive e Docs</label>
            <label><input data-google-service type="checkbox" value="calendar" checked> Agenda</label>
            <label><input data-google-service type="checkbox" value="contacts" checked> Contatos</label>
            <label><input data-google-service type="checkbox" value="notebook"> Google Cloud/Notebook</label>
          </div>
          <div class="row"><button id="connectGoogleAccount" type="button">Adicionar conta Google</button><button id="refreshGoogleAccounts" class="secondary" type="button">Atualizar lista</button></div>
        </div>
      </div>
      <div id="googleAccounts" class="google-accounts"></div>
      <div class="google-grid google-ai-grid">
        <div class="google-panel">
          <h3>3. Gemini Developer API</h3>
          <p>A assinatura Google AI Pro não substitui a API. Informe uma chave separada somente quando decidir ativar uso programático.</p>
          <label>Gemini API Key<input id="geminiApiKey" type="password" autocomplete="new-password" placeholder="Não será exibida novamente"></label>
          <label>Modelo<input id="geminiModel" value="gemini-2.5-flash"></label>
          <div class="row"><button id="saveGoogleAi" type="button">Salvar IA</button><button id="testGemini" class="secondary" type="button">Testar Gemini</button></div>
        </div>
        <div class="google-panel">
          <h3>4. Gemini Notebook Enterprise</h3>
          <p>Requer projeto Google Cloud, Discovery Engine API, IAM e licença própria. A API está em prévia.</p>
          <label>Número do projeto Google Cloud<input id="notebookProjectNumber" inputmode="numeric" placeholder="123456789012"></label>
          <label>Multirregião<select id="notebookLocation"><option value="global">global</option><option value="us">us</option><option value="eu">eu</option></select></label>
          <label>Conta autorizada<select id="notebookAccount"><option value="">Conecte uma conta primeiro</option></select></label>
          <button id="listNotebooks" class="secondary" type="button">Validar e listar notebooks</button>
        </div>
      </div>
      <div id="googleNotice" class="google-notice idle" aria-live="polite">Integração pronta para configurar.</div>`;
    const cards = document.querySelectorAll('main > section.card');
    if (cards[0]?.nextSibling) cards[0].parentNode.insertBefore(section, cards[0].nextSibling);
    else document.querySelector('main')?.appendChild(section);
  }

  async function invoke(promise) {
    const result = await promise;
    if (!result?.ok) throw Object.assign(new Error(result?.error?.message || 'Falha na integração Google.'), result?.error || {});
    return result.data;
  }

  function setNotice(message, kind = 'idle') {
    const notice = $('googleNotice');
    if (!notice) return;
    notice.className = `google-notice ${kind}`;
    notice.textContent = message;
  }

  function selectedServices() {
    return [...document.querySelectorAll('[data-google-service]:checked')].map((input) => input.value);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
  }

  function serviceSummary(sync) {
    if (!sync?.services) return 'Ainda não sincronizada';
    const labels = [];
    const gmail = sync.services.gmail;
    const drive = sync.services.drive;
    const calendar = sync.services.calendar;
    const contacts = sync.services.contacts;
    if (gmail?.ok) labels.push(`${formatNumber(gmail.messagesTotal)} e-mails`);
    if (drive?.ok) labels.push(`${formatNumber(drive.sampledFiles)} arquivos${drive.truncated ? '+' : ''}`);
    if (calendar?.ok) labels.push(`${formatNumber(calendar.calendars)} agendas`);
    if (contacts?.ok) labels.push(`${formatNumber(contacts.connections)} contatos${contacts.truncated ? '+' : ''}`);
    const failures = Object.values(sync.services).filter((service) => !service.ok).length;
    if (failures) labels.push(`${failures} serviço(s) pendente(s)`);
    return labels.join(' · ') || 'Sem dados disponíveis';
  }

  function renderAccounts() {
    const container = $('googleAccounts');
    container.replaceChildren();
    if (!state.accounts.length) {
      const empty = document.createElement('div');
      empty.className = 'google-empty';
      empty.textContent = 'Nenhuma conta conectada. Você poderá adicionar a pessoal e a empresarial sem substituir uma pela outra.';
      container.appendChild(empty);
      return;
    }
    for (const account of state.accounts) {
      const card = document.createElement('article');
      card.className = 'google-account-card';
      const identity = document.createElement('div');
      identity.className = 'google-account-identity';
      const avatar = document.createElement('span');
      avatar.className = 'google-account-avatar';
      avatar.textContent = String(account.label || account.name || account.email || 'G').trim().slice(0, 1).toUpperCase();
      identity.appendChild(avatar);
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = account.label ? `${account.label} · ${account.email}` : account.email;
      const detail = document.createElement('small');
      detail.textContent = `${account.services.join(', ')} · ${serviceSummary(account.lastSync)}`;
      text.append(title, detail);
      identity.appendChild(text);

      const actions = document.createElement('div');
      actions.className = 'google-account-actions';
      const sync = document.createElement('button');
      sync.type = 'button';
      sync.textContent = 'Sincronizar';
      sync.onclick = async () => {
        try {
          sync.disabled = true;
          setNotice(`Sincronizando ${account.email}...`, 'running');
          const result = await invoke(window.rbBridge.google.inventory(account.id));
          setNotice(`Sincronização concluída: ${result.healthyServices} serviço(s) acessível(is).`, result.failedServices ? 'attention' : 'success');
          await loadStatus();
        } catch (error) { setNotice(error.message, 'error'); }
        finally { sync.disabled = false; }
      };
      const dossier = document.createElement('button');
      dossier.type = 'button';
      dossier.className = 'secondary';
      dossier.textContent = 'Criar documento mestre';
      dossier.onclick = async () => {
        try {
          dossier.disabled = true;
          const generatedAt = new Date().toLocaleString('pt-BR');
          const content = [
            'RB HUB — Contexto mestre de integração',
            '',
            `Conta Google: ${account.email}`,
            `Rótulo: ${account.label || 'não informado'}`,
            `Gerado em: ${generatedAt}`,
            '',
            'Objetivo',
            'Centralizar o contexto dos projetos RB HUB para uso no Gemini, Google Drive e, futuramente, Gemini Notebook Enterprise.',
            '',
            'Projeto de controle',
            'RB Project Bridge — aplicativo desktop para preservar aplicações, gerar workspaces independentes, validar migrações e produzir pacotes formais de entrega.',
            '',
            'Integrações previstas',
            '- Gmail: consulta, pesquisa, organização e envio autorizado.',
            '- Drive/Docs/Sheets/Slides: geração, atualização e organização de documentos.',
            '- Google Calendar: agendas e eventos dos projetos.',
            '- Google Contacts: resolução de destinatários e participantes.',
            '- Gemini Developer API: geração e análise dentro dos produtos.',
            '- Gemini Notebook Enterprise: notebooks e fontes sincronizados por projeto quando a licença e o Google Cloud estiverem ativos.',
            '',
            'Segurança',
            'Tokens ficam criptografados pelo cofre do sistema operacional. Senhas, refresh tokens e chaves de API não devem ser colocados em repositórios ou documentos.',
            '',
            'Última sincronização',
            JSON.stringify(account.lastSync || { status: 'ainda não executada' }, null, 2),
          ].join('\n');
          const doc = await invoke(window.rbBridge.google.createDocument(account.id, {
            title: `RB HUB — Contexto mestre — ${account.email}`,
            content,
          }));
          setNotice('Documento mestre criado no Google Drive.', 'success');
          await invoke(window.rbBridge.system.openExternal(doc.url));
        } catch (error) { setNotice(error.message, 'error'); }
        finally { dossier.disabled = false; }
      };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost';
      remove.textContent = 'Desconectar';
      remove.onclick = async () => {
        try {
          remove.disabled = true;
          await invoke(window.rbBridge.google.disconnect(account.id));
          setNotice(`${account.email} foi removida deste computador.`, 'success');
          await loadStatus();
        } catch (error) { setNotice(error.message, 'error'); }
        finally { remove.disabled = false; }
      };
      actions.append(sync, dossier, remove);
      card.append(identity, actions);
      container.appendChild(card);
    }
  }

  function applyStatus(status) {
    state.status = status;
    state.accounts = status.accounts || [];
    $('googleVaultStatus').textContent = status.encryptionAvailable ? 'Cofre do sistema disponível' : 'Cofre seguro indisponível';
    $('googleVaultStatus').className = `status ${status.encryptionAvailable ? 'connected' : 'disconnected'}`;
    $('googleOauthStatus').textContent = status.configured ? 'OAuth configurado' : 'OAuth pendente';
    $('googleOauthStatus').className = `status ${status.configured ? 'connected' : 'disconnected'}`;
    if (status.oauth?.clientIdSuffix && !$('googleClientId').value) $('googleClientId').placeholder = `Configurado · final ${status.oauth.clientIdSuffix}`;
    $('geminiModel').value = status.ai?.geminiModel || 'gemini-2.5-flash';
    $('notebookProjectNumber').value = status.ai?.notebookProjectNumber || '';
    $('notebookLocation').value = status.ai?.notebookLocation || 'global';
    $('geminiStatus').textContent = status.ai?.geminiConfigured ? 'Gemini API configurada' : 'Gemini API pendente';
    $('notebookStatus').textContent = status.ai?.notebookConfigured ? 'Notebook configurado' : 'Notebook pendente';
    renderAccounts();
  }

  async function loadStatus() {
    const status = await invoke(window.rbBridge.google.status());
    applyStatus(status);
  }

  async function saveOAuth() {
    const clientId = $('googleClientId').value.trim();
    const clientSecret = $('googleClientSecret').value.trim();
    if (!clientId && state.status?.configured) {
      setNotice('O OAuth já está configurado. Preencha o Client ID apenas para substituí-lo.', 'attention');
      return;
    }
    const status = await invoke(window.rbBridge.google.saveOAuth({ clientId, clientSecret }));
    $('googleClientSecret').value = '';
    applyStatus(status);
    setNotice('Configuração OAuth salva no cofre criptografado.', 'success');
  }

  async function connectAccount() {
    const services = selectedServices();
    if (!services.length) throw new Error('Selecione ao menos um serviço Google.');
    setNotice('Abra o navegador e escolha a conta Google que deseja adicionar.', 'running');
    const account = await invoke(window.rbBridge.google.connect({
      label: $('googleAccountLabel').value.trim(),
      services,
    }));
    $('googleAccountLabel').value = '';
    setNotice(`${account.email} conectada sem substituir as outras contas.`, 'success');
    await loadStatus();
  }

  async function saveAi() {
    const input = {
      geminiApiKey: $('geminiApiKey').value.trim(),
      geminiModel: $('geminiModel').value.trim(),
      notebookProjectNumber: $('notebookProjectNumber').value.trim(),
      notebookLocation: $('notebookLocation').value,
    };
    const status = await invoke(window.rbBridge.google.saveAi(input));
    $('geminiApiKey').value = '';
    applyStatus(status);
    setNotice('Configuração de IA salva no cofre criptografado.', 'success');
  }

  async function testGemini() {
    setNotice('Executando uma chamada mínima da Gemini API...', 'running');
    const result = await invoke(window.rbBridge.google.testGemini());
    setNotice(`Gemini respondeu pelo modelo ${result.model}: ${result.response || 'OK'}`, 'success');
  }

  async function listNotebooks() {
    const accountId = $('notebookAccount').value;
    if (!accountId) throw new Error('Conecte e selecione uma conta com acesso ao Google Cloud.');
    setNotice('Consultando notebooks visualizados recentemente...', 'running');
    const result = await invoke(window.rbBridge.google.listNotebooks(accountId));
    const count = (result.notebooks || result.recentlyViewedNotebooks || []).length;
    setNotice(`${count} notebook(s) retornado(s) pelo Gemini Notebook Enterprise.`, 'success');
  }

  function refreshNotebookAccounts() {
    const select = $('notebookAccount');
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.accounts.length ? 'Selecione uma conta' : 'Conecte uma conta primeiro';
    select.appendChild(placeholder);
    for (const account of state.accounts) {
      const option = document.createElement('option');
      option.value = account.id;
      option.textContent = account.label ? `${account.label} · ${account.email}` : account.email;
      select.appendChild(option);
    }
  }

  async function initialize() {
    mountPanel();
    $('saveGoogleOauth').onclick = () => saveOAuth().catch((error) => setNotice(error.message, 'error'));
    $('connectGoogleAccount').onclick = () => connectAccount().catch((error) => setNotice(error.message, 'error'));
    $('refreshGoogleAccounts').onclick = () => loadStatus().catch((error) => setNotice(error.message, 'error'));
    $('saveGoogleAi').onclick = () => saveAi().catch((error) => setNotice(error.message, 'error'));
    $('testGemini').onclick = () => testGemini().catch((error) => setNotice(error.message, 'error'));
    $('listNotebooks').onclick = () => listNotebooks().catch((error) => setNotice(error.message, 'error'));
    try {
      await loadStatus();
      refreshNotebookAccounts();
      const observer = new MutationObserver(refreshNotebookAccounts);
      observer.observe($('googleAccounts'), { childList: true });
    } catch (error) { setNotice(error.message, 'error'); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
