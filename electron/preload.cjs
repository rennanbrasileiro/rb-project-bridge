'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const allowedEvents = new Set([
  'base44:output', 'github:output', 'build:output', 'migration:progress', 'toolchain:progress',
]);

contextBridge.exposeInMainWorld('rbBridge', {
  system: {
    status: () => ipcRenderer.invoke('system:status'),
    chooseOutputDirectory: () => ipcRenderer.invoke('system:choose-output-directory'),
    openPath: (target) => ipcRenderer.invoke('system:open-path', target),
    openExternal: (url) => ipcRenderer.invoke('system:open-external', url),
  },
  base44: {
    status: () => ipcRenderer.invoke('base44:status'),
    login: () => ipcRenderer.invoke('base44:login'),
    logout: () => ipcRenderer.invoke('base44:logout'),
    projects: () => ipcRenderer.invoke('base44:projects'),
  },
  github: {
    status: () => ipcRenderer.invoke('github:status'),
    login: () => ipcRenderer.invoke('github:login'),
    logout: () => ipcRenderer.invoke('github:logout'),
    accounts: () => ipcRenderer.invoke('github:accounts'),
  },
  migration: {
    start: (input) => ipcRenderer.invoke('migration:start', input),
    cancel: () => ipcRenderer.invoke('migration:cancel'),
    retryPublish: (jobRoot) => ipcRenderer.invoke('migration:retry-publish', jobRoot),
    history: () => ipcRenderer.invoke('migration:history'),
    clearHistory: () => ipcRenderer.invoke('migration:history-clear'),
  },
  on: (channel, callback) => {
    if (!allowedEvents.has(channel)) throw new Error(`Unsupported event channel: ${channel}`);
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
