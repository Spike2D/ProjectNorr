function effectBase(ev, extra) {
  return { ...ev, ...extra }
}

function amount(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

// Normalizes combat-effect lines which are often phrased differently from
// ordinary damage/heal lines. This module intentionally does not invent an
// attacker when the log does not identify one.
function enhanceCombatEffect(text, ev, seq, ts, raw) {
  if (!ev || ev.kind !== 'unknown') return ev
  let m

  // Full and partial resists.
  m = /^(.+?)\s+(fully\s+)?resists?\s+(.+?)\.?$/i.exec(text)
  if (m) {
    return effectBase(ev, {
      kind: 'resist', seq, ts, raw,
      target: m[1].trim(), spell: m[3].trim(),
      partial: !m[2], full: !!m[2], amount: 0,
    })
  }
  m = /^(.+?)\s+partially\s+resists?\s+(.+?)(?:\s*\((\d+)\s+damage\))?\.?$/i.exec(text)
  if (m) {
    return effectBase(ev, {
      kind: 'resist', seq, ts, raw,
      target: m[1].trim(), spell: m[2].trim(),
      partial: true, full: false, amount: m[3] ? amount(m[3]) : 0,
    })
  }

  // Damage shields / reflected damage. Attribution is intentionally left to
  // the attribution layer when the shield owner is identifiable elsewhere.
  m = /^(.+?)\s+(?:takes|took)\s+(\d+)\s+(?:points?\s+of\s+)?damage\s+from\s+(.+?)(?:'s|’s)?\s+damage\s+shield\.?$/i.exec(text)
  if (m) {
    return effectBase(ev, {
      kind: 'damage', seq, ts, raw,
      attacker: m[3].trim(), target: m[1].trim(), amount: amount(m[2]),
      dtype: 'damageShield', reflected: true, skill: 'Damage Shield',
    })
  }
  m = /^(.+?)\s+(?:takes|took)\s+(\d+)\s+(?:points?\s+of\s+)?damage\s+from\s+(?:a\s+)?damage shield\.?$/i.exec(text)
  if (m) {
    return effectBase(ev, {
      kind: 'damage', seq, ts, raw,
      attacker: null, target: m[1].trim(), amount: amount(m[2]),
      dtype: 'damageShield', reflected: true, skill: 'Damage Shield',
    })
  }

  // Common DoT tick form: "X takes N damage from Your Spell".
  m = /^(.+?)\s+(?:takes|has taken)\s+(\d+)\s+(?:points?\s+of\s+)?damage\s+from\s+(.+?)\.?$/i.exec(text)
  if (m) {
    let source = m[3].trim()
    let attacker = null
    const your = /^your\s+(.+)$/i.exec(source)
    const named = /^(.+?)['’]s\s+(.+)$/i.exec(source)
    if (your) { attacker = 'You'; source = your[1] }
    else if (named) { attacker = named[1].trim(); source = named[2].trim() }
    return effectBase(ev, {
      kind: 'damage', seq, ts, raw,
      attacker, target: m[1].trim(), amount: amount(m[2]),
      dtype: 'dot', overTime: true, skill: source,
    })
  }

  // HoT ticks where the log identifies the spell after the heal amount.
  m = /^(.+?)\s+(?:heals?|gains?)\s+(\d+)\s+(?:points?\s+of\s+)?(?:hit points?|health)(?:\s+from\s+(.+?))?\.?$/i.exec(text)
  if (m) {
    let spell = m[3] ? m[3].trim() : undefined
    let healer = null
    if (spell) {
      const your = /^your\s+(.+)$/i.exec(spell)
      const named = /^(.+?)['’]s\s+(.+)$/i.exec(spell)
      if (your) { healer = 'You'; spell = your[1] }
      else if (named) { healer = named[1].trim(); spell = named[2].trim() }
    }
    return effectBase(ev, {
      kind: 'heal', seq, ts, raw,
      healer, target: m[1].trim(), amount: amount(m[2]),
      spell, overTime: true,
    })
  }

  return ev
}

module.exports = { enhanceCombatEffect }
