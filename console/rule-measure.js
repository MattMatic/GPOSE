// "rule measure" - GPOSE console snippet (paste into the browser DevTools console on the GPOSE page).
// PHASE 1: MEASURE ONLY. It flags nothing and does not touch the Pattern List. It measures, for every mark in a
// sample of words (GPOSE deltas applied), the OUTLINE distances a human checks by eye, and prints their
// distributions for edited and unedited marks, so we can see whether these numbers separate good placements from
// bad ones BEFORE any rule is built on them.
//
// For each mark (a glyph with an attachment) it records, in font units (capped at CAP):
//   dOwn         nearest ink of the glyph it is attached to
//   dRoot        nearest ink of the letter at the end of its attachment chain (same as dOwn for a mark on a letter)
//   dOtherBase   nearest ink of any OTHER letter (not its own root letter, not a mark)
//   dSameMark    nearest ink of another mark on the SAME letter (not itself, not marks hanging on it, not its base)
//   dOtherMark   nearest ink of a mark on a DIFFERENT letter
//   margin       dOtherBase - dRoot : positive = nearer its own letter than to any other (outline ownership)
//   hOwn         horizontal gap between the mark and the x-extent of its root letter (0 = inside it)
//   hOtherBase   the same, to the nearest OTHER letter
//   hMargin      hOtherBase - hOwn : positive = horizontally closer to its own letter (association)
// "edited" = the mark or the glyph it is attached to has a GPOSE delta (the human looked at it).
// Also prints the size of the dot glyphs (candidates for the dot unit DU).
//
// Results: window.__ruleMeasure = { rows, dims, settings }  (rows: one object per mark). Use GlyphQuery.describe(index)
// to look at a word, or window.__ruleMeasure.rows.filter(...) to look at any group of marks.
(async () => {
  // ---- settings ---------------------------------------------------------------------------------
  const LIST     = null;   // null = every word, 'kerning' etc = a named list, 'active' = main window
  const SAMPLE   = 0;   // measure this many random words from the list (0 = all of them: slow)
  const SEED     = 1;      // same seed = same sample
  const MARKS    = null;   // regexp on mark glyph names to measure, e.g. /^(sdb|ddb|tdb)/ ; null = every attached mark
  const CAP      = 400;    // distances are only measured up to this; anything further counts as CAP
  const TOP      = 14;     // glyph groups shown in the tables (the most common)

  // ---- sample -----------------------------------------------------------------------------------
  const all = GlyphQuery.listIndices(LIST);
  let list = all;
  if (SAMPLE && all.length > SAMPLE) {
    let s = SEED >>> 0 || 1;                                      // small deterministic shuffle (LCG)
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const a = all.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    list = a.slice(0, SAMPLE).sort((x, y) => x - y);
  }

  // ---- measuring --------------------------------------------------------------------------------
  const rows = [], dims = {};
  const grpOf = (n) => n.split('.')[0].replace(/\d+$/, '');
  const dist = (a, b) => {                                          // outline distance, capped
    if (!a.outline || !b.outline) return CAP;
    if (GlyphQuery.boxDistance(a, b) >= CAP) return CAP;
    const d = GlyphQuery.distance(a, b, CAP);
    return Number.isFinite(d) ? Math.min(d, CAP) : CAP;
  };
  const dimsOf = (g) => {                                           // size of a glyph's outline: box and area
    const o = g.outline;
    if (!o) return null;
    let area = 0;
    for (const p of o.polys) {
      let a = 0;
      for (let k = 0; k < p.n; k++) { const j = (k + 1) % p.n; a += p.pts[2 * k] * p.pts[2 * j + 1] - p.pts[2 * j] * p.pts[2 * k + 1]; }
      area = Math.max(area, Math.abs(a) / 2);                       // the largest contour (dots are one contour)
    }
    return { w: Math.round(o.x1 - o.x0), h: Math.round(o.y1 - o.y0), area: Math.round(area) };
  };

  await GlyphQuery.scan({
    title: 'Rule measure', list, apply: false, quiet: true,
    test: (w) => {
      const gs = w.glyphs;
      for (const m of gs) {
        if (!m.mark || !m.outline) continue;
        if (!dims[m.name]) dims[m.name] = dimsOf(m);
        if (MARKS && !MARKS.test(m.name)) continue;
        const own = m.base, root = m.rootBase;
        if (!own || !root) continue;                                // not attached to anything: nothing to measure against
        const kids = new Set(m.marks);                              // marks hanging on this mark (and their own, one level)
        for (const k of [...kids]) for (const kk of k.marks) kids.add(kk);
        let dRoot = dist(m, root), dOwn = own === root ? dRoot : dist(m, own);
        let dOtherBase = CAP, dSameMark = CAP, dOtherMark = CAP, otherBase = null, hOtherBase = CAP;
        const hgap = (a, b) => Math.max(a.x0 - b.x1, b.x0 - a.x1, 0);
        const hOwn = root.box ? Math.min(CAP, hgap(m.box, root.box)) : CAP;
        for (const g of gs) {
          if (g === m || g === own || g === root || kids.has(g) || !g.outline) continue;
          if (!g.mark) {
            if (g.box) hOtherBase = Math.min(hOtherBase, hgap(m.box, g.box));
            const d = dist(m, g);
            if (d < dOtherBase) { dOtherBase = d; otherBase = g; }
          } else {
            const gr = g.rootBase;
            const d = dist(m, g);
            if (gr === root) { if (d < dSameMark) dSameMark = d; } else if (d < dOtherMark) dOtherMark = d;
          }
        }
        rows.push({
          wi: w.index, word: w.text, i: m.i, name: m.name, grp: grpOf(m.name), on: `#${root.i} ${root.name}`,
          edited: m.hasDelta || own.hasDelta || root.hasDelta, dOwn: Math.round(dOwn), dRoot: Math.round(dRoot),
          dOtherBase: Math.round(dOtherBase), dSameMark: Math.round(dSameMark), dOtherMark: Math.round(dOtherMark),
          margin: Math.round(dOtherBase - dRoot), hOwn: Math.round(hOwn), hOtherBase: Math.round(hOtherBase),
          hMargin: Math.round(hOtherBase - hOwn), nearest: otherBase ? `#${otherBase.i} ${otherBase.name}` : '',
        });
      }
      return null;
    },
  });

  // ---- report -----------------------------------------------------------------------------------
  const settings = { LIST, SAMPLE, SEED, CAP, words: list.length, marks: rows.length };
  globalThis.__ruleMeasure = { rows, dims, settings };
  const report = [];                                              // the same text as the tables, copied to the clipboard at the end
  const say = (title, data) => {
    console.log(title);
    if (data) { console.table(data); report.push(`## ${title}`, ...tsv(data)); } else report.push(title);
  };
  const tsv = (data) => data.length ? [Object.keys(data[0]).join('\t'), ...data.map(r => Object.values(r).join('\t'))] : [];
  console.log(`Rule measure: ${rows.length} marks in ${list.length} words (${rows.filter(r => r.edited).length} edited, ` +
              `${rows.filter(r => !r.edited).length} unedited). Distances are outline-to-outline in font units, capped at ${CAP}.`);

  const dotNames = Object.keys(dims).filter(n => /^(sdb|ddb|tdb|sda|dda|tda)(\.|$)/.test(n) && dims[n]).sort();
  report.push(`Rule measure: ${rows.length} marks in ${list.length} words, CAP ${CAP}`);
  say('Dot glyph sizes (candidates for the dot unit DU: take the width or height of the single dot):', dotNames.map(n => ({ glyph: n, ...dims[n] })));

  const counts = {};
  for (const r of rows) counts[r.grp] = (counts[r.grp] || 0) + 1;
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, TOP);
  const table = (key, title) => {
    const out = [];
    for (const g of top) {
      for (const ed of [false, true]) {
        const v = rows.filter(r => r.grp === g && r.edited === ed).map(r => r[key]);
        if (!v.length) continue;
        const zero = v.filter(x => x === 0).length, capped = v.filter(x => x >= CAP).length;
        out.push({ ...GlyphQuery.stats(`${g} ${ed ? 'edited' : 'unedited'}`, v),
                   'zero%': Math.round(1000 * zero / v.length) / 10, 'capped%': Math.round(1000 * capped / v.length) / 10 });
      }
    }
    say(title, out);
  };
  table('dOwn', 'dOwn: distance to the glyph the mark is attached to (0 = touching it)');
  table('dOtherBase', 'dOtherBase: distance to the nearest OTHER letter (0 = touching it)');
  table('dSameMark', 'dSameMark: distance to another mark on the same letter');
  table('dOtherMark', 'dOtherMark: distance to a mark on a different letter');
  table('margin', 'margin = dOtherBase - dRoot: negative = nearer another letter than its own (outline ownership)');
  table('hOwn', 'hOwn: horizontal gap from the mark to the x-extent of its own letter (0 = inside it)');
  table('hMargin', 'hMargin = hOtherBase - hOwn: negative = horizontally closer to another letter than its own');
  const own = {};
  for (const r of rows) {
    const o = (own[r.grp] ||= { grp: r.grp, n: 0, edited: 0, outlineNearerOther: 0, editedOutlineNearerOther: 0, hNearerOther: 0, editedHNearerOther: 0, outsideOwnExtent: 0 });
    o.n++; if (r.edited) o.edited++;
    if (r.margin < 0) { o.outlineNearerOther++; if (r.edited) o.editedOutlineNearerOther++; }
    if (r.hMargin < 0) { o.hNearerOther++; if (r.edited) o.editedHNearerOther++; }
    if (r.hOwn > 0) o.outsideOwnExtent++;
  }
  say('Ownership: marks nearer another letter than their own, by outline and by horizontal gap; and marks outside their own letter\'s x-extent', top.map(g => own[g]));
  try { if (typeof copy === 'function') { copy(report.join('\n')); console.log('The whole report has been copied to the clipboard.'); } } catch (e) { /* no clipboard helper */ }
  return globalThis.__ruleMeasure;
})();
