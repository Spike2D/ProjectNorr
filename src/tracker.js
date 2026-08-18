class TrackerModule {
  constructor() {
    this.reset()
  }

  reset() {
    this.startedAt = null
    this.lastEventTs = null
    this.zone = null
    this.player = null
    this.level = null
    this.xpGains = 0
    this.aaGains = 0
    this.aaSpent = 0
    this.kills = 0
    this.deaths = 0
    this.skillUps = 0
    this.skills = new Map()
    this.loot = new Map()
    this.coins = { platinum: 0, gold: 0, silver: 0, copper: 0 }
    this.coinSources = new Map()
    this.faction = new Map()
    this.lastLoot = []
    this.lastEvents = []
  }

  _remember(ev) {
    if (!ev) return
    this.lastEventTs = ev.ts || this.lastEventTs
    this.lastEvents.push({
      ts: ev.ts,
      seq: ev.seq,
      kind: ev.kind,
      raw: ev.raw,
    })
    if (this.lastEvents.length > 100) this.lastEvents.shift()
  }

  _addMap(map, key, value) {
    if (!key) return
    map.set(key, (map.get(key) || 0) + value)
  }

  _addCoins(coins, source) {
    if (!coins) return
    let totalCopper = 0
    for (const name of ['platinum', 'gold', 'silver', 'copper']) {
      const value = Number(coins[name] || 0)
      if (!Number.isFinite(value)) continue
      this.coins[name] += value
      const multiplier = { platinum: 1000, gold: 100, silver: 10, copper: 1 }[name]
      totalCopper += value * multiplier
    }
    if (source) this._addMap(this.coinSources, source, totalCopper)
  }

  onEvent(ev, live) {
    if (!ev) return
    this._remember(ev)

    if (ev.kind === 'sessionStart' && this.startedAt == null) {
      this.startedAt = ev.ts || Date.now()
    }

    if (this.startedAt == null && ev.ts) this.startedAt = ev.ts

    switch (ev.kind) {
      case 'zone':
        this.zone = ev.zone || this.zone
        break
      case 'selfWho':
        if (ev.level != null) this.level = ev.level
        if (ev.zone) this.zone = ev.zone
        break
      case 'level':
        this.level = ev.level || this.level
        break
      case 'expGain':
        this.xpGains += 1
        break
      case 'aaGain':
        this.aaGains += Number(ev.amount || 0)
        break
      case 'aaSpend':
        this.aaSpent += Number(ev.cost || 0)
        break
      case 'skillUp':
        this.skillUps += 1
        this._addMap(this.skills, ev.skill, Number(ev.value || 1))
        break
      case 'death':
      case 'playerDeath':
        this.deaths += 1
        break
      case 'loot': {
        const item = ev.item || 'Unknown'
        const count = Number.isFinite(ev.count) && ev.count > 0 ? ev.count : 1
        const current = this.loot.get(item) || { item, count: 0, loots: 0, sources: new Map(), dispositions: new Map() }
        current.count += count
        current.loots += 1
        if (ev.source) this._addMap(current.sources, ev.source, count)
        if (ev.disposition) this._addMap(current.dispositions, ev.disposition, count)
        this.loot.set(item, current)
        this.lastLoot.unshift({
          ts: ev.ts,
          item,
          count,
          source: ev.source || null,
          disposition: ev.disposition || 'looted',
        })
        if (this.lastLoot.length > 50) this.lastLoot.length = 50
        break
      }
      case 'coin':
        this._addCoins(ev.coins, ev.source || 'unknown')
        break
      case 'consider':
        if (ev.mob && ev.faction) {
          this.faction.set(ev.mob, {
            mob: ev.mob,
            faction: ev.faction,
            level: ev.level,
            difficulty: ev.difficulty,
            rare: !!ev.rare,
            ts: ev.ts,
          })
        }
        break
      case 'death':
        this.kills += 1
        break
      case 'unknown':
        break
    }

    if (!live) return
  }

  _duration(now = Date.now()) {
    if (this.startedAt == null) return 0
    const end = this.lastEventTs || now
    return Math.max(0, end - this.startedAt)
  }

  snapshot(now = Date.now()) {
    const durationMs = this._duration(now)
    const hours = durationMs > 0 ? durationMs / 3600000 : 0
    const loot = Array.from(this.loot.values())
      .map(entry => ({
        item: entry.item,
        count: entry.count,
        loots: entry.loots,
        sources: Object.fromEntries(entry.sources),
        dispositions: Object.fromEntries(entry.dispositions),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100)

    const faction = Array.from(this.faction.values())
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 100)

    const skills = Array.from(this.skills.entries())
      .map(([skill, gains]) => ({ skill, gains }))
      .sort((a, b) => b.gains - a.gains)

    const totalCopper = this.coins.platinum * 1000 + this.coins.gold * 100 + this.coins.silver * 10 + this.coins.copper

    return {
      zone: this.zone,
      player: this.player,
      level: this.level,
      durationMs,
      durationSeconds: Math.floor(durationMs / 1000),
      xpGains: this.xpGains,
      xpPerHour: hours > 0 ? Math.round(this.xpGains / hours) : 0,
      aaGains: this.aaGains,
      aaPerHour: hours > 0 ? Math.round(this.aaGains / hours) : 0,
      aaSpent: this.aaSpent,
      kills: this.kills,
      killsPerHour: hours > 0 ? Math.round(this.kills / hours) : 0,
      deaths: this.deaths,
      skillUps: this.skillUps,
      skills,
      coins: { ...this.coins, totalCopper },
      coinSources: Object.fromEntries(this.coinSources),
      loot,
      lastLoot: this.lastLoot.slice(),
      faction,
      lastEventTs: this.lastEventTs,
    }
  }
}

module.exports = { TrackerModule }
