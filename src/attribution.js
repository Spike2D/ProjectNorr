const { enhanceCombatEffect } = require('./combat-effects')
const { applyParserFixes } = require('./parser-fixes')

class AttributionModule {
  constructor() { this.reset() }

  reset() {
    this.pets = new Map()
    this.charmed = new Map()
    this.pendingOwners = new Map()
  }

  _key(name) { return String(name || '').trim().toLowerCase() }

  _remember(name, owner = 'You', type = 'pet', ts = 0) {
    if (!name) return
    const clean = String(name).trim()
    this.pets.set(this._key(clean), { name: clean, owner: owner || 'You', type, claimedAt: ts })
  }

  _remove(name) {
    const key = this._key(name)
    this.pets.delete(key)
    this.charmed.delete(key)
    this.pendingOwners.delete(key)
  }

  _decorate(ev, info) {
    if (!ev || !info) return ev
    return {
      ...ev,
      attribution: { owner: info.owner, kind: info.type, entity: info.name },
      owner: info.owner,
      entityType: info.type,
      entity: info.name,
    }
  }

  _lookup(name) {
    const key = this._key(name)
    return this.pets.get(key) || (this.charmed.has(key) ? {
      name: name,
      owner: this.charmed.get(key),
      type: 'charmed',
    } : null)
  }

  process(ev) {
    if (!ev) return null
    if (ev.attribution) return ev

    const rawText = ev.text || ev.message || String(ev.raw || '').replace(/^\[[^\]]+\]\s*/, '')
    ev = applyParserFixes(rawText, ev)
    ev = enhanceCombatEffect(rawText, ev, ev.seq, ev.ts, ev.raw)

    switch (ev.kind) {
      case 'zone':
        this.reset()
        return ev
      case 'petClaim':
        this._remember(ev.name, 'You', 'pet', ev.ts)
        return this._decorate(ev, { name: ev.name, owner: 'You', type: 'pet' })
      case 'allyPetLeader':
        this._remember(ev.pet, ev.owner, 'pet', ev.ts)
        return this._decorate(ev, { name: ev.pet, owner: ev.owner, type: 'pet' })
      case 'petSay':
        if (ev.name) {
          const owner = ev.owner || 'You'
          this._remember(ev.name, owner, 'pet', ev.ts)
          return this._decorate(ev, { name: ev.name, owner, type: 'pet' })
        }
        return ev
      case 'charm':
        if (ev.mob) {
          this.charmed.set(this._key(ev.mob), 'You')
          this._remember(ev.mob, 'You', 'charmed', ev.ts)
          return this._decorate(ev, { name: ev.mob, owner: 'You', type: 'charmed' })
        }
        return ev
      case 'uncharm':
        this._remove(ev.mob)
        return ev
      case 'death':
      case 'playerDeath':
        if (ev.name) this._remove(ev.name)
        break
    }

    // Owner attribution is intentionally applied to every producer field,
    // not just melee attackers. This covers pet spells, DoTs, HoTs and procs.
    for (const field of ['attacker', 'healer', 'caster', 'source']) {
      if (!ev[field]) continue
      const info = this._lookup(ev[field])
      if (info) return this._decorate(ev, info)
    }

    // Some event shapes expose the producing entity as `from`.
    if (ev.from) {
      const info = this._lookup(ev.from)
      if (info) return this._decorate(ev, info)
    }

    return ev
  }
}

module.exports = { AttributionModule }
