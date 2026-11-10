const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browser', Object.freeze({
  getState: () => ipcRenderer.invoke('orbit:state'),
  suggest: query => ipcRenderer.invoke('orbit:suggest',query),
  getSeoulWeather: () => ipcRenderer.invoke('orbit:seoul-weather'),
  action: (name, payload = {}) => ipcRenderer.invoke('orbit:action', name, payload),
  sendLayout: layout => ipcRenderer.send('orbit:guest-layout', layout),
  showChromeMenu: request => ipcRenderer.invoke('orbit:chrome-menu', request),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('orbit:state-changed', listener);
    return () => ipcRenderer.removeListener('orbit:state-changed', listener);
  },
  onCommand: callback => {
    const listener = (_event, command, payload) => callback(command, payload);
    ipcRenderer.on('orbit:command', listener);
    return () => ipcRenderer.removeListener('orbit:command', listener);
  }
}));
