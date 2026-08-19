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

// Alternate melee wording.
const frenzy = parse('A warrior frenzies on a goblin for 42 points of damage.')
assert.equal(frenzy.kind, 'damage')
assert.equal(frenzy.amount, 42)
assert.equal(frenzy.verb, 'frenzy')

const flurry = parse('A warrior flurries a goblin for 43 points of damage.')
assert.equal(flurry.kind, 'damage')
assert.equal(flurry.amount, 43)
assert.equal(flurry.verb, 'flurry')

// Alternate heal grammar.
const heals = parse('A cleric heals You for 99 hit points.')
assert.equal(heals.kind, 'heal')
assert.equal(heals.healer, 'A cleric')
assert.equal(heals.target, 'You')
assert.equal(heals.amount, 99)

// Loot special dispositions must not fall through to generic loot parsing.
const currencyLoot = parse('You looted 2 Rusty Coins from an orc corpse and stored it in your currency.')
assert.equal(currencyLoot.kind, 'loot')
assert.equal(currencyLoot.item, 'Rusty Coins')
assert.equal(currencyLoot.source, 'an orc')
assert.equal(currencyLoot.count, 2)
assert.equal(currencyLoot.disposition, 'currency')

const soldLoot = parse('You looted a Rusty Sword from an orc corpse and sold it for 10 gold.')
assert.equal(soldLoot.kind, 'loot')
assert.equal(soldLoot.item, 'Rusty Sword')
assert.equal(soldLoot.disposition, 'sold')

// Alternate death wording.
const killed = parse('A goblin has been killed.')
assert.equal(killed.kind, 'death')
assert.equal(killed.name, 'A goblin')
assert.equal(killed.bySelf, false)

// Alternate receive wording.
const received = parse('You receive 3 Healing Potions from the corpse.')
assert.equal(received.kind, 'itemReceived')
assert.equal(received.item, 'Healing Potions')
assert.equal(received.count, 3)

console.log(`Parser regression tests passed: ${cases.length + 10}`)
