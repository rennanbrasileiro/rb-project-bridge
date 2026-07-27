'use strict';

const verifyWorkspaceButton = document.createElement('button');
verifyWorkspaceButton.id = 'verifyWorkspace';
verifyWorkspaceButton.className = 'secondary';
verifyWorkspaceButton.textContent = 'Testar banco, login e CRUD';
verifyWorkspaceButton.type = 'button';
$('repairPreview').insertAdjacentElement('afterend', verifyWorkspaceButton);

function functionalVerificationPrepared(result = lastResult) {
  return Boolean(result?.standalone?.functionalVerification?.prepared
    || result?.functionalVerification?.prepared
    || result?.workspaceValidation
    || result?.operationSummary?.technicalGates?.workspace);
}

const configureActionsBeforeFunctionalVerification = configureResultActions;
configureResultActions = function configureActionsWithFunctionalVerification(result = lastResult) {
  configureActionsBeforeFunctionalVerification(result);
  const jobRoot = result?.paths?.jobRoot;
  verifyWorkspaceButton.classList.toggle('hidden', !jobRoot || result?.options?.deliveryMode === 'snapshot');
  if (jobRoot) $('resultActions').classList.remove('hidden');
  verifyWorkspaceButton.title = functionalVerificationPrepared(result)
    ? 'Inicia Supabase local, aplica migrations e testa autenticação, profiles, CRUD e RLS.'
    : 'Operações antigas podem precisar ser reconstruídas antes deste teste.';
};

const setRunningBeforeFunctionalVerification = setRunning;
setRunning = function setRunningWithFunctionalVerification(running) {
  setRunningBeforeFunctionalVerification(running);
  verifyWorkspaceButton.disabled = running;
};

verifyWorkspaceButton.onclick = async () => {
  const jobRoot = lastResult?.paths?.jobRoot;
  if (!jobRoot) return setResult('Operação indisponível', 'Não foi possível localizar o workspace da operação.', 'error');
  try {
    setRunning(true);
    stage('supabase', 'running');
    setResult('Executando testes funcionais', 'O Bridge iniciará um Supabase local limpo e testará migrations, usuários, login, profiles, CRUD e RLS.', 'running', ['Docker Desktop necessário', 'Nenhum secret será persistido']);
    setOperationSummary('Validando workspace real', 'Esta etapa usa banco e autenticação reais; o modo demo não conta como evidência.', 'running');
    log('Executando verificação funcional automática do workspace...');
    const state = await call(window.rbBridge.migration.verifyWorkspace(jobRoot));
    lastResult = state.result;
    stage('supabase', 'complete');
    setResult('Workspace funcional aprovado', 'Supabase local, migrations, login, profiles, CRUD e isolamento RLS passaram nos testes.', 'success');
    setOperationSummary('Banco e autenticação aprovados', 'A evidência automática foi registrada e os defeitos relacionados foram resolvidos por reteste.', 'success');
    configureResultActions(lastResult);
  } catch (error) {
    stage('supabase', 'failed', error.message);
    setResult('Workspace funcional reprovado', error.message, 'error');
    setOperationSummary('Defeitos funcionais identificados', 'Consulte a fila de defeitos, corrija o workspace e execute o teste novamente.', 'error');
    log(`Verificação funcional: ${error.message}`);
    await refreshOperationDecision(lastResult);
  } finally {
    setRunning(false);
  }
};
