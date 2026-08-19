(function(){
  if (window.__norrDpsUi) return;
  window.__norrDpsUi = true;
  let mode = 'dealt';
  let root = null;
  const fmt = n => { n = Number(n) || 0; return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n).toLocaleString(); };
  const esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  const host = () => document.querySelector('#root .flex-1.overflow-y-auto.p-3');
  const active = () => [...document.querySelectorAll('#root button')].some(b => b.textContent.trim() === 'DPS Meter' && b.className.includes('subtab-active'));
  function ensure(){
    const h = host(); if (!h) return null;
    if (!root) { root = document.createElement('div'); root.id = 'norr-integrated-dps'; root.className = 'space-y-3'; h.appendChild(root); }
    return h;
  }
  function render(s){
    const h = ensure(); if (!h || !root) return;
    const current = s?.current || {};
    const outgoing = (s?.outgoing || []).filter(e => ['you','player','pet','charmed'].includes(e.kind));
    const incoming = (s?.incoming || []).filter(e => e.name);
    const list = mode === 'dealt' ? outgoing : incoming;
    const top = Math.max(1, ...list.map(e => Number(e.dps) || 0));
    const title = mode === 'dealt' ? 'DAMAGE DEALT' : 'DAMAGE TAKEN';
    const target = current.target || current.name || 'No active encounter';
    const duration = current.duration || '00:00';
    const rows = list.map((e, i) => {
      const dps = Number(e.dps) || 0;
      const pct = Math.max(2, dps / top * 100);
      const damage = Number(e.damage) || 0;
      const label = e.kind === 'you' ? 'You' : e.name;
      const owner = e.owner ? `<span style="opacity:.55;margin-left:4px">(${esc(e.owner)})</span>` : '';
      const hits = e.hits != null ? ` · ${fmt(e.hits)} hits` : '';
      const fill = mode === 'dealt' ? (e.kind === 'you' ? '#d9b25f' : '#6fb3d2') : '#cf6679';
      return `<div style="position:relative;height:42px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.045);margin-bottom:4px;border:1px solid rgba(255,255,255,.035)"><div style="position:absolute;inset:0;width:${pct}%;background:${fill};opacity:.28"></div><div style="position:absolute;inset:0;display:flex;align-items:center;padding:4px 8px;gap:8px"><span style="width:18px;color:#6b6560;font-size:10px;text-align:right">${i+1}</span><div style="flex:1;min-width:0"><div style="font-weight:600;color:${e.kind === 'you' ? '#d9b25f' : '#e8e6e3'};font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}${owner}</div><div style="color:#9a9590;font-size:9px;margin-top:2px">${fmt(damage)} damage${hits}</div></div><div style="text-align:right;white-space:nowrap"><div style="font-weight:700;color:#e8e6e3;font-size:12px;font-variant-numeric:tabular-nums">${fmt(dps)} DPS</div></div></div></div>`;
    }).join('');
    root.innerHTML = `<div class="panel p-3"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px"><div><div class="font-display" style="font-size:11px;font-weight:600;color:#d9b25f">${title}</div><div style="font-size:10px;color:#9a9590;margin-top:2px">${esc(target)} · ${esc(duration)}</div></div><div style="display:flex;gap:4px"><button id="norr-dps-dealt" class="subtab ${mode === 'dealt' ? 'subtab-active' : ''}">Damage Dealt</button><button id="norr-dps-taken" class="subtab ${mode === 'taken' ? 'subtab-active' : ''}">Damage Taken</button></div></div>${rows || '<div style="text-align:center;padding:18px 0;color:#6b6560;font-size:11px">No damage recorded yet</div>'}</div>`;
    root.querySelector('#norr-dps-dealt').onclick = () => { mode = 'dealt'; tick(); };
    root.querySelector('#norr-dps-taken').onclick = () => { mode = 'taken'; tick(); };
    const existing = h.children[1];
    if (existing && existing !== root) existing.style.display = 'none';
  }
  async function tick(){
    const h = host();
    if (!h) return;
    const on = active();
    if (!on) { if (root) root.style.display = 'none'; if (h.children[1]) h.children[1].style.display = ''; return; }
    ensure(); root.style.display = 'block';
    try { render(await window.electronAPI.parserSnapshot()); } catch (e) { console.error('[Norr DPS UI]', e); }
  }
  const obs = new MutationObserver(() => { if (active()) ensure(); });
  const rootEl = document.getElementById('root');
  if (rootEl) obs.observe(rootEl, { subtree:true, childList:true, attributes:true, attributeFilter:['class'] });
  setInterval(tick, 700);
  tick();
})();
