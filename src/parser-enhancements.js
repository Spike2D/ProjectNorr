function eventBase(raw, seq, ts) {
  return { seq, ts, raw }
}

function normName(name) {
  const n = String(name || '').trim()
  if (/^(you|yourself|your)$/i.test(n)) return 'You'
  return n
}

function modifiers(text) {
  if (!text) return []
  return text.split(/[\s,]+/).filter(Boolean)
}

function parseAmount(value) {
  const n = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

// Compatibility layer for alternate EverQuest Legends log wording.
// It only handles events that the main parser classified as unknown, so it
// cannot override an established parser result.
function enhanceEvent(text, baseEvent, seq, ts, raw) {
  if (baseEvent && baseEvent.kind !== 'unknown') return baseEvent
  let m

  m = /^(.+?)\s+(hit|hits|slash|slashes|pierce|pierces|crush|crushes|bash|bashes|kick|kicks|bite|bites|claw|claws|gore|gores|maul|mauls|punch|punches|strike|strikes|slice|slices|backstab|backstabs|slam|slams|sting|stings|rend|rends|smash|smashes|gnaw|gnaws|lash|lashes|smite|smites|cleave|cleaves|reave|reaves|shoot|shoots|frenzy|frenzies|flurry|flurries)\s+(.+?)\s+for\s+(\d+)\s+(?:points?\s+of\s+)?damage\.?(?:\s+\((.+?)\))?$/i.exec(text)
  if (m) {
    const amount = parseAmount(m[4])
    if (amount != null) {
      const verb = m[2].toLowerCase().replace(/ies$/, 'y').replace(/es$/, '').replace(/s$/, '')
      return { ...eventBase(raw, seq, ts), kind: 'damage', attacker: normName(m[1]), target: normName(m[3]), amount, dtype: 'melee', skill: verb, verb, crit: /critical/i.test(m[5] || ''), modifiers: modifiers(m[5]) }
    }
  }

  m = /^(.+?)\s+hits?\s+(.+?)\s+for\s+(\d+)\s+(?:points?\s+of\s+)?([\w-]+)\s+damage(?:\s+by\s+(.+?))?\.?(?:\s+\((.+?)\))?$/i.exec(text)
  if (m) {
    const amount = parseAmount(m[3])
    if (amount != null) {
      const mods = modifiers(m[6])
      return { ...eventBase(raw, seq, ts), kind: 'damage', attacker: normName(m[1]), target: normName(m[2]), amount, dtype: 'spell', dclass: m[4].toLowerCase(), skill: (m[5] || 'unknown spell').trim(), crit: /critical/i.test(m[6] || ''), modifiers: mods }
    }
  }

  m = /^(.+?)\s+has taken\s+(\d+)\s+(?:points?\s+of\s+)?damage\s+(?:from|by)\s+(.+?)\.?(?:\s+\((.+?)\))?$/i.exec(text)
  if (m) {
    const amount = parseAmount(m[2])
    if (amount != null) {
      let source = m[3].trim()
      let attacker = null
      if (/^your\s+/i.test(source)) {
        attacker = 'You'
        source = source.replace(/^your\s+/i, '')
      } else {
        const sm = /^(.+?)['’]s\s+(.+)$/.exec(source)
        if (sm) {
          attacker = normName(sm[1])
          source = sm[2]
        }
      }
      return { ...eventBase(raw, seq, ts), kind: 'damage', attacker, target: normName(m[1]), amount, dtype: 'dot', skill: source, crit: /critical/i.test(m[4] || ''), modifiers: modifiers(m[4]) }
    }
  }

  m = /^(.+?)\s+heals?\s+(.+?)\s+for\s+(\d+)\s+(?:points?\s+of\s+)?hit points?(?:\s+by\s+(.+?))?\.?(?:\s+\((.+?)\))?$/i.exec(text)
  if (m) {
    const amount = parseAmount(m[3])
    if (amount != null) {
      const healer = normName(m[1])
      const target = /^(itself|himself|herself|themselves)$/i.test(m[2].trim()) ? healer : normName(m[2])
      return { ...eventBase(raw, seq, ts), kind: 'heal', healer, target, amount, spell: m[4] ? m[4].trim() : undefined, crit: /critical/i.test(m[5] || ''), overTime: /over time/i.test(text), modifiers: modifiers(m[5]) }
    }
  }

  m = /^You gain\s+(?:(party)\s+)?experience!?(?:\s*\(([\d.,]+)%\))?$/i.exec(text)
  if (m) {
    const pct = m[2] ? Number(m[2].replace(',', '.')) : undefined
    return { ...eventBase(raw, seq, ts), kind: 'expGain', party: !!m[1], pct: Number.isFinite(pct) ? pct : undefined }
  }

  m = /^(.+?)\s+(?:has been killed|has died|died)\.?$/i.exec(text)
  if (m && !/^you$/i.test(m[1].trim())) {
    return { ...eventBase(raw, seq, ts), kind: 'death', name: normName(m[1]), bySelf: false }
  }

  m = /^You have looted\s+(?:(\d+)\s+|an?\s+)?(.+?)(?:\s+from\s+(.+?)\s+corpse)?\.?$/i.exec(text)
  if (m) {
    return { ...eventBase(raw, seq, ts), kind: 'loot', item: m[2].trim(), source: m[3] ? m[3].replace(/[’']s corpse$/i, '').trim() : undefined, count: m[1] ? Number(m[1]) : undefined }
  }

  m = /^You receive\s+(?:(\d+)\s+|an?\s+)?(.+?)\s+from\s+(?:the\s+)?(?:corpse|item)\.?$/i.exec(text)
  if (m && !/(platinum|gold|silver|copper)/i.test(m[2])) {
    return { ...eventBase(raw, seq, ts), kind: 'itemReceived', item: m[2].trim(), count: m[1] ? Number(m[1]) : 1, via: 'receive' }
  }

  m = /^(.+?)['’]s\s+(.+?)\s+spell\s+has worn off\.?$/i.exec(text)
  if (m) {
    return { ...eventBase(raw, seq, ts), kind: 'buffFade', spell: m[2].trim(), target: normName(m[1]) }
  }

  m = /^(.+?)\s+begins\s+(casting|singing)\s+(.+?)\.?$/i.exec(text)
  if (m && !/^you$/i.test(m[1].trim())) {
    return { ...eventBase(raw, seq, ts), kind: 'otherCastBegin', caster: normName(m[1]), spell: m[3].trim(), sung: m[2].toLowerCase() === 'singing' }
  }

  return baseEvent
}

module.exports = { enhanceEvent }
