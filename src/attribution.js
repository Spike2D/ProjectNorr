class AttributionModule {
  constructor() {
    this.reset()
  }

  reset() {
    this.pets = new Map() // normalized pet name -> { name, owner, type, claimedAt }
    this.charmed = new Map() // normalized mob name -> owner
  }

  _key(name) {
    return String(name || '').trim().toLowerCase()
  }

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
      attribution: {
        owner: info.owner,
        kind: info.type,
        entity: info.name,
      },
      owner: info.owner,
      entityType: info.type,
    }
  }

  process(ev) {
    if (!ev) return null

    switch (ev.kind) {
      case 'zone':
        this.reset()
        return ev

      case 'petClaim':
        this._rememberPet(ev.name, 'You', 'pet', ev.ts)
        return { ...ev, owner: 'You', entityType: 'pet', attribution: { owner: 'You', kind: 'pet', entity: ev.name } }

      case 'allyPetLeader':
        this._rememberPet(ev.pet, ev.owner, 'pet', ev.ts)
        return { ...ev, entityType: 'pet', attribution: { owner: ev.owner, kind: 'pet', entity: ev.pet } }

      case 'petSay':
        if (ev.name) this._rememberPet(ev.name, 'You', 'pet', ev.ts)
        return { ...ev, owner: 'You', entityType: 'pet', attribution: { owner: 'You', kind: 'pet', entity: ev.name } }

      case 'charm':
        this.charmed.set(this._key(ev.mob), 'You')
        this._rememberPet(ev.mob, 'You', 'charmed', ev.ts)
        return { ...ev, owner: 'You', entityType: 'charmed', attribution: { owner: 'You', kind: 'charmed', entity: ev.mob } }

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
