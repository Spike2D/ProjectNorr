// Deterministic post-parse corrections. Keep this layer conservative: it only
// rewrites an event when the raw line contains enough evidence to do so.
function cleanName(value) {
  const n = String(value || '').trim()
  if (/^(you|yourself|your)$/i.test(n)) return 'You'
  return n
}

function parseModifiers(value) {
  if (!value) return []
  return String(value).split(/[\s,]+/).filter(Boolean).map(v => v.toLowerCase())
}

function applyParserFixes(text, ev) {
  if (!ev) return ev
  const line = String(text || '').trim()

  if (ev.kind === 'miss') {
    const result = { ...ev }
    result.attacker = result.attacker ? cleanName(result.attacker) : result.attacker
    result.target = result.target ? cleanName(result.target) : result.target
    result.mtype = String(result.mtype || 'miss').toLowerCase()
    result.outcome = result.mtype
    result.verb = result.verb ? String(result.verb).toLowerCase() : undefined
    if (!result.modifiers) {
      const mod = /\(([^)]+)\)\s*$/.exec(line)
      if (mod) result.modifiers = parseModifiers(mod[1])
    }
    return result
  }

  // Direct variants occasionally appear without the long "tries to X" form.
  let m = /^(.+?)\s+miss(?:es)?\s+(.+?)[.!]?$/i.exec(line)
  if (m) {
    return { ...ev, kind: 'miss', attacker: cleanName(m[1]), target: cleanName(m[2]), mtype: 'miss', outcome: 'miss' }
  }

  m = /^(.+?)['’]s\s+(?:attack|blow|strike)\s+(?:is|was)\s+(parried|dodged|riposted|blocked)\.?$/i.exec(line)
  if (m) {
    return { ...ev, kind: 'miss', attacker: cleanName(m[1]), target: ev.target, mtype: m[2].toLowerCase().replace(/ed$/, ''), outcome: m[2].toLowerCase() }
  }

  // Absorption is not a miss for statistics purposes: it is mitigation.
  m = /^(.+?)['’]s\s+magical skin\s+absorbs\s+(?:the\s+)?(?:blow|attack)\.?$/i.exec(line)
  if (m) {
    return { ...ev, kind: 'miss', attacker: cleanName(m[1]), target: 'You', mtype: 'absorb', outcome: 'absorb' }
  }

  // Rune/ward absorption. We deliberately do not invent the original damage.
  m = /^(.+?)\s+(?:absorbs|absorbed)\s+(\d+)\s+(?:points?\s+of\s+)?damage(?:\s+from\s+(.+?))?\.?$/i.exec(line)
  if (m) {
    return { ...ev, kind: 'mitigation', type: 'absorb', target: cleanName(m[1]), amount: Number(m[2]), source: m[3] ? cleanName(m[3]) : undefined }
  }

  if (ev.kind === 'damage') {
    const result = { ...ev }
    result.attacker = result.attacker ? cleanName(result.attacker) : result.attacker
    result.target = result.target ? cleanName(result.target) : result.target
    if (result.dtype) result.dtype = String(result.dtype).toLowerCase()
    if (result.amount != null) result.amount = Number(result.amount)
    if (result.overTime || result.dtype === 'dot') result.overTime = true
    if (result.reflected || result.dtype === 'damageshield') result.dtype = 'damageShield'
    return result
  }

  if (ev.kind === 'heal') {
    const result = { ...ev }
    result.healer = result.healer ? cleanName(result.healer) : result.healer
    result.target = result.target ? cleanName(result.target) : result.target
    result.amount = Number(result.amount)
    if (result.rawAmount != null) result.rawAmount = Number(result.rawAmount)
    if (result.overTime) result.overTime = true
    return result
  }

  return ev
}

module.exports = { applyParserFixes }
