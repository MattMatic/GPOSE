// Duplicate Glyph Sequence Finder
// github.com/MattMatic
// 2026-08
//
// Finds WordListEntry pairs/clusters that shape to the same visible glyph
// output despite having different source text - e.g. one word contains an
// inserted default-ignorable codepoint (ZWJ/ZWNJ/etc, which HarfBuzz still
// emits as a real, zero-ink, zero-advance glyph rather than dropping it), or
// two spellings that a font's GSUB normalizes to the same output glyphs.
//
// Detection works purely off already-shaped `.hb` data - no HarfBuzz calls.

import { DEFAULT_IGNORABLE_CODEPOINTS } from './wordlist.mjs';

/*
 * Per-GID classifier: does this glyph ever draw visible ink?
 * Classification is a font-level property of the GID, so it's cached once
 * per GID and reused across every entry.
 */
function isGlyphInkEmpty(hbs, gid, cache) {
  let empty = cache.get(gid);
  if (empty === undefined) {
    const data = hbs.glyphToRelativeJson(gid);
    empty = (data.ext.w === 0) && (data.ext.h === 0);
    cache.set(gid, empty);
  }
  return empty;
}

/*
 * A glyph occurrence is "non-contributing" (safe to drop from a visual-
 * identity signature) iff:
 *   - its GID never draws ink, AND
 *   - this occurrence doesn't move the pen (ax/ay=0).
 * ax/ay is the cumulative advance, so a non-zero advance still shifts every
 * later glyph even if this one is invisible - that's not droppable. Its own
 * dx/dy don't matter: nudging invisible ink around still draws nothing.
 */
function isOccurrenceNonContributing(hbs, hbItem, emptyCache) {
  if (hbItem.ax !== 0 || hbItem.ay !== 0) return false;
  return isGlyphInkEmpty(hbs, hbItem.g, emptyCache);
}

/*
 * Build the filtered "ink signature" for one WordListEntry.
 * @param {HarfBuzzShaping} hbs
 * @param {WordListEntry} entry
 * @param {Map} emptyCache - shared isGlyphInkEmpty() cache
 * @return {object}
 * @return {string} .key  - string key for Map bucketing
 * @return {array}  .kept - [{origIndex, g, ax, ay, dx, dy}, ...], origIndex
 *                          indexes back into entry.hb / entry.delta
 */
function buildInkSignature(hbs, entry, emptyCache) {
  const kept = [];
  const hb = entry.hb;
  for (let i = 0; i < hb.length; i++) {
    const e = hb[i];
    if (isOccurrenceNonContributing(hbs, e, emptyCache)) continue;
    kept.push({ origIndex: i, g: e.g, ax: e.ax, ay: e.ay, dx: e.dx, dy: e.dy });
  }
  const key = kept.map(t => `${t.g},${t.ax},${t.ay},${t.dx},${t.dy}`).join('|');
  return { key, kept };
}

/*
 * Read a delta field as a comparable value: a finite number, or null if unset.
 */
function deltaVal(delta, field) {
  const v = delta ? delta[field] : undefined;
  return (typeof v === 'number' && !isNaN(v)) ? v : null;
}

/*
 * Compare entryA.delta vs entryB.delta at aligned glyph positions.
 * keptA/keptB come from buildInkSignature() and, since both entries share
 * the same signature key, are already position-for-position aligned.
 * @return {array} mismatches - [{aIndex, bIndex, g, a:{dx,dy,ax}, b:{dx,dy,ax}}, ...]
 */
function compareDeltas(entryA, keptA, entryB, keptB) {
  const mismatches = [];
  for (let k = 0; k < keptA.length; k++) {
    const aIndex = keptA[k].origIndex;
    const bIndex = keptB[k].origIndex;
    const da = entryA.delta[aIndex];
    const db = entryB.delta[bIndex];
    const a = { dx: deltaVal(da, 'dx'), dy: deltaVal(da, 'dy'), ax: deltaVal(da, 'ax') };
    const b = { dx: deltaVal(db, 'dx'), dy: deltaVal(db, 'dy'), ax: deltaVal(db, 'ax') };
    if ((a.dx !== b.dx) || (a.dy !== b.dy) || (a.ax !== b.ax)) {
      mismatches.push({ aIndex, bIndex, g: keptA[k].g, a, b });
    }
  }
  return mismatches;
}

/*
 * Diff two words by character multiset (purely for labeling - doesn't
 * affect duplicate detection). If every character that differs in count
 * between the two words is a Default_Ignorable codepoint, the pair is
 * labeled 'ignorable'; otherwise 'other'.
 * @return {'same'|'ignorable'|'other'}
 */
function classifyCause(wordA, wordB) {
  if (wordA === wordB) return 'same';
  const countsA = new Map();
  const countsB = new Map();
  for (const ch of wordA) countsA.set(ch, (countsA.get(ch) || 0) + 1);
  for (const ch of wordB) countsB.set(ch, (countsB.get(ch) || 0) + 1);
  const allChars = new Set([...countsA.keys(), ...countsB.keys()]);
  let hasDiff = false;
  let onlyIgnorableDiffs = true;
  for (const ch of allChars) {
    if ((countsA.get(ch) || 0) === (countsB.get(ch) || 0)) continue;
    hasDiff = true;
    if (!DEFAULT_IGNORABLE_CODEPOINTS.has(ch.codePointAt(0))) onlyIgnorableDiffs = false;
  }
  if (!hasDiff) return 'same';
  return onlyIgnorableDiffs ? 'ignorable' : 'other';
}

