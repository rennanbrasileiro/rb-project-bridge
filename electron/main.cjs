'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const { JsonLogger } = require('./core/logger.cjs');
const { BridgeError, asBridgeError } = require('./core/errors.cjs');
const { safeSlug } = require('./core/fs-utils.cjs');
const { setDeliveryContext } = require('./core/delivery-context.cjs');
const { Base44Service } = require('./services/base44-service.cjs');
const { ToolchainService } = require('./services/toolchain-service.cjs');
const { GitHubService } = require('./services/github-service.cjs');
const { SecurityService } = require('./services/security-service.cjs');
const { BuildService } = require('./services/build-service.cjs');
const { StandaloneService } = require('./services/standalone-service.cjs');
const { PreviewService } = require('./services/preview-service.cjs');
const { PreviewRepairService } = require('./services/preview-repair-service.cjs');
const { ArchiveService } = require('./services/archive-service.cjs');
const { ReportService } = require('./services/report-service.cjs');
const { MigrationService } = require('./services/migration-service.cjs');
const { OperationControlService } = require('./services/operation-control-service.cjs');
const { GoogleAccountService } = require('./services/google-account-service.cjs');
const { GoogleWorkspaceService } = require('./services/google-workspace-service.cjs');
const { GoogleAiService } = require('./services/google-ai-service.cjs');

let mainWindow;
let services;
const base44SmokeMode = process.env.RB_BRIDGE_SMOKE_BASE44_OAUTH === '1';
function emit(channel, payload) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); }
function openExternal(url) { return shell.openExternal(url); }

function createServices() {
  const userDataDir = app.getPath('userData');
  const logger = new JsonLogger(path.join(userDataDir, 'logs'));
  const common = { logger, emit };
  const sessionRoot = path.join(userDataDir, 'sessions');
  const toolchain = new ToolchainService({ ...common, toolsDir: path.join(userDataDir, 'tools') });
  const base44 = new Base44Service({ ...common, sessionDir: path.join(sessionRoot, 'base44'), openExternal });
  const github = new GitHubService({ ...common, toolchain, sessionDir: path.join(sessionRoot, 'github'), openExternal });
  const security = new SecurityService(common);
  const preview = new PreviewService({ logger, emit, openExternal, createBrowserWindow: (options) => new BrowserWindow(options) });
  const build = new BuildService({ ...common, runtimeValidator: (directory, options) => preview.validateRuntime(directory, options) });
  const standalone = new StandaloneService(common);
  const archive = new ArchiveService({ emit });
  const reports = new ReportService({ userDataDir, logger });
  const migration = new MigrationService({ base44, github, security, build, standalone, archive, reports, logger, emit });
  const previewRepair = new PreviewRepairService({ build, standalone, security, reports, logger, emit });
  const operationControl = new OperationControlService({ reports, logger });
  const googleAccounts = new GoogleAccountService({ userDataDir, safeStorage, logger, openExternal });
  const googleWorkspace = new GoogleWorkspaceService({ accounts: googleAccounts, logger });
  const googleAi = new GoogleAiService({ accounts: googleAccounts, logger });
  return {
    logger,
    toolchain,
    base44,
    github,
    security,
    build,
    standalone,
    preview,
    previewRepair,
    archive,
    reports,
    migration,
    operationControl,
    googleAccounts,
    googleWorkspace,
    googleAi,
  };
}

function serializeError(error) { const normalized = asBridgeError(error); return { name: normalized.name, code: normalized.code, message: normalized.message, details: normalized.details }; }
function handle(channel, action) { ipcMain.handle(channel, async (_event, ...args) => { try { return { ok: true, data: await action(...args) }; } catch (error) { services?.logger?.error('ipc.error', { channel, error: serializeError(error) }); return { ok: false, error: serializeError(error) }; } }); }

