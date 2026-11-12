// "rule corridor" - GPOSE console snippet (paste into the browser DevTools console on the GPOSE page).
// MEASURE ONLY: flags nothing and does not touch the Pattern List.
//
// Is the visual link between a mark and its letter cut by another glyph (for example a REf from the previous cursive
// run passing between a dot and the letter it belongs to)?
//
// For every mark attached directly to a letter (marks stacked on marks are counted but skipped) it drops PROBES vertical
// lines across the mark's width, from the mark's edge facing the letter to the letter's nearest ink at that x. It then
// measures how much of each line is covered by the ink of ANY other glyph (other letters, and marks other than the mark
// itself and the marks hanging on it), with the GPOSE deltas applied.
//   occlusion   mean over the probes of  (covered length / probe length)   0 = clear, 1 = fully covered
//   blocked     probes with any cover (of PROBES)
//   cutter      the glyph covering the most
//   sameRun     the cutter is in the same cursive run as the letter, else it is from another run
// In a cascade the next letters of a run drop in front of the dots and marks of the earlier ones, so a cutter from the SAME run
// is normal. IGNORE_SAME_RUN (on by default) leaves glyphs of the same run out, so only glyphs of OTHER runs count.
// A mark counts as belonging to the run of the letter it is attached to.
// Results: window.__ruleCorridor = { rows, skipped, settings }.
(async () => {
  // ---- settings ---------------------------------------------------------------------------------
  const LIST      = null;   // null = every word, 'kerning' etc = a named list, 'active' = main window
  const SAMPLE    = 0;  // measure this many random words (0 = all of them: slow)
  const SEED      = 1;      // same seed = same sample
  const MARKS     = null;   // regexp on mark glyph names, e.g. /^(sdb|ddb|tdb)/ ; null = every mark on a letter
  const PROBES    = 5;      // vertical lines across the mark's width
  const MAX_LEN   = 600;    // ignore probes longer than this (the mark is far from the letter there)
  const IGNORE_SAME_RUN = true;   // true = only glyphs from OTHER cursive runs can cover the link (a REf from the previous run, say)
  const MIN_LIST  = 0.25;   // list marks whose occlusion is at least this
  const SHOW      = 60;     // rows listed
  const TOP       = 14;     // glyph groups shown in the table
  const COPY      = true;   // try to copy the text of everything printed to the clipboard

  // ---- sample -----------------------------------------------------------------------------------
  const all = GlyphQuery.listIndices(LIST);
  let list = all;
  if (SAMPLE && all.length > SAMPLE) {
    let s = SEED >>> 0 || 1;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const a = all.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    list = a.slice(0, SAMPLE).sort((x, y) => x - y);
  }

  // ---- geometry: where does glyph g's outline cross the vertical line at x? (y values, sorted) -----------
  const crossings = (g, x) => {
    const ys = [];
    if (!g.outline || x < g.box.x0 || x > g.box.x1) return ys;
    const ox = g.px, oy = g.py;
    for (const p of g.outline.polys) {
      if (x < p.x0 + ox || x > p.x1 + ox) continue;
      for (let i = 0; i < p.n; i++) {
        const j = (i + 1) % p.n;
        const x1 = p.pts[2 * i] + ox, y1 = p.pts[2 * i + 1] + oy, x2 = p.pts[2 * j] + ox, y2 = p.pts[2 * j + 1] + oy;
        if ((x1 <= x) !== (x2 <= x)) ys.push(y1 + (x - x1) * (y2 - y1) / (x2 - x1));
      }
    }
    return ys.sort((a, b) => a - b);
  };
  // the inside intervals of g along the line (even-odd), clipped to [lo, hi]
  const covered = (g, x, lo, hi) => {
    const ys = crossings(g, x), out = [];
    for (let k = 0; k + 1 < ys.length; k += 2) {
      const a = Math.max(ys[k], lo), b = Math.min(ys[k + 1], hi);
      if (b > a) out.push([a, b]);
    }
    return out;
  };

  // ---- measuring --------------------------------------------------------------------------------
  const rows = [];
  let skipped = 0, noProbe = 0;
  const grpOf = (n) => n.split('.')[0].replace(/\d+$/, '');
  await GlyphQuery.scan({
    title: 'Rule corridor', list, apply: false, quiet: true,
    test: (w) => {
      const gs = w.glyphs;
      for (const m of gs) {
        if (!m.mark || !m.outline) continue;
        if (MARKS && !MARKS.test(m.name)) continue;
        const own = m.base, root = m.rootBase;
        if (!own || !root) continue;
        if (own !== root) { skipped++; continue; }                    // a mark on a mark: not in this version
        const kids = new Set(m.marks);
        for (const k of [...kids]) for (const kk of k.marks) kids.add(kk);
        const runOf = (g) => (g.mark && g.rootBase ? g.rootBase.run : g.run);
        const others = gs.filter(g => g !== m && g !== root && !kids.has(g) && g.outline && !(IGNORE_SAME_RUN && runOf(g) === root.run));
        const mb = m.box, width = mb.x1 - mb.x0;
        let n = 0, blocked = 0, sum = 0, len = 0;
        const by = new Map();                                          // cutter glyph -> covered length
        for (let k = 0; k < PROBES; k++) {
          const x = mb.x0 + (k + 0.5) * width / PROBES;
          const bc = crossings(root, x);
          if (!bc.length) continue;
          // the nearest letter ink above the mark's top edge or below its bottom edge
          let up = Infinity, down = Infinity;
          for (const y of bc) { if (y >= mb.y1) up = Math.min(up, y - mb.y1); if (y <= mb.y0) down = Math.min(down, mb.y0 - y); }
          if (up === Infinity && down === Infinity) continue;       // the letter's ink at x overlaps the mark's height: nothing between
          const [lo, hi] = up <= down ? [mb.y1, mb.y1 + up] : [mb.y0 - down, mb.y0];
          const L = hi - lo;
          if (L <= 0 || L > MAX_LEN) continue;
          const iv = [];
          for (const g of others) {
            if (g.box.x0 > x || g.box.x1 < x || g.box.y1 < lo || g.box.y0 > hi) continue;
            for (const [a, b] of covered(g, x, lo, hi)) { iv.push([a, b]); by.set(g, (by.get(g) || 0) + (b - a)); }
          }
          iv.sort((p, q) => p[0] - q[0]);
          let u = 0, end = -Infinity;                                  // union length of the covered intervals
          for (const [a, b] of iv) { const s0 = Math.max(a, end); if (b > s0) { u += b - s0; end = b; } }
          n++; len += L; sum += Math.min(1, u / L); if (u > 0) blocked++;
        }
        if (!n) { noProbe++; continue; }
        let cutter = null, best = 0;
        for (const [g, v] of by) if (v > best) { best = v; cutter = g; }
        rows.push({
          wi: w.index, word: w.text, i: m.i, name: m.name, grp: grpOf(m.name), on: `#${root.i} ${root.name}`,
          edited: m.hasDelta || root.hasDelta, probes: n, blocked, len: Math.round(len / n),
          occlusion: Math.round(100 * sum / n) / 100,
          cutter: cutter ? `#${cutter.i} ${cutter.name}` : '', cutterIsMark: cutter ? cutter.mark : false,
          sameRun: cutter ? runOf(cutter) === root.run : false,
        });
      }
      return null;
    },
  });

  // ---- report -----------------------------------------------------------------------------------
  const settings = { LIST, SAMPLE, SEED, PROBES, MAX_LEN, IGNORE_SAME_RUN, words: list.length, marks: rows.length, skippedMarkOnMark: skipped, noProbe };
  globalThis.__ruleCorridor = { rows, skipped, settings };
  const report = [];
  const tsv = (data) => data.length ? [Object.keys(data[0]).join('\t'), ...data.map(r => Object.values(r).join('\t'))] : [];
  const say = (title, data) => { console.log(title); if (data) { console.table(data); report.push(`## ${title}`, ...tsv(data)); } };
  const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : 0);
  console.log(`Rule corridor: ${rows.length} marks measured in ${list.length} words (${skipped} marks on marks skipped, ${noProbe} with no probe line).`);
  report.push(`Rule corridor: ${rows.length} marks in ${list.length} words; ${skipped} marks on marks skipped; ${noProbe} with no probe line`);

  const counts = {};
  for (const r of rows) counts[r.grp] = (counts[r.grp] || 0) + 1;
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, TOP);
  const grpTable = [];
  for (const g of top) for (const ed of [false, true]) {
    const v = rows.filter(r => r.grp === g && r.edited === ed);
    if (!v.length) continue;
    const bl = v.filter(r => r.occlusion > 0), s = v.filter(r => r.occlusion >= MIN_LIST), h = v.filter(r => r.occlusion >= 0.5);
    const occ = bl.map(r => r.occlusion).sort((a, b) => a - b);
    grpTable.push({ group: `${g} ${ed ? 'edited' : 'unedited'}`, n: v.length, 'any cover %': pct(bl.length, v.length),
                    [`>= ${MIN_LIST} %`]: pct(s.length, v.length), '>= 0.5 %': pct(h.length, v.length),
                    'median cover (when covered)': occ.length ? occ[Math.floor(occ.length / 2)] : 0 });
  }
  say('How much of the link between a mark and its letter is covered by other glyphs (occlusion 0 = clear, 1 = fully covered)', grpTable);

  const cut = rows.filter(r => r.occlusion >= MIN_LIST), cutters = {};
  for (const r of cut) {
    const fam = (r.cutter.replace(/^#\d+ /, '')).replace(/\d+$/, '');
    const key = `${fam}${r.cutterIsMark ? ' (mark)' : ''} | ${r.sameRun ? 'same run as the letter' : 'another run'}`;
    cutters[key] = (cutters[key] || 0) + 1;
  }
  say(`What covers the link (marks with occlusion >= ${MIN_LIST}: ${cut.length} of ${rows.length})`,
      Object.entries(cutters).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => ({ cutter: k, marks: v })));

  say(`The ${Math.min(SHOW, cut.length)} most covered (${cut.length} marks with occlusion >= ${MIN_LIST})`,
      cut.sort((a, b) => b.occlusion - a.occlusion || b.blocked - a.blocked).slice(0, SHOW).map(r => ({
        index: r.wi + 1, word: r.word, mark: `#${r.i} ${r.name}`, on: r.on, occlusion: r.occlusion, blocked: `${r.blocked}/${r.probes}`,
        'link length': r.len, cutter: r.cutter, sameRun: r.sameRun ? 'yes' : 'no', edited: r.edited ? 'yes' : 'no' })));
  if (COPY) { try { if (typeof copy === 'function') { copy(report.join('\n')); console.log('Copied to the clipboard.'); } } catch (e) { /* not available */ } }
  return globalThis.__ruleCorridor;
})();
