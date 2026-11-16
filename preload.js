const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.sendSync('db:load'),
  save: d => ipcRenderer.send('db:save', d),
  info: () => ipcRenderer.sendSync('app:info'),
  openData: () => ipcRenderer.send('app:open-data'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  document: a => ipcRenderer.invoke('doc:run', a),
  exportCsv: a => ipcRenderer.invoke('export:csv', a),
  copyText: t => ipcRenderer.send('clip:copy', t),
  mailGet: () => ipcRenderer.sendSync('mail:get'),
  mailSet: c => ipcRenderer.invoke('mail:set', c),
  mailTest: () => ipcRenderer.invoke('mail:test'),
  gateState: () => ipcRenderer.sendSync('gate:state'),
  activate: t => ipcRenderer.invoke('access:activate', t),
  recheck: () => ipcRenderer.invoke('access:recheck'),
  pinCheck: p => ipcRenderer.invoke('pin:check', p),
  pinStatus: () => ipcRenderer.sendSync('pin:status'),
  pinSet: a => ipcRenderer.invoke('pin:set', a),
  accessInfo: () => ipcRenderer.sendSync('access:info'),
  backupGet: () => ipcRenderer.sendSync('backup:get'),
  backupFolder: () => ipcRenderer.invoke('backup:folder'),
  backupSettings: a => ipcRenderer.invoke('backup:settings', a),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  backupRestore: a => ipcRenderer.invoke('backup:restore', a),
  lock: () => ipcRenderer.send('pin:lock'),
  licences: {
    available: () => ipcRenderer.sendSync('lic:available'),
    list: () => ipcRenderer.invoke('lic:list'),
    issue: a => ipcRenderer.invoke('lic:issue', a),
    revoke: a => ipcRenderer.invoke('lic:revoke', a),
    publish: () => ipcRenderer.invoke('lic:publish')
  }
});