/*
 * Scan the wordlist for entries that shape to the same visible glyph
 * sequence via different source text, and report per-cluster delta
 * disagreements so they can be reconciled via the Pattern List.
 *
 * @param {WordList} wordList
 * @param {HarfBuzzShaping} hbs
 * @param {object} [options]
 * @param {object} [options.progressPanel] - defaults to window.progressPanel if present; pass null to skip
 * @param {number[]} [options.indices] - subset of wordList indices to scan (default: all)
 * @return {Promise<Array>} clusters, worst delta-mismatch first:
 *   {
 *     indices: number[],   // wordList indices in this cluster
 *     words: string[],     // entry.w for each index, same order as indices
 *     cause: 'same'|'ignorable'|'other'|'mixed',
 *     mismatches: [{ pair:[refIndex,otherIndex], glyphs:[{aIndex,bIndex,g,a,b}, ...] }, ...],
 *     worstDelta: number,  // largest single |dx|/|dy|/|ax| disagreement in the cluster
 *   }
 */
async function findDuplicateClusters(wordList, hbs, options = {}) {
  const pp = ('progressPanel' in options)
    ? options.progressPanel
    : (typeof window !== 'undefined' ? window.progressPanel : null);
  const indices = options.indices || null;
  const total = indices ? indices.length : wordList.length();

  const emptyCache = new Map();
  const buckets = new Map();     // signature key -> [wordListIndex, ...]
  const keptByIndex = new Map(); // wordListIndex -> kept array (reused below)

  if (pp) await pp.start(total, 'Scanning for duplicate glyph sequences', true);

  for (let n = 0; n < total; n++) {
    const idx = indices ? indices[n] : n;
    const entry = wordList.get(idx);
    if (entry && entry.hb) {
      const sig = buildInkSignature(hbs, entry, emptyCache);
      keptByIndex.set(idx, sig.kept);
      let bucket = buckets.get(sig.key);
      if (!bucket) buckets.set(sig.key, bucket = []);
      bucket.push(idx);
    }
    if (pp) {
      await pp.setProgress(n);
      if (pp.aborted()) break;
    }
  }
  if (pp) await pp.done();

  const results = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const refIdx = bucket[0];
    const refEntry = wordList.get(refIdx);
    const refKept = keptByIndex.get(refIdx);
    const mismatches = [];
    let worstDelta = 0;
    let cause = null;
    for (let k = 1; k < bucket.length; k++) {
      const otherIdx = bucket[k];
      const otherEntry = wordList.get(otherIdx);
      const otherKept = keptByIndex.get(otherIdx);
      const glyphs = compareDeltas(refEntry, refKept, otherEntry, otherKept);
      if (glyphs.length > 0) {
        mismatches.push({ pair: [refIdx, otherIdx], glyphs });
        for (const g of glyphs) {
          worstDelta = Math.max(
            worstDelta,
            Math.abs((g.a.dx ?? 0) - (g.b.dx ?? 0)),
            Math.abs((g.a.dy ?? 0) - (g.b.dy ?? 0)),
            Math.abs((g.a.ax ?? 0) - (g.b.ax ?? 0)),
          );
        }
      }
      const pairCause = classifyCause(refEntry.w, otherEntry.w);
      cause = (cause === null) ? pairCause : (cause === pairCause ? cause : 'mixed');
    }
    results.push({
      indices: bucket,
      words: bucket.map(i => wordList.get(i).w),
      cause: cause || 'same',
      mismatches,
      worstDelta,
    });
  }

  results.sort((a, b) => b.worstDelta - a.worstDelta);
  return results;
}

/*
 * Console helper: log a readable summary of findDuplicateClusters() results.
 * @param {array} results - from findDuplicateClusters()
 * @param {WordList} wordList
 * @param {HarfBuzzShaping} hbs
 * @param {object} [options]
 * @param {number} [options.limit=50]
 */
function printDuplicateClusters(results, wordList, hbs, options = {}) {
  const { limit = 50 } = options;
  const withMismatch = results.filter(c => c.mismatches.length > 0).length;
  console.log(`${results.length} duplicate cluster(s) found, ${withMismatch} with delta mismatches` +
    (results.length > limit ? ` (showing first ${limit})` : ''));
  results.slice(0, limit).forEach((cluster, ci) => {
    const flag = cluster.mismatches.length ? '  ⚠ DELTA MISMATCH' : '';
    console.groupCollapsed(
      `#${ci} [${cluster.cause}]${flag} — ${cluster.words.map(w => `"${w}"`).join('  vs  ')}`
    );
    console.log('indices:', cluster.indices);
    cluster.mismatches.forEach(mm => {
      const [ai, bi] = mm.pair;
      console.log(`  ${wordList.get(ai).w}  vs  ${wordList.get(bi).w}`);
      mm.glyphs.forEach(g => {
        const name = hbs.getGlyphName(g.g);
        console.log(`    ${name} (gid ${g.g}):`, `A[${g.aIndex}]=`, g.a, `B[${g.bIndex}]=`, g.b);
      });
    });
    console.groupEnd();
  });
  return results;
}

export {
  findDuplicateClusters,
  printDuplicateClusters,
  buildInkSignature,
  classifyCause,
};
