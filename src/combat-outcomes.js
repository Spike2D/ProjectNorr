class CombatOutcomeModule {
  constructor() { this.reset() }

  reset() {
    this.outcomes = { miss: 0, parry: 0, dodge: 0, riposte: 0, block: 0, absorb: 0, resist: 0 }
    this.outgoing = { attempts: 0, hits: 0, misses: 0 }
    this.incoming = { attempts: 0, hits: 0, misses: 0 }
    this.mitigationAbsorbed = 0
    this.fullResists = 0
    this.partialResists = 0
    this.last = []
  }

  onEvent(ev) {
    if (!ev) return
    if (ev.kind === 'miss') {
      const type = String(ev.mtype || ev.outcome || 'miss').toLowerCase()
      if (this.outcomes[type] == null) this.outcomes[type] = 0
      this.outcomes[type]++
      const attacker = String(ev.attacker || '')
      const target = String(ev.target || '')
      const outgoing = /^you$/i.test(attacker) || /^you/i.test(attacker)
      const bucket = outgoing ? this.outgoing : this.incoming
      bucket.attempts++
      bucket.misses++
      this._remember(ev, type)
      return
    }

    if (ev.kind === 'damage') {
      const attacker = String(ev.attacker || '')
      const outgoing = /^you$/i.test(attacker) || /^you/i.test(attacker)
      const bucket = outgoing ? this.outgoing : this.incoming
      bucket.attempts++
      bucket.hits++
      return
    }

    if (ev.kind === 'resist') {
      if (ev.full) this.fullResists++
      else if (ev.partial) this.partialResists++
      this.outcomes.resist++
      this._remember(ev, ev.full ? 'full-resist' : 'partial-resist')
      return
    }

    if (ev.kind === 'mitigation' && ev.type === 'absorb') {
      const n = Number(ev.amount)
      if (Number.isFinite(n)) this.mitigationAbsorbed += n
      this.outcomes.absorb++
      this._remember(ev, 'absorb')
    }
  }

  _remember(ev, type) {
    this.last.unshift({ ts: ev.ts, type, attacker: ev.attacker, target: ev.target, amount: ev.amount, raw: ev.raw })
    if (this.last.length > 100) this.last.length = 100
  }

  snapshot() {
    return {
      outcomes: { ...this.outcomes },
      outgoing: { ...this.outgoing },
      incoming: { ...this.incoming },
      mitigationAbsorbed: this.mitigationAbsorbed,
      fullResists: this.fullResists,
      partialResists: this.partialResists,
      last: this.last.slice(),
    }
  }
}

module.exports = { CombatOutcomeModule }
