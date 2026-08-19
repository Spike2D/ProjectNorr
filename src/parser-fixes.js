// Small post-parse corrections kept separate from the main parser while the
// Legends log corpus is being expanded. These corrections only touch events
// with enough evidence to be deterministic.
function applyParserFixes(text, ev) {
  if (!ev) return ev

  if (ev.kind === 'damage' && ev.dtype === 'melee' && text) {
    const m = /^(.+?)\s+(hit|hits|slash|slashes|pierce|pierces|crush|crushes|bash|bashes|kick|kicks|bite|bites|claw|claws|gore|gores|maul|mauls|punch|punches|strike|strikes|slice|slices|backstab|backstabs|slam|slams|sting|stings|rend|rends|smash|smashes|gnaw|gnaws|lash|lashes|smite|smites|cleave|cleaves|reave|reaves|shoot|shoots|frenzy|frenzies|flurry|flurries)\s+(.+?)\s+for\s+(\d+)\s+(?:points?\s+of\s+)?damage/i.exec(text)
    if (m) {
      const skill = m[2].toLowerCase().replace(/ies$/, 'y').replace(/es$/, '').replace(/s$/, '')
      return { ...ev, attacker: m[1].trim(), target: m[3].trim(), skill, verb: skill }
    }
  }

  return ev
}

module.exports = { applyParserFixes }
