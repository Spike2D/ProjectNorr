// Encounter lifecycle engine. Boundaries are intentionally independent from CombatModule.
// A target switch does not automatically mean a new fight: active DoTs/adds can keep
// the same encounter alive. We only split when the previous target has been quiet
// for targetSwitchMs, or the whole combat context has timed out.
class EncounterEngine {
  constructor(options = {}) {
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 12000
    this.targetSwitchMs = Number(options.targetSwitchMs) > 0 ? Number(options.targetSwitchMs) : 3500
    this.maxEncounters = Number(options.maxEncounters) > 0 ? Number(options.maxEncounters) : 200
    this.reset()
  }

  reset() {
    this.encounters = []
    this.current = null
    this.lastCombatTs = null
    this.lastZone = null
    this.seq = 0
    this.targetLastTs = new Map()
    this.deadTargets = new Map()
  }

  _isPlayer(name) { return !name || /^(you|yourself)$/i.test(String(name).trim()) }
  _clean(name) { return name == null ? null : String(name).trim() }

  _combatTarget(ev) {
    if (!ev) return null
    const attacker = this._clean(ev.attacker)
    const target = this._clean(ev.target)
    const owner = this._clean(ev.owner)
    const attackerIsPlayer = this._isPlayer(attacker) || !!owner
    if (target && !this._isPlayer(target) && attackerIsPlayer) return target
    if (attacker && !this._isPlayer(attacker) && target && this._isPlayer(target)) return attacker
    if (target && !this._isPlayer(target)) return target
    if (attacker && !this._isPlayer(attacker)) return attacker
    return null
  }

  _isCombatEvent(ev) {
    return !!ev && ['damage','miss','resist','mitigation','proc','castBegin','castFizzle','castInterrupted'].includes(ev.kind)
  }

  _new(ts, target) {
    const enc = { id: `${ts}-${this.seq}`, startTs: ts, endTs: null, durationMs: 0,
      durationSeconds: 0, zone: this.lastZone, target: target || null, status: 'active',
      damage: 0, hits: 0, misses: 0, resists: 0, healing: 0, deaths: 0, events: 0,
      attackers: new Map(), targets: new Map(), targetLastTs: new Map(), endReason: null }
    this.current = enc
    this.encounters.unshift(enc)
    if (this.encounters.length > this.maxEncounters) this.encounters.length = this.maxEncounters
    return enc
  }

  _finish(ts, reason = 'timeout') {
    if (!this.current || this.current.status !== 'active') return
    const value = Number(ts)
    const end = Number.isFinite(value) ? Math.max(value, this.current.startTs) : this.current.startTs
    this.current.endTs = end
    this.current.durationMs = Math.max(0, end - this.current.startTs)
    this.current.durationSeconds = Number((this.current.durationMs / 1000).toFixed(2))
    this.current.status = 'completed'
    this.current.endReason = reason
    this.current.targetLastTs = new Map()
    this.current = null
    this.lastCombatTs = null
    this.targetLastTs.clear()
  }

  _touchMap(map, key) { if (key) map.set(key, (map.get(key) || 0) + 1) }

  _isRecentlyDead(target, ts) {
    if (!target) return false
    const deadAt = this.deadTargets.get(target)
    if (deadAt == null) return false
    if (ts - deadAt <= this.timeoutMs) return true
    this.deadTargets.delete(target)
    return false
  }

  _shouldSplit(ts, target) {
    if (!this.current || this.current.status !== 'active') return false
    if (this.lastCombatTs != null && ts - this.lastCombatTs > this.timeoutMs) return true
    if (!target || !this.lastCombatTs || ts - this.lastCombatTs <= this.targetSwitchMs) return false
    if (this.current.targets.has(target) || this.current.target === target) return false
    for (const last of this.targetLastTs.values()) {
      if (ts - last <= this.targetSwitchMs) return false
    }
    return true
  }

