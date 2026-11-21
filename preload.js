'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /** Appelle une action du processus principal ; lève une Error avec un message lisible en cas d'échec. */
  call: async (name, ...args) => {
    const r = await ipcRenderer.invoke('call', name, args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  on: (channel, cb) => {
    if (!['inbox', 'progress', 'navigate'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  }
});
