'use strict';

let latestRepairJobRoot = null;

function repairableHistoryEntry(entry) {
  return entry?.jobRoot && entry?.previewDir && entry?.status === 'completed' ? entry : null;
}

function showCompletedOperation(entry, operationState = null) {
  const card = $('completedCard');
  if (!entry) {
    latestRepairJobRoot = null;
    card.classList.add('hidden');
    $('repairPreview').classList.add('hidden');
    return;
  }

  latestRepairJobRoot = entry.jobRoot;
  const project = entry.project?.name || operationState?.result?.project?.name || 'Produto';
  $('completedTitle').textContent = `${project}: operação local disponível`;
  $('completedMessage').textContent = entry.previewRepaired
    ? 'O preview já foi reconstruído e validado. Você pode abri-lo novamente, registrar homologações ou repetir a validação.'
    : 'Você pode evoluir o workspace, registrar homologações, recompilar e validar sem reexportar a Base44.';
  card.classList.remove('hidden');
  $('repairPreview').classList.remove('hidden');

  if (operationState?.result) {
    lastResult = operationState.result;
  } else if (!lastResult) {
    lastResult = {
      status: entry.status,
      project: entry.project,
      paths: { jobRoot: entry.jobRoot, previewDir: entry.previewDir },
      github: entry.github || null,
      githubRepository: entry.githubRepository || null,
    };
  }
  configureResultActions(lastResult);
}

async function refreshRepairAction() {
  try {
    const history = await call(window.rbBridge.migration.history());
    const entry = history.map(repairableHistoryEntry).find(Boolean) || null;
    if (!entry) return showCompletedOperation(null);
    let operationState = null;
    try { operationState = await call(window.rbBridge.migration.operationState(entry.jobRoot)); }
    catch (error) { log(`Relatório da operação: ${error.message}`); }
    showCompletedOperation(entry, operationState);
  } catch {
    showCompletedOperation(null);
  }
}

const originalConfigureResultActions = configureResultActions;
configureResultActions = function configureResultActionsWithRepair(result = lastResult) {
  originalConfigureResultActions(result);
  const jobRoot = result?.paths?.jobRoot || latestRepairJobRoot;
  $('repairPreview').classList.toggle('hidden', !jobRoot);
  if (jobRoot && $('resultActions').classList.contains('hidden')) $('resultActions').classList.remove('hidden');
};

const originalSetRunning = setRunning;
setRunning = function setRunningWithRepair(running) {
  originalSetRunning(running);
  $('repairPreview').disabled = running;
};

$('repairPreview').onclick = async () => {
  const jobRoot = lastResult?.paths?.jobRoot || latestRepairJobRoot;
  if (!jobRoot) return setResult('Operação indisponível', 'Não existe uma operação local que possa ter o preview reconstruído.', 'error');

  try {
    setRunning(true);
    stage('build', 'running');
    setResult('Reconstruindo preview', 'O Bridge está corrigindo o runtime, instalando dependências em cópia isolada, recompilando e abrindo o resultado em Chromium.', 'running');
    setOperationSummary('Revalidando operação local', 'Base44 e GitHub não serão alterados.', 'running');
    log('Reconstruindo o preview existente sem reexportar e sem publicar...');

    lastResult = await call(window.rbBridge.migration.repairPreview(jobRoot));
    stage('build', 'complete');
    setResult(
      'Preview corrigido e validado',
      'O bundle foi reconstruído e renderizou corretamente em Chromium. Nenhuma alteração foi enviada ao GitHub.',
      'success',
      ['Build aprovado', 'Runtime aprovado', 'GitHub não alterado'],
    );
    setOperationSummary('Preview pronto', 'A aplicação local foi reconstruída e validada em execução.', 'success');
    configureResultActions(lastResult);
    await refreshRepairAction();
  } catch (error) {
    stage('build', 'failed', error.message);
    const runtimeErrors = error.details?.runtime?.errors || error.details?.build?.runtime?.errors || [];
    setResult('Não foi possível corrigir o preview', error.message, 'error', runtimeErrors.slice(0, 3));
    setOperationSummary('Preview reprovado', 'O problema foi identificado antes de qualquer nova publicação.', 'error');
    log(`Revalidação: ${error.message}${runtimeErrors.length ? `\n- ${runtimeErrors.join('\n- ')}` : ''}`);
  } finally {
    setRunning(false);
  }
};

void refreshRepairAction();
