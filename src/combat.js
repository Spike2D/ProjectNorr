class CombatModule {
  constructor() {
    this.reset()
  }

  reset() {
    this.encounters = []
    this.current = null
    this.lastZone = null
    this.seq = 0
    this.entities = new Map()
    this.incoming = new Map()
    this.maxEntityDamage = 0
    this.maxIncomingDamage = 0
    this.secondBuckets = new Map()
    this.maxSecondDamage = 0
    this.playerName = null
    this.petNames = new Set()
    this.meterScope = 'everyone'
    this.procs = []
  }

  setPlayerName(name) {
    this.playerName = name ? name.trim() : null
  }

  claimPet(name) {
    if (!name) return
    const n = name.trim()
    if (n && !this.petNames.has(n)) {
      this.petNames.add(n)
    }
  }

  _classifyKind(name) {
    if (!name) return 'enemy'
    const n = name.toLowerCase()
    if (this.playerName && n === this.playerName.toLowerCase()) return 'you'
    if (this.petNames.has(name)) return 'pet'
    if (n === 'you' || n === 'yourself') return 'you'
    return 'enemy'
  }

  setMeterScope(scope) {
    if (scope === 'you' || scope === 'everyone') {
      this.meterScope = scope
    }
  }

  _scopeAllows(ent) {
    if (this.meterScope === 'everyone') return true
    if (ent.kind === 'you') return true
    return false
  }

  _recordProc(ev, label, detail) {
    this.procs.push({
      ts: ev.ts,
      seq: ev.seq,
      kind: ev.kind,
      label: label || ev.kind,
      detail: detail || '',
    })
    if (this.procs.length > 200) this.procs.length = 200
  }

  _recordEvent(ev) {
    if (!this.current || this.current.status !== 'active') return
    const enc = this.current
    enc.events = enc.events || []
    enc.events.push({
      ts: ev.ts,
      seq: ev.seq,
      kind: ev.kind,
      attacker: ev.attacker || null,
      target: ev.target || null,
      amount: ev.amount || null,
      dtype: ev.dtype || null,
      skill: ev.skill || ev.dclass || null,
      crit: !!ev.modifiers && ev.modifiers.some(m => /critical/i.test(m)),
      modifiers: ev.modifiers || [],
      mtype: ev.mtype || null,
      spell: ev.spell || null,
      verb: ev.verb || null,
      item: ev.item || null,
      source: ev.source || null,
      reason: ev.reason || null,
      stance: ev.stance || null,
      invocation: ev.invocation || null,
      label: ev.kind,
      detail: '',
    })
    if (enc.events.length > 500) enc.events.length = 500
  }

  _ensureCurrent(ts, name) {
    if (!this.current || this.current.status !== 'active') {
      this.current = this.startEncounter(ts, name)
    }
    return this.current
  }

  _nameEncounter(enc, ev) {
    const target = ev.target
    const attacker = ev.attacker
    const subject = target && target !== 'You' && target !== 'you' ? target :
                    attacker && attacker !== 'You' && attacker !== 'you' ? attacker : null
    if (!subject) return
    if (enc.name !== 'Unknown') {
      if (enc.zone && !enc.target) {
        enc.target = subject
        enc.name = `${enc.zone} — ${subject}`
      }
      return
    }
    enc.name = subject
    enc.target = subject
  }

  _touchEntity(name, kind) {
    const key = name || 'Unknown'
    let ent = this.entities.get(key)
    if (!ent) {
      ent = {
        name: key,
        kind: kind || this._classifyKind(name),
        damage: 0,
        hits: 0,
        maxHit: 0,
        deaths: 0,
        crits: 0,
        critDamage: 0,
        categories: { melee: 0, spell: 0, dot: 0, ds: 0 },
        skills: new Map(),
      }
      this.entities.set(key, ent)
    }
    return ent
  }

  _touchIncoming(name) {
    const key = name || 'Unknown'
    let ent = this.incoming.get(key)
    if (!ent) {
      ent = {
        name: key,
        kind: 'enemy',
        damage: 0,
        hits: 0,
        maxHit: 0,
        crits: 0,
        critDamage: 0,
        categories: { melee: 0, spell: 0, dot: 0, ds: 0 },
        skills: new Map(),
      }
      this.incoming.set(key, ent)
    }
    return ent
  }

  _addSkill(ent, skill, amount) {
    if (!skill) return
    if (!ent.skills) ent.skills = new Map()
    const s = ent.skills.get(skill) || { name: skill, damage: 0, hits: 0, maxHit: 0, category: 'melee' }
    s.damage += amount
    s.hits += 1
    if (amount > s.maxHit) s.maxHit = amount
    ent.skills.set(skill, s)
  }

  _addSecondBucket(ts, amount) {
    const sec = Math.floor(ts / 1000)
    const prev = this.secondBuckets.get(sec) || 0
    this.secondBuckets.set(sec, prev + amount)
    if (prev + amount > this.maxSecondDamage) {
      this.maxSecondDamage = prev + amount
    }
  }

  _updateMaxEntityDamage() {
    this.maxEntityDamage = 0
    for (const ent of this.entities.values()) {
      if (ent.damage > this.maxEntityDamage) this.maxEntityDamage = ent.damage
    }
  }

  _updateMaxIncomingDamage() {
    this.maxIncomingDamage = 0
    for (const ent of this.incoming.values()) {
      if (ent.damage > this.maxIncomingDamage) this.maxIncomingDamage = ent.damage
    }
  }

  _recordDamage(ent, amount, dtype, skill, dclass, crit) {
    ent.damage += amount
    ent.hits += 1
    if (amount > ent.maxHit) ent.maxHit = amount
    const cat = (dtype || 'melee').toLowerCase()
    if (ent.categories[cat] !== undefined) ent.categories[cat] += amount
    else ent.categories.melee += amount
    if (crit) {
      ent.crits += 1
      ent.critDamage += amount
    }
    this._addSkill(ent, skill || dclass || null, amount)
  }

  onEvent(ev, live) {
    if (!live) return
    this.seq = Math.max(this.seq, ev.seq || 0)

    switch (ev.kind) {
      case 'zone':
        this.lastZone = ev.zone
        if (this.current && this.current.status === 'active') {
          this.current.status = 'completed'
          this.current.endTs = ev.ts
          this.current.duration = ((ev.ts - this.current.startTs) / 1000).toFixed(0) + 's'
          this.current.zone = ev.zone
          if (this.current.name === 'Unknown') {
            this.current.name = ev.zone
          }
        }
        this.current = {
          id: Date.now(),
          name: ev.zone,
          target: null,
          zone: ev.zone,
          startTs: ev.ts,
          status: 'active',
          damage: 0,
          hits: 0,
          maxHit: 0,
          duration: '0s',
        }
        this.encounters.unshift(this.current)
        if (this.encounters.length > 50) this.encounters.length = 50
        this.entities = new Map()
        this.incoming = new Map()
        this.maxEntityDamage = 0
        this.maxIncomingDamage = 0
        this.secondBuckets = new Map()
        this.maxSecondDamage = 0
        this.procs = []
        break

      case 'damage':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          const crit = !!(ev.modifiers && ev.modifiers.some(m => /critical/i.test(m)))
          if (ev.attacker === 'You' || ev.attacker === 'you') {
            enc.damage += ev.amount
            enc.hits += 1
            if (ev.amount > enc.maxHit) enc.maxHit = ev.amount
            if (crit) enc.crits = (enc.crits || 0) + 1
          }
          const kind = this._classifyKind(ev.attacker)
          const ent = this._touchEntity(ev.attacker, kind)
          this._recordDamage(ent, ev.amount, ev.dtype, ev.skill, ev.dclass, crit)
          this._updateMaxEntityDamage()
          this._addSecondBucket(ev.ts, ev.amount)
          if (ev.target && ev.target !== 'You' && ev.target !== 'you' && this._classifyKind(ev.target) === 'enemy') {
            const inc = this._touchIncoming(ev.target)
            this._recordDamage(inc, ev.amount, ev.dtype, ev.skill, ev.dclass, crit)
            this._updateMaxIncomingDamage()
          }
          this._recordEvent(ev)
        }
        break

      case 'death':
        {
          const ent = this._touchEntity(ev.target)
          ent.deaths += 1
        }
        if (this.current && this.current.status === 'active') {
          this.current.status = 'completed'
          this.current.endTs = ev.ts
          this.current.duration = ((ev.ts - this.current.startTs) / 1000).toFixed(0) + 's'
          this._nameEncounter(this.current, ev)
        }
        this._recordEvent(ev)
        break

      case 'playerDeath':
        {
          const ent = this._touchEntity('You')
          ent.deaths += 1
        }
        if (this.current && this.current.status === 'active') {
          this.current.status = 'completed'
          this.current.endTs = ev.ts
          this.current.duration = ((ev.ts - this.current.startTs) / 1000).toFixed(0) + 's'
          this._nameEncounter(this.current, ev)
        }
        this._recordEvent(ev)
        break

      case 'miss':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          if (ev.attacker === 'You' || ev.attacker === 'you') {
            enc.misses = (enc.misses || 0) + 1
          }
          if (ev.mtype && ev.mtype !== 'miss') {
            this._recordProc(ev, ev.mtype, ev.verb ? `(${ev.verb})` : '')
          }
          this._recordEvent(ev)
        }
        break

      case 'resist':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          if (ev.caster === 'you' || ev.caster === 'You') {
            enc.resists = (enc.resists || 0) + 1
          }
          this._recordProc(ev, 'resist', ev.spell ? `vs ${ev.spell}` : '')
          this._recordEvent(ev)
        }
        break

      case 'heal':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          if (ev.healer === 'You' || ev.healer === 'you') {
            enc.healing = (enc.healing || 0) + ev.amount
          }
          this._recordEvent(ev)
        }
        break

      case 'mitigation':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          if (ev.mtype === 'rune') {
            enc.runes = (enc.runes || 0) + (ev.amount || 0)
            this._recordProc(ev, 'rune', `absorbed ${ev.amount}`)
          } else if (ev.mtype === 'absorbSwing' || ev.mtype === 'absorbDamageShield') {
            enc.absorbs = (enc.absorbs || 0) + 1
            this._recordProc(ev, ev.mtype, '')
          }
          this._recordEvent(ev)
        }
        break

      case 'castBegin':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.casts = (enc.casts || 0) + 1
          this._recordEvent(ev)
        }
        break

      case 'castFizzle':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.fizzles = (enc.fizzles || 0) + 1
          this._recordProc(ev, 'fizzle', '')
          this._recordEvent(ev)
        }
        break

      case 'castInterrupted':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.interrupts = (enc.interrupts || 0) + 1
          this._recordProc(ev, 'interrupt', '')
          this._recordEvent(ev)
        }
        break

      case 'itemMerge':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.merges = (enc.merges || 0) + 1
          this._recordProc(ev, 'merge', '')
          this._recordEvent(ev)
        }
        break

      case 'itemMergeFailed':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.mergeFails = (enc.mergeFails || 0) + 1
          this._recordProc(ev, 'mergeFail', '')
          this._recordEvent(ev)
        }
        break

      case 'poisonCoat':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.poisonCoats = (enc.poisonCoats || 0) + 1
          this._recordProc(ev, 'poisonCoat', '')
          this._recordEvent(ev)
        }
        break

      case 'poisonDry':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.poisonDrys = (enc.poisonDrys || 0) + 1
          this._recordProc(ev, 'poisonDry', '')
          this._recordEvent(ev)
        }
        break

      case 'aaPotion':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.aaPotions = (enc.aaPotions || 0) + 1
          this._recordProc(ev, 'aaPotion', '')
          this._recordEvent(ev)
        }
        break

      case 'aaActivate':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.aaActivations = (enc.aaActivations || 0) + 1
          this._recordProc(ev, 'aaActivate', '')
          this._recordEvent(ev)
        }
        break

      case 'level':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.levels = (enc.levels || 0) + 1
          this._recordEvent(ev)
        }
        break

      case 'expGain':
        {
          const enc = this._ensureCurrent(ev.ts, 'Unknown')
          this._nameEncounter(enc, ev)
          enc.expGains = (enc.expGains || 0) + 1
          this._recordEvent(ev)
        }
        break

      case 'petClaim':
        this.claimPet(ev.name)
        break
    }
  }

  startEncounter(ts, name) {
    const enc = {
      id: Date.now(),
      name: name || this.lastZone || 'Unknown',
      target: null,
      zone: this.lastZone,
      startTs: ts,
      status: 'active',
      damage: 0,
      hits: 0,
      maxHit: 0,
      duration: '0s',
      crits: 0,
      critDamage: 0,
      misses: 0,
      resists: 0,
      healing: 0,
      runes: 0,
      absorbs: 0,
      casts: 0,
      fizzles: 0,
      interrupts: 0,
      merges: 0,
      mergeFails: 0,
      poisonCoats: 0,
      poisonDrys: 0,
      aaPotions: 0,
      aaActivations: 0,
      levels: 0,
      expGains: 0,
      events: [],
    }
    this.current = enc
    this.encounters.unshift(enc)
    if (this.encounters.length > 50) this.encounters.length = 50
    this.entities = new Map()
    this.incoming = new Map()
    this.maxEntityDamage = 0
    this.maxIncomingDamage = 0
    this.secondBuckets = new Map()
    this.maxSecondDamage = 0
    this.procs = []
    return enc
  }

  snapshot() {
    const now = Date.now()
    const active = this.current && this.current.status === 'active'
    const secs = active ? Math.max(1, (now - this.current.startTs) / 1000) : 1
    const totalSecs = active ? secs : (this.current ? (parseFloat(this.current.duration) || 1) : 1)
    const bestSec = this.secondBuckets.size > 0 ? Math.max(...this.secondBuckets.values()) : 0
    const outgoing = Array.from(this.entities.values())
      .filter(ent => this._scopeAllows(ent))
      .sort((a, b) => b.damage - a.damage)
      .slice(0, 20)
      .map(ent => {
        const avgHit = ent.hits > 0 ? Math.round(ent.damage / ent.hits) : 0
        const avgCrit = ent.crits > 0 ? Math.round(ent.critDamage / ent.crits) : 0
        const dps = Math.floor(ent.damage / secs)
        const sdps = Math.floor(ent.damage / totalSecs)
        return {
          name: ent.name,
          kind: ent.kind,
          damage: ent.damage,
          hits: ent.hits,
          maxHit: ent.maxHit,
          deaths: ent.deaths,
          crits: ent.crits,
          critDamage: ent.critDamage,
          avgHit,
          avgCrit,
          dps,
          sdps,
          pct: this.maxEntityDamage > 0 ? (ent.damage / this.maxEntityDamage) * 100 : 0,
          categories: { ...ent.categories },
          skills: Array.from(ent.skills.values())
            .sort((a, b) => b.damage - a.damage)
            .slice(0, 10)
            .map(s => ({
              name: s.name,
              damage: s.damage,
              hits: s.hits,
              maxHit: s.maxHit,
              category: s.category,
              pct: ent.damage > 0 ? (s.damage / ent.damage) * 100 : 0,
            })),
        }
      })

    const incoming = Array.from(this.incoming.values())
      .sort((a, b) => b.damage - a.damage)
      .slice(0, 20)
      .map(ent => {
        const avgHit = ent.hits > 0 ? Math.round(ent.damage / ent.hits) : 0
        const avgCrit = ent.crits > 0 ? Math.round(ent.critDamage / ent.crits) : 0
        const dps = Math.floor(ent.damage / secs)
        const sdps = Math.floor(ent.damage / totalSecs)
        return {
          name: ent.name,
          kind: ent.kind,
          damage: ent.damage,
          hits: ent.hits,
          maxHit: ent.maxHit,
          deaths: ent.deaths,
          crits: ent.crits,
          critDamage: ent.critDamage,
          avgHit,
          avgCrit,
          dps,
          sdps,
          pct: this.maxIncomingDamage > 0 ? (ent.damage / this.maxIncomingDamage) * 100 : 0,
          categories: { ...ent.categories },
        }
      })

    const totalOut = outgoing.reduce((s, e) => s + e.damage, 0)
    const totalIn = incoming.reduce((s, e) => s + e.damage, 0)
    const allDamage = totalOut + totalIn

    return {
      encounters: this.encounters,
      current: this.current,
      seq: this.seq,
      outgoing,
      incoming,
      totalOut,
      totalIn,
      allDamage,
      maxEntityDamage: this.maxEntityDamage,
      maxIncomingDamage: this.maxIncomingDamage,
      bestSec,
      totalSecs,
      activeSecs: secs,
      procs: this.procs,
    }
  }
}

module.exports = { CombatModule }
