'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JsonLogger } = require('../electron/core/logger.cjs');
const { setDeliveryContext } = require('../electron/core/delivery-context.cjs');
const { Base44Service } = require('../electron/services/base44-service.cjs');
const { ToolchainService } = require('../electron/services/toolchain-service.cjs');
const { GitLabService } = require('../electron/services/gitlab-service.cjs');
const { SecurityService } = require('../electron/services/security-service.cjs');
const { BuildService } = require('../electron/services/build-service.cjs');
const { StandaloneService } = require('../electron/services/standalone-service.cjs');
const { ArchiveService } = require('../electron/services/archive-service.cjs');
const { ReportService } = require('../electron/services/report-service.cjs');
const { MigrationService } = require('../electron/services/migration-service.cjs');
const { validateHeadlessRuntime } = require('./headless-runtime-validator.cjs');
const { ConnectionStore } = require('./connection-store.cjs');

async function writeBase44Session(base44, auth) {
  if (!auth?.accessToken || !auth?.refreshToken) throw new Error('Conexão Base44 sem credenciais válidas.');
  const target = base44.getAuthPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(auth, null, 2), { encoding: 'utf8', mode: 0o600 });
}

async function runCloudJob(job, options = {}) {
  const dataRoot = path.resolve(options.dataRoot || process.env.RB_BRIDGE_CLOUD_DATA || path.join(process.cwd(), '.bridge-cloud'));
  const ephemeralRoot = await fs.mkdtemp(path.join(os.tmpdir(), `rb-bridge-cloud-${job.id}-`));
  const userDataDir = path.join(ephemeralRoot, 'user-data');
  const sessionRoot = path.join(ephemeralRoot, 'sessions');
  const outputDirectory = path.join(dataRoot, 'artifacts', job.id);
  await Promise.all([fs.mkdir(userDataDir, { recursive: true }), fs.mkdir(outputDirectory, { recursive: true })]);
  const logger = new JsonLogger(path.join(userDataDir, 'logs'));
  const emit = (channel, payload) => options.onEvent?.({ channel, ...payload });
  const common = { logger, emit };
  const connections = options.connections || new ConnectionStore({ root: dataRoot });
  const base44Connection = await connections.get(job.input.connections.base44, 'base44');
  const gitProvider = job.input.repository.provider || 'gitlab';
  if (gitProvider !== 'gitlab') throw new Error(`Bridge Cloud Alpha suporta GitLab neste momento; provedor recebido: ${gitProvider}.`);
  const gitlabConnection = await connections.get(job.input.connections.git, 'gitlab');
  const toolchain = new ToolchainService({ ...common, toolsDir: path.join(dataRoot, 'tools') });
  const base44 = new Base44Service({ ...common, sessionDir: path.join(sessionRoot, 'base44'), openExternal: async () => {} });
  await writeBase44Session(base44, base44Connection.secret.auth);
  const gitlab = new GitLabService({ ...common, toolchain, sessionDir: path.join(sessionRoot, 'gitlab'), baseUrl: gitlabConnection.metadata.baseUrl, tokenProvider: async () => gitlabConnection.secret.token });
  const security = new SecurityService(common);
  const build = new BuildService({ ...common, runtimeValidator: validateHeadlessRuntime });
  const standalone = new StandaloneService(common);
  const archive = new ArchiveService({ emit });
  const reports = new ReportService({ userDataDir, logger });
  const migration = new MigrationService({ base44, github: gitlab, security, build, standalone, archive, reports, logger, emit });

  const input = structuredClone(job.input);
  input.outputDirectory = outputDirectory;
  input.acceptedAuthorization = true;
  delete input.connections;
  if (job.input.deliveryContext) setDeliveryContext({ projectId: input.project.id, ...job.input.deliveryContext });
  try {
    const report = await migration.migrate(input);
    return { report, outputDirectory, provider: gitProvider };
  } finally {
    await fs.rm(ephemeralRoot, { recursive: true, force: true }).catch(() => null);
  }
}

module.exports = { runCloudJob, writeBase44Session };
