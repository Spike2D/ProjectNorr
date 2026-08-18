// Encounter lifecycle engine. Keeps fight boundaries separate from CombatModule so
// combat statistics can evolve without changing how a fight starts/ends.
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
    this.lastTarget = null
    this.lastZone = null
    this.seq = 0
  }

  _isPlayer(name) {
    return !name || /^(you|yourself)$/i.test(String(name).trim())
  }

  _combatTarget(ev) {
    if (!ev) return null
    if (ev.target && !this._isPlayer(ev.target)) return String(ev.target).trim()
    if (ev.attacker && !this._isPlayer(ev.attacker)) return String(ev.attacker).trim()
    return null
  }

  _isCombatEvent(ev) {
    if (!ev) return false
    return [
      'damage', 'miss', 'resist', 'mitigation', 'heal',
      'castBegin', 'castFizzle', 'castInterrupted'
    ].includes(ev.kind)
  }

  _new(ts, target) {
    const enc = {
      id: `${ts}-${this.seq}`,
      startTs: ts,
      endTs: null,
      durationMs: 0,
      zone: this.lastZone,
      target: target || null,
      status: 'active',
      damage: 0,
      hits: 0,
      misses: 0,
      resists: 0,
      healing: 0,
      deaths: 0,
      events: 0,
      attackers: new Map(),
      targets: new Map(),
    }
    this.current = enc
    this.encounters.unshift(enc)
    if (this.encounters.length > this.maxEncounters) this.encounters.length = this.maxEncounters
    return enc
  }

  _finish(ts, reason = 'timeout') {
    if (!this.current || this.current.status !== 'active') return
    const end = Math.max(Number(ts) || this.current.startTs, this.current.startTs)
    this.current.endTs = end
    this.current.durationMs = Math.max(0, end - this.current.startTs)
    this.current.durationSeconds = Math.max(0, this.current.durationMs / 1000)
    this.current.status = 'completed'
    this.current.endReason = reason
    this.current = null
    this.lastTarget = null
  }

  _shouldSplit(ts, target) {
    if (!this.current || this.current.status !== 'active') return false
    const now = Number(ts) || this.current.startTs
    if (this.lastCombatTs != null && now - this.lastCombatTs > this.timeoutMs) return true
    if (target && this.lastTarget && target !== this.lastTarget && this.lastCombatTs != null && now - this.lastCombatTs > this.targetSwitchMs) return true
    return false
  }

  _touchMap(map, key) {
    if (!key) return
    map.set(key, (map.get(key) || 0) + 1)
  }

  onEvent(ev, live) {
    if (!ev) return
    this.seq = Math.max(this.seq, Number(ev.seq) || 0)

    if (ev.kind === 'zone') {
      if (this.current) this._finish(ev.ts, 'zone-change')
      this.lastZone = ev.zone || this.lastZone
      this.lastCombatTs = null
      this.lastTarget = null
      return
    }

    if (ev.kind === 'death' || ev.kind === 'playerDeath') {
      if (this.current) {
        this.current.deaths += 1
        this.current.events += 1
        this._finish(ev.ts, ev.kind === 'playerDeath' ? 'player-death' : 'death')
      }
      return
    }

    if (!this._isCombatEvent(ev)) return

    const ts = Number(ev.ts) || Date.now()
    const target = this._combatTarget(ev)
    if (this._shouldSplit(ts, target)) this._finish(ts, 'target-switch')
    const enc = this.current || this._new(ts, target)

    if (target) {
      if (!enc.target) enc.target = target
      this._touchMap(enc.targets, target)
      this.lastTarget = target
    }
    if (ev.attacker && !this._isPlayer(ev.attacker)) this._touchMap(enc.attackers, String(ev.attacker).trim())

    enc.events += 1
    if (ev.kind === 'damage') {
      const amount = Math.max(0, Number(ev.amount) || 0)
      enc.damage += amount
      enc.hits += 1
    } else if (ev.kind === 'miss') {
      enc.misses += 1
    } else if (ev.kind === 'resist') {
      enc.resists += 1
    } else if (ev.kind === 'heal') {
      enc.healing += Math.max(0, Number(ev.amount) || 0)
    }

    this.lastCombatTs = ts
  }

  onTick(now = Date.now()) {
    if (this.current && this.lastCombatTs != null && now - this.lastCombatTs > this.timeoutMs) {
      this._finish(now, 'timeout')
    }
  }

  snapshot() {
    const now = Date.now()
    const result = this.encounters.map(enc => {
      const end = enc.endTs || now
      const durationMs = enc.status === 'active'
        ? Math.max(0, end - enc.startTs)
        : enc.durationMs
      const dps = durationMs > 0 ? enc.damage / (durationMs / 1000) : 0
      return {
        id: enc.id,
        startTs: enc.startTs,
        endTs: enc.endTs,
        durationMs,
        durationSeconds: Number((durationMs / 1000).toFixed(2)),
        zone: enc.zone,
        target: enc.target,
        status: enc.status,
        endReason: enc.endReason || null,
        damage: enc.damage,
        dps: Number(dps.toFixed(2)),
        hits: enc.hits,
        misses: enc.misses,
        resists: enc.resists,
        healing: enc.healing,
        deaths: enc.deaths,
        events: enc.events,
        attackers: Array.from(enc.attackers.entries()).map(([name, count]) => ({ name, count })),
        targets: Array.from(enc.targets.entries()).map(([name, count]) => ({ name, count })),
      }
    })

    return {
      active: result[0]?.status === 'active' ? result[0] : null,
      encounters: result,
      timeoutMs: this.timeoutMs,
      targetSwitchMs: this.targetSwitchMs,
    }
  }
}

module.exports = { EncounterEngine }