function validateMigrationInput(input) {
  if (!input || typeof input !== 'object') throw new BridgeError('INVALID_INPUT', 'Os dados da operação são obrigatórios.');
  if (!input.acceptedAuthorization) throw new BridgeError('AUTHORIZATION_REQUIRED', 'Confirme que o proprietário autorizou esta operação.');
  if (!input.project?.id || !input.project?.name) throw new BridgeError('PROJECT_REQUIRED', 'Selecione um projeto Base44.');
  if (!input.outputDirectory || typeof input.outputDirectory !== 'string') throw new BridgeError('OUTPUT_DIRECTORY_REQUIRED', 'Selecione uma pasta de entrega.');
  const repo = input.repository;
  if (!repo?.owner || !repo?.ownerType) throw new BridgeError('GITHUB_OWNER_REQUIRED', 'Selecione uma conta ou organização GitHub.');
  if (!['user', 'organization'].includes(repo.ownerType)) throw new BridgeError('INVALID_GITHUB_OWNER_TYPE', 'O tipo de proprietário GitHub é inválido.');
  repo.strategy = repo.strategy === 'create' ? 'create' : 'reuse';
  repo.name = safeSlug(repo.name, safeSlug(input.project.name));
  if (!/^[a-z0-9._-]{1,100}$/i.test(repo.name)) throw new BridgeError('INVALID_REPOSITORY_NAME', 'O nome do repositório é inválido.');
  repo.visibility = 'private';
  repo.description = String(repo.description ?? '').slice(0, 350);
  repo.commitMessage = String(repo.commitMessage ?? '').slice(0, 200);
  input.deliveryMode = input.deliveryMode === 'snapshot' ? 'snapshot' : 'standalone-supabase';
  input.buildValidation = input.deliveryMode === 'standalone-supabase' ? true : Boolean(input.buildValidation);
  return input;
}

function validateJobRoot(jobRoot) {
  if (typeof jobRoot !== 'string' || !path.isAbsolute(jobRoot)) throw new BridgeError('INVALID_PATH', 'É necessária uma pasta de operação válida.');
  return jobRoot;
}

