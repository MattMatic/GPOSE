/**
 * rules-loader.mjs
 *
 * *** THIS FILE IS COPIED VERBATIM FROM gpos-miner/js/io/rules-loader.mjs ***
 * (see the sync note in rules-format.mjs, which this file depends on and
 * which is copied alongside it).
 *
 * Parses a rules JSON document produced by gpos-miner's output/rules-exporter.mjs
 * and resolves its glyph names back to GIDs using the TARGET run's own glyph
 * lookup (gpos-miner: a registry built from a fontinfo.json; GPOSE: its own
 * currently-loaded font) - not whatever font the rules were originally
 * exported from. Deliberately takes a plain `name -> gid` function rather
 * than gpos-miner's own GlyphRegistry object, since GPOSE has no such object
 * and shouldn't need to fake one up just to satisfy this file's shape.
 *
 * Produces a `patterns` array shaped identically to the in-memory array
 * pattern-miner.mjs builds, so it can be handed unmodified to
 * rule-dispatch.mjs (gpos-miner's own dispatch, and this copy of the same
 * file).
 *
 * A glyph name with no GID in the target font (renamed/removed since the
 * rules were mined) drops just that context entry or pattern, rather than
 * failing the whole load - the target font is the authority.
 */

import { checkRulesFormat } from './rules-format.mjs';

/**
 * @param {object}   rulesDoc - parsed rules JSON (see rules-exporter.mjs)
 * @param {Function} gidOf    - (glyphName: string) => number|undefined, looked up
 *                              against the font this run targets
 * @returns {{ patterns: PatternEntry[], warnings: string[] }}
 */
export function resolveRules(rulesDoc, gidOf) {
  checkRulesFormat(rulesDoc);

  const warnings = [];
  const missingNames = new Set();
  const gidOfTracked = (name) => {
    const gid = gidOf(name);
    if (gid === undefined) missingNames.add(name);
    return gid;
  };

  const patterns = [];
  for (const p of rulesDoc.patterns ?? []) {
    const targetGID = gidOfTracked(p.target);
    if (targetGID === undefined) continue; // whole pattern is moot without its target

    const contextGroupList = [];
    for (const g of p.contextGroups ?? []) {
      const left  = (g.left  ?? []).map(gidOfTracked);
      const right = (g.right ?? []).map(gidOfTracked);
      if (left.some(g => g === undefined) || right.some(g => g === undefined)) continue; // drop this alternative only
      contextGroupList.push({ leftContexts: [left], rightContexts: [right] });
    }
    // A pattern with all its context alternatives dropped (every one referenced
    // a since-removed glyph) can't fire safely - skip it rather than guess.
    if ((p.contextGroups?.length ?? 0) > 0 && contextGroupList.length === 0) continue;

    patterns.push({
      targetGID,
      dx: p.dx ?? 0,
      dy: p.dy ?? 0,
      ax: p.ax ?? 0,
      ay: p.ay ?? 0,
      isZeroVR: !!p.isZeroVR,
      lookupType: 'ChainContextPos',
      contextGroupList,
    });
  }

  if (missingNames.size > 0) {
    warnings.push(`${missingNames.size} glyph name(s) from the rules file were not found in this font: ${[...missingNames].slice(0, 20).join(', ')}${missingNames.size > 20 ? ', …' : ''}`);
  }
  if (patterns.length < (rulesDoc.patterns?.length ?? 0)) {
    warnings.push(`${(rulesDoc.patterns?.length ?? 0) - patterns.length} of ${rulesDoc.patterns?.length ?? 0} pattern(s) were dropped (target or all context alternatives unresolved).`);
  }

  return { patterns, warnings };
}
