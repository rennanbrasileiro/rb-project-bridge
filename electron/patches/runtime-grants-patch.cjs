'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { StandaloneService } = require('../services/standalone-service.cjs');
const { writeJson } = require('../core/fs-utils.cjs');
const { VERIFICATION_MIGRATION } = require('./functional-workspace-patch.cjs');

const PATCH_FLAG = Symbol.for('rb.bridge.runtime.grants.patch');
const RUNTIME_GRANTS_MIGRATION = '99999999999998_rb_runtime_grants.sql';
const SMOKE_GRANT_MARKER = '-- RB Project Bridge smoke grants';

function quoteIdentifier(value) {
  return `"${String(value || '').replaceAll('"', '""')}"`;
}

function runtimeGrantSql(entities = []) {
  const tables = [...new Set(entities.map((entity) => entity?.table).filter(Boolean))];
  const statements = [
    '-- RB Project Bridge runtime grants.',
    '-- SQL grants permit operations; RLS policies remain the row-level security boundary.',
    'grant usage on schema public to anon, authenticated;',
  ];
  for (const table of tables) {
    const target = `public.${quoteIdentifier(table)}`;
    if (table === 'profiles') statements.push(`grant select, update on table ${target} to authenticated;`);
    else statements.push(`grant select, insert, update, delete on table ${target} to authenticated;`);
  }
  return `${statements.join('\n')}\n`;
}

function smokeGrantSql() {
  return `\n${SMOKE_GRANT_MARKER}
grant usage on schema public to anon, authenticated;
grant select on table public.rb_bridge_smoke to anon;
grant select, insert, update, delete on table public.rb_bridge_smoke to authenticated;
grant select, update on table public.profiles to authenticated;
`;
}

async function applyRuntimeGrants(root, report) {
  const migrationsDir = path.join(root, 'supabase', 'migrations');
  await fs.mkdir(migrationsDir, { recursive: true });
  const runtimeGrantsPath = path.join(migrationsDir, RUNTIME_GRANTS_MIGRATION);
  await fs.writeFile(runtimeGrantsPath, runtimeGrantSql(report.entities), 'utf8');

  const verificationPath = path.join(migrationsDir, VERIFICATION_MIGRATION);
  const verification = await fs.readFile(verificationPath, 'utf8');
  const nextVerification = verification.includes(SMOKE_GRANT_MARKER)
    ? verification
    : `${verification.trimEnd()}${smokeGrantSql()}`;
  await fs.writeFile(verificationPath, nextVerification, 'utf8');

  report.runtimeGrants = {
    prepared: true,
    migrationPath: path.relative(root, runtimeGrantsPath).replaceAll('\\', '/'),
    authenticatedTables: [...new Set((report.entities || []).map((entity) => entity?.table).filter(Boolean))],
    anonymousTables: ['rb_bridge_smoke'],
    securityBoundary: 'RLS policies remain mandatory and are verified separately.',
  };
  await writeJson(path.join(root, 'RB-STANDALONE-REPORT.json'), report);
  return report;
}

if (!StandaloneService.prototype[PATCH_FLAG]) {
  const originalTransform = StandaloneService.prototype.transform;
  StandaloneService.prototype.transform = async function transformWithRuntimeGrants(root, options = {}) {
    const report = await originalTransform.call(this, root, options);
    return applyRuntimeGrants(root, report);
  };
  Object.defineProperty(StandaloneService.prototype, PATCH_FLAG, { value: true, enumerable: false });
}

module.exports = {
  RUNTIME_GRANTS_MIGRATION,
  SMOKE_GRANT_MARKER,
  quoteIdentifier,
  runtimeGrantSql,
  smokeGrantSql,
  applyRuntimeGrants,
};
