// Aggregates kill/loot/currency data for farming sessions. This is deliberately
// independent from CombatModule: farming is a long-lived session view, not a fight meter.
class FarmingModule {
  constructor() {
    this.reset()
  }

  reset() {
    this.startedAt = null
    this.lastTs = null
    this.lastMob = null
    this.mobs = new Map()
    this.loot = new Map()
    this.currency = { platinum: 0, gold: 0, silver: 0, copper: 0 }
    this.xpEvents = 0
  }

  _mob(name) {
    const key = name ? String(name).trim() : 'Unknown'
    let mob = this.mobs.get(key)
    if (!mob) {
      mob = {
        name: key,
        kills: 0,
        lastKillTs: null,
        loot: new Map(),
        currencyCopper: 0,
      }
      this.mobs.set(key, mob)
    }
    return mob
  }

  _item(name) {
    const key = name ? String(name).trim() : 'Unknown'
    let item = this.loot.get(key)
    if (!item) {
      item = { item: key, count: 0, drops: 0, sources: new Map() }
      this.loot.set(key, item)
    }
    return item
  }

  _coinsTotal(coins) {
    if (!coins) return 0
    return Number(coins.platinum || 0) * 1000 +
      Number(coins.gold || 0) * 100 +
      Number(coins.silver || 0) * 10 +
      Number(coins.copper || 0)
  }

  onEvent(ev) {
    if (!ev) return
    const ts = Number(ev.ts) || Date.now()
    if (this.startedAt == null) this.startedAt = ts
    this.lastTs = ts

    if (ev.kind === 'death') {
      const name = ev.target || ev.mob || ev.victim
      if (name && !/^(you|yourself)$/i.test(String(name))) {
        const mob = this._mob(name)
        mob.kills += 1
        mob.lastKillTs = ts
        this.lastMob = mob.name
      }
      return
    }

    if (ev.kind === 'loot') {
      const item = this._item(ev.item)
      const count = Math.max(1, Number(ev.count) || 1)
      item.count += count
      item.drops += 1
      const source = ev.source || this.lastMob || 'Unknown'
      item.sources.set(source, (item.sources.get(source) || 0) + count)
      const mob = this.mobs.get(source)
      if (mob) {
        mob.loot.set(item.item, (mob.loot.get(item.item) || 0) + count)
      }
      return
    }

    if (ev.kind === 'coin') {
      const coins = ev.coins || {}
      for (const key of Object.keys(this.currency)) {
        this.currency[key] += Number(coins[key] || 0)
      }
      const total = this._coinsTotal(coins)
      if (this.lastMob) {
        const mob = this._mob(this.lastMob)
        mob.currencyCopper += total
      }
      return
    }

    if (ev.kind === 'expGain') this.xpEvents += 1
  }

  snapshot() {
    const end = this.lastTs || Date.now()
    const durationMs = this.startedAt == null ? 0 : Math.max(0, end - this.startedAt)
    const hours = durationMs > 0 ? durationMs / 3600000 : 0

    const mobs = Array.from(this.mobs.values()).map(mob => ({
      name: mob.name,
      kills: mob.kills,
      killsPerHour: hours > 0 ? Number((mob.kills / hours).toFixed(2)) : 0,
      lastKillTs: mob.lastKillTs,
      currencyCopper: mob.currencyCopper,
      loot: Object.fromEntries(mob.loot),
    })).sort((a, b) => b.kills - a.kills)

    const loot = Array.from(this.loot.values()).map(item => ({
      item: item.item,
      count: item.count,
      drops: item.drops,
      dropSources: Object.fromEntries(item.sources),
    })).sort((a, b) => b.count - a.count)

    const totalKills = mobs.reduce((sum, mob) => sum + mob.kills, 0)
    const totalCopper = this._coinsTotal(this.currency)

    return {
      durationMs,
      durationSeconds: Number((durationMs / 1000).toFixed(2)),
      totalKills,
      killsPerHour: hours > 0 ? Number((totalKills / hours).toFixed(2)) : 0,
      xpEvents: this.xpEvents,
      currency: { ...this.currency, totalCopper },
      mobs,
      loot,
    }
  }
}

module.exports = { FarmingModule }
