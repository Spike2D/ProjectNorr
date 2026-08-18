const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const { parseEvent } = require('./src/parser')
const { enhanceEvent } = require('./src/parser-enhancements')
const { AttributionModule } = require('./src/attribution')
const { LogBus } = require('./src/bus')
const { CombatModule } = require('./src/combat')
const { TrackerModule } = require('./src/tracker')
const { EncounterEngine } = require('./src/encounters')
const { FarmingModule } = require('./src/farming')

let mainWindow
let bus
let combat
let tracker
let attribution
let encounters
let farming
let tailInterval
let logPath
let seq = 0
let parsing = false

function parseLineEvent(line, sequence) {
  const parsed = parseEvent(line, sequence)
  return parsed ? enhanceEvent(parsed.text || '', parsed, sequence, parsed.ts, line) : null
}

function parseRawLine(line, sequence) {
  const parsed = parseEvent(line, sequence)
  if (!parsed) return null
  const match = /^\[(.+?)\]\s?(.*)$/.exec(line)
  const event = enhanceEvent(match ? match[2] : '', parsed, sequence, parsed.ts, line)
  return attribution ? attribution.process(event) : event
}

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

function subscribeModules(targetBus, targetCombat, targetTracker, targetAttribution, targetEncounters, targetFarming) {
  targetBus.subscribe((rawEv, live) => {
    const ev = targetAttribution.process(rawEv)
    if (ev.kind === 'petClaim' || ev.kind === 'petSay') targetCombat.claimPet(ev.name)
    if (ev.entityType === 'charmed' && ev.name) targetCombat.claimPet(ev.name)
    targetCombat.onEvent(ev, live)
    targetTracker.onEvent(ev, live)
    targetEncounters.onEvent(ev, live)
    targetFarming.onEvent(ev, live)
  })
}

function createWindow() {
  bus = new LogBus()
  combat = new CombatModule()
  tracker = new TrackerModule()
  attribution = new AttributionModule()
  encounters = new EncounterEngine()
  farming = new FarmingModule()
  subscribeModules(bus, combat, tracker, attribution, encounters, farming)

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
      if (res && res.ok) mainWindow.webContents.send('parser-auto-started')
    }
  })

  if (process.env.NODE_ENV === 'development') mainWindow.webContents.openDevTools()
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
      encounters.onTick(Date.now())
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
          const ev = parseRawLine(line, ++seq)
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

ipcMain.handle('select-log-folder', async (_, folderPath) => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('scan-log-files', async (_, folderPath) => {
  try {
    return fs.readdirSync(folderPath)
      .filter(f => /eqlog.*\.(txt|log)$/i.test(f))
      .map(f => path.join(folderPath, f))
      .sort()
  } catch { return [] }
})

ipcMain.handle('scan-log-dates', async (_, folderPath) => {
  try {
    const files = fs.readdirSync(folderPath)
      .filter(f => /eqlog.*\.(txt|log)$/i.test(f))
      .map(f => ({ file: path.join(folderPath, f), mtime: fs.statSync(path.join(folderPath, f)).mtimeMs }))
    const byDate = new Map()
    for (const entry of files) {
      const key = new Date(entry.mtime).toISOString().slice(0, 10)
      if (!byDate.has(key)) byDate.set(key, entry.file)
    }
    return Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  } catch { return [] }
})

async function startParser(filePath) {
  if (parsing) return { ok: false, error: 'Parser already running' }
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'Log file not found' }
  parsing = true
  try {
    if (tailInterval) clearInterval(tailInterval)
    bus = new LogBus()
    combat = new CombatModule()
    tracker = new TrackerModule()
    attribution = new AttributionModule()
    encounters = new EncounterEngine()
    farming = new FarmingModule()
    subscribeModules(bus, combat, tracker, attribution, encounters, farming)
    seq = 0
    const content = fs.readFileSync(filePath, 'utf-8')
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue
      const ev = parseRawLine(line, ++seq)
      if (ev) bus.emit(ev, false)
    }
    tailFile(filePath)
    saveLastLogPath(filePath)
    return { ok: true, filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    parsing = false
  }
}

ipcMain.handle('start-parser', async (_, filePath) => startParser(filePath))
ipcMain.handle('stop-parser', async () => {
  if (tailInterval) clearInterval(tailInterval)
  tailInterval = null
  parsing = false
  return { ok: true }
})

ipcMain.handle('parser-snapshot', () => ({
  parser: { running: !!tailInterval, logPath, sequence: seq },
  combat: combat ? combat.snapshot() : null,
  tracker: tracker ? tracker.snapshot() : null,
  encounters: encounters ? encounters.snapshot() : null,
  farming: farming ? farming.snapshot() : null,
}))
