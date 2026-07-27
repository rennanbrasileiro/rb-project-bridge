'use strict';

let operationDecisionState = null;
let operationDecisionRequest = 0;

function decisionElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

function decisionStatus(kind, text) {
  return decisionElement('span', `decision-status ${kind}`, text);
}

function decisionList(container, items, emptyText) {
  container.replaceChildren();
  const values = Array.isArray(items) ? items : [];
  if (!values.length) {
    container.appendChild(decisionElement('p', 'decision-empty', emptyText));
    return;
  }
  const list = decisionElement('ol', 'decision-list');
  for (const item of values) list.appendChild(decisionElement('li', '', item));
  container.appendChild(list);
}

function renderDecisionSummary(summary) {
  const panel = $('operationDecision');
  operationDecisionState = summary;
  if (!summary) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');

  $('decisionTitle').textContent = `${summary.project?.name || 'Produto'} — estado atual e continuidade`;
  $('decisionSubtitle').textContent = summary.current.readyForContractedHandoff
    ? 'O pacote contratado possui evidências para handoff. Revise a custódia e o aceite antes do corte.'
    : 'A entrega técnica existe, mas o painel abaixo mostra o que ainda falta para o pacote contratado.';

  const statusGrid = $('decisionStatusGrid');
  statusGrid.replaceChildren();
  const cards = [
    ['Contratado', summary.contracted.package.label, summary.contracted.target.label],
    ['Alcançado', `${summary.current.label} · ${summary.current.score}/100`, `Recomendado: ${summary.current.recommendedPackage}`],
    ['Handoff', summary.current.readyForContractedHandoff ? 'Pronto' : 'Pendente', summary.current.packageGap],
    ['Produção', summary.decisions.canGoProduction ? 'Corte possível' : 'Bloqueada', summary.decisions.productionGuidance],
  ];
  for (const [label, value, detail] of cards) {
    const card = decisionElement('article', 'decision-summary-card');
    card.append(decisionElement('span', 'decision-kicker', label));
    card.append(decisionElement('strong', '', value));
    card.append(decisionElement('p', '', detail));
    statusGrid.appendChild(card);
  }

  const decisionBox = $('decisionGuidance');
  decisionBox.replaceChildren();
  const guidance = [
    ['PR / código', summary.decisions.canMergeWorkspace ? 'passed' : 'pending', summary.decisions.mergeGuidance],
    ['Pacote contratado', summary.decisions.readyForContractedHandoff ? 'passed' : 'pending', summary.decisions.deliveryGuidance],
    ['Produção', summary.decisions.canGoProduction ? 'passed' : 'blocked', summary.decisions.productionGuidance],
  ];
  for (const [label, status, detail] of guidance) {
    const row = decisionElement('div', 'decision-guidance-row');
    row.append(decisionStatus(status, label));
    row.append(decisionElement('p', '', detail));
    decisionBox.appendChild(row);
  }

  const scopeBody = $('decisionScopeBody');
  scopeBody.replaceChildren();
  for (const item of summary.contracted.scope || []) {
    const row = document.createElement('tr');
    row.append(decisionElement('td', '', item.label));
    row.append(decisionElement('td', '', item.selected ? 'Incluído' : 'Fora do escopo'));
    const state = item.status === 'validated' ? 'Validado' : item.status === 'pending' ? 'Pendente' : '—';
    const stateCell = decisionElement('td');
    stateCell.append(decisionStatus(item.status === 'validated' ? 'passed' : item.status === 'pending' ? 'pending' : 'neutral', state));
    row.append(stateCell);
    row.append(decisionElement('td', '', item.detail));
    scopeBody.appendChild(row);
  }

  const validationRoot = $('decisionValidations');
  validationRoot.replaceChildren();
  const validations = summary.validations || [];
  if (!validations.length) {
    validationRoot.appendChild(decisionElement('p', 'decision-empty', 'Este pacote não exige homologações adicionais registradas pelo operador.'));
  }
  for (const validation of validations) {
    const card = decisionElement('article', `validation-card ${validation.passed ? 'passed' : 'pending'}`);
    const head = decisionElement('div', 'validation-head');
    const heading = decisionElement('div');
    heading.append(decisionElement('strong', '', validation.label));
    heading.append(decisionElement('p', '', validation.description));
    head.append(heading);
    head.append(decisionStatus(validation.passed ? 'passed' : 'pending', validation.passed ? 'Validado' : 'Pendente'));
    card.append(head);

    const grid = decisionElement('div', 'validation-fields');
    const evidenceLabel = decisionElement('label', '', 'Evidência ou referência');
    const evidence = document.createElement('input');
    evidence.id = `validationEvidence-${validation.id}`;
    evidence.value = validation.evidence || '';
    evidence.placeholder = 'Ex.: PR, URL, relatório, ambiente ou descrição da conferência';
    evidenceLabel.append(evidence);
    grid.append(evidenceLabel);

    const notesLabel = decisionElement('label', '', 'Observações');
    const notes = document.createElement('textarea');
    notes.id = `validationNotes-${validation.id}`;
    notes.rows = 2;
    notes.value = validation.notes || '';
    notes.placeholder = 'Registre o que foi testado, limitações e resultado.';
    notesLabel.append(notes);
    grid.append(notesLabel);
    card.append(grid);

    if (validation.validatedAt || validation.validatedBy) {
      const meta = [validation.validatedBy, validation.validatedAt ? new Date(validation.validatedAt).toLocaleString('pt-BR') : null].filter(Boolean).join(' · ');
      card.append(decisionElement('small', 'validation-meta', meta));
    }

    const actions = decisionElement('div', 'validation-actions');
    const save = decisionElement('button', validation.passed ? 'secondary' : 'primary', validation.passed ? 'Atualizar evidência' : 'Registrar como validado');
    save.type = 'button';
    save.dataset.validationId = validation.id;
    save.dataset.validationPassed = 'true';
    actions.append(save);
    if (validation.passed) {
      const reopen = decisionElement('button', 'ghost', 'Reabrir pendência');
      reopen.type = 'button';
      reopen.dataset.validationId = validation.id;
      reopen.dataset.validationPassed = 'false';
      actions.append(reopen);
    }
    card.append(actions);
    validationRoot.appendChild(card);
  }

  decisionList($('decisionNextActions'), summary.nextActions, 'Nenhuma próxima ação obrigatória registrada.');

  const evolutionRoot = $('decisionEvolution');
  evolutionRoot.replaceChildren();
  for (const path of summary.evolutionPaths || []) {
    const card = decisionElement('article', `evolution-card${path.highlighted ? ' highlighted' : ''}`);
    card.append(decisionElement('strong', '', path.title));
    card.append(decisionElement('p', 'evolution-when', path.useWhen));
    if (path.command) {
      const command = decisionElement('code', 'evolution-command', path.command);
      card.append(command);
    }
    const list = decisionElement('ol');
    for (const step of path.steps || []) list.append(decisionElement('li', '', step));
    card.append(list);
    evolutionRoot.appendChild(card);
  }

  $('decisionPackageState').textContent = summary.packageState?.dirty
    ? 'Existem homologações registradas depois da última geração. Recalcule o pacote antes de entregar.'
    : summary.artifacts?.clientArchive
      ? 'O pacote local está atualizado com o último estado registrado.'
      : 'O pacote ainda precisa ser gerado ou recalculado.';
  $('decisionPackageState').className = `package-state ${summary.packageState?.dirty ? 'pending' : 'passed'}`;
  $('openWorkspaceDecision').classList.toggle('hidden', !summary.artifacts?.repositoryDirectory);
  $('openPlanDecision').classList.toggle('hidden', !summary.artifacts?.operationPlan);
  $('openExtensionDecision').classList.toggle('hidden', !summary.artifacts?.extensionRequest);
  $('regeneratePackageDecision').classList.toggle('hidden', !summary.artifacts?.repositoryDirectory);
}

