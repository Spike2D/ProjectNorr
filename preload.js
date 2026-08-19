const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openLogFile: () => ipcRenderer.invoke('open-log-file'),
  selectLogFolder: () => ipcRenderer.invoke('select-log-folder'),
  scanLogFiles: (folderPath) => ipcRenderer.invoke('scan-log-files', folderPath),
  scanLogDates: (folderPath) => ipcRenderer.invoke('scan-log-dates', folderPath),
  parseLogForDate: (filePath, options) => ipcRenderer.invoke('parse-log-for-date', filePath, options),
  readLogFile: (filePath) => ipcRenderer.invoke('read-log-file', filePath),
  writeLogFile: (filePath, content) => ipcRenderer.invoke('write-log-file', filePath, content),
  statLogFile: (filePath) => ipcRenderer.invoke('stat-log-file', filePath),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  parserStart: (filePath) => ipcRenderer.invoke('start-parser', filePath),
  parserStop: () => ipcRenderer.invoke('stop-parser'),
  parserSnapshot: () => ipcRenderer.invoke('parser-snapshot'),
  setMeterScope: (scope) => ipcRenderer.invoke('set-meter-scope', scope),
  onParserAutoStarted: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('parser-auto-started', listener)
    return () => ipcRenderer.removeListener('parser-auto-started', listener)
  }
})
