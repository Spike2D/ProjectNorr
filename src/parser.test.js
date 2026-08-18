const assert = require('node:assert/strict')
const { parseEvent } = require('./parser')
const { enhanceEvent } = require('./parser-enhancements')

function parse(text, seq = 1) {
  const raw = `[Thu Aug 20 12:34:56 2026] ${text}`
  const base = parseEvent(raw, seq)
  if (!base) return null
  return enhanceEvent(text, base, seq, base.ts, raw)
}

const cases = [
  ['You hit a goblin for 123 damage.', 'damage'],
  ['A goblin hits You for 17 damage.', 'damage'],
  ['A goblin has taken 25 points of damage by a fire spell.', 'damage'],
  ['You heals yourself for 10 hit points.', 'heal'],
  ['You gain experience! (12.5%).', 'expGain'],
  ['You have looted 3 Shiny Stones from a goblin corpse.', 'loot'],
  ['An orc has been killed.', 'death'],
  ['A wizard begins casting Fireball.', 'otherCastBegin'],
]

for (const [text, kind] of cases) {
  const ev = parse(text)
  assert.ok(ev, `no event for: ${text}`)
  assert.equal(ev.kind, kind, `${text} -> ${ev.kind}`)
}

const known = parse('You have slain an orc!')
assert.equal(known.kind, 'death')
assert.equal(known.bySelf, true)

const unknown = parse('This is deliberately unrecognized parser text.')
assert.equal(unknown.kind, 'unknown')

console.log(`Parser regression tests passed: ${cases.length + 2}`)
