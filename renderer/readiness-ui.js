'use strict';

function readinessMeta(result = lastResult) {
  const readiness = result?.readiness;
  if (!readiness) return [];
  const contracts = readiness.runtimeContracts || {};
  return [
    `${readiness.label} · ${readiness.score}/100`,
    `Pacote: ${readiness.recommendedPackage}`,
    contracts.emulated ? `${contracts.emulated} contrato(s) emulado(s)` : null,
    contracts.unsupported ? `${contracts.unsupported} contrato(s) não suportado(s)` : null,
    readiness.productionBlockers?.length ? `${readiness.productionBlockers.length} bloqueador(es) de produção` : null,
  ].filter(Boolean);
}

const setResultWithoutReadiness = setResult;
setResult = function setResultWithReadiness(title, message = '', kind = 'idle', meta = []) {
  const combined = [...(Array.isArray(meta) ? meta : []), ...readinessMeta(lastResult)];
  setResultWithoutReadiness(title, message, kind, [...new Set(combined)]);
};
