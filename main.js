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

function parseRawLine(line, sequence) {
  const parsed = parseEvent(line, sequence)
  if (!parsed) return null
  const match = /^\[(.+?)\]\s?(.*)$/.exec(line)
  return enhanceEvent(match ? match[2] : '', parsed, sequence, parsed.ts, line)
}

function getLastLogPath() { return path.join(app.getPath('userData'), 'last-log.json') }
function loadLastLogPath() { try { const p=getLastLogPath();if(fs.existsSync(p)){const d=JSON.parse(fs.readFileSync(p,'utf-8'));if(d.path&&fs.existsSync(d.path))return d.path}}catch{} return null }
function saveLastLogPath(p) { try { const lp=getLastLogPath();fs.mkdirSync(path.dirname(lp),{recursive:true});fs.writeFileSync(lp,JSON.stringify({path:p}),'utf-8') } catch{} }

function subscribeModules(targetBus, targetCombat, targetTracker, targetAttribution, targetEncounters, targetFarming) {
  targetBus.subscribe((rawEv, live) => {
    const ev = targetAttribution.process(rawEv)
    if (ev.kind === 'petClaim' || ev.kind === 'petSay') targetCombat.claimPet(ev.name)
    if (ev.entityType === 'charmed' && ev.name) targetCombat.claimPet(ev.name)
    targetEncounters.onEvent(ev, live)
    targetCombat.setEncounterContext(targetEncounters.current)
    targetCombat.onEvent(ev, live)
    targetTracker.onEvent(ev, live)
    targetFarming.onEvent(ev, live)
  })
}

function buildSnapshot() {
  encounters.onTick(Date.now())
  combat.setEncounterContext(encounters.current)
  const encounterSnapshot = encounters.snapshot()
  return {
    ...combat.snapshot(),
    tracker: tracker.snapshot(),
    encounters: encounterSnapshot.encounters || [],
    encounterActive: encounterSnapshot.active || null,
    farming: farming.snapshot()
  }
}

function createWindow() {
  bus=new LogBus(); combat=new CombatModule(); tracker=new TrackerModule(); attribution=new AttributionModule(); encounters=new EncounterEngine(); farming=new FarmingModule()
  subscribeModules(bus,combat,tracker,attribution,encounters,farming)
  mainWindow=new BrowserWindow({width:850,height:550,minWidth:650,minHeight:420,frame:false,titleBarStyle:'hidden',backgroundColor:'#0a0c10',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}})
  mainWindow.loadFile(path.join(__dirname,'src','index.html'))
  mainWindow.webContents.on('did-finish-load',async()=>{const last=loadLastLogPath();if(last){const res=await startParser(last);if(res&&res.ok)mainWindow.webContents.send('parser-auto-started')}})
  if(process.env.NODE_ENV==='development')mainWindow.webContents.openDevTools()
}
app.whenReady().then(createWindow)
app.on('window-all-closed',()=>{if(tailInterval)clearInterval(tailInterval);if(process.platform!=='darwin')app.quit()})
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})

function tailFile(filePath) {
  if(tailInterval)clearInterval(tailInterval);logPath=filePath;let lastSize=0;try{lastSize=fs.statSync(filePath).size}catch{}
  tailInterval=setInterval(()=>{try{encounters.onTick(Date.now());const stat=fs.statSync(filePath);if(stat.size<lastSize)lastSize=0;if(stat.size===lastSize)return;const stream=fs.createReadStream(filePath,{start:lastSize,encoding:'utf-8'});let buf='';stream.on('data',chunk=>{buf+=chunk;const lines=buf.split(/\r?\n/);buf=lines.pop();for(const line of lines){if(!line.trim())continue;const ev=parseRawLine(line,++seq);if(ev)bus.emit(ev,true)}});stream.on('end',()=>{lastSize=stat.size});lastSize=stat.size}catch(err){console.error('tail error',err)}},250)
}

