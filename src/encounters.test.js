const assert = require('node:assert/strict')
const { EncounterEngine } = require('./encounters')

const e = new EncounterEngine({ timeoutMs: 12000, targetSwitchMs: 3500 })

const ev = (ts, kind, fields = {}) => ({ ts, seq: ts, kind, ...fields })

// Same target remains one encounter across a quiet period shorter than timeout.
e.onEvent(ev(1000, 'damage', { attacker: 'You', target: 'Goblin', amount: 10 }), true)
e.onEvent(ev(5000, 'damage', { attacker: 'You', target: 'Goblin', amount: 20 }), true)
assert.equal(e.snapshot().encounters.length, 1)
assert.equal(e.snapshot().active.damage, 30)

// A DoT tick on the previous target keeps an add/switch in the same encounter.
e.onEvent(ev(7000, 'damage', { attacker: 'You', target: 'Goblin', amount: 5, overTime: true }), true)
e.onEvent(ev(9000, 'damage', { attacker: 'You', target: 'Orc', amount: 15 }), true)
assert.equal(e.snapshot().encounters.length, 1)
assert.deepEqual(e.snapshot().active.targets.map(x => x.name).sort(), ['Goblin', 'Orc'])

// Once every previous target has been quiet beyond the switch window, a new target splits.
e.onEvent(ev(14000, 'damage', { attacker: 'You', target: 'Troll', amount: 25 }), true)
assert.equal(e.snapshot().encounters.length, 2)
assert.equal(e.snapshot().active.target, 'Troll')

// Death closes the encounter and a late tick for that dead target must not reopen it.
e.onEvent(ev(15000, 'death', { target: 'Troll' }), true)
assert.equal(e.snapshot().active, null)
e.onEvent(ev(16000, 'damage', { attacker: 'You', target: 'Troll', amount: 3, overTime: true }), true)
assert.equal(e.snapshot().encounters.length, 2)

// Player death closes an active encounter.
e.onEvent(ev(20000, 'damage', { attacker: 'Orc', target: 'You', amount: 40 }), true)
e.onEvent(ev(21000, 'playerDeath', { target: 'You' }), true)
assert.equal(e.snapshot().active, null)
assert.equal(e.snapshot().encounters.at(0).endReason, 'player-death')

// Zone changes never leak state into the next zone.
e.onEvent(ev(22000, 'zone', { zone: 'Plane of Hate' }), true)
e.onEvent(ev(23000, 'damage', { attacker: 'You', target: 'A', amount: 1 }), true)
assert.equal(e.snapshot().active.zone, 'Plane of Hate')

console.log('Encounter tests passed')
