const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')

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

window.addEventListener('DOMContentLoaded', () => {
  try {
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.textContent = fs.readFileSync(path.join(__dirname, 'src', 'dps-meter-ui.js'), 'utf8')
    document.documentElement.appendChild(script)
  } catch (error) {
    console.error('[Norr] Failed to load integrated DPS meter UI:', error)
  }
})