async function refreshOperationDecision(result = lastResult) {
  const jobRoot = result?.paths?.jobRoot;
  if (!jobRoot) return renderDecisionSummary(result?.operationSummary || null);
  const request = ++operationDecisionRequest;
  try {
    const state = await call(window.rbBridge.migration.operationState(jobRoot));
    if (request !== operationDecisionRequest) return;
    if (state?.result) lastResult = state.result;
    renderDecisionSummary(state?.summary || state?.result?.operationSummary || null);
    configureResultActionsBeforeDecision(lastResult);
  } catch (error) {
    if (request !== operationDecisionRequest) return;
    log(`Painel de continuidade: ${error.message}`);
    renderDecisionSummary(result?.operationSummary || null);
  }
}

async function saveDecisionValidation(validationId, passed) {
  const jobRoot = lastResult?.paths?.jobRoot;
  if (!jobRoot) return setResult('Operação indisponível', 'Não foi possível localizar a pasta da operação.', 'error');
  const evidence = $(`validationEvidence-${validationId}`)?.value || '';
  const notes = $(`validationNotes-${validationId}`)?.value || '';
  try {
    setResult('Registrando homologação', 'O relatório e o plano serão recalculados sem alterar o GitHub.', 'running');
    const state = await call(window.rbBridge.migration.saveValidation(jobRoot, {
      validationId,
      passed,
      evidence,
      notes,
      validatedBy: lastResult?.options?.deliveryOwner || lastResult?.options?.clientName || '',
    }));
    lastResult = state.result;
    renderDecisionSummary(state.summary);
    configureResultActionsBeforeDecision(lastResult);
    setResult(passed ? 'Homologação registrada' : 'Pendência reaberta', 'O pacote foi marcado para regeneração. O GitHub não foi alterado.', passed ? 'success' : 'attention');
  } catch (error) {
    setResult('Não foi possível registrar a homologação', error.message, 'error');
  }
}

