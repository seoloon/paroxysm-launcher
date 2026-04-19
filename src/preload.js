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
    list:   ()   => ipcRenderer.invoke('library:list'),
    get:    id   => ipcRenderer.invoke('library:get', id),
    delete: id   => ipcRenderer.invoke('library:delete', id),
  },
  modpack: {
    pickFile: ()    => ipcRenderer.invoke('modpack:pick-file'),
    import:   path  => ipcRenderer.invoke('modpack:import', path),
  },
  game: {
    launch: id => ipcRenderer.invoke('game:launch', id),
  },
  shell: { open: p => ipcRenderer.invoke('shell:open', p) },
  app:   { version: () => ipcRenderer.invoke('app:version') },
  on,
  off,
});
