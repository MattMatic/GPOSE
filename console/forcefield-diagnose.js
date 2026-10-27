// "force field diagnose" - GPOSE console snippet (paste into the browser DevTools console on the GPOSE page).
// Uses the GlyphQuery helpers (js/glyph-query.js, loaded by the app); see console/README.md.
//
// For words where the outlines of two glyphs overlap but the force field did not flag a collision, this replays the force
// field's pair test (FontForceField.evaluate -> processPair) for every overlapping pair and reports WHICH stage let the
// pair through:
//   1. attachment indexes   - do the cursive / mark index sets in the shaping result line up with the glyphs (marks are
//                             marks, cursive neighbours are neighbours)? A word with a ZWNJ is the usual suspect.
//   2. stored v fresh       - is the evaluation the app holds for the word (entry.ev) the same as one made now?
//   3. exemptions           - the pair is skipped as "same cursive set" or by a JSON "overlaps" rule
//   4. the test that is used - near v near, or for a mark and its base nearBase v near (the smaller field)
//   5. the fields themselves - empty / missing near field, bounding boxes that say "far away", fields that sit somewhere
//                              other than where the glyph is drawn
// Only pairs in DIFFERENT cursive runs are shown unless ONLY_DIFFERENT_RUN is false (a mark counts as part of the run of
// the glyph it is attached to, as in the Proximity panel). Nothing in the app is changed. The result is left in
// window.__ffDiag.
(async () => {
  // ---- settings ---------------------------------------------------------------------------------
  const WORDS = ['کج‌گو', 'علمِ‌کتبہ'];     // the words to examine; null = the word displayed in the main window
  const ONLY_DIFFERENT_RUN = true;          // false = every overlapping pair
  const MAX_GAP = 0;                        // outline distance counted as "overlapping" (0 = crossing, touching or nested)
  const TOLERANCE = 2;                      // font units: allowed difference between the force-field box and the placed box

  // ---- helpers ----------------------------------------------------------------------------------
  const fmt = (v) => Math.round(v);
  const cpHex = (s) => [...s].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');
  const areaOf = (cp) => { try { return cp && cp.paths64 ? Math.round(cp.getArea().area) : 0; } catch (e) { return NaN; } };
  const boxOfField = (cp) => (cp && cp.bbox && !isNaN(cp.bbox.x.min)) ? { x0: cp.bbox.x.min, x1: cp.bbox.x.max, y0: cp.bbox.y.min, y1: cp.bbox.y.max } : null;
  const boxesAgree = (a, b) => !!a && !!b && ['x0', 'x1', 'y0', 'y1'].every(k => Math.abs(a[k] - b[k]) <= TOLERANCE);
  const hit = (a, b) => {                                   // collisionCPath, but returns the intersection area (or null) and frees it
    if (!a || !b) return null;
    const r = a.collisionCPath(b);
    if (!r) return null;
    const area = areaOf(r);
    r.destroy();
    return area;
  };
  const runOf = (g) => (g.mark && g.rootBase) ? g.rootBase.run : g.run;

  const words = WORDS || [wordList.getCurrentEntry().getWord()];
  const out = { words: [] };
  window.__ffDiag = out;

  for (const text of words) {
    const idx = wordList.find(text);
    console.group(`%c${text}`, 'font-weight:bold');
    const rec = { text, found: idx >= 0, problems: [], pairs: [] };
    out.words.push(rec);
    if (idx < 0) {
      console.warn(`not in the word list. Code points: ${cpHex(text)} (a ZWNJ typed as U+200C must match exactly)`);
      console.groupEnd();
      continue;
    }
    const entry = wordList.get(idx);
    const pw = GlyphQuery.placed(entry);
    const hb = hbs.applyDeltaArray(entry.hb, entry.delta);
    const cur = hb.attachments?.cursives, mk = hb.attachments?.marks;
    const n = hb.length;
    console.log(`word #${idx}, ${n} glyphs, code points ${cpHex(text)}, rtl=${hb.rtl}`);

    // 1. attachment indexes ---------------------------------------------------------------------
    const bad = [];
    for (const set of cur?.cursives ?? []) {
      for (const i of set) if (!(i >= 0 && i < n)) bad.push(`cursive index ${i} is outside 0..${n - 1}`);
      const s = [...set].sort((a, b) => a - b);
      for (let k = 1; k < s.length; k++) {                    // neighbours, not counting marks sitting between them
        for (let m = s[k - 1] + 1; m < s[k]; m++) if (!pw.glyphs[m]?.mark) { bad.push(`cursive set {${s.join(',')}} skips the non-mark glyph #${m}`); break; }
      }
      for (const i of s) if (pw.glyphs[i]?.mark) bad.push(`cursive set has a mark: #${i} ${pw.glyphs[i].name}`);
    }
    for (const [m, b] of mk?.marks ?? []) {
      if (!(m >= 0 && m < n && b >= 0 && b < n)) { bad.push(`mark pair [${m},${b}] is outside 0..${n - 1}`); continue; }
      if (!pw.glyphs[m].mark) bad.push(`mark pair [${m},${b}]: #${m} ${pw.glyphs[m].name} is not a mark glyph`);
    }
    // each set of cursive pairs (as recorded) must agree with the merged sets
    for (const [a, b] of cur?.entries ?? []) {
      if (!cur.hasPair(a, b) || !cur.hasPair(b, a)) bad.push(`cursive pair [${a},${b}] is not one set in both directions (sets were never merged)`);
    }
    if (bad.length) { rec.problems.push('attachment indexes do not line up'); console.warn('1. ATTACHMENT INDEXES:', bad); }
    else console.log('1. attachment indexes: consistent');
    console.log('   cursive sets:', (cur?.cursives ?? []).map(s => '{' + [...s].sort((a, b) => a - b).join(',') + '}').join(' ') || '(none)',
                ' mark pairs [mark,base]:', (mk?.marks ?? []).map(p => `[${p}]`).join(' ') || '(none)');

    // 2. stored v fresh evaluation -------------------------------------------------------------
    const stored = entry.ev;
    const fresh = fff.evaluate(hb, { returnFields: false });
    const qs = (e) => e ? `${e.quality} (near ${e.counts?.near}, glyph ${e.counts?.glyph})` : '(none)';
    if (stored && stored.quality !== fresh.quality) {
      rec.problems.push('stored evaluation differs from a fresh one');
      console.warn(`2. STORED v FRESH: stored quality ${qs(stored)}, fresh ${qs(fresh)} - the stored result is stale (or was made by the worker with different JSON)`);
    } else console.log(`2. stored v fresh: same, quality ${qs(fresh)}  (0 OK, 1 maybe, 2 kerning, 3 near, 4 glyph)`);
    rec.quality = fresh.quality;

    // 3-5. replay of processPair for every overlapping pair -----------------------------------
    const sf = hbg.addGlyphFieldsToResult(hb);
    const gfs = sf.hb.map(e => e.gf);
    const rows = [];
    try {
      // field sanity, once per glyph
      const fieldRows = pw.glyphs.filter(g => g.outline).map(g => {
        const gf = gfs[g.i], near = gf.getField('near'), nb = gf.getField('nearBase'), far = gf.getField('far');
        const own = boxOfField(gf.getField());
        return { i: g.i, name: g.name, mark: g.mark,
                 nearAmt: near?.amount, nearArea: areaOf(near), nearBaseAmt: nb?.amount, farAmt: far?.amount,
                 glyphArea: areaOf(gf.getField()), boxMatches: boxesAgree(own, g.box),
                 placedBox: `${fmt(g.box.x0)}..${fmt(g.box.x1)} / ${fmt(g.box.y0)}..${fmt(g.box.y1)}`,
                 fieldBox: own ? `${fmt(own.x0)}..${fmt(own.x1)} / ${fmt(own.y0)}..${fmt(own.y1)}` : '-' };
      });
      const badFields = fieldRows.filter(r => !r.nearArea || !r.glyphArea || !r.boxMatches || r.nearArea < r.glyphArea);
      if (badFields.length) { rec.problems.push('a glyph field is empty, smaller than its glyph or in the wrong place'); console.warn('5a. FIELD PROBLEMS:'); console.table(badFields); }
      else console.log('5a. fields: every glyph has a near field at least as large as the glyph, drawn where the glyph is placed');
      rec.fields = fieldRows;

      for (const A of pw.glyphs) {
        if (!A.outline) continue;
        for (const B of pw.glyphs) {
          if (B.i <= A.i || !B.outline) continue;
          if (GlyphQuery.distance(A, B, MAX_GAP + 1) > MAX_GAP) continue;                  // not overlapping
          const sameRun = runOf(A) === runOf(B);
          if (ONLY_DIFFERENT_RUN && sameRun) continue;
          const i = A.i, j = B.i, ga = gfs[i], gb = gfs[j];
          const nearA = ga.getField('near'), nearB = gb.getField('near');
          // which branch of processPair the pair takes
          const mp = mk && mk.findPair(i, j);
          const cl = hb[i].cl === hb[j].cl && !!(fff.getGlyphData(A.g)?.cl || fff.getGlyphData(B.g)?.cl);
          let path, used = null;
          let ruleNote = '';
          if (cur && cur.hasPair(i, j)) path = 'SKIPPED: same cursive set';
          else if (fff.glyphsCanOverlap(A.g, B.g)) {
            path = 'SKIPPED: JSON "overlaps" rule';
            // which rule(s) let it through
            ruleNote = fff.overlaps.map((set, k) => ({ set, k })).filter(({ set }) => set.has(A.g) && set.has(B.g))
              .map(({ set, k }) => `overlaps[${k}] = ${set.src} (${set.size} glyphs)`).join('; ');
          }
          else if (mp && (i === mp[1] || j === mp[1] || cur?.hasPair(i, mp[1]) || cur?.hasPair(j, mp[1]))) {
            path = 'mark v its base (nearBase x near)';
            const mark = i === mp[0] ? ga : gb, base = i === mp[0] ? gb : ga;
            const nbf = mark.getField('nearBase');
            used = nbf ? hit(nbf, base.getField('near')) : hit(mark.getField(), base.getField('near'));
          } else if (fff.glyphInBars(A.g) && fff.glyphInBars(B.g)) {
            path = 'bar (nearBar x nearBar)';
            used = hit(ga.getField('nearBar'), gb.getField('nearBar'));
          } else if (mp && cl) path = 'SKIPPED: cluster overlap';
          else { path = 'near x near'; used = hit(nearA, nearB); }
          const nearNear = hit(nearA, nearB);                                  // what it would be with no exemption
          const glyphGlyph = hit(ga.getField(), gb.getField());
          const farAway = !!(nearA && nearB && nearA.isFarAway(nearB));
          const flagged = used != null;

          let why = '';
          if (!flagged) {
            if (path.startsWith('SKIPPED')) why = path.replace('SKIPPED: ', 'exempt - ') + (ruleNote ? ': ' + ruleNote : '');
            else if (path.startsWith('mark')) why = nearNear != null ? 'the mark/base test (nearBase) is smaller than near x near, which does hit' : 'mark/base test found no hit';
            else if (!nearA || !nearB) why = 'a near field is missing';
            else if (!areaOf(nearA) || !areaOf(nearB)) why = 'a near field is empty';
            else if (farAway) why = 'near fields\' bounding boxes say "far away" although the outlines overlap (stale bbox?)';
            else if (!boxesAgree(boxOfField(ga.getField()), A.box) || !boxesAgree(boxOfField(gb.getField()), B.box)) why = 'the field is not where the glyph is placed';
            else why = 'Intersect64 found nothing although the outlines overlap and the fields are sound';
          }
          const row = { pair: `#${i} ${A.name} / #${j} ${B.name}`, runs: `${runOf(A)} / ${runOf(B)}`, path,
                        flagged, nearNearHit: nearNear != null, glyphHit: glyphGlyph != null, why };
          rows.push(row);
          rec.pairs.push({ ...row, i, j, cursivePair: !!cur?.hasPair(i, j), markPair: mp || null, farAway,
                           markAttachedTo: [A.base ? A.base.i : null, B.base ? B.base.i : null] });
        }
      }
    } finally {
      gfs.forEach(g => g.destroy());
    }

    if (!rows.length) {
      console.log('3-5. no overlapping pairs' + (ONLY_DIFFERENT_RUN ? ' in different cursive runs' : '') + ' found by the outlines');
    } else {
      console.log(`3-5. ${rows.length} overlapping pair(s) by outline; the force field would flag ${rows.filter(r => r.flagged).length}`);
      console.table(rows);
      const missed = rows.filter(r => !r.flagged);
      if (missed.length) rec.problems.push(...[...new Set(missed.map(r => r.why))]);
    }
    console.log(rec.problems.length ? `%cVERDICT for ${text}: ${rec.problems.join('; ')}` : `%cVERDICT for ${text}: nothing found wrong by these checks`,
                rec.problems.length ? 'color:#c30;font-weight:bold' : 'color:#080;font-weight:bold');
    console.groupEnd();
  }

  console.log('Result kept in window.__ffDiag (per word: problems, quality, per-glyph fields, per-pair rows).');
  return out;
})();
