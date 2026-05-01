'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Wrap listeners so we can remove them by the original callback reference
const listenerMap = new WeakMap();

function on(ch, cb) {
  const wrapped = (_, d) => cb(d);
  listenerMap.set(cb, wrapped);
  ipcRenderer.on(ch, wrapped);
}

function off(ch, cb) {
  const wrapped = listenerMap.get(cb);
  if (wrapped) { ipcRenderer.removeListener(ch, wrapped); listenerMap.delete(cb); }
}

contextBridge.exposeInMainWorld('px', {
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close:    () => ipcRenderer.send('win:close'),
  },
  config: {
    get: key        => ipcRenderer.invoke('config:get', key),
    set: (key, val) => ipcRenderer.invoke('config:set', key, val),
  },
  auth: {
    status:  () => ipcRenderer.invoke('auth:status'),
    login:   () => ipcRenderer.invoke('auth:login'),
    logout:  () => ipcRenderer.invoke('auth:logout'),
  },
  library: {
    list:   ()            => ipcRenderer.invoke('library:list'),
    get:    id            => ipcRenderer.invoke('library:get', id),
    delete: id            => ipcRenderer.invoke('library:delete', id),
    update: (id, fields)  => ipcRenderer.invoke('library:update', id, fields),
  },
  logs: {
    list:   packId            => ipcRenderer.invoke('modpack:get-logs', packId),
    // SECURITY FIX: pass { packId, logPath } so main process can validate the path
    read:   (packId, logPath) => ipcRenderer.invoke('modpack:read-log', { packId, logPath }),
  },
  game: {
    launch: id => ipcRenderer.invoke('game:launch', id),
    kill:  () => ipcRenderer.invoke('game:kill'),
  },
  shell: {
    open:         p   => ipcRenderer.invoke('shell:open', p),
    openExternal: url => ipcRenderer.invoke('shell:open-external', url),
  },
  modrinth: {
    search:           (params) => ipcRenderer.invoke('modrinth:search', params),
    getProject:       (id)     => ipcRenderer.invoke('modrinth:get-project', id),
    getVersions:      (id)     => ipcRenderer.invoke('modrinth:get-versions', id),
    download:         (params) => ipcRenderer.invoke('modrinth:download', params),
    getGameVersions:  ()       => ipcRenderer.invoke('modrinth:get-game-versions'),
    getInstalledFiles:(packId) => ipcRenderer.invoke('modrinth:get-installed-files', packId),
    checkInstanceUpdates: (packId) => ipcRenderer.invoke('modrinth:instance-check-updates', packId),
    applyInstanceUpdates: (payload) => ipcRenderer.invoke('modrinth:instance-apply-updates', payload),
  },
  modpack: {
    pickFile:     ()       => ipcRenderer.invoke('modpack:pick-file'),
    import:       payload  => ipcRenderer.invoke('modpack:import', payload),
    resolveNames: id       => ipcRenderer.invoke('modpack:resolve-names', id),
    deleteContentFile: payload => ipcRenderer.invoke('modpack:delete-content-file', payload),
    fetchIcon:    (params) => ipcRenderer.invoke('modpack:fetch-icon', params),
  },
  app:   { version: () => ipcRenderer.invoke('app:version') },
  updates: {
    getState:   () => ipcRenderer.invoke('updates:get-state'),
    check:      () => ipcRenderer.invoke('updates:check'),
    installNow: () => ipcRenderer.invoke('updates:install-now'),
  },
  rpc: {
    setPage: page => ipcRenderer.invoke('rpc:set-page', page),
  },
  system: {
    ram: () => ipcRenderer.invoke('system:ram'),
  },
  java: {
    listInstallations: ()        => ipcRenderer.invoke('java:list-installations'),
    installRecommended: (major)  => ipcRenderer.invoke('java:install-recommended', major),
    browse: (major)              => ipcRenderer.invoke('java:browse', major),
    test: (major)                => ipcRenderer.invoke('java:test', major),
  },
  resources: {
    info:       () => ipcRenderer.invoke('resource:get-info'),
    purgeCache: () => ipcRenderer.invoke('resource:purge-cache'),
  },
  instance: {
    getMcVersions:     ()                       => ipcRenderer.invoke('instance:get-mc-versions'),
    getLoaderVersions: (loader, mcVersion)      => ipcRenderer.invoke('instance:get-loader-versions', { loader, mcVersion }),
    create:            (opts)                   => ipcRenderer.invoke('instance:create', opts),
  },
  on,
  off,
});
