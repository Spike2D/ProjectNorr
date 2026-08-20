const base = require('./parser')

const LINE_RE = /^\[(.+?)\]\s?(.*)$/

function parseLine(raw) {
  const m = LINE_RE.exec(raw)
  if (!m) return null
  return { ts: base.parseLine(raw)?.ts ?? 0, text: m[2], raw }
}

function norm(name) {
  const n = String(name ?? '').trim()
  return /^(you|yourself|your)$/i.test(n) ? 'You' : n
}

function mods(value) {
  return value ? value.split(/[\s,]+/).filter(Boolean) : []
}

function event(ctx, kind, fields = {}) {
  return { kind, seq: ctx.seq, ts: ctx.ts, raw: ctx.raw, ...fields }
}

function fixedEvent(ctx) {
  const { text } = ctx
  let m

  // Damage: Legends uses both "for 123 damage" and
  // "for 123 points of melee/magic damage" forms.
  m = /^(.+?)\s+(hit|hits|slash|slashes|pierce|pierces|crush|crushes|bash|bashes|kick|kicks|bite|bites|claw|claws|gore|gores|maul|mauls|punch|punches|strike|strikes|slice|slices|backstab|backstabs|slam|slams|sting|stings|rend|rends|smash|smashes|gnaw|gnaws|lash|lashes|smite|smites|cleave|cleaves|reave|reaves|shoot|shoots|frenzy|frenzies|flurry|flurries)\s+(.+?)\s+for\s+(\d+)\s+(?:(points?)\s+of\s+)?damage\.?(?:\s+\((.+?)\))?$/i.exec(text)
  if (m) {
    const verb = m[2].toLowerCase().replace(/ies$/, 'y').replace(/es$/, '').replace(/s$/, '')
    const modifiers = mods(m[6])
    const skill = /backstab/i.test(verb) ? 'Backstab' : /bash/i.test(verb) ? 'Bash' : /kick/i.test(verb) ? 'Kick' : /shoot/i.test(verb) ? 'Ranged' : /strike/i.test(verb) ? 'Strike' : /frenzy/i.test(verb) ? 'Frenzy' : /flurry/i.test(verb) ? 'Flurry' : /cleave/i.test(verb) ? 'Cleave' : /smite/i.test(verb) ? 'Smite' : 'Melee'
    return event(ctx, 'damage', { attacker: norm(m[1]), target: norm(m[3]), amount: Number(m[4]), dtype: 'melee', skill, verb, crit: modifiers.some(x => /critical/i.test(x)), modifiers })
  }

  // Spell damage with or without an explicit "by <spell>" clause.
  m = /^(.+?)\s+hits?\s+(.+?)\s+for\s+(\d+)\s+(?:points?\s+of\s+)?([\w-]+)\s+damage(?:\s+by\s+(.+?))?\.?(?:\s+\((.+?)\))?$/i.exec(text)
  if (m) {
    const modifiers = mods(m[6])
    return event(ctx, 'damage', { attacker: norm(m[1]), target: norm(m[2]), amount: Number(m[3]), dtype: 'spell', dclass: m[4], skill: (m[5] || m[4]).trim(), crit: modifiers.some(x => /critical/i.test(x)), modifiers })
  }

  // Damage-over-time wording, including both "from" and "by".
  m = /^(.+?)\s+has taken\s+(\d+)\s+(?:points?\s+of\s+)?damage\s+(?:from|by)\s+(.+?)\.?(?:\s+\((.+?)\))?$/i.exec(text)
  if (m) {
    let source = m[3].trim()
    let attacker = null
    if (/^your\s+/i.test(source)) {
      attacker = 'You'
      source = source.replace(/^your\s+/i, '')
    } else {
      const sm = /^(.+?)['’]s\s+(.+)$/.exec(source)
      if (sm) { attacker = norm(sm[1]); source = sm[2] }
    }
    const modifiers = mods(m[4])
    return event(ctx, 'damage', { attacker, target: norm(m[1]), amount: Number(m[2]), dtype: 'dot', skill: source, crit: modifiers.some(x => /critical/i.test(x)), modifiers })
  }

  // Heals: both "healed" and "heals" occur in logs.
  m = /^(.+?)\s+heals?\s+(.+?)(?:\s+over time)?\s+for\s+(\d+)(?:\s+\((\d+)\))?\s+hit points?(?:\s+by\s+(.+?))?\.?(?:\s+\((.+?)\))?$/i.exec(text)
  if (m) {
    const healer = norm(m[1])
    const targetRaw = m[2].trim()
    const target = /^(itself|himself|herself|themselves)$/i.test(targetRaw) ? healer : norm(targetRaw)
    const modifiers = mods(m[7])
    return event(ctx, 'heal', { target, amount: Number(m[3]), rawAmount: m[4] ? Number(m[4]) : undefined, spell: m[6]?.trim(), healer, crit: modifiers.some(x => /critical/i.test(x)), overTime: /\bover time\b/i.test(text), modifiers })
  }

  // Experience lines sometimes end with a period after the percentage.
  m = /^You gain\s+(?:(party)\s+)?experience!?(?:\s*\(([\d.,]+)%\))?\.?$/i.exec(text)
  if (m) {
    const pct = m[2] == null ? undefined : Number(m[2].replace(',', '.'))
    return event(ctx, 'expGain', { party: !!m[1], ...(Number.isFinite(pct) ? { pct } : {}) })
  }

  // Death variants.
  if (text === 'You died.') return event(ctx, 'playerDeath')
  m = /^You have been slain by (.+?)[.!]?$/i.exec(text)
  if (m) return event(ctx, 'playerDeath', { killer: m[1].trim() })
  m = /^You have slain (.+?)[.!]?$/i.exec(text)
  if (m) return event(ctx, 'death', { name: norm(m[1]), bySelf: true })
  m = /^(.+?) has been (?:slain|killed) by (.+?)[.!]?$/i.exec(text)
  if (m) return event(ctx, 'death', { name: norm(m[1]), bySelf: false, killer: m[2].trim() })
  m = /^(.+?) has been (?:slain|killed)\.?$/i.exec(text)
  if (m) return event(ctx, 'death', { name: norm(m[1]), bySelf: false })
  m = /^(.+?) died\.$/i.exec(text)
  if (m) return event(ctx, 'death', { name: norm(m[1]), bySelf: false })

  // Item acquisition that is not currency.
  m = /^You receive\s+(?:(\d+)\s+|an?\s+)?(.+?)\s+from\s+(?:the\s+)?corpse\.?$/i.exec(text)
  if (m && !/\b(?:platinum|gold|silver|copper)\b/i.test(m[2])) {
    return event(ctx, 'itemReceived', { item: m[2].trim(), count: m[1] ? Number(m[1]) : 1, via: 'receive' })
  }
  m = /^You received\s+(?:(\d+)\s+|an?\s+)?(.+?)\s+from\s+(?:that item|the item)\.?$/i.exec(text)
  if (m && !/\b(?:platinum|gold|silver|copper)\b/i.test(m[2])) {
    return event(ctx, 'itemReceived', { item: m[2].trim(), count: m[1] ? Number(m[1]) : 1, via: 'receive' })
  }

  // Poison coating: the old guard only entered the named branch when the
  // literal word "poison" followed "in", making named coatings unreachable.
  m = /^(.+?) coats their blades in (.+?)!$/i.exec(text)
  if (m) return event(ctx, 'poisonCoat', { poison: m[2].trim(), self: false, mob: norm(m[1]) })

  return null
}

function parseEvent(raw, seq) {
  const parsed = parseLine(raw)
  if (!parsed) return null
  const ctx = { raw, seq, ts: parsed.ts, text: parsed.text }
  const fixed = fixedEvent(ctx)
  return fixed || base.parseEvent(raw, seq)
}

module.exports = {
  parseEvent,
  parseLine,
  idKey: base.idKey,
  spellCanonKey: base.spellCanonKey,
  cleanMob: base.cleanMob,
  looksDamage: text => /\bfor\s+\d+\s+(?:points?\s+of\s+)?damage\b|\bhas taken\s+\d+\s+(?:points?\s+of\s+)?damage\b/i.test(text),
  norm,
}
