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
 * @returns {Set<number>} GIDs of every ignorable name found in this font
 */
export function buildIgnorableGids(gidOf) {
  const ignorable = new Set();
  for (const name of IGNORABLE_GLYPH_NAMES) {
    const gid = gidOf(name);
    if (gid != null && gid !== -1) ignorable.add(gid);
  }
  return ignorable;
}