$('decisionValidations').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-validation-id]');
  if (!button) return;
  void saveDecisionValidation(button.dataset.validationId, button.dataset.validationPassed === 'true');
});

$('regeneratePackageDecision').onclick = async () => {
  const jobRoot = lastResult?.paths?.jobRoot;
  if (!jobRoot) return setResult('Operação indisponível', 'Não foi possível localizar a pasta da operação.', 'error');
  try {
    setResult('Recalculando pacote do cliente', 'Os relatórios, o manifesto, o plano e o ZIP serão atualizados com as homologações registradas.', 'running');
    const state = await call(window.rbBridge.migration.regeneratePackage(jobRoot));
    lastResult = state.result;
    renderDecisionSummary(state.summary);
    configureResultActionsBeforeDecision(lastResult);
    setResult('Pacote do cliente atualizado', 'O ZIP e os documentos agora refletem o escopo e as evidências registradas.', 'success');
  } catch (error) {
    setResult('Não foi possível regenerar o pacote', error.message, 'error');
  }
};

$('openWorkspaceDecision').onclick = () => operationDecisionState?.artifacts?.repositoryDirectory && call(window.rbBridge.system.openPath(operationDecisionState.artifacts.repositoryDirectory));
$('openPlanDecision').onclick = () => operationDecisionState?.artifacts?.operationPlan && call(window.rbBridge.system.openPath(operationDecisionState.artifacts.operationPlan));
$('openExtensionDecision').onclick = () => operationDecisionState?.artifacts?.extensionRequest && call(window.rbBridge.system.openPath(operationDecisionState.artifacts.extensionRequest));

const configureResultActionsBeforeDecision = configureResultActions;
configureResultActions = function configureResultActionsWithDecision(result = lastResult) {
  configureResultActionsBeforeDecision(result);
  void refreshOperationDecision(result);
};

const setRunningBeforeDecision = setRunning;
setRunning = function setRunningWithDecision(running) {
  setRunningBeforeDecision(running);
  for (const id of ['regeneratePackageDecision', 'openWorkspaceDecision', 'openPlanDecision', 'openExtensionDecision']) {
    const button = $(id);
    if (button) button.disabled = running;
  }
};
