const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openLogFile: () => ipcRenderer.invoke('open-log-file'),
  selectLogFolder: () => ipcRenderer.invoke('select-log-folder'),
  scanLogFiles: (folderPath) => ipcRenderer.invoke('scan-log-files', folderPath),
  scanLogDates: (folderPath) => ipcRenderer.invoke('scan-log-dates', folderPath),
  parseLogForDate: (filePath) => ipcRenderer.invoke('parse-log-for-date', filePath),
  readLogFile: (filePath) => ipcRenderer.invoke('read-log-file', filePath),
  writeLogFile: (filePath, content) => ipcRenderer.invoke('write-log-file', filePath, content),
  statLogFile: (filePath) => ipcRenderer.invoke('stat-log-file', filePath),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  parserStart: (filePath) => ipcRenderer.invoke('parser-start', filePath),
  parserStop: () => ipcRenderer.invoke('parser-stop'),
  parserSnapshot: () => ipcRenderer.invoke('parser-snapshot'),
  parserLoading: () => ipcRenderer.invoke('parser-loading'),
  setMeterScope: (scope) => ipcRenderer.invoke('set-meter-scope', scope),
  onParserAutoStarted: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('parser-auto-started', listener)
    return () => ipcRenderer.removeListener('parser-auto-started', listener)
  }
})