ipcMain.handle('open-log-file',async()=>{const r=await dialog.showOpenDialog(mainWindow,{filters:[{name:'Log Files',extensions:['txt','log']},{name:'All Files',extensions:['*']}],properties:['openFile']});return r.canceled?null:r.filePaths[0]})
ipcMain.handle('select-log-folder',async()=>{const r=await dialog.showOpenDialog(mainWindow,{properties:['openDirectory']});return r.canceled?null:r.filePaths[0]})
ipcMain.handle('scan-log-files',async(_,folderPath)=>{try{return fs.readdirSync(folderPath).filter(f=>/eqlog.*\.(txt|log)$/i.test(f)).map(f=>path.join(folderPath,f)).sort()}catch{return[]}})
ipcMain.handle('scan-log-dates',async(_,folderPath)=>{try{const files=fs.readdirSync(folderPath).filter(f=>/eqlog.*\.(txt|log)$/i.test(f)).map(f=>({file:path.join(folderPath,f),mtime:fs.statSync(path.join(folderPath,f)).mtimeMs}));const byDate=new Map();for(const e of files){const d=new Date(e.mtime),key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,x=byDate.get(key);if(!x||e.mtime>x.mtime)byDate.set(key,{date:key,filePath:e.file,mtime:e.mtime})}return Array.from(byDate.values()).sort((a,b)=>b.mtime-a.mtime)}catch{return[]}})

ipcMain.handle('parse-log-for-date',async(_,filePath)=>{
  const tempCombat=new CombatModule(),tempTracker=new TrackerModule(),tempAttribution=new AttributionModule(),tempEncounters=new EncounterEngine(),tempFarming=new FarmingModule(),tempBus=new LogBus();subscribeModules(tempBus,tempCombat,tempTracker,tempAttribution,tempEncounters,tempFarming)
  try{const content=fs.readFileSync(filePath,'utf-8'),lines=content.split(/\r?\n/),nameMatch=path.basename(filePath).match(/^eqlog_([^_]+)_/i);if(nameMatch){tempCombat.setPlayerName(nameMatch[1]);tempTracker.player=nameMatch[1]}for(let i=0;i<lines.length;i++){if(!lines[i].trim())continue;const ev=parseRawLine(lines[i],i+1);if(ev)tempBus.emit(ev,true)}tempEncounters.onTick(Date.now());tempCombat.setEncounterContext(tempEncounters.current);const encounterSnapshot=tempEncounters.snapshot();return{...tempCombat.snapshot(),tracker:tempTracker.snapshot(),encounters:encounterSnapshot.encounters||[],encounterActive:encounterSnapshot.active||null,farming:tempFarming.snapshot()}}catch(err){return{error:err.message}}
})
ipcMain.handle('read-log-file',async(_,filePath)=>{try{return fs.readFileSync(filePath,'utf-8')}catch(err){throw new Error(`Failed to read file: ${err.message}`)}})
ipcMain.handle('write-log-file',async(_,filePath,content)=>{try{fs.writeFileSync(filePath,content,'utf-8');return true}catch(err){throw new Error(`Failed to write file: ${err.message}`)}})
ipcMain.handle('stat-log-file',async(_,filePath)=>{try{const s=fs.statSync(filePath);return{size:s.size,mtime:s.mtimeMs}}catch(err){throw new Error(`Failed to stat file: ${err.message}`)}})
ipcMain.handle('close-window',async()=>app.quit())
ipcMain.handle('minimize-window',async()=>{if(mainWindow)mainWindow.minimize()})

async function startParser(filePath) {
  if(tailInterval)clearInterval(tailInterval);combat.reset();tracker.reset();attribution.reset();encounters.reset();farming.reset();seq=0;parsing=true
  try{const content=fs.readFileSync(filePath,'utf-8'),lines=content.split(/\r?\n/),nameMatch=path.basename(filePath).match(/^eqlog_([^_]+)_/i);if(nameMatch){combat.setPlayerName(nameMatch[1]);tracker.player=nameMatch[1]}for(const line of lines){if(!line.trim())continue;const ev=parseRawLine(line,++seq);if(ev)bus.emit(ev,true)}tailFile(filePath);saveLastLogPath(filePath);return{ok:true,path:filePath,lines:lines.length}}catch(err){console.error(err);return{ok:false,error:err.message}}finally{parsing=false}
}
ipcMain.handle('start-parser',async(_,filePath)=>startParser(filePath))
ipcMain.handle('stop-parser',async()=>{if(tailInterval){clearInterval(tailInterval);tailInterval=null}parsing=false;return true})
ipcMain.handle('parser-status',async()=>({running:parsing,path:logPath}))
ipcMain.handle('parser-snapshot',async()=>buildSnapshot())
ipcMain.handle('set-meter-scope',async(_,scope)=>{combat.setMeterScope(scope);return true})
ipcMain.handle('set-player-name',async(_,name)=>{combat.setPlayerName(name);tracker.player=name;return true})
