const assert = require('node:assert/strict')
const { parseEvent } = require('./parser-v2')

function parse(text, seq = 1) {
  return parseEvent(`[Thu Aug 20 12:34:56 2026] ${text}`, seq)
}

function expectKind(text, kind) {
  const ev = parse(text)
  assert.ok(ev, `no event for: ${text}`)
  assert.equal(ev.kind, kind, `${text} -> ${ev.kind}`)
  return ev
}

expectKind('You hit a goblin for 123 damage.', 'damage')
expectKind('A goblin hits You for 17 damage.', 'damage')
expectKind('A goblin has taken 25 points of damage by a fire spell.', 'damage')
expectKind('You heals yourself for 10 hit points.', 'heal')
expectKind('You gain experience! (12.5%).', 'expGain')
expectKind('You have looted 3 Shiny Stones from a goblin corpse.', 'loot')
expectKind('An orc has been killed.', 'death')
expectKind('A wizard begins casting Fireball.', 'otherCastBegin')

const frenzy = expectKind('A warrior frenzies on a goblin for 42 points of damage.', 'damage')
assert.equal(frenzy.amount, 42)
assert.equal(frenzy.verb, 'frenzy')

const flurry = expectKind('A warrior flurries a goblin for 43 points of damage.', 'damage')
assert.equal(flurry.amount, 43)
assert.equal(flurry.verb, 'flurry')

const heals = expectKind('A cleric heals You for 99 hit points.', 'heal')
assert.equal(heals.healer, 'A cleric')
assert.equal(heals.target, 'You')
assert.equal(heals.amount, 99)

const spell = expectKind('A wizard hits You for 55 fire damage by Fireball.', 'damage')
assert.equal(spell.dtype, 'spell')
assert.equal(spell.amount, 55)
assert.equal(spell.skill, 'Fireball')

const currencyLoot = expectKind('You looted 2 Rusty Coins from an orc corpse and stored it in your currency.', 'loot')
assert.equal(currencyLoot.item, 'Rusty Coins')
assert.equal(currencyLoot.source, 'an orc')
assert.equal(currencyLoot.count, 2)
assert.equal(currencyLoot.disposition, 'currency')

const soldLoot = expectKind('You looted a Rusty Sword from an orc corpse and sold it for 10 gold.', 'loot')
assert.equal(soldLoot.item, 'Rusty Sword')
assert.equal(soldLoot.disposition, 'sold')

const killed = expectKind('A goblin has been killed.', 'death')
assert.equal(killed.name, 'A goblin')
assert.equal(killed.bySelf, false)

const killedBy = expectKind('A goblin has been killed by You!', 'death')
assert.equal(killedBy.name, 'A goblin')
assert.equal(killedBy.killer, 'You')

const received = expectKind('You receive 3 Healing Potions from the corpse.', 'itemReceived')
assert.equal(received.item, 'Healing Potions')
assert.equal(received.count, 3)
assert.equal(received.via, 'receive')

const poison = expectKind('A rogue coats their blades in neurotoxic poison!', 'poisonCoat')
assert.equal(poison.poison, 'neurotoxic poison')
assert.equal(poison.self, false)

const proc = expectKind('A goblin is poisoned.', 'proc')
assert.equal(proc.effect, 'poison')
assert.equal(proc.name, 'Poison')
assert.equal(proc.isStrike, undefined)
assert.equal(proc.wasStrike, undefined)

const unknown = parse('This is deliberately unrecognized parser text.')
assert.equal(unknown.kind, 'unknown')

console.log('Parser regression tests passed: 25')
