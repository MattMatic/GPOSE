/**
 * ignorable-glyphs.mjs
 *
 * *** THIS FILE IS COPIED VERBATIM FROM gpos-miner/js/data/ignorable-glyphs.mjs ***
 * (see the sync note in rules-format.mjs).
 *
 * The set of glyph NAMEs treated as Default_Ignorable (ZWNJ, ZWJ, CGJ, etc.)
 * - HarfBuzz skips these transparently when matching GPOS ChainContextPos
 * rules, so mining and any later rule dispatch must strip them from context
 * sequences identically, or a context sequence that used to skip over one
 * silently fails to match once the two tools disagree on which glyphs count.
 *
 * Deliberately NAME-based, not Unicode-codepoint-based: some of these glyphs
 * are only reachable via GSUB substitution in some fonts and carry no direct
 * cmap/unicode mapping, so a codepoint-based detector can silently miss them
 * even though a name-based one catches them (or vice versa) - the two
 * approaches are not guaranteed to agree for a given font. What matters here
 * isn't which approach is more "correct" in the abstract, it's that every
 * consumer of a rules file uses the exact same detection the rules were
 * mined against - hence one shared, name-based list rather than two
 * independently-written heuristics.
 *
 * GID 0 (.notdef) is always added on top of the name list, unconditionally.
 * A Default_Ignorable codepoint the font has no cmap entry for (e.g. RLM/LRM
 * in a font that never renders bidi marks) resolves to GID 0 at shape time -
 * not to a glyph literally named 'uni200F', since no such glyph exists in the
 * font to give a name to. The name-based lookup above therefore silently
 * fails to add it, and unlike ZWNJ/ZWJ (which DO have real, named glyphs and
 * so get caught by name), it was passing through unstripped: HarfBuzz still
 * treats it as Default_Ignorable and transparently skips over it during
 * ChainContextPos matching (see hb-ot-layout-gsubgpos.hh's may_skip() -
 * SKIP_MAYBE is driven by the source codepoint's Default_Ignorable property,
 * independent of which GID it resolved to), but a miner that doesn't also
 * skip it ends up baking a literal '.notdef' into a rule's backtrack/
 * lookahead sequence - a context slot real HarfBuzz will never actually stop
 * on. GID 0 is never itself a meaningful "real letter" to condition GPOS
 * context on, so stripping it unconditionally is safe regardless of why a
 * given occurrence produced it.
 */

export const IGNORABLE_GLYPH_NAMES = [
  'zerowidthnonjoiner',    // U+200C ZWNJ
  'zerowidthjoiner',       // U+200D ZWJ
  'softhyphen',            // U+00AD
  'zerowidthspace',        // U+200B
  'wordjoiner',            // U+2060
  'zerowidthnobreakspace', // U+FEFF
  'uni200C', 'uni200D', 'uni034F', 'uni00AD',
  'uni200B', 'uni200E', 'uni200F', 'uni2060',
];

/**
 * @param {Function} gidOf - (glyphName: string) => number|undefined|-1, looked
 *                           up against the font in question
 * @returns {Set<number>} GIDs of every ignorable name found in this font,
 *                        plus GID 0 (.notdef) unconditionally
 */
export function buildIgnorableGids(gidOf) {
  const ignorable = new Set([0]); // .notdef - never a meaningful context glyph
  for (const name of IGNORABLE_GLYPH_NAMES) {
    const gid = gidOf(name);
    if (gid != null && gid !== -1) ignorable.add(gid);
  }
  return ignorable;
}
