'use strict';

const ALLOWED_PACKAGES = new Set(['preservation', 'sandbox', 'workspace', 'production']);
const ALLOWED_TARGETS = new Set(['supabase-cloud-static', 'supabase-self-hosted', 'aws-custom', 'repository-only']);
let current = null;

function clean(value, limit = 200) { return String(value ?? '').trim().slice(0, limit); }
function sanitizeScope(scope = {}) {
  return {
    data: Boolean(scope.data),
    users: Boolean(scope.users),
    storage: Boolean(scope.storage),
    integrations: Boolean(scope.integrations),
    deployment: Boolean(scope.deployment),
  };
}

function setDeliveryContext(input = {}) {
  const deliveryPackage = ALLOWED_PACKAGES.has(input.deliveryPackage) ? input.deliveryPackage : 'workspace';
  const defaultTarget = deliveryPackage === 'preservation' ? 'repository-only' : 'supabase-cloud-static';
  current = {
    projectId: clean(input.projectId, 120) || null,
    deliveryPackage,
    targetProfile: ALLOWED_TARGETS.has(input.targetProfile) ? input.targetProfile : defaultTarget,
    clientName: clean(input.clientName, 160) || null,
    deliveryOwner: clean(input.deliveryOwner, 160) || null,
    migrationScope: sanitizeScope(input.migrationScope),
    capturedAt: new Date().toISOString(),
  };
  return current;
}

function getDeliveryContext(projectId = null) {
  if (!current) return null;
  if (projectId && current.projectId && String(projectId) !== current.projectId) return null;
  return { ...current, migrationScope: { ...current.migrationScope } };
}

function clearDeliveryContext() { current = null; }

module.exports = { setDeliveryContext, getDeliveryContext, clearDeliveryContext, ALLOWED_PACKAGES, ALLOWED_TARGETS };
