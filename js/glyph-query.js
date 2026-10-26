// GlyphQuery: shared helpers for console snippets (and, later, a UI) that look at where glyphs are placed.
//
//   GlyphQuery.scan({ title, test, list, apply, mode })   run test(word) over a word list, show progress and a table,
//                                                         and put the matching words in the Pattern List
//   GlyphQuery.placed(entry)                              a PlacedWord: every glyph with its placed position,
//                                                         outline, box, attachments and cursive run
//   GlyphQuery.distance / overlaps / clearance            outline geometry between placed glyphs
//   GlyphQuery.stats / printStats                         percentiles of a list of measurements
//
// All positions are font units, y up, in the word's left-to-right visual glyph order, with the GPOSE deltas
// applied (the same placement the main SVG draws). See console/README.md for the API and examples.
//
// Relies on globals from index.html: wordList, hbs, hbg, setPatternList, progressPanel (optional).
'use strict';

const GlyphQuery = (() => {
  // ---- per-glyph data (cached; call reset() after loading a different font) ----------------------------
  const nameCache = new Map(), markCache = new Map(), outlineCache = new Map();
  const nameOf = (g) => { let n = nameCache.get(g); if (n === undefined) { n = hbs.getGlyphName(g); nameCache.set(g, n); } return n; };
  const isMark = (g) => { let m = markCache.get(g); if (m === undefined) { m = !!hbs.isGlyphMark?.(g); markCache.set(g, m); } return m; };

  // Flattened outline of a glyph: { polys:[{pts:Float64Array(x,y,...), n, x0,x1,y0,y1}], x0,x1,y0,y1 } or null
  function outlineOf(g) {
    if (outlineCache.has(g)) return outlineCache.get(g);
    let r = null;
    try {
      const ps = hbg.ensureFields(g).getField()?.paths64;
      if (ps) {
        const polys = [];
        let X0 = Infinity, X1 = -Infinity, Y0 = Infinity, Y1 = -Infinity;
        for (let i = 0, n = ps.size(); i < n; i++) {
          const p = ps.get(i), sz = p.size(), pts = new Float64Array(sz * 2);
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let k = 0; k < sz; k++) {
            const pt = p.get(k), x = Number(pt.x), y = Number(pt.y);
            pt.delete();
            pts[2 * k] = x; pts[2 * k + 1] = y;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          p.delete();
          if (sz >= 2) { polys.push({ pts, n: sz, x0, x1, y0, y1 }); X0 = Math.min(X0, x0); X1 = Math.max(X1, x1); Y0 = Math.min(Y0, y0); Y1 = Math.max(Y1, y1); }
        }
        if (polys.length) r = { polys, x0: X0, x1: X1, y0: Y0, y1: Y1 };
      }
    } catch (e) { /* glyph without an outline */ }
    outlineCache.set(g, r);
    return r;
  }
  // The same outline with x and y swapped (cached), so the horizontal sliding code can also slide vertically
  function transposed(o) {
    if (!o._T) {
      o._T = {
        polys: o.polys.map(p => {
          const pts = new Float64Array(p.pts.length);
          for (let k = 0; k < p.n; k++) { pts[2 * k] = p.pts[2 * k + 1]; pts[2 * k + 1] = p.pts[2 * k]; }
          return { pts, n: p.n, x0: p.y0, x1: p.y1, y0: p.x0, y1: p.x1 };
        }),
        x0: o.y0, x1: o.y1, y0: o.x0, y1: o.x1,
      };
    }
    return o._T;
  }
  function reset() { nameCache.clear(); markCache.clear(); outlineCache.clear(); }

  // ---- outline geometry (raw outlines + offsets) -------------------------------------------------------
  const boxGap = (a, ax, ay, b, bx, by) => Math.hypot(      // gap between two shifted boxes (0 if they overlap)
    Math.max(a.x0 + ax - (b.x1 + bx), b.x0 + bx - (a.x1 + ax), 0),
    Math.max(a.y0 + ay - (b.y1 + by), b.y0 + by - (a.y1 + ay), 0));
  const ptSeg2 = (px, py, ax, ay, bx, by) => {               // squared distance from a point to a segment
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  };
  const side = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const inside = (B, bx, by, x, y) => {                      // non-zero winding: is (x,y) inside outline B?
    let w = 0;
    for (const pb of B.polys) {
      for (let i = 0; i < pb.n; i++) {
        const j = (i + 1) % pb.n;
        const x1 = pb.pts[2 * i] + bx, y1 = pb.pts[2 * i + 1] + by, x2 = pb.pts[2 * j] + bx, y2 = pb.pts[2 * j + 1] + by;
        const c = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
        if (y1 <= y) { if (y2 > y && c > 0) w++; } else if (y2 <= y && c < 0) w--;
      }
    }
    return w !== 0;
  };
  // the point on segment (ax,ay)-(bx,by) nearest to (px,py)
  const nearOnSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return [ax + t * dx, ay + t * dy];
  };
  // Shortest distance between outlines A and B (each shifted), looking no further than `limit` (returned if
  // they are further apart). 0 if they cross, touch, or one lies inside the other. When `out` is given it also
  // receives the nearest points (out.ax,ay on A, out.bx,by on B; out.found), and out.nested = 'a' | 'b' if one
  // outline lies wholly inside the other.
  function outlineSearch(A, ax, ay, B, bx, by, limit, out) {
    let best = limit, best2 = limit * limit;
    for (const pa of A.polys) {
      for (const pb of B.polys) {
        if (boxGap(pa, ax, ay, pb, bx, by) >= best) continue;
        for (let i = 0; i < pa.n; i++) {
          const j = (i + 1) % pa.n;
          const x1 = pa.pts[2 * i] + ax, y1 = pa.pts[2 * i + 1] + ay, x2 = pa.pts[2 * j] + ax, y2 = pa.pts[2 * j + 1] + ay;
          const sx0 = Math.min(x1, x2) - best, sx1 = Math.max(x1, x2) + best, sy0 = Math.min(y1, y2) - best, sy1 = Math.max(y1, y2) + best;
          for (let k = 0; k < pb.n; k++) {
            const m = (k + 1) % pb.n;
            const x3 = pb.pts[2 * k] + bx, y3 = pb.pts[2 * k + 1] + by, x4 = pb.pts[2 * m] + bx, y4 = pb.pts[2 * m + 1] + by;
            if ((x3 < sx0 && x4 < sx0) || (x3 > sx1 && x4 > sx1) || (y3 < sy0 && y4 < sy0) || (y3 > sy1 && y4 > sy1)) continue;
            const d1 = side(x3, y3, x4, y4, x1, y1), d2 = side(x3, y3, x4, y4, x2, y2);
            const d3 = side(x1, y1, x2, y2, x3, y3), d4 = side(x1, y1, x2, y2, x4, y4);
            if (d1 * d2 < 0 && d3 * d4 < 0) {                                  // the outlines cross
              if (out) {
                const t = d1 / (d1 - d2);
                out.ax = out.bx = x1 + t * (x2 - x1); out.ay = out.by = y1 + t * (y2 - y1); out.found = true;
              }
              return 0;
            }
            const c1 = ptSeg2(x1, y1, x3, y3, x4, y4), c2 = ptSeg2(x2, y2, x3, y3, x4, y4);
            const c3 = ptSeg2(x3, y3, x1, y1, x2, y2), c4 = ptSeg2(x4, y4, x1, y1, x2, y2);
            const d = Math.min(c1, c2, c3, c4);
            if (d < best2) {
              best2 = d; best = Math.sqrt(d);
              if (out) {
                out.found = true;
                if (d === c1)      { out.ax = x1; out.ay = y1; [out.bx, out.by] = nearOnSeg(x1, y1, x3, y3, x4, y4); }
                else if (d === c2) { out.ax = x2; out.ay = y2; [out.bx, out.by] = nearOnSeg(x2, y2, x3, y3, x4, y4); }
                else if (d === c3) { out.bx = x3; out.by = y3; [out.ax, out.ay] = nearOnSeg(x3, y3, x1, y1, x2, y2); }
                else               { out.bx = x4; out.by = y4; [out.ax, out.ay] = nearOnSeg(x4, y4, x1, y1, x2, y2); }
              }
              if (best2 === 0) return 0;
            }
          }
        }
      }
    }
    if (boxGap(A, ax, ay, B, bx, by) === 0) {                                  // nested outlines never cross
      for (const pa of A.polys) if (inside(B, bx, by, pa.pts[0] + ax, pa.pts[1] + ay)) { if (out) out.nested = 'a'; return 0; }
      for (const pb of B.polys) if (inside(A, ax, ay, pb.pts[0] + bx, pb.pts[1] + by)) { if (out) out.nested = 'b'; return 0; }
    }
    return best;
  }
  const outlineDistance = (A, ax, ay, B, bx, by, limit = Infinity) => outlineSearch(A, ax, ay, B, bx, by, limit, null);
  // How far outline N can slide in direction `dir` (-1 left, +1 right) before it touches outline G. Infinity if never.
  function slide(N, nx, ny, G, gx, gy, dir) {
    let best = Infinity;
    for (const pn of N.polys) {
      for (const pg of G.polys) {
        if (pn.y1 + ny < pg.y0 + gy || pn.y0 + ny > pg.y1 + gy) continue;       // no shared height
        for (let i = 0; i < pn.n; i++) {                       // N's corners hitting G's edges
          const vx = pn.pts[2 * i] + nx, vy = pn.pts[2 * i + 1] + ny;
          for (let k = 0; k < pg.n; k++) {
            const m = (k + 1) % pg.n;
            const x3 = pg.pts[2 * k] + gx, y3 = pg.pts[2 * k + 1] + gy, x4 = pg.pts[2 * m] + gx, y4 = pg.pts[2 * m + 1] + gy;
            if (y3 === y4 || vy < Math.min(y3, y4) || vy > Math.max(y3, y4)) continue;
            const d = dir * ((x3 + (vy - y3) * (x4 - x3) / (y4 - y3)) - vx);
            if (d >= 0 && d < best) best = d;
          }
        }
        for (let k = 0; k < pg.n; k++) {                       // G's corners hitting N's edges
          const wx = pg.pts[2 * k] + gx, wy = pg.pts[2 * k + 1] + gy;
          for (let i = 0; i < pn.n; i++) {
            const j = (i + 1) % pn.n;
            const x1 = pn.pts[2 * i] + nx, y1 = pn.pts[2 * i + 1] + ny, x2 = pn.pts[2 * j] + nx, y2 = pn.pts[2 * j + 1] + ny;
            if (y1 === y2 || wy < Math.min(y1, y2) || wy > Math.max(y1, y2)) continue;
            const d = dir * (wx - (x1 + (wy - y1) * (x2 - x1) / (y2 - y1)));
            if (d >= 0 && d < best) best = d;
          }
        }
      }
    }
    return best;
  }
  // do outlines A and B cross, touch, or does one lie inside the other?
  function outlinesOverlap(A, ax, ay, B, bx, by) { return outlineDistance(A, ax, ay, B, bx, by, 1) === 0; }

  // ---- placed glyphs and words -------------------------------------------------------------------------
  class PlacedGlyph {
    constructor(word, i, g, px, py) {
      this.word = word; this.i = i; this.g = g; this.px = px; this.py = py;
      this.name = nameOf(g); this.mark = isMark(g);
    }
    get outline() { return this._o === undefined ? (this._o = outlineOf(this.g)) : this._o; }
    /** placed bounding box {x0,x1,y0,y1} of the outline, or null if the glyph has none */
    get box() {
      if (this._b === undefined) { const o = this.outline; this._b = o ? { x0: o.x0 + this.px, x1: o.x1 + this.px, y0: o.y0 + this.py, y1: o.y1 + this.py } : null; }
      return this._b;
    }
    get hasDelta() { return !!this.word.entry.hasDeltaAt(this.i); }
    /** the glyph this mark is attached to (a PlacedGlyph), or undefined */
    get base() { return this.word.glyphs[this.word._baseOf.get(this.i)]; }
    /** the base at the end of any mark-to-mark chain */
    get rootBase() {
      let b = this.base, guard = 8;
      while (b && b.base && guard--) b = b.base;
      return b;
    }
    /** the marks attached to this glyph */
    get marks() { return this.word.glyphs.filter(m => m.base === this); }
    /** id of this glyph's cursive run (glyphs joined by cursive attachment); an unjoined glyph is a run of one */
    get run() { return this.word.run(this.i); }
    is(re) { return re.test(this.name); }
  }

  class PlacedWord {
    constructor(entry, index) {
      this.entry = entry; this.index = index;
      const hb = hbs.applyDeltaArray(entry.hb, entry.delta);          // HarfBuzz result + the GPOSE deltas
      let x = 0, y = 0;
      this.glyphs = hb.map((e, i) => {
        const p = new PlacedGlyph(this, i, e.g, x + e.dx, y + e.dy);
        x += e.ax; y += e.ay;
        return p;
      });
      this._baseOf = new Map((entry.hb.attachments?.marks?.marks ?? []).map(([mk, base]) => [mk, base]));
      this._runOf = new Map();
      (entry.hb.attachments?.cursives?.cursives ?? []).forEach((set, r) => { for (const i of set) this._runOf.set(i, r); });
    }
    get text() { return this.entry.getWord(); }
    run(i) { return this._runOf.has(i) ? `r${this._runOf.get(i)}` : `g${i}`; }
    /** glyphs whose name matches re */
    find(re) { return this.glyphs.filter(g => re.test(g.name)); }
  }

  const placed = (entryOrIndex) => {
    const entry = typeof entryOrIndex === 'number' ? wordList.get(entryOrIndex) : entryOrIndex;
    return entry?.hb ? new PlacedWord(entry, typeof entryOrIndex === 'number' ? entryOrIndex : wordList.list.indexOf(entry)) : null;
  };

  // ---- relations between placed glyphs --------------------------------------------------------------------
  /** shortest outline-to-outline distance (0 if overlapping); Infinity if either has no outline */
  const distance = (a, b, limit = Infinity) => (a.outline && b.outline)
    ? outlineDistance(a.outline, a.px, a.py, b.outline, b.px, b.py, limit) : Infinity;
  /**
   * The nearest points of two placed glyphs' outlines: { d, a: {x,y}, b: {x,y}, dx, dy, touching, nested }, or null if
   * either glyph has no outline or they are further apart than `limit`. (dx, dy) = point on b minus point on a, signed
   * (font units, y up). For crossing / touching outlines d = 0 and both points are where they meet; if one outline lies
   * wholly inside the other, d = 0, dx = dy = 0, nested = 'a' | 'b' (a is inside b / b is inside a) and the points are
   * the nearest boundary points (null if those are further than `limit`).
   */
  const closest = (a, b, limit = Infinity) => {
    if (!a.outline || !b.outline) return null;
    if (boxGap(a.box, 0, 0, b.box, 0, 0) >= limit) return null;                 // the boxes alone put them out of range
    const out = { found: false, nested: null };
    const d = outlineSearch(a.outline, a.px, a.py, b.outline, b.px, b.py, limit, out);
    if (!out.found && !out.nested) return d < limit || d === 0 ? { d, a: null, b: null, dx: 0, dy: 0, touching: d === 0, nested: null } : null;
    const flat = d === 0;                                                       // overlapping: no direction
    return {
      d, nested: out.nested, touching: flat,
      a: out.found ? { x: out.ax, y: out.ay } : null, b: out.found ? { x: out.bx, y: out.by } : null,
      dx: flat || !out.found ? 0 : out.bx - out.ax, dy: flat || !out.found ? 0 : out.by - out.ay,
    };
  };
  /**
   * A glyph matcher in the Bulk Apply style: 'name' (exact), '/regexp/' (tested against the name) or '~' (any mark glyph:
   * the font's mark class), and a leading '!' inverts any of them ('!~' = any glyph that is not a mark). Empty text gives
   * null. Throws on a bad regexp. The returned test is called as test(name, isMark); '~' needs isMark (a PlacedGlyph's .mark).
   */
  function matcher(text) {
    text = (text ?? '').trim();
    if (!text) return null;
    let invert = false;
    if (text[0] === '!') { invert = true; text = text.slice(1); }
    let test;
    if (text === '~') test = (n, isMark) => !!isMark;
    else if (text.length > 2 && text[0] === '/' && text.endsWith('/')) { const re = new RegExp(text.slice(1, -1), 'u'); test = (n) => re.test(n); }
    else test = (n) => n === text;
    return invert ? (n, isMark) => !test(n, isMark) : test;
  }
  const overlaps = (a, b) => !!(a.outline && b.outline) && outlinesOverlap(a.outline, a.px, a.py, b.outline, b.px, b.py);
  /** gap between the two glyphs' bounding boxes (0 if they overlap) */
  const boxDistance = (a, b) => (a.box && b.box) ? boxGap(a.box, 0, 0, b.box, 0, 0) : Infinity;
  /**
   * How far glyph n can slide before touching any of `others`: left (`dir: -1`) or right (`+1`) along x, or
   * (`axis: 'y'`) down (`-1`) or up (`+1`). Only glyphs in n's lane (its height for x, its width for y) within `look`
   * units in that direction are considered. A glyph already overlapping n counts as 0. Returns { d, by }
   * (d = Infinity if nothing is in the way). `stopAt`: give up once d <= stopAt.
   */
  const clearance = (n, others, { dir = -1, axis = 'x', look = 600, stopAt = null } = {}) => {
    const nb = n.box, res = { d: Infinity, by: null };
    if (!nb || !n.outline) return res;
    const Y = axis === 'y';
    const [nA0, nA1, nP0, nP1] = Y ? [nb.y0, nb.y1, nb.x0, nb.x1] : [nb.x0, nb.x1, nb.y0, nb.y1];   // along / across
    for (const G of others) {
      if (G === n) continue;
      const gb = G.box;
      if (!gb || !G.outline) continue;
      const [gA0, gA1, gP0, gP1] = Y ? [gb.y0, gb.y1, gb.x0, gb.x1] : [gb.x0, gb.x1, gb.y0, gb.y1];
      if (gP1 < nP0 || gP0 > nP1) continue;                                      // not in n's lane
      if (dir < 0 ? (gA1 < nA0 - look || gA0 > nA1) : (gA0 > nA1 + look || gA1 < nA0)) continue;
      const d = overlaps(n, G) ? 0
        : Y ? slide(transposed(n.outline), n.py, n.px, transposed(G.outline), G.py, G.px, dir)
            : slide(n.outline, n.px, n.py, G.outline, G.px, G.py, dir);
      if (d < res.d) { res.d = d; res.by = G; }
      if (stopAt != null && res.d <= stopAt) break;
    }
    return res;
  };

  // ---- inspecting a word ----------------------------------------------------------------------------------
  /**
   * Print (and return) a table of every glyph of a word: placed position, box, attachment and cursive run.
   * Pass a PlacedWord, a word-list index, an entry, the word's text, or nothing for the displayed word.
   */
  function describe(w) {
    let word = w;
    if (w === undefined) word = placed(wordList.getCurrentIndex());
    else if (typeof w === 'string') { const e = wordList.findWord?.(w); word = e ? placed(e) : null; }
    else if (!(w instanceof PlacedWord)) word = placed(w);
    if (!word) { console.warn('GlyphQuery.describe: no such word'); return null; }
    const f = (v) => Math.round(v);
    const rows = word.glyphs.map(g => ({
      i: g.i, name: g.name, mark: g.mark, px: f(g.px), py: f(g.py),
      x: g.box ? `${f(g.box.x0)}..${f(g.box.x1)}` : '-', y: g.box ? `${f(g.box.y0)}..${f(g.box.y1)}` : '-',
      base: g.base ? `#${g.base.i} ${g.base.name}` : '', rootBase: g.rootBase ? `#${g.rootBase.i}` : '',
      run: g.run, delta: g.hasDelta,
    }));
    console.log(`${word.text} (#${word.index + 1})`);
    console.table(rows);
    return rows;
  }

  // ---- statistics ---------------------------------------------------------------------------------------
  /** one table row of percentiles for a list of numbers */
  function stats(name, arr) {
    const s = [...arr].sort((a, b) => a - b);
    const pct = (p) => s.length ? s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] : '-';
    const r = (v) => typeof v === 'number' ? Math.round(v * 10) / 10 : v;
    return { measure: name, n: s.length, min: r(pct(0)), p1: r(pct(1)), p5: r(pct(5)), p25: r(pct(25)), median: r(pct(50)),
             p75: r(pct(75)), p95: r(pct(95)), p99: r(pct(99)), max: s.length ? r(s[s.length - 1]) : '-' };
  }
  const printStats = (...rows) => console.table(rows);

  // ---- scanning a word list ---------------------------------------------------------------------------
  /** the key of the list selected in the main window ('all', 'kerning', 'pattern', ...) */
  function activeListKey() {
    const q = (id) => globalThis[id]?.checked;
    if (q('radClassCollision')) return 'collision';
    if (q('radClassNear')) return 'near';
    if (q('radClassKerning')) return 'kerning';
    if (q('radClassMaybe')) return 'maybe';
    if (q('radClassPattern')) return 'pattern';
    if (q('radClassEdited')) return 'edited';
    return 'all';
  }
  /** list: null/'all' = every word, 'kerning' etc = a named list, 'active' = the main window's list, or an index array */
  function listIndices(list) {
    if (Array.isArray(list)) return list;
    const key = list === 'active' ? activeListKey() : (list ?? 'all');
    return key === 'all' ? wordList.list.map((_, i) => i) : (wordList.filtered[key] ?? []);
  }

  /**
   * Run `test(word, entry)` over a word list. `word` is a PlacedWord. test returns a falsy value for no match,
   * or an object (one table row) for a match. Shows the progress panel (Abort works), logs a summary and a
   * table, keeps the result in GlyphQuery.last (and window[resultVar] if given), and - when `apply` - puts the
   * matching words in the Pattern List ('replace' | 'merge' | 'subtract').
   * Returns { hits, words, searched, ms }.
   */
  async function scan({ title = 'Scan', test, list = null, apply = true, mode = 'replace', show = 60, resultVar = null, quiet = false } = {}) {
    const t0 = performance.now();
    const indices = listIndices(list);
    const hits = [], words = [];
    const pp = globalThis.progressPanel;
    if (pp) await pp.start(indices.length, title, true);
    let searched = 0;
    try {
      for (let n = 0; n < indices.length; n++) {
        const wi = indices[n];
        if (pp) { await pp.setProgress(n); if (pp.aborted()) break; }
        searched++;
        const word = placed(wi);
        if (!word) continue;
        const row = test(word, word.entry);
        if (row) { hits.push({ index: wi + 1, word: word.text, ...(typeof row === 'object' ? row : {}) }); words.push(wi); }
      }
    } finally {
      if (pp) await pp.done();
    }
    const ms = Math.round(performance.now() - t0);
    const result = { hits, words, searched, ms };
    GlyphQuery.last = result;
    if (resultVar) globalThis[resultVar] = hits;
    if (!quiet) {
      console.log(`${title}: ${hits.length} words match (${searched} searched, ${ms} ms).` + (resultVar ? ` Full list in window.${resultVar}` : ' Full list in GlyphQuery.last.hits'));
      console.table(hits.slice(0, show));
    }
    if (apply && words.length) {
      setPatternList(words, mode);
      if (!quiet) console.log(`Pattern List ${mode === 'replace' ? 'replaced with' : mode === 'merge' ? 'merged with' : 'minus'} ${words.length} words. Select "Pattern" in the main list to step through them.`);
    }
    return result;
  }

  return { scan, placed, describe, PlacedGlyph, PlacedWord, distance, closest, matcher, boxDistance, overlaps, clearance, stats, printStats,
           listIndices, activeListKey, outlineOf, reset, last: null };
})();
