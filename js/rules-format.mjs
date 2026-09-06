/**
 * rules-format.mjs
 *
 * The gpos-miner-rules JSON format contract - a single source of truth for
 * the `format`/`version` fields output/rules-exporter.mjs stamps and every
 * consumer (gpos-miner's own io/rules-loader.mjs, and this copy) validates
 * against.
 *
 * *** THIS FILE IS COPIED VERBATIM FROM gpos-miner/js/io/rules-format.mjs ***
 * (alongside rules-loader.mjs and rule-dispatch.mjs - see the sync note at
 * the top of each). If gpos-miner bumps RULES_FORMAT_VERSION because the
 * document shape changed, copy this file here too - an un-synced older copy
 * will then correctly reject the newer file with an "unsupported version"
 * error instead of silently misinterpreting it, which is the whole point of
 * checking a version number in the first place.
 */

export const RULES_FORMAT = 'gpos-miner-rules';

// Bump on any change to the document shape rules-exporter.mjs writes
// (new/renamed/removed fields, changed semantics of an existing field).
// Loaders reject anything other than an exact match - see the comment on
// checkRulesFormat() for why this starts strict rather than as a range.
export const RULES_FORMAT_VERSION = 1;

/**
 * Validate a parsed rules JSON document's format/version before touching its
 * content. Throws with a message safe to surface directly in the UI.
 *
 * Exact-match on version (not "<=") deliberately: at v1, with only one
 * consumer generation in the wild, there's no reason yet to assume a future
 * version is a superset an older loader could safely ignore the new parts
 * of - that assumption is what a min/max range would encode, and adding it
 * before it's needed is exactly the kind of forward-compatibility guess that
 * usually turns out wrong. Revisit this once a v2 actually exists.
 *
 * @param {object} doc - JSON.parse() of a rules file
 * @throws {Error}
 */
export function checkRulesFormat(doc) {
  if (doc?.format !== RULES_FORMAT) {
    throw new Error(`Not a recognised rules file (format: ${doc?.format ?? 'missing'}, expected: ${RULES_FORMAT})`);
  }
  if (doc?.version !== RULES_FORMAT_VERSION) {
    throw new Error(`Unsupported rules file version ${doc?.version ?? 'missing'} (this tool supports version ${RULES_FORMAT_VERSION}). Re-export the rules file, or update this tool if the rules file is newer.`);
  }
}
