const LINE_RE = /^\[(.+?)\]\s?(.*)$/

function parseEqTimestamp(stamp) {
  const m = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})$/.exec(stamp.trim())
  if (!m) {
    const t = Date.parse(stamp)
    return Number.isNaN(t) ? 0 : t
  }
  const [, mon, day, time, year] = m
  const t = Date.parse(`${mon} ${day} ${year} ${time}`)
  return Number.isNaN(t) ? 0 : t
}

function parseLine(raw) {
  const m = LINE_RE.exec(raw)
  if (!m) return null
  return { ts: parseEqTimestamp(m[1]), text: m[2], raw }
}

function norm(name) {
  const n = name.trim()
  const l = n.toLowerCase()
  if (l === 'you' || l === 'yourself' || l === 'your') return 'You'
  return n
}

function idKey(name) {
  const n = name.trim().toLowerCase()
  if (n === 'you' || n === 'yourself' || n === 'your') return 'you'
  return n
}

const RANK_TAIL_RE = / (?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/
const CANON_CACHE = new Map()
const CANON_CACHE_MAX = 20000
function spellCanonKey(spell) {
  const hit = CANON_CACHE.get(spell)
  if (hit !== undefined) return hit
  const key = spell.trim().replace(RANK_TAIL_RE, '').trim().toLowerCase()
  if (CANON_CACHE.size < CANON_CACHE_MAX) CANON_CACHE.set(spell, key)
  return key
}

function cleanMob(s) {
  if (!s) return undefined
  return s.replace(/['`’]s$/i, '').trim() || undefined
}

function looksDamage(text) {
  return /\bfor \d+ points? of|\bhas taken \d+ damage/.test(text)
}

const MELEE_VERBS =
  'hit(?:s)?|slash(?:es)?|pierce(?:s)?|crush(?:es)?|bash(?:es)?|kick(?:s)?|bite(?:s)?|claw(?:s)?|gore(?:s)?|maul(?:s)?|punch(?:es)?|strike(?:s)?|slice(?:s)?|backstab(?:s)?|slam(?:s)?|sting(?:s)?|rend(?:s)?|smash(?:es)?|gnaw(?:s)?|lash(?:es)?|smite(?:s)?|cleave(?:s)?|reave(?:s)?|shoot(?:s)?|frenzies on|frenzy on|flurries|flurry'

// Capture the actual melee verb. The previous parser used a non-capturing
// group here and then tried to recover the verb with a second regex, which
// made the capture indexes inconsistent with the modifiers capture.
const MELEE_RE = new RegExp(`^(.+?) (${MELEE_VERBS}) (.+?) for (\\d+) points? of damage\\.(?: \\((.+?)\\))?$`)
const SPELL_RE = /^(.+?) (?:hits?) (.+?) for (\d+) points of ([\w-]+) damage by (.+?)\.(?: \((.+?)\))?$/
const DOT_RE = /^(.+?) has taken (\d+) damage from (.+?)\.(?: \((.+?)\))?$/
const HEAL_RE = /^(.+?) healed (.+?)( over time)? for (\d+)(?: \((\d+))? hit points?(?: by (.+?))?\.(?: \(([A-Za-z][A-Za-z ]*)\))?$/
const MISS_RE = new RegExp(
  '^(.+?) tr(?:y|ies) to \\w+ (?:on )?(.+?), but ' +
    '(?:(miss|misses)' +
    '|(.+?) (parries|dodges|ripostes|blocks)' +
    '|(YOU) (parry|dodge|riposte|block)' +
    "|.+?'s magical skin (absorbs) the blow" +
    '|(YOUR) magical skin absorbs the blow)' +
    '!(?: \\([A-Za-z]+\\))?$'
)
const RESIST_YOURS_RE = /^(.+?) resisted your (.+?)!$/
const RESIST_CASTER_RE = /^(.+?) resisted (.+?)'s (.+?)!$/
const RESIST_INCOMING_RE = /^You resist(?:ed)? (.+?)'s (.+?)!$/
const ZONE_RE = /^You have entered (.+?)\.$/
const PSEUDO_ZONE_RE = /^an area where /i
const SLAIN_SELF_RE = /^You have slain (.+?)!$/
const SLAIN_BY_RE = /^(.+?) has been slain by (.+?)!$/
const PLAYER_DEATH_RE = /^You have been slain by (.+?)!$/
const MOB_DIED_RE = /^(.+?) died\.$/

const TIER_ADJ = { awakened: 1, adaptive: 2, fused: 3, refined: 4 }
const TIER_LABELS = ['d0', 'd1 · Awakened', 'd2 · Adaptive', 'd3 · Fused', 'd4 · Refined']
const INSTANCE_SUFFIX_RE = /\s-\s*(Solo|Group)\b/i
const TIER_UNKNOWN = -1
const TIER_OPEN_WORLD = 0

function zoneTier(zone) {
  const base = zone
    .replace(/\s*-\s*(Solo|Group)\b.*$/i, '')
    .replace(/\s+\d+\s*\([^)]*\)\s*$/, '')
    .replace(/\s+\([^)]*\)\s*$/, '')
    .trim()
  const adj = /\(([A-Za-z]+)\)\s*$/.exec(zone)
  if (adj) return { base, tier: TIER_ADJ[adj[1].toLowerCase()] ?? TIER_UNKNOWN }
  if (INSTANCE_SUFFIX_RE.test(zone)) return { base, tier: 0 }
  return { base, tier: base ? TIER_OPEN_WORLD : TIER_UNKNOWN }
}
const LEVEL_RE = /^You have gained a level! Welcome to level (\d+)!$/
const EXP_RE = /^You gain (party )?experience!(?: \(([\d.]+)%\))?$/
const CAST_BEGIN_RE = /^You begin (casting|singing) (.+?)\.$/
const CAST_FIZZLE_RE = /^Your (.+?) spell fizzles!$/
const CAST_INTERRUPT_RE = /^Your (.+?) spell is interrupted\.$/
const CAST_RESUMED_LINE = 'You regain your concentration and continue your casting.'
const BUFF_FADE_SELF_RE = /^Your (.+?) spell has worn off\.$/
const BUFF_FADE_PET_RE = /^Your pet's (.+?) spell has worn off\.$/
const UNCHARM_RE = /^Your (.+?) spell has worn off of (.+?)\.$/
const CHARM_RE = /^(.+?) has been charmed\.$/
const CC_APPLY_RE = /^(.+?) has been (mesmerized|enthralled|entranced|ensnared)\.$/
const CC_WAKE_RE = /^(.+?) has been awakened by (.+?)\.$/
const PET_CLAIM_RE = /^(.+?) told you, '(?:Attacking .+ Master|I am unable to wake .+?, Master)\.'$/
const AA_ACTIVATE_RE = /^You activate (.+?)\.$/
const STANCE_RE = /^You assume an? (.+?) stance\.$/
const INVOCATION_RE = /^You begin reciting the (.+?) invocation\.$/
const YOU_DIED = 'You died.'
const LOOT_RE = /^--You have looted (?:(\d+) |an? )?(.+?)(?: from (.+?) corpse)?\.--$/
const LOOT_RE_PLAIN = /^You have looted (?:(\d+) |an? )?(.+?)(?: from (.+?) corpse)?\.$/
const DESTROY_RE = /^You successfully destroyed (\d+) (.+?)\.$/
const OFFER_RE = /^You offered [\d,]+ (.+?) to (.+?)\.$/
const TRADE_DONE_RE = /^You complete the trade with (.+?)\.$/
const AA_RE = /^You have gained (an|\d+) ability point(?:\(s\))?!\s+You now have (\d+) ability point/
const AA_SPEND_RE = / at a cost of (\d+) ability points?\.$/
const AA_ABILITY_RE = /gained the ability (?:"([^"]+)"|to use (.+?)) at a cost of/
const AA_IMPROVED_RE = /^You have improved (.+?) (\d+) at a cost of/
const AA_POTION_LANDING = 'You are filled with the spirit of alternate adventure.'
const MEND_RE = /^You mend your wounds and heal some damage\.$/

const WELCOME_LINE = 'Welcome to EverQuest Legends!'
const CAMP_START_LINE = 'It will take you about 30 seconds to prepare your camp.'
const CAMP_ABORT_LINE = 'You abandon your preparations to camp.'
const OUTPUT_FILE_PREFIX = 'Outputfile Complete: '

const RUNE_GAIN_RE = /^You gain a rune for (\d+) points? of absorption\.$/
const SKIN_ABSORB_DS_RE = /^YOUR magical skin absorbs the damage of (.+?)'s .+\.$/
const DS_RE = /^(.+?) is \w+ by (YOUR|.+?'s) (.+?) for (\d+) points? of non-melee damage\.$/
const DS_INC_RE = /^YOU are \w+ by (.+?)'s (.+?) for (\d+) points? of non-melee damage!$/

const PET_SAY_RE = /^(.+?) says, '(.+?)'$/
const PET_SAY_LINES = [
  ['follow', 'Following you, Master.'],
  ['regroup', 'Regrouping with you, Master.'],
  ['calm', 'Sorry, Master... calming down.'],
  ['hold', 'I will guard this area, Master.'],
  ['comply', 'As you wish, oh great one.'],
  ['illegalTarget', 'I am unable to wake'],
]
const PET_LEADER_RE = /^(.+?) says, 'My leader is (.+?)\.'$/

const POISON_DRY_LINES = {
  'The poison dries from the blade.': 'neurotoxic',
  'The venom drips away.': 'paralytic',
}
const POISON_COAT_MSGS = new Map([
  ['You coat your blades in a neurotoxic poison.', { name: 'Neurotoxin', group: 'neurotoxic' }],
  ['You coat your blades in a stunning poison.', { name: 'Stunning Agent', group: 'stunning' }],
  ['You coat your blades in a weak paralytic poison.', { name: 'Weak Paralytic', group: 'paralytic' }],
])
const POISON_COAT_OTHER_NAMED_RE = /^(.+?) coats their blades in (.+?)!$/
const POISON_COAT_OTHER_GENERIC_RE = /^(.+?) coats their blades in poison!$/

const EMOTE_SELF_RE = /^You (?:feel|look|sense|seem)\b[^.]*\.$/
const EMOTE_PET_RE = /^([A-Z][A-Za-z'`]*(?: [A-Za-z'`]+)*) (?:feels|looks|seems)\b[^.]*\.$/

const LOOT_CURRENCY_RE = /^You looted (?:(\d+) |an? )?(.+?) from (.+?) corpse and stored it in your currency\.?$/
const LOOT_SOLD_RE = /^You looted (?:(\d+) |an? )?(.+?) from (.+?) corpse and sold it for (?:free|[\d,]+ (?:platinum|gold|silver|copper).*?)\.?$/
const LOOT_STORED_RE = /^You looted (?:(\d+) |an? )?(.+?) from (.+?) corpse and stored it in your (Dragon Hoard|tradeskill depot)\.?$/
const LOOT_COMBINE_RE = /^You looted (?:(\d+) |an? )?(.+?) from (.+?) corpse to create (?:an? )?(.+?)\.?$/

const ITEM_MERGE_RE = /^You have successfully merged two items together to create a new item: (.+)$/
const ITEM_MERGE_FAIL_RE = /^Your request to merge (.+?) with (.+?) failed\. /
const WEAK_MOTE_LINE = 'The item you are trying to add will not work, this mote is not sufficiently powerful to upgrade this item.'
const SELF_FUSE_LINE = 'The item you are trying to add will not work, you cannot fuse an item to itself.'
const WRONG_TYPE_LINE = 'The item you are trying to add will not work, you cannot merge two different types of items.'
const MERGE_CANCEL_LINE = 'Request to merge items canceled, both items remain unmodified.'

const WHO_ROW_RE = /^\s*(?:\* RIP \*\s*)?(?:AFK\s+)?\[(\d+) ([A-Z]{3}(?:\/[A-Z]{3})*)\] (.+?)(?: \(([^)]*)\))?(?: <([^>]*)>)?\s+ZONE: (.+?)\s*$/
const SKILL_UP_RE = /^You have become better at (.+?)!(?: \((\d+)\))?$/
const SPECIAL_ATTACK_RE = /^You will now use (.+?)(?: instead of (.+?))? while (auto )?attacking\.$/
const ITEM_ACTIVATE_RE = /^Your (.+?) (shimmers briefly|feels alive with power)\.$/
const CLASS_UNLOCK_PREFIX = 'You have completed achievement: Primary Class Unlock - '

const MEMORIZE_BEGIN_RE = /^Beginning to memorize (.+?)\.\.\.$/
const MEMORIZE_DONE_RE = /^You have finished memorizing (.+?)\.$/
const FORGET_RE = /^You forget (.+?)\.$/
const SPELL_SET_RE = /^Spell set (.+?) (saved|loaded|deleted)\.$/
const ILLUSION_FADE_LINE = 'Your illusion fades.'

const COIN_TOKEN_RE = /(\d[\d,]*) (platinum|gold|silver|copper)/g
const COIN_SEPARATORS_RE = /^[\s,]*(?:and[\s,]*)*$/
const COIN_CORPSE_RE = /^You receive (.+?) from the corpse\.$/
const COIN_ITEM_RE = /^You received (.+?) from that item\.$/
const COIN_VENDOR_RE = /^You receive (.+?) from (.+?) for the (.+)\(s\)\.$/
const COIN_BARE_RE = /^You received? (.+?)\s*\.$/
const ITEM_INVENTORY_RE = /^(.+?) has been placed in your inventory!$/
const ITEM_OVERFLOW_RE = /^Your inventory is full\. (.+?) has been added to your overflow items!/
const ITEM_FASHIONED_RE = /^You have fashioned the items together to create something new: (.+?)\.$/
const PURCHASE_RE = /^You purchased (\d+) (.+?) from (.+?) for (.*)\.$/

const CORPSE_SUFFIX_RE = /['`’]s corpse$/
const WHO_ZONE_SHORTNAME_RE = /\s*\([a-z0-9_]+\)$/
const CHAT_QUOTE_MARKER = "', '"

const CONSIDER_FACTION_RUNGS = [
  { phrase: 'appears to be', faction: 'neutral' },
  { phrase: 'seems', faction: 'neutral' },
  { phrase: 'looks', faction: 'neutral' },
  { phrase: 'seems to be', faction: 'neutral' },
  { phrase: 'appears', faction: 'neutral' },
  { phrase: 'is', faction: 'neutral' },
  { phrase: 'looks to be', faction: 'neutral' },
  { phrase: 'is approximately', faction: 'neutral' },
  { phrase: 'is about', faction: 'neutral' },
  { phrase: 'seems about', faction: 'neutral' },
  { phrase: 'appears about', faction: 'neutral' },
  { phrase: 'is roughly', faction: 'neutral' },
  { phrase: 'seems roughly', faction: 'neutral' },
  { phrase: 'appears roughly', faction: 'neutral' },
]
const CONSIDER_RE = new RegExp(
  '^(.+?)( - a rare creature -)? (' +
    CONSIDER_FACTION_RUNGS.map((r) => r.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
    ') -- (.+?)\s*\(Lvl: (\d+)\)$'
)

function meleeSkill(verb) {
  const v = verb.toLowerCase()
  if (v.startsWith('backstab')) return 'Backstab'
  if (v.startsWith('bash')) return 'Bash'
  if (v.startsWith('kick')) return 'Kick'
  if (v.startsWith('cleav')) return 'Cleave'
  if (v.startsWith('smite')) return 'Smite'
  if (v.startsWith('shoot')) return 'Ranged'
  if (v.startsWith('strike')) return 'Strike'
  if (v.startsWith('frenz')) return 'Frenzy'
  if (v.startsWith('flurr')) return 'Flurry'
  return 'Melee'
}

function meleeVerbBase(verb) {
  const v = verb.toLowerCase()
  if (v.startsWith('frenz')) return 'frenzy'
  if (v.startsWith('flurr')) return 'flurry'
  const bases = new Set(['hit','slash','pierce','crush','bash','kick','bite','claw','gore','maul','punch','strike','slice','backstab','slam','sting','rend','smash','gnaw','lash','smite','cleave','reave','shoot','frenzy','flurry'])
  if (bases.has(v)) return v
  if (v.endsWith('es') && bases.has(v.slice(0, -2))) return v.slice(0, -2)
  if (v.endsWith('s') && bases.has(v.slice(0, -1))) return v.slice(0, -1)
  return v
}

function parseCoins(clause) {
  const coins = {}
  let rest = ''
  let last = 0
  let found = 0
  for (const m of clause.matchAll(COIN_TOKEN_RE)) {
    const at = m.index
    rest += clause.slice(last, at)
    last = at + m[0].length
    const amount = Number(m[1].replace(/,/g, ''))
    const denom = m[2]
    if (!Number.isFinite(amount) || coins[denom] !== undefined) return null
    coins[denom] = amount
    found++
  }
  if (found === 0) return null
  rest += clause.slice(last)
  return COIN_SEPARATORS_RE.test(rest) ? coins : null
}

function parseModifiers(str) {
  if (!str) return []
  return str.split(/[\s,]+/).filter(Boolean)
}

function hasCritical(mods) {
  return mods.some(m => m.toLowerCase() === 'critical')
}

const CLASSIFIERS = [
  function classifyMiss(c) {
    const { text } = c
    if (text.includes(', but ') && (text.startsWith('You try to ') || text.includes(' tries to '))) {
      const m = MISS_RE.exec(text)
      if (m) {
        const attacker = norm(m[1])
        let mtype, target
        if (m[3]) { mtype = 'miss'; target = norm(m[2]) }
        else if (m[5]) {
          mtype = m[5] === 'parries' ? 'parry' : m[5] === 'dodges' ? 'dodge' : m[5] === 'ripostes' ? 'riposte' : 'block'
          target = norm(m[4])
        } else if (m[7]) { mtype = m[7]; target = 'You' }
        else if (m[9]) { mtype = 'absorb'; target = 'You' }
        else { mtype = 'absorb'; target = norm(m[2]) }
        const verbM = / tr(?:y|ies) to (\w+)/.exec(text)
        const modM = / \(([A-Za-z]+)\)$/.exec(text)
        const mods = modM ? parseModifiers(modM[1]) : []
        return { kind: 'miss', seq: c.seq, ts: c.ts, raw: c.raw, attacker, target, mtype, verb: verbM ? meleeVerbBase(verbM[1]) : undefined, modifiers: mods.length ? mods : undefined }
      }
    }
    return null
  },
  function classifyDamage(c) {
    const { text } = c
    if (text.includes('points of') || text.includes('point of')) {
      let m = SPELL_RE.exec(text)
      if (m) {
        const mods = parseModifiers(m[6])
        return { kind: 'damage', seq: c.seq, ts: c.ts, raw: c.raw, attacker: norm(m[1]), target: norm(m[2]), amount: Number(m[3]), dtype: 'spell', dclass: m[4], skill: m[5].trim(), crit: hasCritical(mods), modifiers: mods }
      }
      m = MELEE_RE.exec(text)
      if (m) {
        const verb = meleeVerbBase(m[2])
        const mods = parseModifiers(m[5])
        return { kind: 'damage', seq: c.seq, ts: c.ts, raw: c.raw, attacker: norm(m[1]), target: norm(m[3]), amount: Number(m[4]), dtype: 'melee', skill: meleeSkill(verb), verb, crit: hasCritical(mods), modifiers: mods }
      }
    }
    if (text.includes('has taken')) {
      let m = DOT_RE.exec(text)
      if (m) {
        const target = norm(m[1])
        const amount = Number(m[2])
        let attacker = null
        let skill = m[3]
        if (/^your /i.test(m[3])) {
          attacker = 'You'
          skill = m[3].replace(/^your /i, '')
        } else {
          const by = / by (.+)$/.exec(m[3])
          if (by) { attacker = norm(by[1]); skill = m[3].slice(0, by.index) }
        }
        if (attacker !== null) {
          const mods = parseModifiers(m[4])
          return { kind: 'damage', seq: c.seq, ts: c.ts, raw: c.raw, attacker, target, amount, dtype: 'dot', skill: skill.trim(), crit: /critical/i.test(m[4] || ''), modifiers: mods }
        }
      }
      m = /^(.+?) has taken (\d+) damage by (.+?)\.(?: \((.+?)\))?$/.exec(text)
      if (m) {
        return { kind: 'damage', seq: c.seq, ts: c.ts, raw: c.raw, attacker: null, target: norm(m[1]), amount: Number(m[2]), dtype: 'dot', skill: m[3].trim(), crit: /critical/i.test(m[4] || ''), modifiers: m[4] ? parseModifiers(m[4]) : [] }
      }
    }
    return null
  },
  function classifyHeal(c) {
    const { text } = c
    if (text.startsWith('You mend') && MEND_RE.test(text)) {
      return { kind: 'healUnstated', seq: c.seq, ts: c.ts, raw: c.raw, skill: 'Mend', target: 'You' }
    }
    if (text.includes(' healed ')) {
      const m = HEAL_RE.exec(text)
      if (m) {
        const healer = norm(m[1])
        const tRaw = m[2].trim()
        const reflexive = /^(itself|himself|herself|themselves)$/i.test(tRaw)
        return { kind: 'heal', seq: c.seq, ts: c.ts, raw: c.raw, target: reflexive ? healer : norm(tRaw), amount: Number(m[4]), rawAmount: m[5] ? Number(m[5]) : undefined, spell: m[6] ? m[6].trim() : undefined, healer, crit: /critical/i.test(m[7] || ''), overTime: !!m[3] }
      }
    }
    return null
  },
  function classifyResist(c) {
    const { text } = c
    if (text.includes('resist') && !text.includes('points of') && text.endsWith('!')) {
      if (text.startsWith('You resist')) {
        const m = RESIST_INCOMING_RE.exec(text)
        if (m) return { kind: 'resist', seq: c.seq, ts: c.ts, raw: c.raw, caster: norm(m[1]), target: 'You', spell: m[2].trim(), incoming: true }
      } else {
        let m = RESIST_YOURS_RE.exec(text)
        if (m) return { kind: 'resist', seq: c.seq, ts: c.ts, raw: c.raw, caster: 'you', target: norm(m[1]), spell: m[2].trim(), incoming: false }
        m = RESIST_CASTER_RE.exec(text)
        if (m) return { kind: 'resist', seq: c.seq, ts: c.ts, raw: c.raw, caster: norm(m[2]), target: norm(m[1]), spell: m[3].trim(), incoming: false }
      }
    }
    return null
  },
  function classifyZone(c) {
    if (c.text.includes('entered')) {
      const m = ZONE_RE.exec(c.text)
      if (m && !c.text.startsWith('an area where')) return { kind: 'zone', seq: c.seq, ts: c.ts, raw: c.raw, zone: m[1].trim() }
    }
    return null
  },
  function classifyDeath(c) {
    const { text } = c
    if (text === YOU_DIED) return { kind: 'playerDeath', seq: c.seq, ts: c.ts, raw: c.raw }
    if (text.includes('slain')) {
      const pd = PLAYER_DEATH_RE.exec(text)
      if (pd) return { kind: 'playerDeath', seq: c.seq, ts: c.ts, raw: c.raw, killer: pd[1].trim() }
      let m = SLAIN_SELF_RE.exec(text)
      if (m) return { kind: 'death', seq: c.seq, ts: c.ts, raw: c.raw, name: norm(m[1]), bySelf: true }
      m = SLAIN_BY_RE.exec(text)
      if (m) return { kind: 'death', seq: c.seq, ts: c.ts, raw: c.raw, name: norm(m[1]), bySelf: false, killer: m[2].trim() }
    }
    if (text.endsWith(' died.')) {
      const m = MOB_DIED_RE.exec(text)
      if (m) return { kind: 'death', seq: c.seq, ts: c.ts, raw: c.raw, name: norm(m[1]), bySelf: false }
    }
    return null
  },
  function classifyLevel(c) {
    if (c.text.includes('gained a level')) {
      const m = LEVEL_RE.exec(c.text)
      if (m) return { kind: 'level', seq: c.seq, ts: c.ts, raw: c.raw, level: Number(m[1]) }
    }
    return null
  },
  function classifyExp(c) {
    if (c.text.startsWith('You gain ')) {
      const m = EXP_RE.exec(c.text)
      if (m) {
        const party = m[1] !== undefined
        return m[2] === undefined ? { kind: 'expGain', seq: c.seq, ts: c.ts, raw: c.raw, party } : { kind: 'expGain', seq: c.seq, ts: c.ts, raw: c.raw, party, pct: Number(m[2]) }
      }
    }
    return null
  },
  function classifyCastLifecycle(c) {
    const { text } = c
    if (text.startsWith('You begin ')) {
      const m = CAST_BEGIN_RE.exec(text)
      if (m) return { kind: 'castBegin', seq: c.seq, ts: c.ts, raw: c.raw, spell: m[2].trim(), sung: m[1] === 'singing' }
    }
    if (text.includes(' begins casting ') || text.includes(' begins singing ')) {
      const m = /^(.+?) begins (?:casting|singing) (.+?)\.$/.exec(text)
      if (m && norm(m[1]) !== 'You') return { kind: 'otherCastBegin', seq: c.seq, ts: c.ts, raw: c.raw, caster: norm(m[1]), spell: m[2].trim() }
    }
    if (text.includes('spell fizzles!')) {
      const m = CAST_FIZZLE_RE.exec(text)
      if (m) return { kind: 'castFizzle', seq: c.seq, ts: c.ts, raw: c.raw, spell: m[1].trim() }
    }
    if (text.includes('spell is interrupted.')) {
      const m = CAST_INTERRUPT_RE.exec(text)
      if (m) return { kind: 'castInterrupted', seq: c.seq, ts: c.ts, raw: c.raw, spell: m[1].trim() }
    }
    if (text === CAST_RESUMED_LINE) return { kind: 'castResumed', seq: c.seq, ts: c.ts, raw: c.raw }
    return null
  },
  function classifyWornOff(c) {
    const { text } = c
    if (text.includes('worn off of')) {
      const m = UNCHARM_RE.exec(text)
      if (m) return { kind: 'uncharm', seq: c.seq, ts: c.ts, raw: c.raw, mob: norm(m[2]), spell: m[1].trim() }
    } else if (text.includes('worn off.')) {
      let m = BUFF_FADE_PET_RE.exec(text)
      if (m) return { kind: 'buffFade', seq: c.seq, ts: c.ts, raw: c.raw, spell: m[1].trim(), target: 'pet' }
      m = BUFF_FADE_SELF_RE.exec(text)
      if (m) return { kind: 'buffFade', seq: c.seq, ts: c.ts, raw: c.raw, spell: m[1].trim() }
    }
    return null
  },
  function classifyCcApply(c) {
    if (c.text.includes('has been ')) {
      const m = CC_APPLY_RE.exec(c.text)
      if (m) return { kind: 'cc', seq: c.seq, ts: c.ts, raw: c.raw, mob: norm(m[1]), verb: m[2] }
    }
    return null
  },
  function classifyCcWake(c) {
    if (!c.text.includes(' has been awakened by ')) return null
    const m = CC_WAKE_RE.exec(c.text)
    if (m) return { kind: 'ccWake', seq: c.seq, ts: c.ts, raw: c.raw, mob: norm(m[1]), by: norm(m[2]) }
    return null
  },
  function classifyCharm(c) {
    if (c.text.includes('has been charmed')) {
      const m = CHARM_RE.exec(c.text)
      if (m) return { kind: 'charm', seq: c.seq, ts: c.ts, raw: c.raw, mob: norm(m[1]) }
    }
    return null
  },
  function classifyPetClaim(c) {
    if (c.text.includes(" told you, '")) {
      const m = PET_CLAIM_RE.exec(c.text)
      if (m) return { kind: 'petClaim', seq: c.seq, ts: c.ts, raw: c.raw, name: norm(m[1]), via: 'tell' }
    }
    return null
  },
  function classifyPetSay(c) {
    if (!c.text.includes(" says, '")) return null
    const m = /^(.+?) says, '(.+?)'$/.exec(c.text)
    if (!m) return null
    const sayText = m[2]
    const map = new Map([
      ['Following you, Master.', 'follow'],
      ['Sorry, Master... calming down.', 'calm'],
      ['As you wish, oh great one.', 'comply'],
      ['I am unable to wake', 'illegalTarget'],
      ['Regrouping with you, Master.', 'regroup'],
      ['I will guard this area, Master.', 'hold'],
    ])
    const say = map.get(sayText)
    if (say) return { kind: 'petSay', seq: c.seq, ts: c.ts, raw: c.raw, name: norm(m[1]), say }
    return null
  },
  function classifyPetLeader(c) {
    if (!c.text.includes(" says, 'My leader is ")) return null
    const m = PET_LEADER_RE.exec(c.text)
    if (!m) return null
    const leader = m[2].trim()
    if (leader.toLowerCase() === 'you') return { kind: 'petClaim', seq: c.seq, ts: c.ts, raw: c.raw, name: norm(m[1]), via: 'leader' }
    return { kind: 'allyPetLeader', seq: c.seq, ts: c.ts, raw: c.raw, pet: norm(m[1]), owner: norm(leader) }
  },
  function classifyAaActivate(c) {
    if (c.text.startsWith('You activate ')) {
      const m = AA_ACTIVATE_RE.exec(c.text)
      if (m) return { kind: 'aaActivate', seq: c.seq, ts: c.ts, raw: c.raw, name: m[1].trim() }
    }
    return null
  },
  function classifyStance(c) {
    if (c.text.startsWith('You assume ')) {
      const m = STANCE_RE.exec(c.text)
      if (m) return { kind: 'stanceChange', seq: c.seq, ts: c.ts, raw: c.raw, stance: m[1].trim().toLowerCase() }
    }
    if (c.text.startsWith('You begin reciting ')) {
      const m = INVOCATION_RE.exec(c.text)
      if (m) return { kind: 'invocationChange', seq: c.seq, ts: c.ts, raw: c.raw, invocation: m[1].trim().toLowerCase() }
    }
    return null
  },
  function classifyLoot(c) {
    const { text } = c
    if (text.startsWith('You successfully destroyed ')) {
      const m = DESTROY_RE.exec(text)
      if (m) return { kind: 'loot', seq: c.seq, ts: c.ts, raw: c.raw, item: m[2].trim(), disposition: 'destroyed', count: Number(m[1]) }
    }
    // Specific loot messages must be checked before the generic looted regex.
    if (text.startsWith('You looted ')) {
      const cur = LOOT_CURRENCY_RE.exec(text)
      if (cur) return { kind: 'loot', seq: c.seq, ts: c.ts, raw: c.raw, item: cur[2].trim(), source: cur[3].trim(), count: cur[1] ? Number(cur[1]) : undefined, disposition: 'currency' }
      const sold = LOOT_SOLD_RE.exec(text)
      if (sold) return { kind: 'loot', seq: c.seq, ts: c.ts, raw: c.raw, item: sold[2].trim(), source: sold[3].trim(), count: sold[1] ? Number(sold[1]) : undefined, disposition: 'sold' }
      const stored = LOOT_STORED_RE.exec(text)
      if (stored) return { kind: 'loot', seq: c.seq, ts: c.ts, raw: c.raw, item: stored[2].trim(), source: stored[3].trim(), count: stored[1] ? Number(stored[1]) : undefined, disposition: stored[4] === 'Dragon Hoard' ? 'hoard' : 'depot' }
      const combine = LOOT_COMBINE_RE.exec(text)
      if (combine) return { kind: 'loot', seq: c.seq, ts: c.ts, raw: c.raw, item: combine[2].trim(), source: combine[3].trim(), count: combine[1] ? Number(combine[1]) : undefined, disposition: 'combined', created: combine[4]?.trim() }
      const m = LOOT_RE.exec(text) || LOOT_RE_PLAIN.exec(text)
      if (m) return { kind: 'loot', seq: c.seq, ts: c.ts, raw: c.raw, item: m[2].trim(), source: m[3] ? m[3].replace(/'s corpse$/, '').trim() : undefined, count: m[1] ? Number(m[1]) : undefined }
    }
    return null
  },
  function classifyItemMerge(c) {
    const { text } = c
    if (text.startsWith('You have successfully merged ')) {
      const m = ITEM_MERGE_RE.exec(text)
      if (m) return { kind: 'itemMerge', seq: c.seq, ts: c.ts, raw: c.raw, item: m[1].trim() }
    }
    if (text.startsWith('Your request to merge ')) {
      const m = ITEM_MERGE_FAIL_RE.exec(text)
      if (!m) return null
      const reason = text.includes(WEAK_MOTE_LINE) ? 'weakMote' : text.includes(SELF_FUSE_LINE) ? 'selfFuse' : text.includes(WRONG_TYPE_LINE) ? 'wrongType' : text.includes(MERGE_CANCEL_LINE) ? 'canceled' : 'mismatch'
      return { kind: 'itemMergeFailed', seq: c.seq, ts: c.ts, raw: c.raw, reason, target: m[1]?.trim(), component: m[2]?.trim() }
    }
    return null
  },
  function classifyTurnIn(c) {
    if (c.text.includes('offered')) {
      const m = OFFER_RE.exec(c.text)
      if (m) return { kind: 'offer', seq: c.seq, ts: c.ts, raw: c.raw, item: m[1].trim(), npc: m[2].trim() }
    }
    if (c.text.includes('complete the trade')) {
      const m = TRADE_DONE_RE.exec(c.text)
      if (m) return { kind: 'trade', seq: c.seq, ts: c.ts, raw: c.raw, npc: m[1].trim() }
    }
    return null
  },
  function classifyAa(c) {
    if (c.text.includes('ability point')) {
      const g = AA_RE.exec(c.text)
      if (g) return { kind: 'aaGain', seq: c.seq, ts: c.ts, raw: c.raw, amount: g[1] === 'an' ? 1 : Number(g[1]), nowHave: Number(g[2]) }
      const cst = AA_SPEND_RE.exec(c.text)
      if (cst) {
        const cost = Number(cst[1])
        const imp = AA_IMPROVED_RE.exec(c.text)
        if (imp) return { kind: 'aaSpend', seq: c.seq, ts: c.ts, raw: c.raw, ability: `${imp[1].trim()} ${imp[2]}`, cost, rank: Number(imp[2]) }
        const a = AA_ABILITY_RE.exec(c.text)
        const ability = (a && (a[1] || a[2])) ? (a[1] || a[2]).trim() : 'ability'
        return { kind: 'aaSpend', seq: c.seq, ts: c.ts, raw: c.raw, ability, cost }
      }
    }
    if (c.text === AA_POTION_LANDING) return { kind: 'aaPotion', seq: c.seq, ts: c.ts, raw: c.raw }
    return null
  },
  function classifySessionStart(c) {
    if (c.text === 'Welcome to EverQuest Legends!') return { kind: 'sessionStart', seq: c.seq, ts: c.ts, raw: c.raw }
    return null
  },
  function classifyMitigation(c) {
    const { text } = c
    if (text.startsWith('You gain a rune for ')) {
      const m = RUNE_GAIN_RE.exec(text)
      if (m) return { kind: 'mitigation', seq: c.seq, ts: c.ts, raw: c.raw, mtype: 'rune', amount: Number(m[1]) }
    }
    if (text.startsWith('YOUR magical skin absorbs')) {
      const m = SKIN_ABSORB_DS_RE.exec(text)
      if (m) return { kind: 'mitigation', seq: c.seq, ts: c.ts, raw: c.raw, mtype: 'absorbDamageShield', source: norm(m[1].replace(/'s$/, '')) }
    }
    if (text.includes('non-melee damage')) {
      let m = DS_RE.exec(text)
      if (m) {
        const caster = m[2] === 'YOUR' ? 'You' : norm(m[2].replace(/'s$/, ''))
        return { kind: 'mitigation', seq: c.seq, ts: c.ts, raw: c.raw, mtype: 'absorbSwing', source: caster }
      }
      m = DS_INC_RE.exec(text)
      if (m) return { kind: 'mitigation', seq: c.seq, ts: c.ts, raw: c.raw, mtype: 'absorbSwing', source: norm(m[1]) }
    }
    return null
  },
  function classifyConsider(c) {
    if (!c.text.includes('(Lvl: ')) return null
    const m = CONSIDER_RE.exec(c.text)
    if (!m) return null
    const found = CONSIDER_FACTION_RUNGS.find(r => r.phrase === m[3])
    const faction = found ? found.faction : undefined
    if (!faction) return null
    return { kind: 'consider', seq: c.seq, ts: c.ts, raw: c.raw, mob: m[1].trim(), rare: m[2] !== undefined, level: Number(m[5]), faction, difficulty: m[4].trim() }
  },
  function classifyGroup(c) {
    const { text } = c
    if (text === 'You have joined the group.') return { kind: 'group', seq: c.seq, ts: c.ts, raw: c.raw, change: 'selfJoin' }
    if (text === 'You have been removed from the group.') return { kind: 'group', seq: c.seq, ts: c.ts, raw: c.raw, change: 'selfLeave' }
    if (text.includes('has joined the group.')) {
      const m = /^(.+?) has joined the group\.$/.exec(text)
      if (m) return { kind: 'group', seq: c.seq, ts: c.ts, raw: c.raw, change: 'join', name: m[1].trim() }
    }
    if (text.includes('has left the group.')) {
      const m = /^(.+?) has (?:left|been removed from) the group\.$/.exec(text)
      if (m) return { kind: 'group', seq: c.seq, ts: c.ts, raw: c.raw, change: 'leave', name: m[1].trim() }
    }
    if (text.includes('is now the leader of your group.')) {
      const m = /^(.+?) is now the leader of your group\.$/.exec(text)
      if (m) return { kind: 'group', seq: c.seq, ts: c.ts, raw: c.raw, change: 'leader', name: m[1].trim() }
    }
    if (text.includes('invites you to join a group.')) {
      const m = /^(.+?) invites you to join a group\.$/.exec(text)
      if (m) return { kind: 'group', seq: c.seq, ts: c.ts, raw: c.raw, change: 'invite', name: m[1].trim() }
    }
    if (text.includes(' tells the group, ')) {
      const m = /^(.+?) tells the group, '/.exec(text)
      if (m) return { kind: 'group', seq: c.seq, ts: c.ts, raw: c.raw, change: 'confirm', name: m[1].trim() }
    }
    return null
  },
  function classifyCamp(c) {
    const { text } = c
    if (text === CAMP_START_LINE) return { kind: 'campStart', seq: c.seq, ts: c.ts, raw: c.raw }
    if (text === CAMP_ABORT_LINE) return { kind: 'campAbort', seq: c.seq, ts: c.ts, raw: c.raw }
    return null
  },
  function classifyOutputFile(c) {
    if (!c.text.startsWith(OUTPUT_FILE_PREFIX)) return null
    const file = c.text.slice(OUTPUT_FILE_PREFIX.length).trim()
    if (!file) return null
    return { kind: 'outputFile', seq: c.seq, ts: c.ts, raw: c.raw, file }
  },
  function classifyAcquire(c) {
    const { text } = c
    if (text.startsWith('You rece')) {
      const corpse = COIN_CORPSE_RE.exec(text)
      const corpseCoins = corpse ? parseCoins(corpse[1]) : null
      if (corpseCoins) return { kind: 'coin', seq: c.seq, ts: c.ts, raw: c.raw, source: 'corpse', coins: corpseCoins }
      const item = COIN_ITEM_RE.exec(text)
      const itemCoins = item ? parseCoins(item[1]) : null
      if (itemCoins) return { kind: 'coin', seq: c.seq, ts: c.ts, raw: c.raw, source: 'item', coins: itemCoins }
      const vendor = COIN_VENDOR_RE.exec(text)
      const vendorCoins = vendor ? parseCoins(vendor[1]) : null
      if (vendor && vendorCoins) return { kind: 'coin', seq: c.seq, ts: c.ts, raw: c.raw, source: 'vendor', coins: vendorCoins, npc: vendor[2].trim(), item: vendor[3].trim() }
      const bare = COIN_BARE_RE.exec(text)
      const bareCoins = bare ? parseCoins(bare[1]) : null
      if (bareCoins) return { kind: 'coin', seq: c.seq, ts: c.ts, raw: c.raw, source: 'unstated', coins: bareCoins }
      return null
    }
    if (text.startsWith('You purchased ')) {
      const m = PURCHASE_RE.exec(text)
      if (!m) return null
      const clause = m[4].trim()
      const price = clause === '' ? {} : parseCoins(clause)
      if (!price) return null
      return { kind: 'purchase', seq: c.seq, ts: c.ts, raw: c.raw, item: m[2].trim(), count: Number(m[1]), npc: m[3].trim(), price }
    }
    if (text.startsWith('You have fashioned ')) {
      const m = ITEM_FASHIONED_RE.exec(text)
      return m ? { kind: 'itemReceived', seq: c.seq, ts: c.ts, raw: c.raw, item: m[1].trim(), via: 'fashioned' } : null
    }
    if (text.startsWith('Your inventory is full. ')) {
      const m = ITEM_OVERFLOW_RE.exec(text)
      return m ? { kind: 'itemReceived', seq: c.seq, ts: c.ts, raw: c.raw, item: m[1].trim(), via: 'overflow' } : null
    }
    if (text.endsWith(' has been placed in your inventory!') && !text.includes(CHAT_QUOTE_MARKER)) {
      const m = ITEM_INVENTORY_RE.exec(text)
      return m ? { kind: 'itemReceived', seq: c.seq, ts: c.ts, raw: c.raw, item: m[1].trim(), via: 'inventory' } : null
    }
    return null
  },
  function classifySelfWho(c) {
    if (!c.text.includes('ZONE: ')) return null
    const m = WHO_ROW_RE.exec(c.text)
    if (!m) return null
    const name = m[3].trim().replace(CORPSE_SUFFIX_RE, '')
    if (name.toLowerCase() !== 'you') return null
    const ev = { kind: 'selfWho', seq: c.seq, ts: c.ts, raw: c.raw, level: Number(m[1]), classes: m[2].split('/') }
    const race = m[4] ? m[4].trim() : ''
    if (race) ev.race = race
    const zone = m[6].replace(WHO_ZONE_SHORTNAME_RE, '').trim()
    if (zone) ev.zone = zone
    return ev
  },
  function classifySkillUp(c) {
    if (!c.text.startsWith('You have become better at ')) return null
    const m = SKILL_UP_RE.exec(c.text)
    if (!m) return null
    const skill = m[1].trim()
    return m[2] === undefined ? { kind: 'skillUp', seq: c.seq, ts: c.ts, raw: c.raw, skill } : { kind: 'skillUp', seq: c.seq, ts: c.ts, raw: c.raw, skill, value: Number(m[2]) }
  },
  function classifySpecialAttack(c) {
    if (!c.text.startsWith('You will now use ')) return null
    const m = SPECIAL_ATTACK_RE.exec(c.text)
    if (!m) return null
    const skill = m[1].trim()
    if (!skill) return null
    const ev = { kind: 'specialAttack', seq: c.seq, ts: c.ts, raw: c.raw, skill, autoAttack: m[3] !== undefined }
    const replaces = m[2] ? m[2].trim() : undefined
    if (replaces) ev.replaces = replaces
    return ev
  },
  function classifyClassUnlock(c) {
    if (!c.text.startsWith(CLASS_UNLOCK_PREFIX)) return null
    const className = c.text.slice(CLASS_UNLOCK_PREFIX.length).trim()
    if (!className) return null
    return { kind: 'classUnlock', seq: c.seq, ts: c.ts, raw: c.raw, className }
  },
  function classifyItemActivate(c) {
    if (!c.text.startsWith('Your ')) return null
    const m = ITEM_ACTIVATE_RE.exec(c.text)
    if (!m) return null
    const item = m[1].trim()
    if (!item) return null
    return { kind: 'itemActivate', seq: c.seq, ts: c.ts, raw: c.raw, item, effect: m[2] === 'shimmers briefly' ? 'shimmer' : 'alive' }
  },
  function classifyIllusionFade(c) {
    if (c.text === ILLUSION_FADE_LINE) return { kind: 'illusionFade', seq: c.seq, ts: c.ts, raw: c.raw }
    return null
  },
  function classifySpellGems(c) {
    const { text } = c
    if (text.startsWith('Beginning to memorize ')) {
      const m = MEMORIZE_BEGIN_RE.exec(text)
      return m ? { kind: 'memorizeBegin', seq: c.seq, ts: c.ts, raw: c.raw, spell: m[1].trim() } : null
    }
    if (text.startsWith('You have finished memorizing ')) {
      const m = MEMORIZE_DONE_RE.exec(text)
      return m ? { kind: 'memorizeDone', seq: c.seq, ts: c.ts, raw: c.raw, spell: m[1].trim() } : null
    }
    if (text.startsWith('You forget ')) {
      const m = FORGET_RE.exec(text)
      return m ? { kind: 'forget', seq: c.seq, ts: c.ts, raw: c.raw, spell: m[1].trim() } : null
    }
    if (text.startsWith('Spell set ')) {
      const m = SPELL_SET_RE.exec(text)
      return m ? { kind: 'spellSet', seq: c.seq, ts: c.ts, raw: c.raw, name: m[1].trim(), action: m[2] } : null
    }
    return null
  },
  function classifyPoisonCoat(c) {
    const { text } = c
    if (text.startsWith('You coat your blades')) {
      const m = POISON_COAT_MSGS.get(text)
      return m ? { kind: 'poisonCoat', seq: c.seq, ts: c.ts, raw: c.raw, poison: m.name, group: m.group, self: true } : null
    }
    if (text.includes('coats their blades in poison')) {
      const named = POISON_COAT_OTHER_NAMED_RE.exec(text)
      if (named) return { kind: 'poisonCoat', seq: c.seq, ts: c.ts, raw: c.raw, poison: named[2].trim(), self: false, mob: norm(named[1]) }
      const generic = POISON_COAT_OTHER_GENERIC_RE.exec(text)
      if (generic) return { kind: 'poisonCoat', seq: c.seq, ts: c.ts, raw: c.raw, poison: 'poison', self: false, mob: norm(generic[1]) }
    }
    return null
  },
  function classifyPoisonDry(c) {
    const { text } = c
    const group = POISON_DRY_LINES[text]
    if (group) return { kind: 'poisonDry', seq: c.seq, ts: c.ts, raw: c.raw, group }
    return null
  },
  function classifyPoisonProc(c) {
    const m = /^(.+?) is poisoned\.$/.exec(c.text)
    if (!m) return null
    return {
      kind: 'proc',
      seq: c.seq,
      ts: c.ts,
      raw: c.raw,
      target: norm(m[1]),
      effect: 'poison',
      name: 'Poison',
    }
  },
  function classifyDbBuff(c) {
    const { text } = c
    if (text.startsWith('You feel')) {
      const m = /^You feel (.+?)\.$/.exec(text)
      if (m) return { kind: 'dbBuff', seq: c.seq, ts: c.ts, raw: c.raw, text: m[1].trim(), target: 'You', gained: true }
    }
    if (text.startsWith('Your ') && text.endsWith(' spell has worn off.')) {
      const m = /^Your (.+?) spell has worn off\.$/.exec(text)
      if (m) return { kind: 'dbBuff', seq: c.seq, ts: c.ts, raw: c.raw, text: m[1].trim(), target: 'You', gained: false }
    }
    if (text.includes('begins to cast') || text.includes('begins singing')) {
      const m = /^(.+?) begins (?:casting|singing) (.+?)\.$/.exec(text)
      if (m && norm(m[1]) !== 'You') return { kind: 'otherCastBegin', seq: c.seq, ts: c.ts, raw: c.raw, caster: norm(m[1]), spell: m[2].trim() }
    }
    return null
  },
  function classifySpellEmote(c) {
    const { text } = c
    if (EMOTE_SELF_RE.test(text)) return { kind: 'spellEmote', seq: c.seq, ts: c.ts, raw: c.raw, subject: 'You', text }
    const pm = EMOTE_PET_RE.exec(text)
    if (pm) return { kind: 'spellEmote', seq: c.seq, ts: c.ts, raw: c.raw, subject: pm[1], text }
    return null
  },
]

function parseEvent(raw, seq) {
  const pm = LINE_RE.exec(raw)
  if (!pm) return null
  const ts = parseEqTimestamp(pm[1])
  const text = pm[2]
  const ctx = { text, ts, seq, raw }
  for (const fn of CLASSIFIERS) {
    const ev = fn(ctx)
    if (ev) return ev
  }
  return { kind: 'unknown', seq, ts, raw }
}

module.exports = { parseEvent, idKey, spellCanonKey, cleanMob, looksDamage, norm, parseLine }