function registerIpc() {
  handle('system:status', async () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    toolchain: await services.toolchain.status(),
    base44: await services.base44.whoami(),
    github: await services.github.authStatus(),
    google: await services.googleAccounts.status(),
    preview: services.preview.status(),
  }));
  handle('system:choose-output-directory', async () => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  handle('system:open-path', async (target) => { if (typeof target !== 'string' || !path.isAbsolute(target)) throw new BridgeError('INVALID_PATH', 'Somente caminhos locais absolutos podem ser abertos.'); const error = await shell.openPath(target); if (error) throw new BridgeError('OPEN_PATH_FAILED', error); return true; });
  handle('system:open-external', async (url) => { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol)) throw new BridgeError('INVALID_URL', 'Somente links HTTP/HTTPS podem ser abertos.'); if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new BridgeError('INVALID_URL', 'Links HTTP são permitidos apenas para preview local.'); await shell.openExternal(parsed.href); return true; });
  handle('base44:status', () => services.base44.whoami()); handle('base44:login', () => services.base44.login()); handle('base44:logout', () => services.base44.logout()); handle('base44:projects', () => services.base44.listProjects());
  handle('github:status', () => services.github.authStatus()); handle('github:login', () => services.github.login()); handle('github:logout', () => services.github.logout()); handle('github:accounts', () => services.github.getAccounts()); handle('github:ensure-delivery-scopes', () => services.github.ensureDeliveryScopes()); handle('github:repositories', (owner, ownerType) => services.github.listRepositories(owner, ownerType)); handle('github:source-status', (input) => services.github.inspectSourceStatus(input));
  handle('google:status', () => services.googleAccounts.status());
  handle('google:save-oauth', (input) => services.googleAccounts.saveOAuthConfiguration(input));
  handle('google:save-ai', (input) => services.googleAccounts.saveAiConfiguration(input));
  handle('google:connect', (input) => services.googleAccounts.connect(input));
  handle('google:disconnect', (accountId) => services.googleAccounts.disconnect(accountId));
  handle('google:inventory', (accountId) => services.googleWorkspace.inventory(accountId));
  handle('google:search-messages', (accountId, input) => services.googleWorkspace.searchMessages(accountId, input));
  handle('google:send-message', (accountId, input) => services.googleWorkspace.sendMessage(accountId, input));
  handle('google:create-document', (accountId, input) => services.googleWorkspace.createDocument(accountId, input));
  handle('google:test-gemini', () => services.googleAi.testGemini());
  handle('google:list-notebooks', (accountId) => services.googleAi.listNotebooks(accountId));
  handle('google:create-notebook', (accountId, input) => services.googleAi.createNotebook(accountId, input));
  handle('google:add-notebook-sources', (accountId, input) => services.googleAi.addNotebookSources(accountId, input));
  handle('google:upload-notebook-file', (accountId, input) => services.googleAi.uploadNotebookFile(accountId, input));
  handle('delivery:set-context', (input) => setDeliveryContext(input));
  handle('migration:start', (input) => services.migration.migrate(validateMigrationInput(input)));
  handle('migration:cancel', () => { const migration = services.migration.cancel(); const repair = services.previewRepair.cancel(); return { cancelled: Boolean(migration.cancelled || repair.cancelled) }; });
  handle('migration:retry-publish', (jobRoot) => services.migration.retryPublish(validateJobRoot(jobRoot)));
  handle('migration:repair-preview', (jobRoot) => services.previewRepair.repair(validateJobRoot(jobRoot)));
  handle('migration:operation-state', (jobRoot) => services.operationControl.getState(validateJobRoot(jobRoot)));
  handle('migration:validation-save', (jobRoot, input) => services.operationControl.saveValidation(validateJobRoot(jobRoot), input));
  handle('migration:package-regenerate', (jobRoot) => services.operationControl.regeneratePackage(validateJobRoot(jobRoot)));
  handle('migration:history', () => services.reports.getHistory()); handle('migration:history-clear', () => services.reports.clearHistory());
  handle('preview:start', (directory) => services.preview.start(directory)); handle('preview:stop', () => services.preview.stop()); handle('preview:status', () => services.preview.status());
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1280, height: 900, minWidth: 1040, minHeight: 720, backgroundColor: '#071018', title: 'RB Project Bridge', show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  mainWindow.removeMenu(); mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')); mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== mainWindow.webContents.getURL()) event.preventDefault(); });
}

async function runBase44Smoke() {
  services = createServices(); const markerPath = process.env.RB_BRIDGE_SMOKE_MARKER;
  try { const device = await services.base44.requestDeviceCode(); if (!device.userCode || !device.verificationUri || !device.deviceCode) throw new Error('A Base44 não retornou o fluxo OAuth esperado.'); if (markerPath) await fsp.writeFile(markerPath, JSON.stringify({ ok: true, userCode: device.userCode, verificationUri: device.verificationUri }), 'utf8'); app.exit(0); }
  catch (error) { if (markerPath) await fsp.writeFile(markerPath, JSON.stringify({ ok: false, error: error.message }), 'utf8').catch(() => null); process.stderr.write(`${error.stack || error.message}\n`); app.exit(1); }
}

app.whenReady().then(() => { if (base44SmokeMode) return runBase44Smoke(); services = createServices(); registerIpc(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', async () => { if (!base44SmokeMode) await services?.preview?.stop().catch(() => null); if (!base44SmokeMode && process.platform !== 'darwin') app.quit(); });
process.on('uncaughtException', (error) => services?.logger?.error('process.uncaughtException', { message: error.message, stack: error.stack }));
process.on('unhandledRejection', (error) => services?.logger?.error('process.unhandledRejection', { message: error instanceof Error ? error.message : String(error) }));
