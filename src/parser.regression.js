const assert = require('assert')
const { parseEvent } = require('./parser')

function expectKind(line, kind, extra = {}) {
  const ev = parseEvent(line, 1700000000000)
  assert.strictEqual(ev.kind, kind, `${line}\nexpected ${kind}, got ${ev.kind}`)
  for (const [key, value] of Object.entries(extra)) {
    assert.deepStrictEqual(ev[key], value, `${line}\n${key}`)
  }
}

expectKind('You hit a_training_dummy for 42 points of damage.', 'damage', { attacker: 'You', target: 'a_training_dummy', amount: 42 })
expectKind('You heal yourself for 125 points of health.', 'heal', { amount: 125 })
expectKind('You gain 1234 experience!', 'expGain', { amount: 1234 })
expectKind('You gain 2.5% experience.', 'expGain', { percent: 2.5 })
expectKind('You loot 3 Bone Chips from an_orc.', 'loot', { item: 'Bone Chips', count: 3 })
expectKind('You loot a Bone Chip from an_orc.', 'loot', { item: 'Bone Chip', count: 1 })

console.log('Parser regression corpus passed')
