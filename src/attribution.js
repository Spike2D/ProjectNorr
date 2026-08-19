const { enhanceCombatEffect } = require('./combat-effects')
const { applyParserFixes } = require('./parser-fixes')

class AttributionModule {
  constructor() { this.reset() }

  reset() {
    this.pets = new Map()
    this.charmed = new Map()
  }

  _key(name) { return String(name || '').trim().toLowerCase() }

  _rememberPet(name, owner = 'You', type = 'pet', ts = 0) {
    if (!name) return
    this.pets.set(this._key(name), { name: String(name).trim(), owner: owner || 'You', type, claimedAt: ts })
  }

  _remove(name) {
    const key = this._key(name)
    this.pets.delete(key)
    this.charmed.delete(key)
  }

  _decorate(ev, info) {
    if (!ev || !info) return ev
    return {
      ...ev,
      attribution: { owner: info.owner, kind: info.type, entity: info.name },
      owner: info.owner,
      entityType: info.type,
    }
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
        this._rememberPet(ev.name, 'You', 'pet', ev.ts)
        return this._decorate(ev, { name: ev.name, owner: 'You', type: 'pet' })
      case 'allyPetLeader':
        this._rememberPet(ev.pet, ev.owner, 'pet', ev.ts)
        return this._decorate(ev, { name: ev.pet, owner: ev.owner, type: 'pet' })
      case 'petSay':
        if (ev.name) this._rememberPet(ev.name, 'You', 'pet', ev.ts)
        return this._decorate(ev, { name: ev.name, owner: 'You', type: 'pet' })
      case 'charm':
        this.charmed.set(this._key(ev.mob), 'You')
        this._rememberPet(ev.mob, 'You', 'charmed', ev.ts)
        return this._decorate(ev, { name: ev.mob, owner: 'You', type: 'charmed' })
      case 'uncharm':
        this._remove(ev.mob)
        return ev
      case 'death':
      case 'playerDeath':
        if (ev.name) this._remove(ev.name)
        break
    }

    if (ev.attacker) {
      const info = this.pets.get(this._key(ev.attacker))
      if (info) return this._decorate(ev, info)
      const charmOwner = this.charmed.get(this._key(ev.attacker))
      if (charmOwner) return this._decorate(ev, { name: ev.attacker, owner: charmOwner, type: 'charmed' })
    }
    if (ev.healer) {
      const info = this.pets.get(this._key(ev.healer))
      if (info) return this._decorate(ev, info)
    }
    if (ev.caster) {
      const info = this.pets.get(this._key(ev.caster))
      if (info) return this._decorate(ev, info)
    }
    return ev
  }
}

module.exports = { AttributionModule }
