'use strict';

let operationDecisionState = null;
let operationDecisionRequest = 0;

function decisionElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}
function field(tag, id, value, placeholder, rows = null) {
  const element = document.createElement(tag);
  element.id = id;
  element.value = value || '';
  element.placeholder = placeholder || '';
  if (rows) element.rows = rows;
  return element;
}
function labeled(text, control) {
  const label = decisionElement('label', '', text);
  label.append(control);
  return label;
}
function statusKind(status) {
  return ({ passed: 'passed', validated: 'passed', not_applicable: 'neutral', 'not-applicable': 'neutral', pending: 'pending', blocked: 'blocked', failed: 'failed', open: 'failed', in_progress: 'pending', ready_for_retest: 'pending', resolved: 'passed', accepted_risk: 'neutral' })[status] || 'neutral';
}
function statusText(status) {
  return ({ passed: 'Aprovado', validated: 'Validado', not_applicable: 'Não se aplica', 'not-applicable': 'Não se aplica', pending: 'Pendente', blocked: 'Bloqueado', failed: 'Reprovado', open: 'Aberto', in_progress: 'Em correção', ready_for_retest: 'Pronto para reteste', resolved: 'Resolvido', accepted_risk: 'Risco aceito', 'not-in-scope': 'Fora do escopo' })[status] || status || 'Pendente';
}
function decisionStatus(kind, text) { return decisionElement('span', `decision-status ${kind}`, text); }
function decisionList(container, items, emptyText) {
  container.replaceChildren();
  const values = Array.isArray(items) ? items : [];
  if (!values.length) return container.appendChild(decisionElement('p', 'decision-empty', emptyText));
  const list = decisionElement('ol', 'decision-list');
  for (const item of values) list.appendChild(decisionElement('li', '', item));
  container.appendChild(list);
}
function ensureDefectSection() {
  let root = $('decisionDefects');
  if (root) return root;
  const section = decisionElement('div', 'decision-section');
  section.append(decisionElement('h4', '', 'Defeitos e retestes'));
  section.append(decisionElement('p', '', 'Uma reprovação vira um defeito rastreável. O item só volta a aprovado depois de um reteste posterior.'));
  root = decisionElement('div', 'defect-grid');
  root.id = 'decisionDefects';
  section.append(root);
  const validationSection = $('decisionValidations').closest('.decision-section');
  validationSection.insertAdjacentElement('afterend', section);
  return root;
}
function renderValidation(validation, root) {
  const card = decisionElement('article', `validation-card ${statusKind(validation.status)}`);
  const head = decisionElement('div', 'validation-head');
  const heading = decisionElement('div');
  heading.append(decisionElement('strong', '', validation.label));
  heading.append(decisionElement('p', '', validation.description));
  head.append(heading, decisionStatus(statusKind(validation.status), statusText(validation.status)));
  card.append(head);

  const grid = decisionElement('div', 'validation-fields');
  grid.append(
    labeled('Evidência ou referência', field('input', `validationEvidence-${validation.id}`, validation.evidence, 'PR, URL, relatório, ambiente ou descrição da conferência')),
    labeled('Observações', field('textarea', `validationNotes-${validation.id}`, validation.notes, 'O que foi testado, limitações e resultado.', 2)),
  );
  card.append(grid);

  const rejection = document.createElement('details');
  rejection.className = 'rejection-details';
  rejection.open = ['failed', 'blocked'].includes(validation.status);
  const summary = document.createElement('summary');
  summary.textContent = 'Detalhes para reprovação ou bloqueio';
  rejection.append(summary);
  const rejectionGrid = decisionElement('div', 'validation-fields rejection-grid');
  const severity = document.createElement('select');
  severity.id = `validationSeverity-${validation.id}`;
  for (const [value, label] of [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['critical', 'Crítica']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = (validation.severity || 'high') === value; severity.append(option);
  }
  rejectionGrid.append(
    labeled('Comportamento esperado', field('textarea', `validationExpected-${validation.id}`, validation.expected, 'O que deveria acontecer?', 2)),
    labeled('Comportamento observado', field('textarea', `validationObserved-${validation.id}`, validation.observed, 'O que aconteceu de fato?', 2)),
    labeled('Passos para reproduzir', field('textarea', `validationReproduction-${validation.id}`, validation.reproductionSteps, 'Como repetir a falha?', 2)),
    labeled('Severidade', severity),
  );
  rejection.append(rejectionGrid);
  card.append(rejection);

  if (validation.validatedAt || validation.validatedBy || validation.defectId) {
    const meta = [validation.defectId, validation.validatedBy, validation.validatedAt ? new Date(validation.validatedAt).toLocaleString('pt-BR') : null].filter(Boolean).join(' · ');
    card.append(decisionElement('small', 'validation-meta', meta));
  }
  const actions = decisionElement('div', 'validation-actions');
  for (const [status, label, className] of [['passed', 'Aprovar / reteste aprovado', 'primary'], ['failed', 'Reprovar', 'danger'], ['blocked', 'Registrar bloqueio', 'secondary'], ['not_applicable', 'Não se aplica', 'ghost'], ['pending', 'Reabrir pendência', 'ghost']]) {
    const button = decisionElement('button', className, label);
    button.type = 'button';
    button.dataset.validationId = validation.id;
    button.dataset.validationStatus = status;
    actions.append(button);
  }
  card.append(actions);
  root.append(card);
}
function renderDefect(defect, root) {
  const card = decisionElement('article', `defect-card severity-${defect.severity}`);
  const head = decisionElement('div', 'validation-head');
  const heading = decisionElement('div');
  heading.append(decisionElement('strong', '', `${defect.id} — ${defect.title}`));
  heading.append(decisionElement('p', '', `${defect.gate} · severidade ${defect.severity}`));
  head.append(heading, decisionStatus(statusKind(defect.status), statusText(defect.status)));
  card.append(head);
  const facts = decisionElement('dl', 'defect-facts');
  for (const [term, value] of [['Esperado', defect.expected], ['Observado', defect.observed], ['Reprodução', defect.reproductionSteps], ['Evidência', defect.evidence]]) {
    if (!value) continue;
    facts.append(decisionElement('dt', '', term), decisionElement('dd', '', value));
  }
  card.append(facts);

  const controls = decisionElement('div', 'validation-fields');
  const owner = field('input', `defectOwner-${defect.id}`, defect.owner, 'Responsável');
  const notes = field('textarea', `defectNotes-${defect.id}`, defect.notes, 'Acompanhamento, correção aplicada ou dependência.', 2);
  const state = document.createElement('select'); state.id = `defectStatus-${defect.id}`;
  for (const [value, label] of [['open', 'Aberto'], ['in_progress', 'Em correção'], ['ready_for_retest', 'Pronto para reteste'], ['accepted_risk', 'Risco aceito']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = defect.status === value; state.append(option);
  }
  controls.append(labeled('Responsável', owner), labeled('Estado', state), labeled('Acompanhamento', notes));
  card.append(controls);
  const actions = decisionElement('div', 'validation-actions');
  const update = decisionElement('button', 'secondary', 'Atualizar defeito'); update.dataset.defectAction = 'update'; update.dataset.defectId = defect.id; actions.append(update);
  const retestPass = decisionElement('button', 'primary', 'Reteste aprovado'); retestPass.dataset.defectAction = 'retest-passed'; retestPass.dataset.defectId = defect.id; actions.append(retestPass);
  const retestFail = decisionElement('button', 'danger', 'Reteste reprovado'); retestFail.dataset.defectAction = 'retest-failed'; retestFail.dataset.defectId = defect.id; actions.append(retestFail);
  card.append(actions);
  if (defect.retests?.length) card.append(decisionElement('small', 'validation-meta', `${defect.retests.length} reteste(s) registrado(s) · último: ${statusText(defect.retests.at(-1).status)}`));
  root.append(card);
}
function renderDecisionSummary(summary) {
  const panel = $('operationDecision');
  operationDecisionState = summary;
  if (!summary) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  $('decisionTitle').textContent = `${summary.project?.name || 'Produto'} — estado atual e continuidade`;
  $('decisionSubtitle').textContent = summary.current.readyForContractedHandoff
    ? 'O pacote possui evidências vigentes e nenhum defeito aberto.'
    : summary.current.packageGap;

  const statusGrid = $('decisionStatusGrid'); statusGrid.replaceChildren();
  const cards = [
    ['Contratado', summary.contracted.package.label, summary.contracted.target.label],
    ['Alcançado', `${summary.current.label} · ${summary.current.score}/100`, `Recomendado: ${summary.current.recommendedPackage}`],
    ['Defeitos', String(summary.openDefects?.length || 0), summary.blockingDefects?.length ? `${summary.blockingDefects.length} bloqueante(s)` : 'Nenhum bloqueante'],
    ['Produção', summary.decisions.canGoProduction ? 'Corte possível' : 'Bloqueada', summary.decisions.productionGuidance],
  ];
  for (const [label, value, detail] of cards) { const card = decisionElement('article', 'decision-summary-card'); card.append(decisionElement('span', 'decision-kicker', label), decisionElement('strong', '', value), decisionElement('p', '', detail)); statusGrid.append(card); }

  const decisionBox = $('decisionGuidance'); decisionBox.replaceChildren();
  for (const [label, status, detail] of [['PR / código', summary.decisions.canMergeWorkspace ? 'passed' : 'failed', summary.decisions.mergeGuidance], ['Pacote contratado', summary.decisions.readyForContractedHandoff ? 'passed' : 'pending', summary.decisions.deliveryGuidance], ['Produção', summary.decisions.canGoProduction ? 'passed' : 'blocked', summary.decisions.productionGuidance]]) {
    const row = decisionElement('div', 'decision-guidance-row'); row.append(decisionStatus(statusKind(status), label), decisionElement('p', '', detail)); decisionBox.append(row);
  }

  const scopeBody = $('decisionScopeBody'); scopeBody.replaceChildren();
  for (const item of summary.contracted.scope || []) { const row = document.createElement('tr'); row.append(decisionElement('td', '', item.label), decisionElement('td', '', item.selected ? 'Incluído' : 'Fora do escopo')); const stateCell = decisionElement('td'); stateCell.append(decisionStatus(statusKind(item.status), statusText(item.status))); row.append(stateCell, decisionElement('td', '', item.detail)); scopeBody.append(row); }

  const validationRoot = $('decisionValidations'); validationRoot.replaceChildren();
  if (!(summary.validations || []).length) validationRoot.append(decisionElement('p', 'decision-empty', 'Este pacote não exige homologações adicionais.'));
  for (const validation of summary.validations || []) renderValidation(validation, validationRoot);

  const defectRoot = ensureDefectSection(); defectRoot.replaceChildren();
  if (!(summary.openDefects || []).length) defectRoot.append(decisionElement('p', 'decision-empty', 'Nenhum defeito aberto.'));
  for (const defect of summary.openDefects || []) renderDefect(defect, defectRoot);

  decisionList($('decisionNextActions'), summary.nextActions, 'Nenhuma próxima ação obrigatória registrada.');
  const evolutionRoot = $('decisionEvolution'); evolutionRoot.replaceChildren();
  for (const path of summary.evolutionPaths || []) { const card = decisionElement('article', `evolution-card${path.highlighted ? ' highlighted' : ''}`); card.append(decisionElement('strong', '', path.title), decisionElement('p', 'evolution-when', path.useWhen)); if (path.command) card.append(decisionElement('code', 'evolution-command', path.command)); const list = decisionElement('ol'); for (const step of path.steps || []) list.append(decisionElement('li', '', step)); card.append(list); evolutionRoot.append(card); }

  $('decisionPackageState').textContent = summary.packageState?.dirty ? 'O relatório mudou. Recalcule o pacote antes de entregar.' : summary.artifacts?.clientArchive ? 'O pacote local reflete o último estado registrado.' : 'O pacote precisa ser gerado.';
  $('decisionPackageState').className = `package-state ${summary.packageState?.dirty ? 'pending' : 'passed'}`;
  $('openWorkspaceDecision').classList.toggle('hidden', !summary.artifacts?.repositoryDirectory);
  $('openPlanDecision').classList.toggle('hidden', !summary.artifacts?.operationPlan);
  $('openExtensionDecision').classList.toggle('hidden', !summary.artifacts?.extensionRequest);
  $('regeneratePackageDecision').classList.toggle('hidden', !summary.artifacts?.repositoryDirectory);
}
async function applyState(state, successTitle, successMessage, kind = 'success') {
  lastResult = state.result;
  renderDecisionSummary(state.summary);
  configureResultActionsBeforeDecision(lastResult);
  setResult(successTitle, successMessage, kind);
}
async function refreshOperationDecision(result = lastResult) {
  const jobRoot = result?.paths?.jobRoot;
  if (!jobRoot) return renderDecisionSummary(result?.operationSummary || null);
  const request = ++operationDecisionRequest;
  try { const state = await call(window.rbBridge.migration.operationState(jobRoot)); if (request !== operationDecisionRequest) return; if (state?.result) lastResult = state.result; renderDecisionSummary(state?.summary || state?.result?.operationSummary || null); configureResultActionsBeforeDecision(lastResult); }
  catch (error) { if (request !== operationDecisionRequest) return; log(`Painel de continuidade: ${error.message}`); renderDecisionSummary(result?.operationSummary || null); }
}
function validationPayload(validationId, status) {
  return {
    validationId, status,
    evidence: $(`validationEvidence-${validationId}`)?.value || '', notes: $(`validationNotes-${validationId}`)?.value || '',
    expected: $(`validationExpected-${validationId}`)?.value || '', observed: $(`validationObserved-${validationId}`)?.value || '', reproductionSteps: $(`validationReproduction-${validationId}`)?.value || '', severity: $(`validationSeverity-${validationId}`)?.value || 'high',
    validatedBy: lastResult?.options?.deliveryOwner || lastResult?.options?.clientName || '',
  };
}
async function saveDecisionValidation(validationId, status) {
  const jobRoot = lastResult?.paths?.jobRoot;
  if (!jobRoot) return setResult('Operação indisponível', 'Não foi possível localizar a operação.', 'error');
  try { setResult('Atualizando validação', 'O ledger, os defeitos e o plano serão recalculados sem alterar o GitHub.', 'running'); const state = await call(window.rbBridge.migration.saveValidation(jobRoot, validationPayload(validationId, status))); await applyState(state, status === 'passed' ? 'Validação aprovada' : status === 'failed' ? 'Reprovação registrada' : 'Validação atualizada', status === 'failed' ? 'Um defeito foi aberto e o pacote permanece bloqueado até reteste.' : 'O estado vigente foi registrado; o GitHub não foi alterado.', status === 'failed' ? 'attention' : 'success'); }
  catch (error) { setResult('Não foi possível registrar a validação', error.message, 'error'); }
}
$('decisionValidations').addEventListener('click', (event) => { const button = event.target.closest('button[data-validation-id]'); if (button) void saveDecisionValidation(button.dataset.validationId, button.dataset.validationStatus); });
ensureDefectSection().addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-defect-action]'); if (!button) return;
  const jobRoot = lastResult?.paths?.jobRoot; const defectId = button.dataset.defectId; if (!jobRoot || !defectId) return;
  const owner = $(`defectOwner-${defectId}`)?.value || ''; const notes = $(`defectNotes-${defectId}`)?.value || '';
  try {
    setResult('Atualizando defeito', 'O histórico e as decisões serão recalculados.', 'running');
    let state;
    if (button.dataset.defectAction === 'update') state = await call(window.rbBridge.migration.updateDefect(jobRoot, defectId, { owner, notes, status: $(`defectStatus-${defectId}`)?.value || 'open' }));
    else state = await call(window.rbBridge.migration.retestDefect(jobRoot, defectId, { status: button.dataset.defectAction === 'retest-passed' ? 'passed' : 'failed', evidence: notes, notes, executor: owner });
    await applyState(state, 'Defeito atualizado', button.dataset.defectAction === 'retest-passed' ? 'O reteste foi aprovado e o defeito foi resolvido.' : 'O resultado do reteste foi registrado.', button.dataset.defectAction === 'retest-failed' ? 'attention' : 'success');
  } catch (error) { setResult('Não foi possível atualizar o defeito', error.message, 'error'); }
});
$('regeneratePackageDecision').onclick = async () => { const jobRoot = lastResult?.paths?.jobRoot; if (!jobRoot) return setResult('Operação indisponível', 'Não foi possível localizar a operação.', 'error'); try { setResult('Recalculando pacote', 'Manifesto, plano, ZIP e checksum serão atualizados.', 'running'); const state = await call(window.rbBridge.migration.regeneratePackage(jobRoot)); await applyState(state, 'Pacote atualizado', state.summary.openDefects?.length ? 'O pacote foi atualizado como acompanhamento, mas continua bloqueado para handoff.' : 'O pacote reflete as evidências vigentes.'); } catch (error) { setResult('Não foi possível regenerar o pacote', error.message, 'error'); } };
$('openWorkspaceDecision').onclick = () => operationDecisionState?.artifacts?.repositoryDirectory && call(window.rbBridge.system.openPath(operationDecisionState.artifacts.repositoryDirectory));
$('openPlanDecision').onclick = () => operationDecisionState?.artifacts?.operationPlan && call(window.rbBridge.system.openPath(operationDecisionState.artifacts.operationPlan));
$('openExtensionDecision').onclick = () => operationDecisionState?.artifacts?.extensionRequest && call(window.rbBridge.system.openPath(operationDecisionState.artifacts.extensionRequest));
const configureResultActionsBeforeDecision = configureResultActions;
configureResultActions = function configureResultActionsWithDecision(result = lastResult) { configureResultActionsBeforeDecision(result); void refreshOperationDecision(result); };
const setRunningBeforeDecision = setRunning;
setRunning = function setRunningWithDecision(running) { setRunningBeforeDecision(running); for (const id of ['regeneratePackageDecision', 'openWorkspaceDecision', 'openPlanDecision', 'openExtensionDecision']) { const button = $(id); if (button) button.disabled = running; } };
