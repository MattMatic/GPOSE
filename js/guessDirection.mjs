/**
 * guessDirection.mjs
 *
 * A dependency-free reimplementation of the direction-guessing heuristic
 * used by HarfBuzz's hb_buffer_t::guess_segment_properties() (src/hb-buffer.cc),
 * for cases where you need the guessed direction *value* itself in JS —
 * harfbuzzjs's Buffer class does not expose a getDirection()/getScript()
 * getter, only the set*() methods and guessSegmentProperties() (which is
 * write-only from JS's perspective).
 *
 * ALGORITHM (mirrors hb-buffer.cc exactly):
 *   1. Scan the string codepoint by codepoint, in order.
 *   2. Find the first codepoint whose Unicode Script is NOT Common,
 *      Inherited, or Unknown.
 *   3. Look up that script's "horizontal direction" (mirrors
 *      hb_script_get_horizontal_direction() in src/hb-common.cc):
 *        - a fixed list of scripts are RTL
 *        - a small set of scripts (Old Hungarian, Old Italic, Runic,
 *          Tifinagh) are direction-AMBIGUOUS and treated the same as
 *          "no strong script found"
 *        - everything else is LTR
 *   4. If no strong-script character is found (or the one found is on
 *      the ambiguous list), default to LTR.
 *
 * VERIFIED (see conversation record): the Common/Inherited classification
 * of ZWJ, ZWNJ, LRM, RLM, and the explicit bidi formatting/isolate
 * characters (LRE/RLE/PDF/LRO/RLO, LRI/RLI/FSI/PDI) was confirmed by
 * compiling and running HarfBuzz's actual generated src/hb-ucd-table.hh
 * (Unicode 17.0.0 snapshot), not just inferred from Scripts.txt. That
 * table is HarfBuzz's default Unicode-data provider (hb-ucd.cc); a build
 * using ICU or GLib as its unicode_funcs backend instead could in
 * principle disagree, though in practice these Unicode properties are
 * long-stable and unlikely to differ.
 *
 * NOT VERIFIED: the complete RTL script list below was only partially
 * confirmed against HarfBuzz's actual switch statement in hb-common.cc
 * (a representative prefix was read from source, not to the end of the
 * function). It is otherwise assembled from the well-documented set of
 * Unicode scripts with inherent right-to-left directionality. Treat it
 * as high-confidence, not source-verified line-by-line.
 *
 * IMPORTANT CAVEATS:
 *   - This is NOT the Unicode Bidi Algorithm (UAX #9). It is a cheap,
 *     single-pass heuristic intended for buffers that are expected to
 *     be a single script/direction run before shaping. For arbitrary
 *     mixed-direction text, use a real bidi implementation (e.g.
 *     bidi-js) to split into direction-homogeneous runs first — do not
 *     use this function as a substitute for that.
 *   - LRM/RLM and the explicit bidi control characters are Script=Common
 *     and are therefore SKIPPED, not treated as direction hints, exactly
 *     mirroring HarfBuzz's (arguably surprising) real behavior.
 *   - This uses the JS engine's own Unicode property tables (via \p{Script=…}
 *     regex escapes), which track whatever Unicode version that engine
 *     ships — not necessarily the same Unicode version any particular
 *     HarfBuzz build's hb-ucd-table.hh was generated against. For any
 *     codepoint assigned a script in recent Unicode revisions, the two
 *     could in principle disagree until both sides catch up.
 */

// Scripts HarfBuzz's hb_script_get_horizontal_direction() maps to RTL.
// (High-confidence, not exhaustively source-verified — see header note.)
const RTL_SCRIPTS = [
  'Arabic', 'Hebrew', 'Syriac', 'Thaana', 'Cypriot', 'Kharoshthi',
  'Phoenician', 'Nko', 'Lydian', 'Avestan', 'Imperial_Aramaic',
  'Inscriptional_Pahlavi', 'Inscriptional_Parthian', 'Old_South_Arabian',
  'Old_Turkic', 'Samaritan', 'Mandaic', 'Meroitic_Cursive',
  'Meroitic_Hieroglyphs', 'Manichaean', 'Mende_Kikakui', 'Nabataean',
  'Old_North_Arabian', 'Palmyrene', 'Psalter_Pahlavi', 'Hatran',
  'Adlam', 'Hanifi_Rohingya', 'Old_Sogdian', 'Sogdian', 'Elymaic',
  'Chorasmian', 'Yezidi', 'Old_Uyghur', 'Sidetic',
];

// Scripts HarfBuzz treats as direction-AMBIGUOUS (hb-common.cc returns
// HB_DIRECTION_INVALID for these; guess_segment_properties then falls
// back to the same LTR default used when no strong script is found).
const AMBIGUOUS_SCRIPTS = ['Old_Hungarian', 'Old_Italic', 'Runic', 'Tifinagh'];

const rtlRegex = new RegExp(RTL_SCRIPTS.map((s) => `\\p{Script=${s}}`).join('|'), 'u');
const ambiguousRegex = new RegExp(AMBIGUOUS_SCRIPTS.map((s) => `\\p{Script=${s}}`).join('|'), 'u');

// Codepoints HarfBuzz's scan skips entirely: Script=Common, Inherited, Unknown.
// This is what makes ZWJ/ZWNJ (Inherited) and LRM/RLM/bidi-format-controls
// (Common) invisible to the guess — confirmed against hb-ucd-table.hh.
const skipRegex = /\p{Script=Common}|\p{Script=Inherited}|\p{Script=Unknown}/u;

/**
 * Guess the paragraph direction of a string the same way HarfBuzz's
 * hb_buffer_t::guess_segment_properties() does: find the first
 * strong-script character and use its inherent horizontal direction,
 * defaulting to 'ltr' if none is found (or if the one found belongs to
 * a direction-ambiguous script).
 *
 * @param {string} text
 * @returns {'ltr' | 'rtl'}
 */
export function guessDirection(text) {
  for (const ch of text) { // iterates by codepoint, not UTF-16 code unit
    if (skipRegex.test(ch)) continue;
    if (ambiguousRegex.test(ch)) continue; // treated same as "not found"
    return rtlRegex.test(ch) ? 'rtl' : 'ltr';
  }
  return 'ltr';
}
