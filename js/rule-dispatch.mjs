/**
 * rule-dispatch.mjs
 *
 * *** THIS FILE IS COPIED VERBATIM FROM gpos-miner/js/mining/rule-dispatch.mjs ***
 * (see the sync note in rules-format.mjs).
 *
 * The pure per-GID dispatch simulation: given a mined `patterns` array (the
 * shape gpos-miner's pattern-miner.mjs builds, and rules-loader.mjs
 * reconstructs from an exported rules file) and one word's HarfBuzz glyph
 * sequence, computes the correction the compiled font's GPOS lookups would
 * apply.
 *
 * Deliberately has no Worker / SharedArrayBuffer / postMessage dependency -
 * those exist in gpos-miner's workers/simulation-worker.mjs purely for
 * corpus-scale parallelism, which GPOSE applying rules to its Pattern List
 * (a handful of words) doesn't need. This file is that worker's actual
 * logic; GPOSE calls it directly and synchronously per word.
 *
 * `hb` here is any array of glyph entries with a `.g` (GID) field - GPOSE's
 * own we.hb entries qualify as-is, no wrapping needed.
 *
 * Mirrors the compiled font's dispatch exactly:
 *   - Rules within a target GID's group are tried widest-context-first
 *     (ties broken by right-context length) - must match fea-writer.mjs's
 *     comparator exactly, since that's the order the compiled lookups
 *     actually run in.
 *   - First match wins per glyph position.
 *   - A zero-VR rule (<0,0,0,0>) that matches "claims" the position (no
 *     later/narrower rule fires) but contributes no correction itself -
 *     this matches the compiled font's zero-VR sub-lookup applying <0 0 0 0>.
 */

/**
 * Build the per-target-GID flat rule list, pre-sorted into firing order.
 *
 * @param {PatternEntry[]} patterns
 * @returns {Map<number, Rule[]>} targetGID -> rules, widest-context-first
 */
export function buildRulesByGID(patterns) {
  const rulesByGID = new Map();
  for (const p of patterns) {
    if (p.lookupType !== 'ChainContextPos') continue;
    if (!rulesByGID.has(p.targetGID)) rulesByGID.set(p.targetGID, []);
    for (const group of p.contextGroupList ?? []) {
      const lc = group.leftContexts[0]  ?? [];
      const rc = group.rightContexts[0] ?? [];
      rulesByGID.get(p.targetGID).push({
        lc, rc,
        dx: p.dx ?? 0, dy: p.dy ?? 0,
        ax: p.ax ?? 0, ay: p.ay ?? 0,
        isZeroVR: p.isZeroVR ?? false,
        width: lc.length + rc.length,
      });
    }
  }
  for (const rules of rulesByGID.values()) {
    rules.sort((a, b) => {
      // isZeroVR is deliberately not a sort criterion - see fea-writer.mjs for why.
      if (a.width !== b.width) return b.width - a.width;
      return b.rc.length - a.rc.length; // more right-context first
    });
  }
  return rulesByGID;
}

/** Does `rule`'s left/right context match `hb` at position `gi`? */
export function matchesRule(hb, gi, rule) {
  const lc = rule.lc;
  const rc = rule.rc;
  for (let i = 0; i < lc.length; i++) {
    const sp = gi - lc.length + i;
    if (sp < 0 || hb[sp].g !== lc[i]) return false;
  }
  for (let i = 0; i < rc.length; i++) {
    const sp = gi + 1 + i;
    if (sp >= hb.length || hb[sp].g !== rc[i]) return false;
  }
  return true;
}

/**
 * Apply all rules to one word's glyph sequence.
 *
 * @param {Array<{g:number}>}   hb          - the word's glyph sequence
 * @param {Map<number, Rule[]>} rulesByGID  - from buildRulesByGID()
 * @returns {Map<number, {dx,dy,ax,ay}>} glyphIdx -> correction
 */
export function applyPatternsToWord(hb, rulesByGID) {
  const vrs = new Map();
  for (let gi = 0; gi < hb.length; gi++) {
    const rules = rulesByGID.get(hb[gi].g);
    if (!rules) continue;
    for (const rule of rules) {
      if (matchesRule(hb, gi, rule)) {
        if (!rule.isZeroVR)
          vrs.set(gi, { dx: rule.dx, dy: rule.dy, ax: rule.ax, ay: rule.ay });
        break;
      }
    }
  }
  return vrs;
}
