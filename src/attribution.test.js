const assert = require('assert')
const { AttributionModule } = require('./attribution')

const a = new AttributionModule()

let ev = a.process({ kind: 'petClaim', name: 'Fluffy', ts: 1 })
assert.strictEqual(ev.entityType, 'pet')

ev = a.process({ kind: 'damage', attacker: 'fluffy', target: 'an_orc', amount: 42, ts: 2 })
assert.strictEqual(ev.entityType, 'pet')
assert.strictEqual(ev.owner, 'You')
assert.strictEqual(ev.attribution.entity, 'Fluffy')

a.process({ kind: 'charm', mob: 'an_orc', ts: 3 })
ev = a.process({ kind: 'damage', attacker: 'AN_ORC', target: 'another_mob', amount: 17, ts: 4 })
assert.strictEqual(ev.entityType, 'charmed')
assert.strictEqual(ev.owner, 'You')

a.process({ kind: 'uncharm', mob: 'an_orc', ts: 5 })
ev = a.process({ kind: 'damage', attacker: 'an_orc', target: 'another_mob', amount: 17, ts: 6 })
assert.strictEqual(ev.entityType, undefined)

console.log('Attribution regression tests passed')
