'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, shell, utilityProcess } = require('electron');
const { JsonLogger } = require('./core/logger.cjs');
const { BridgeError, asBridgeError } = require('./core/errors.cjs');
const { safeSlug } = require('./core/fs-utils.cjs');
const { Base44Service } = require('./services/base44-service.cjs');
const { ToolchainService } = require('./services/toolchain-service.cjs');
const { GitHubService } = require('./services/github-service.cjs');
const { SecurityService } = require('./services/security-service.cjs');
const { BuildService } = require('./services/build-service.cjs');
const { ArchiveService } = require('./services/archive-service.cjs');
const { ReportService } = require('./services/report-service.cjs');
const { MigrationService } = require('./services/migration-service.cjs');

let mainWindow;
let services;
const base44SmokeMode = process.argv.includes('--smoke-base44-cli');

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function openExternal(url) {
  return shell.openExternal(url);
}

function createServices() {
  const userDataDir = app.getPath('userData');
  const logger = new JsonLogger(path.join(userDataDir, 'logs'));
  const common = { logger, emit };
  const sessionRoot = path.join(userDataDir, 'sessions');
  const toolchain = new ToolchainService({ ...common, toolsDir: path.join(userDataDir, 'tools') });
  const base44 = new Base44Service({
    ...common,
    sessionDir: path.join(sessionRoot, 'base44'),
    openExternal,
    utilityProcess,
  });
  const github = new GitHubService({
    ...common,
    toolchain,
    sessionDir: path.join(sessionRoot, 'github'),
    openExternal,
  });
  const security = new SecurityService(common);
  const build = new BuildService(common);
  const archive = new ArchiveService({ emit });
  const reports = new ReportService({ userDataDir, logger });
  const migration = new MigrationService({ base44, github, security, build, archive, reports, logger, emit });
  return { logger, toolchain, base44, github, security, build, archive, reports, migration };
}

function serializeError(error) {
  const normalized = asBridgeError(error);
  return { name: normalized.name, code: normalized.code, message: normalized.message, details: normalized.details };
}

function handle(channel, action) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try { return { ok: true, data: await action(...args) }; }
    catch (error) {
      services?.logger?.error('ipc.error', { channel, error: serializeError(error) });
      return { ok: false, error: serializeError(error) };
    }
  });
}

function validateMigrationInput(input) {
  if (!input || typeof input !== 'object') throw new BridgeError('INVALID_INPUT', 'Migration input is required.');
  if (!input.acceptedAuthorization) throw new BridgeError('AUTHORIZATION_REQUIRED', 'Confirm that the project owner authorized this migration.');
  if (!input.project?.id || !input.project?.name) throw new BridgeError('PROJECT_REQUIRED', 'Select a Base44 project.');
  if (!input.outputDirectory || typeof input.outputDirectory !== 'string') throw new BridgeError('OUTPUT_DIRECTORY_REQUIRED', 'Select an output directory.');
  const repo = input.repository;
  if (!repo?.owner || !repo?.ownerType) throw new BridgeError('GITHUB_OWNER_REQUIRED', 'Select a GitHub account or organization.');
  if (!['user', 'organization'].includes(repo.ownerType)) throw new BridgeError('INVALID_GITHUB_OWNER_TYPE', 'The GitHub owner type is invalid.');
  repo.name = safeSlug(repo.name, safeSlug(input.project.name));
  if (!/^[a-z0-9._-]{1,100}$/i.test(repo.name)) throw new BridgeError('INVALID_REPOSITORY_NAME', 'The repository name is invalid.');
  repo.visibility = repo.visibility === 'public' ? 'public' : 'private';
  repo.description = String(repo.description ?? '').slice(0, 350);
  repo.commitMessage = String(repo.commitMessage ?? '').slice(0, 200);
  return input;
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
  }));
  handle('system:choose-output-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('system:open-path', async (target) => {
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw new BridgeError('INVALID_PATH', 'Only absolute local paths can be opened.');
    const error = await shell.openPath(target);
    if (error) throw new BridgeError('OPEN_PATH_FAILED', error);
    return true;
  });
  handle('system:open-external', async (url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new BridgeError('INVALID_URL', 'Only HTTPS links can be opened.');
    await shell.openExternal(parsed.href);
    return true;
  });

  handle('base44:status', () => services.base44.whoami());
  handle('base44:login', () => services.base44.login());
  handle('base44:logout', () => services.base44.logout());
  handle('base44:projects', () => services.base44.listProjects());

  handle('github:status', () => services.github.authStatus());
  handle('github:login', () => services.github.login());
  handle('github:logout', () => services.github.logout());
  handle('github:accounts', () => services.github.getAccounts());

  handle('migration:start', (input) => services.migration.migrate(validateMigrationInput(input)));
  handle('migration:cancel', () => services.migration.cancel());
  handle('migration:retry-publish', (jobRoot) => {
    if (typeof jobRoot !== 'string' || !path.isAbsolute(jobRoot)) throw new BridgeError('INVALID_PATH', 'A valid migration directory is required.');
    return services.migration.retryPublish(jobRoot);
  });
  handle('migration:history', () => services.reports.getHistory());
  handle('migration:history-clear', () => services.reports.clearHistory());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: '#071018',
    title: 'RB Project Bridge',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
}

async function runBase44Smoke() {
  services = createServices();
  try {
    await services.base44.runCli(['login', '--help'], {
      timeoutMs: 60_000,
      onOutput: ({ stream, text }) => {
        if (stream === 'stderr') process.stderr.write(text);
        else process.stdout.write(text);
      },
    });
    process.stdout.write('Packaged Base44 utility-process smoke test passed.\n');
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    app.exit(1);
  }
}

app.whenReady().then(() => {
  if (base44SmokeMode) return runBase44Smoke();
  services = createServices();
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (!base44SmokeMode && process.platform !== 'darwin') app.quit(); });
process.on('uncaughtException', (error) => services?.logger?.error('process.uncaughtException', { message: error.message, stack: error.stack }));
process.on('unhandledRejection', (error) => services?.logger?.error('process.unhandledRejection', { message: error instanceof Error ? error.message : String(error) }));
