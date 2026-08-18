const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const { parseEvent } = require('./src/parser')
const { LogBus } = require('./src/bus')
const { CombatModule } = require('./src/combat')
const { TrackerModule } = require('./src/tracker')

let mainWindow
let bus
let combat
let tracker
let tailInterval
let logPath
let seq = 0
let parsing = false

function getLastLogPath() {
  return path.join(app.getPath('userData'), 'last-log.json')
}

function loadLastLogPath() {
  try {
    const p = getLastLogPath()
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (data.path && fs.existsSync(data.path)) return data.path
    }
  } catch {}
  return null
}

function saveLastLogPath(p) {
  try {
    const lp = getLastLogPath()
    fs.mkdirSync(path.dirname(lp), { recursive: true })
    fs.writeFileSync(lp, JSON.stringify({ path: p }), 'utf-8')
  } catch {}
}

function createWindow() {
  bus = new LogBus()
  combat = new CombatModule()
  tracker = new TrackerModule()
  bus.subscribe((ev, live) => {
    if (ev.kind === 'petClaim') {
      combat.claimPet(ev.name)
    }
    combat.onEvent(ev, live)
    tracker.onEvent(ev, live)
  })

  mainWindow = new BrowserWindow({
    width: 850,
    height: 550,
    minWidth: 650,
    minHeight: 420,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))

  mainWindow.webContents.on('did-finish-load', async () => {
    const last = loadLastLogPath()
    if (last) {
      const res = await startParser(last)
      if (res && res.ok) {
        mainWindow.webContents.send('parser-auto-started')
      }
    }
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (tailInterval) clearInterval(tailInterval)
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

function tailFile(filePath) {
  if (tailInterval) clearInterval(tailInterval)
  logPath = filePath
  let lastSize = 0
  try { lastSize = fs.statSync(filePath).size } catch {}

  tailInterval = setInterval(() => {
    try {
      const stat = fs.statSync(filePath)
      if (stat.size < lastSize) lastSize = 0
      if (stat.size === lastSize) return
      const stream = fs.createReadStream(filePath, { start: lastSize, encoding: 'utf-8' })
      let buf = ''
      stream.on('data', chunk => {
        buf += chunk
        const lines = buf.split(/\r?\n/)
        buf = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          const ev = parseEvent(line, ++seq)
          if (ev) bus.emit(ev, true)
        }
      })
      stream.on('end', () => { lastSize = stat.size })
      lastSize = stat.size
    } catch (err) {
      console.error('tail error', err)
    }
  }, 250)
}

ipcMain.handle('open-log-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [
      { name: 'Log Files', extensions: ['txt', 'log'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('select-log-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('scan-log-files', async (_, folderPath) => {
  try {
    const files = fs.readdirSync(folderPath)
    return files
      .filter(f => /eqlog.*\.(txt|log)$/i.test(f))
      .map(f => path.join(folderPath, f))
      .sort()
  } catch {
    return []
  }
})

ipcMain.handle('scan-log-dates', async (_, folderPath) => {
  try {
    const files = fs.readdirSync(folderPath)
    const eqlogs = files
      .filter(f => /eqlog.*\.(txt|log)$/i.test(f))
      .map(f => ({
        file: path.join(folderPath, f),
        mtime: fs.statSync(path.join(folderPath, f)).mtimeMs,
      }))
    const byDate = new Map()
    for (const entry of eqlogs) {
      const d = new Date(entry.mtime)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const existing = byDate.get(key)
      if (!existing || entry.mtime > existing.mtime) {
        byDate.set(key, { date: key, filePath: entry.file, mtime: entry.mtime })
      }
    }
    return Array.from(byDate.values()).sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
})

ipcMain.handle('parse-log-for-date', async (_, filePath) => {
  const tempCombat = new CombatModule()
  const tempTracker = new TrackerModule()
  const tempBus = new LogBus()
  tempBus.subscribe((ev, live) => {
    tempCombat.onEvent(ev, live)
    tempTracker.onEvent(ev, live)
  })
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split(/\r?\n/)
    const nameMatch = path.basename(filePath).match(/^eqlog_([^_]+)_/i)
    if (nameMatch) {
      tempCombat.setPlayerName(nameMatch[1])
      tempTracker.player = nameMatch[1]
    }
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue
      const ev = parseEvent(lines[i], i + 1)
      if (ev) tempBus.emit(ev, true)
    }
    return { ...tempCombat.snapshot(), tracker: tempTracker.snapshot() }
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('read-log-file', async (_, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read file: ${err.message}`)
  }
})

ipcMain.handle('write-log-file', async (_, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  } catch (err) {
    throw new Error(`Failed to write file: ${err.message}`)
  }
})

ipcMain.handle('stat-log-file', async (_, filePath) => {
  try {
    const stat = fs.statSync(filePath)
    return { size: stat.size, mtime: stat.mtimeMs }
  } catch (err) {
    throw new Error(`Failed to stat file: ${err.message}`)
  }
})

ipcMain.handle('close-window', async () => {
  app.quit()
})

ipcMain.handle('minimize-window', async () => {
  if (mainWindow) mainWindow.minimize()
})

async function startParser(filePath) {
  if (tailInterval) clearInterval(tailInterval)
  combat.reset()
  tracker.reset()
  seq = 0
  parsing = true
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split(/\r?\n/)
    const nameMatch = path.basename(filePath).match(/^eqlog_([^_]+)_/i)
    if (nameMatch) {
      combat.setPlayerName(nameMatch[1])
      tracker.player = nameMatch[1]
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      const ev = parseEvent(line, ++seq)
      if (ev) bus.emit(ev, false)
      if (i % 5000 === 0) await new Promise(r => setImmediate(r))
    }
  } catch (err) {
    parsing = false
    return { ok: false, error: err.message }
  }
  tailFile(filePath)
  saveLastLogPath(filePath)
  parsing = false
  return { ok: true }
}

ipcMain.handle('parser-start', async (_, filePath) => {
  return startParser(filePath)
})

ipcMain.handle('parser-stop', async () => {
  if (tailInterval) clearInterval(tailInterval)
  tailInterval = null
  return { ok: true }
})

ipcMain.handle('parser-snapshot', async () => {
  return { ...combat.snapshot(), tracker: tracker.snapshot() }
})

ipcMain.handle('parser-loading', async () => {
  return { loading: parsing }
})

ipcMain.handle('set-meter-scope', async (_, scope) => {
  combat.setMeterScope(scope)
  return { ok: true }
})