  _record(enc, ev, target, ts) {
    enc.events += 1
    if (target) {
      this._touchMap(enc.targets, target)
      enc.targetLastTs.set(target, ts)
      this.targetLastTs.set(target, ts)
    }
    if (ev.attacker && !this._isPlayer(ev.attacker)) this._touchMap(enc.attackers, this._clean(ev.attacker))
    if (!enc.target && target) enc.target = target
  }

  onEvent(ev, live) {
    if (!ev) return
    this.seq = Math.max(this.seq, Number(ev.seq) || 0)

    if (ev.kind === 'zone') {
      if (this.current) this._finish(ev.ts, 'zone-change')
      this.lastZone = ev.zone || this.lastZone
      this.targetLastTs.clear()
      this.deadTargets.clear()
      return
    }

    if (ev.kind === 'playerDeath') {
      if (this.current) {
        this.current.deaths += 1
        this._record(this.current, ev, this._combatTarget(ev), Number(ev.ts) || Date.now())
        this._finish(ev.ts, 'player-death')
      }
      return
    }

    if (ev.kind === 'death') {
      const dead = this._clean(ev.target || ev.name || ev.mob)
      const ts = Number(ev.ts) || Date.now()
      if (this.current && (!dead || this.current.targets.has(dead) || dead === this.current.target)) {
        this.current.deaths += 1
        this._record(this.current, ev, dead, ts)
        this._finish(ts, 'target-death')
      }
      if (dead) this.deadTargets.set(dead, ts)
      return
    }

    if (!this._isCombatEvent(ev)) return
    const value = Number(ev.ts)
    const ts = Number.isFinite(value) ? value : Date.now()
    const target = this._combatTarget(ev)

    // A late DoT tick after a confirmed death belongs to the completed fight and
    // must never resurrect the dead target as a new encounter.
    if (target && this._isRecentlyDead(target, ts)) return

    if (this._shouldSplit(ts, target)) this._finish(ts, 'target-switch')
    const enc = this.current || this._new(ts, target)
    this._record(enc, ev, target, ts)

    if (ev.kind === 'damage') {
      const amount = Number(ev.amount)
      if (Number.isFinite(amount) && amount >= 0) { enc.damage += amount; enc.hits += 1 }
    } else if (ev.kind === 'miss') enc.misses += 1
    else if (ev.kind === 'resist') enc.resists += 1
    this.lastCombatTs = ts
  }

  onTick(now = Date.now()) {
    if (this.current && this.lastCombatTs != null && now - this.lastCombatTs > this.timeoutMs) this._finish(now, 'timeout')
    for (const [target, ts] of this.deadTargets) if (now - ts > this.timeoutMs) this.deadTargets.delete(target)
  }

  snapshot() {
    const now = Date.now()
    const result = this.encounters.map(enc => {
      const end = enc.endTs || now
      const durationMs = enc.status === 'active' ? Math.max(0, end - enc.startTs) : enc.durationMs
      const seconds = durationMs / 1000
      return { id: enc.id, startTs: enc.startTs, endTs: enc.endTs, durationMs,
        durationSeconds: Number(seconds.toFixed(2)), zone: enc.zone, target: enc.target,
        status: enc.status, endReason: enc.endReason || null, damage: enc.damage,
        dps: Number((seconds > 0 ? enc.damage / seconds : 0).toFixed(2)), hits: enc.hits,
        misses: enc.misses, resists: enc.resists, healing: enc.healing, deaths: enc.deaths,
        events: enc.events, attackers: Array.from(enc.attackers.entries()).map(([name,count])=>({name,count})),
        targets: Array.from(enc.targets.entries()).map(([name,count])=>({name,count})) }
    })
    return { active: result.find(e => e.status === 'active') || null, encounters: result,
      timeoutMs: this.timeoutMs, targetSwitchMs: this.targetSwitchMs }
  }
}

module.exports = { EncounterEngine }
