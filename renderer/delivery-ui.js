'use strict';

const CLIENT_PACKAGES = {
  preservation: { label: 'Diagnóstico e preservação', mode: 'snapshot', target: 'repository-only', promise: 'Preserva o ativo, gera backup verificável e mapeia a saída. Não promete aplicação executável.', receives: 'Backup, snapshot, inventário, segurança, riscos e plano de próximos passos.', action: 'Diagnosticar, preservar e entregar' },
  sandbox: { label: 'Sandbox executável', mode: 'standalone-supabase', target: 'supabase-cloud-static', promise: 'Entrega uma aplicação navegável fora da Base44 para demonstração e evolução inicial.', receives: 'Código standalone, preview Chromium, modo demo, contratos e handoff.', action: 'Gerar sandbox e entregar' },
  workspace: { label: 'Workspace evolutivo', mode: 'standalone-supabase', target: 'supabase-cloud-static', promise: 'Entrega um repositório que uma equipe consegue abrir, modificar e testar com banco independente.', receives: 'Sandbox, Supabase local, migrations, scripts, documentação e backlog.', action: 'Preparar workspace e entregar' },
  production: { label: 'Migração completa e homologação', mode: 'standalone-supabase', target: 'supabase-cloud-static', promise: 'Prepara a substituição da Base44, mas só aprova após dados, usuários, integrações, implantação e aceite.', receives: 'Workspace, plano de migração, implantação, aceite, credenciais, rollback e backlog.', action: 'Preparar migração e avaliar aceite' },
};

function clientPackage() { return CLIENT_PACKAGES[$('deliveryPackage')?.value] || CLIENT_PACKAGES.workspace; }
function targetMessage(target) {
  return ({
    'supabase-cloud-static': 'Destino suportado: front-end web e Supabase. As contas de produção devem ficar em nome do cliente.',
    'supabase-self-hosted': 'Workspace Docker preparado; operação, backup, SMTP, TLS e monitoramento são parte do projeto.',
    'aws-custom': 'Blueprint apenas: AWS exige adapters e infraestrutura específicos. Não é implantação automática em Lambda.',
    'repository-only': 'Entrega limitada ao repositório, ZIP e documentação, sem hospedagem gerenciada.',
  })[target] || '';
}

function refreshClientPackage() {
  const definition = clientPackage();
  const packageId = $('deliveryPackage').value;
  $('deliveryMode').value = definition.mode;
  if (!$('targetProfile').dataset.userSelected || packageId === 'preservation') $('targetProfile').value = definition.target;
  $('packagePromise').textContent = definition.promise;
  $('packageReceives').textContent = definition.receives;
  $('targetSummary').textContent = targetMessage($('targetProfile').value);
  $('migrationScope').classList.toggle('hidden', ['preservation', 'sandbox'].includes(packageId));
  const snapshot = definition.mode === 'snapshot';
  for (const name of ['standalone', 'supabase', 'build']) document.querySelector(`[data-step="${name}"]`)?.classList.toggle('disabled', snapshot);
  if (!operationRunning) $('start').textContent = definition.action;
}

async function saveDeliveryContext() {
  const project = $('project').selectedOptions[0];
  const payload = {
    projectId: project?.value || null,
    deliveryPackage: $('deliveryPackage').value,
    targetProfile: $('targetProfile').value,
    clientName: $('clientName').value,
    deliveryOwner: $('deliveryOwner').value,
    migrationScope: {
      data: $('scopeData').checked,
      users: $('scopeUsers').checked,
      storage: $('scopeStorage').checked,
      integrations: $('scopeIntegrations').checked,
      deployment: $('scopeDeployment').checked,
    },
  };
  if (payload.deliveryPackage === 'production' && !String(payload.clientName).trim()) throw new Error('Informe o cliente para uma migração completa e homologação.');
  const response = await window.rbBridge.delivery.setContext(payload);
  if (!response.ok) throw new Error(response.error?.message || 'Não foi possível registrar o pacote contratado.');
  return response.data;
}

function clientDeliveryTarget(result = lastResult) {
  return result?.clientDelivery?.archive?.path
    || result?.reportFiles?.clientDeliveryArchive
    || result?.clientDelivery?.directory
    || result?.reportFiles?.clientDeliveryDirectory
    || null;
}

$('deliveryPackage').onchange = refreshClientPackage;
$('targetProfile').onchange = () => { $('targetProfile').dataset.userSelected = 'true'; refreshClientPackage(); };

const originalStartHandler = $('start').onclick;
$('start').onclick = async (event) => {
  try {
    refreshClientPackage();
    await saveDeliveryContext();
    return await originalStartHandler.call($('start'), event);
  } catch (error) {
    setResult('Revise o pacote contratado', error.message, 'error');
    setOperationSummary('Dados da entrega incompletos', 'Informe o cliente, o pacote e o destino antes de iniciar.', 'error');
  }
};

const originalSetRunningForDelivery = setRunning;
setRunning = function setRunningWithDelivery(running) {
  originalSetRunningForDelivery(running);
  $('start').textContent = running ? 'Processando produto...' : clientPackage().action;
};

const originalConfigureActionsForDelivery = configureResultActions;
configureResultActions = function configureActionsWithClientPackage(result = lastResult) {
  originalConfigureActionsForDelivery(result);
  const target = clientDeliveryTarget(result);
  $('openDelivery').classList.toggle('hidden', !target);
  if (target) $('resultActions').classList.remove('hidden');
};

$('openDelivery').onclick = () => {
  const target = clientDeliveryTarget(lastResult);
  if (target) call(window.rbBridge.system.openPath(target));
};

const originalSetResultForDelivery = setResult;
setResult = function setResultWithDelivery(title, message = '', kind = 'idle', meta = []) {
  const delivery = lastResult?.clientDelivery;
  const accepted = delivery?.acceptance?.acceptedByAutomation;
  const packageLabel = delivery?.package?.label;
  let nextTitle = title;
  let nextKind = kind;
  if (delivery && /Produto gerado e entregue|Entrega concluída/.test(title)) {
    nextTitle = accepted ? 'Pacote gerado e tecnicamente aprovado' : 'Pacote gerado com pendências';
    nextKind = accepted ? 'success' : 'attention';
  }
  const additions = [packageLabel, delivery ? (accepted ? 'Critério automático aprovado' : 'Consulte o checklist de aceite') : null].filter(Boolean);
  originalSetResultForDelivery(nextTitle, message, nextKind, [...(Array.isArray(meta) ? meta : []), ...additions]);
};

refreshClientPackage();
