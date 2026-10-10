/* Acesso somente de leitura aos registros existentes do Bridge. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const logDetails = $('logDetails');
  const logOutput = $('log');
  const guide = document.querySelector('.bridge-guide-top');
  if (!logDetails || !logOutput || !guide || !window.rbBridge?.migration?.history) return;

  const element = (tag, className, label) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };

  const group = element('div', 'bridge-guide-actions');
  const modeButton = guide.querySelector('.bridge-mode-button');
  if (modeButton) {
    modeButton.parentNode.replaceChild(group, modeButton);
    group.appendChild(modeButton);
  } else guide.appendChild(group);

  const shortcut = element('button', 'secondary bridge-diagnostic-shortcut', 'Logs e histórico');
  shortcut.type = 'button';
  group.appendChild(shortcut);

  const toolbar = element('div', 'bridge-log-toolbar');
  const copy = element('button', 'secondary', 'Copiar logs desta sessão');
  const openLogs = element('button', 'ghost', 'Abrir logs salvos');
  const notice = element('span', 'bridge-log-notice', 'Os registros detalhados são preservados no computador.');
  copy.type = 'button';
  openLogs.type = 'button';
  toolbar.append(copy, openLogs, notice);
  logOutput.parentNode.insertBefore(toolbar, logOutput);

  const historyDetails = element('details', 'bridge-history-details');
  const title = element('summary', '', 'Histórico de operações anteriores');
  const description = element('p', 'bridge-history-description',
    'As operações são registradas localmente. Abra a pasta de uma execução para consultar seus relatórios, checkpoints e evidências.');
  const controls = element('div', 'bridge-history-controls');
  const refresh = element('button', 'ghost', 'Atualizar histórico');
  refresh.type = 'button';
  const historyStatus = element('span', 'bridge-history-count', 'Abra para consultar os registros salvos.');
  controls.append(refresh, historyStatus);
  const list = element('div', 'bridge-history-list');
  list.setAttribute('aria-live', 'polite');
  historyDetails.append(title, description, controls, list);
  logDetails.insertAdjacentElement('afterend', historyDetails);

  const setNotice = (message) => { notice.textContent = message; };
  const redact = (source) => String(source || '')
    .replace(/(Código\s+(?:Base44|GitHub)\s*:\s*)[^\s]+/gi, '$1[OCULTADO]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[OCULTADO]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[OCULTADO]')
    .replace(/\bb44k_[A-Za-z0-9_-]{12,}\b/g, '[OCULTADO]')
    .replace(/\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, '[OCULTADO]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[OCULTADO]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [OCULTADO]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[CHAVE PRIVADA OCULTADA]')
    .replace(/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*)[^\s,;}]+/gi, '$1[OCULTADO]');

  copy.addEventListener('click', async () => {
    const project = $('project')?.selectedOptions?.[0]?.dataset?.name || 'Não selecionado';
    const resultTitle = $('resultTitle')?.textContent || 'Sem resultado';
    const text = [
      'RB Project Bridge — diagnóstico da sessão',
      'Projeto: ' + project,
      'Estado: ' + resultTitle,
      'Registro gerado em: ' + new Date().toLocaleString('pt-BR'),
      '',
      redact(logOutput.textContent) || 'Nenhum log de sessão disponível.',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Diagnóstico copiado com padrões de credenciais ocultados. Revise antes de compartilhar.');
    } catch (error) {
      setNotice('Não foi possível copiar automaticamente: ' + error.message);
    }
  });

  async function unwrap(promise) {
    const result = await promise;
    if (!result?.ok) throw new Error(result?.error?.message || 'Não foi possível consultar os registros.');
    return result.data;
  }

  openLogs.addEventListener('click', async () => {
    try {
      const status = await unwrap(window.rbBridge.system.status());
      if (!status?.userData) throw new Error('Diretório de registros indisponível.');
      const root = status.userData.replace(/[\\/]+$/, '');
      const separator = root.includes('\\') ? '\\' : '/';
      await unwrap(window.rbBridge.system.openPath(root + separator + 'logs'));
      setNotice('Pasta de logs persistentes aberta.');
    } catch (error) { setNotice('Não foi possível abrir os logs: ' + error.message); }
  });

  function dateLabel(entry) {
    const raw = entry.finishedAt || entry.startedAt;
    if (!raw) return 'Data não disponível';
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? 'Data não disponível' : date.toLocaleString('pt-BR');
  }

  async function loadHistory() {
    refresh.disabled = true;
    historyStatus.textContent = 'Consultando registros locais...';
    try {
      const history = await unwrap(window.rbBridge.migration.history());
      list.replaceChildren();
      const entries = Array.isArray(history) ? history : [];
      historyStatus.textContent = entries.length + ' registro(s) preservado(s).';
      if (!entries.length) {
        list.appendChild(element('p', 'bridge-history-empty', 'Nenhuma operação anterior registrada neste computador.'));
      }
      // O serviço retém até 200 eventos, inclusive falhas e retomadas.
      // Exibir todos, sem exclusão nem filtro destrutivo.
      for (const entry of entries) {
        const item = element('div', 'bridge-history-item');
        const info = element('div', 'bridge-history-info');
        const name = element('strong', '', entry.project?.name || 'Projeto não identificado');
        const meta = element('small', '',
          [dateLabel(entry), entry.status || 'Estado não informado',
            entry.github?.fullName || entry.githubRepository?.fullName || null].filter(Boolean).join(' · '));
        info.append(name, meta);
        item.appendChild(info);
        if (entry.jobRoot) {
          const folder = element('button', 'secondary', 'Abrir arquivos');
          folder.type = 'button';
          folder.addEventListener('click', async () => {
            try { await unwrap(window.rbBridge.system.openPath(entry.jobRoot)); }
            catch (error) { historyStatus.textContent = 'Erro ao abrir pasta: ' + error.message; }
          });
          item.appendChild(folder);
        }
        list.appendChild(item);
      }
    } catch (error) {
      historyStatus.textContent = 'Histórico indisponível: ' + error.message;
    } finally { refresh.disabled = false; }
  }

  historyDetails.addEventListener('toggle', () => {
    if (historyDetails.open) void loadHistory();
  });
  refresh.addEventListener('click', () => { void loadHistory(); });
  shortcut.addEventListener('click', () => {
    const steps = document.querySelectorAll('.bridge-step');
    if (steps[4]) steps[4].click();
    logDetails.open = true;
    const wasOpen = historyDetails.open;
    historyDetails.open = true;
    if (wasOpen) void loadHistory();
    historyDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
})();
