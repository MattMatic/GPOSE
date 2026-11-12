// PlacementCore: small pure helpers shared by the Placement panel (js/placement-panel.js) and the
// consistency check (js/consistency-check.js). No DOM, no globals other than the ones passed in.
//
//   PlacementCore.fam(name)          'BEi15' -> 'BEi'  (glyph family: the name without its trailing number)
//   PlacementCore.form(name)         'BEi15' -> 'i'    (Gulzar naming: LETTER + form i/m/f/u + variant)
//   PlacementCore.tierOf(h, size)    round a height to the nearest multiple of size (no -0)
//   PlacementCore.num(x)             x if it is a number, else 0
//   PlacementCore.glyphInfo(hbs)     cached name / mark / ignorable lookups for the loaded font
//   PlacementCore.placeWord(entry, info)
//                                    every glyph of a word-list entry with its FINAL placement
//                                    (HarfBuzz position + GPOSE delta), its delta, the glyph it is attached to
//                                    and its nearest base neighbours
//
// Positions are font units, y up, in the word's left-to-right visual glyph order (as GlyphQuery).
'use strict';

const PlacementCore = (() => {
  const FORM_RE = /^[A-Z]+([imfu])(?=\d|\.|$)/;   // Gulzar naming: LETTER + form + variant (BEi15)

  const fam = (n) => (n === undefined || n === null ? '^' : n.replace(/\d+$/, ''));
  const form = (n) => (n === undefined || n === null ? '.' : (FORM_RE.exec(n)?.[1] ?? '-'));
  const num = (x) => (typeof x === 'number' && !isNaN(x) ? x : 0);

  // Round a height to the nearest multiple of `size` (no -0)
  const tierOf = (h, size) => {
    const sz = size > 0 ? size : 100;
    const t = Math.round(h / sz) * sz;
    return t === 0 ? 0 : t;
  };

  // Default_Ignorable glyphs (ZWNJ etc.), by name, as js/ignorable-glyphs.mjs (copied from gpos-miner).
  // Keep the two lists in step. GID 0 (.notdef) is always ignorable.
  const IGNORABLE_GLYPH_NAMES = new Set([
    'zerowidthnonjoiner', 'zerowidthjoiner', 'softhyphen', 'zerowidthspace', 'wordjoiner', 'zerowidthnobreakspace',
    'uni200C', 'uni200D', 'uni034F', 'uni00AD', 'uni200B', 'uni200E', 'uni200F', 'uni2060',
  ]);

  /** Cached glyph lookups for one font. Make a new one after loading a different font. */
  function glyphInfo(hbs) {
    const names = new Map(), marks = new Map();
    const nameOf = (g) => {
      let n = names.get(g);
      if (n === undefined) { n = hbs.getGlyphName(g) ?? `gid${g}`; names.set(g, n); }
      return n;
    };
    const isMark = (g) => {
      let m = marks.get(g);
      if (m === undefined) { m = !!hbs.isGlyphMark?.(g); marks.set(g, m); }
      return m;
    };
    const isIgnorable = (g) => g === 0 || IGNORABLE_GLYPH_NAMES.has(nameOf(g));
    return { nameOf, isMark, isIgnorable };
  }

  /**
   * One record per glyph of a word-list entry, or null if the entry is not shaped.
   *   i, g, name, mark, ignorable
   *   x, y        final placed position (pen position + HarfBuzz offset + GPOSE delta)
   *   ax          final advance (HarfBuzz + delta)
   *   delta       { dx, dy, ax } the GPOSE (human) correction, zeros if none; hasDelta: any of them non-zero
   *   ref         for a mark: the glyph it is attached to (mark-to-base or mark-to-mark); if HarfBuzz reports no
   *               attachment, the nearest base glyph after it in the array (the letter it follows in logical
   *               order), else before it; -1 if none. For a base: -1.
   *   attached    true when ref came from HarfBuzz's attachment record
   *   left, right nearest base glyph (not a mark, not ignorable) before / after this glyph in the array; -1 if none
   */
  function placeWord(entry, info) {
    const hb = entry?.hb;
    if (!hb) return null;
    const n = hb.length;
    const delta = entry.delta;
    const gs = new Array(n);
    let penX = 0, penY = 0;
    for (let i = 0; i < n; i++) {
      const h = hb[i];
      const d = delta?.[i];
      const ddx = num(d?.dx), ddy = num(d?.dy), dax = num(d?.ax), day = num(d?.ay);
      const g = h.g;
      gs[i] = {
        i, g, name: info.nameOf(g), mark: info.isMark(g), ignorable: info.isIgnorable(g),
        x: penX + num(h.dx) + ddx, y: penY + num(h.dy) + ddy, ax: num(h.ax) + dax,
        delta: { dx: ddx, dy: ddy, ax: dax }, hasDelta: !!(ddx || ddy || dax),
        ref: -1, attached: false, left: -1, right: -1,
      };
      penX += num(h.ax) + dax;
      penY += num(h.ay) + day;
    }
    // Nearest base glyph on each side
    let last = -1;
    for (let i = 0; i < n; i++) {
      gs[i].left = last;
      if (!gs[i].mark && !gs[i].ignorable) last = i;
    }
    last = -1;
    for (let i = n - 1; i >= 0; i--) {
      gs[i].right = last;
      if (!gs[i].mark && !gs[i].ignorable) last = i;
    }
    // Marks: what they are attached to
    for (const pair of hb.attachments?.marks?.marks ?? []) {
      const [mk, base] = pair;
      if (gs[mk] && gs[base]) { gs[mk].ref = base; gs[mk].attached = true; }
    }
    for (const r of gs) {
      if (r.mark && r.ref < 0) r.ref = r.right >= 0 ? r.right : r.left;
    }
    return { glyphs: gs, width: penX };
  }

  return { fam, form, num, tierOf, glyphInfo, placeWord, IGNORABLE_GLYPH_NAMES };
})();