// Lightweight live combat HUD. It deliberately lives outside the React tree so it
// cannot interfere with the existing Norr UI while we validate real Legends logs.
window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style')
  style.textContent = `
    #norr-live-hud { position:fixed; right:12px; top:42px; width:285px; z-index:9999; font-family:Inter,'Segoe UI',sans-serif; color:#e8e6e3; pointer-events:auto; }
    #norr-live-hud .norr-card { background:linear-gradient(180deg,#141210 0%,#110f0d 100%); border:1px solid #2a2622; border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.02); overflow:hidden; }
    #norr-live-hud .norr-head { display:flex; align-items:center; justify-content:space-between; padding:7px 9px; border-bottom:1px solid #2a2622; background:linear-gradient(180deg,#1a1714,#141210); }
    #norr-live-hud .norr-title { font-family:Cinzel,'Times New Roman',serif; font-size:11px; font-weight:600; color:#d9b25f; letter-spacing:.03em; }
    #norr-live-hud .norr-status { font-size:8px; color:#6b6560; }
    #norr-live-hud .norr-status.live { color:#5fbf72; }
    #norr-live-hud .norr-body { padding:8px 9px; }
    #norr-live-hud .norr-target { font-size:12px; font-weight:600; color:#e8e6e3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #norr-live-hud .norr-sub { margin-top:2px; font-size:9px; color:#9a9590; }
    #norr-live-hud .norr-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:8px; }
    #norr-live-hud .norr-stat { padding:5px 6px; background:#1a1714; border:1px solid #2a2622; border-radius:4px; }
    #norr-live-hud .norr-label { font-size:8px; color:#6b6560; }
    #norr-live-hud .norr-value { margin-top:1px; font-family:monospace; font-size:11px; color:#d9b25f; font-weight:600; }
    #norr-live-hud .norr-rows { margin-top:8px; }
    #norr-live-hud .norr-row { position:relative; display:flex; align-items:center; gap:6px; height:20px; margin-top:2px; padding:0 6px; border-radius:3px; overflow:hidden; background:rgba(255,255,255,.035); font-size:9px; }
    #norr-live-hud .norr-bar { position:absolute; left:0; top:0; bottom:0; opacity:.28; }
    #norr-live-hud .norr-name { position:relative; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #norr-live-hud .norr-dps { position:relative; font-family:monospace; color:#e8e6e3; }
    #norr-live-hud .norr-foot { margin-top:7px; display:flex; justify-content:space-between; font-size:8px; color:#6b6560; }
  `
  document.head.appendChild(style)

  const hud = document.createElement('div')
  hud.id = 'norr-live-hud'
  hud.innerHTML = `<div class="norr-card">
    <div class="norr-head"><span class="norr-title">LIVE COMBAT</span><span id="norr-hud-status" class="norr-status">WAITING</span></div>
    <div class="norr-body">
      <div id="norr-hud-target" class="norr-target">No active encounter</div>
      <div id="norr-hud-sub" class="norr-sub">Start a log to begin tracking</div>
      <div class="norr-stats">
        <div class="norr-stat"><div class="norr-label">DPS</div><div id="norr-hud-dps" class="norr-value">0</div></div>
        <div class="norr-stat"><div class="norr-label">DAMAGE</div><div id="norr-hud-dmg" class="norr-value">0</div></div>
        <div class="norr-stat"><div class="norr-label">TIME</div><div id="norr-hud-time" class="norr-value">0.0s</div></div>
      </div>
      <div id="norr-hud-rows" class="norr-rows"></div>
      <div class="norr-foot"><span id="norr-hud-out">0 hits · 0 misses</span><span id="norr-hud-resists">0 resists</span></div>
    </div>
  </div>`
  document.body.appendChild(hud)

  const fmt = n => {
    n = Number(n) || 0
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
    return Math.round(n).toLocaleString()
  }

  const update = async () => {
    try {
      const s = await ipcRenderer.invoke('parser-snapshot')
      const e = s && s.current
      const engine = s && s.encounters
      const active = engine && engine.active
      const target = active || e
      const status = document.getElementById('norr-hud-status')
      const targetEl = document.getElementById('norr-hud-target')
      const sub = document.getElementById('norr-hud-sub')
      const dps = document.getElementById('norr-hud-dps')
      const dmg = document.getElementById('norr-hud-dmg')
      const time = document.getElementById('norr-hud-time')
      const rows = document.getElementById('norr-hud-rows')
      const out = document.getElementById('norr-hud-out')
      const resists = document.getElementById('norr-hud-resists')
      if (!target) {
        status.textContent = 'WAITING'; status.className = 'norr-status'
        targetEl.textContent = 'No active encounter'
        sub.textContent = 'Start a log to begin tracking'
        dps.textContent = '0'; dmg.textContent = '0'; time.textContent = '0.0s'; rows.innerHTML = ''; out.textContent = '0 hits · 0 misses'; resists.textContent = '0 resists'
        return
      }
      const live = target.status === 'active'
      status.textContent = live ? 'LIVE' : 'DONE'; status.className = live ? 'norr-status live' : 'norr-status'
      targetEl.textContent = target.target || target.name || 'Unknown target'
      sub.textContent = [target.zone, target.endReason].filter(Boolean).join(' · ') || 'Current encounter'
      dps.textContent = fmt(target.dps || (target.durationSeconds ? target.damage / target.durationSeconds : 0))
      dmg.textContent = fmt(target.damage)
      time.textContent = ((target.durationSeconds != null ? target.durationSeconds : (target.durationMs || 0) / 1000) || 0).toFixed(1) + 's'
      out.textContent = `${Number(target.hits || 0).toLocaleString()} hits · ${Number(target.misses || 0).toLocaleString()} misses`
      resists.textContent = `${Number(target.resists || 0).toLocaleString()} resists`

      const list = (s.owners || s.outgoing || []).slice(0, 5)
      const max = Math.max(1, ...list.map(x => Number(x.dps) || 0))
      rows.innerHTML = list.length ? list.map(x => {
        const width = Math.max(2, ((Number(x.dps) || 0) / max) * 100)
        const owner = x.kind === 'owner' || x.kind === 'you'
        return `<div class="norr-row"><div class="norr-bar" style="width:${width}%;background:${owner ? '#d9b25f' : '#6fb3d2'}"></div><span class="norr-name">${owner ? 'You' : (x.name || 'Unknown')}</span><span class="norr-dps">${fmt(x.dps)} DPS</span></div>`
      }).join('') : '<div class="norr-sub">No attributed damage yet</div>'
    } catch (_) {}
  }

  update()
  setInterval(update, 500)
})
