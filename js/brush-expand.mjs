// brush-expand.mjs
// Non-uniform "brush" expansion of Clipper2 (WASM) paths.
//
//   import { setClipper, getBrush, expandWithBrush } from './brush-expand.mjs';
//   setClipper(Clipper2Z);                       // once, after the WASM module has loaded
//   const out = expandWithBrush(paths, getBrush('40,200@-30,100@30'));
//   ...                                          // use `out`
//   out.delete();                                // the caller owns the returned Paths64
//
// Brush spec strings:  "REACH@DEG,..."  (base 0)   or   "BASE,REACH@DEG,..."
//   - Angles are y-up degrees (pass yDown = true to getBrush for y-down coordinates).
//   - REACH is the absolute reach from the origin, not an addition to BASE:
//     reach(u) = max(BASE, tip . u).
//
// Everything except expandWithBrush is pure JS (no WASM), so parseBrushSpec,
// makeBrush, convexHull and sweepPiece can be unit-tested in Node without Clipper.

let C = null;          // Clipper2 module instance
let useZ = true;       // Clipper2Z build: Point64 takes a third (z) argument

/**
 * Provide the loaded Clipper2 WASM module.
 * @param {object} clipper  The module instance (e.g. Clipper2Z).
 * @param {{z?: boolean}} [opts]  z: true (default) for the Z build, false for the non-Z build.
 */
export function setClipper(clipper, { z = true } = {}) {
  C = clipper;
  useZ = z;
}

function requireClipper(clipper) {
  const c = clipper ?? C;
  if (!c) throw new Error('brush-expand: call setClipper(<Clipper2 module>) first, or pass it as an argument');
  return c;
}

// ---------------------------------------------------------------------------
// Geometry helpers (pure JS)
// ---------------------------------------------------------------------------

/** Convex hull, counter-clockwise (y-up), monotone chain. Points are [x, y]. */
export function convexHull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) {
    while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/**
 * Hull of (a + B) U (a + e + B), computed in O(m).
 * B is a convex CCW brush (a 2-point "segment" brush is also valid).
 * Returns an array of [x, y] vertices.
 */
export function sweepPiece(ax, ay, ex, ey, B) {
  const m = B.length, out = [];
  const front = k => {
    const p = B[k], q = B[(k + 1) % m];
    return (q[0] - p[0]) * ey - (q[1] - p[1]) * ex < 0;
  };
  for (let j = 0; j < m; j++) {
    const fp = front((j + m - 1) % m), fn = front(j), [bx, by] = B[j];
    if (fp && !fn)      out.push([ax + ex + bx, ay + ey + by], [ax + bx, ay + by]);
    else if (!fp && fn) out.push([ax + bx, ay + by], [ax + ex + bx, ay + ey + by]);
    else if (fn)        out.push([ax + ex + bx, ay + ey + by]);
    else                out.push([ax + bx, ay + by]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clipper glue
// ---------------------------------------------------------------------------

function makePoint(c, x, y) {
  return useZ
    ? new c.Point64(BigInt(x), BigInt(y), 0n)
    : new c.Point64(BigInt(x), BigInt(y));
}

function pushPath(c, dst, pts) {
  if (pts.length < 3) return;
  const q = new c.Path64();
  for (const [x, y] of pts) {
    const pt = makePoint(c, x, y);
    q.push_back(pt);
    pt.delete();
  }
  dst.push_back(q);
  q.delete();
}

/** Read a Paths64 into plain Number arrays (exact while |coord| < 2^53). */
function readRings(paths) {
  const rings = [];
  for (let i = 0; i < paths.size(); i++) {
    const p = paths.get(i), n = p.size(), xs = new Array(n), ys = new Array(n);
    for (let k = 0; k < n; k++) {
      const pt = p.get(k);
      xs[k] = Number(pt.x);
      ys[k] = Number(pt.y);
      pt.delete();
    }
    p.delete();
    rings.push({ xs, ys });
  }
  return rings;
}

/**
 * Expand `paths` (a Clipper Paths64) by the convex brush B.
 * Winding of the input does not matter. Returns a NEW Paths64; the caller must .delete() it.
 * @param {object} paths
 * @param {number[][]} B  Convex CCW brush from makeBrush()/getBrush().
 * @param {object} [clipper]  Overrides the instance set with setClipper().
 */
export function expandWithBrush(paths, B, clipper) {
  const c = requireClipper(clipper);
  const bands = new c.Paths64();
  try {
    for (const { xs, ys } of readRings(paths)) {
      const n = xs.length;
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n, ex = xs[j] - xs[k], ey = ys[j] - ys[k];
        if (ex || ey) pushPath(c, bands, sweepPiece(xs[k], ys[k], ex, ey, B));
      }
    }
    return c.Union64(paths, bands, c.FillRule.NonZero);
  } finally {
    bands.delete();
  }
}

// ---------------------------------------------------------------------------
// Brush spec parsing, construction and cache
// ---------------------------------------------------------------------------

/** Parse "REACH@DEG,..." or "BASE,REACH@DEG,..." into { base, tips }. */
export function parseBrushSpec(spec) {
  const tokens = String(spec).split(',').map(s => s.trim()).filter(Boolean);
  let base = 0;
  const tips = [];
  tokens.forEach((tok, i) => {
    const at = tok.indexOf('@');
    if (at < 0) {
      if (i !== 0) throw new Error(`Brush spec "${spec}": bare number only allowed first (as base)`);
      base = Number(tok);
      if (!Number.isFinite(base) || base < 0) throw new Error(`Brush spec "${spec}": bad base "${tok}"`);
    } else {
      const reach = Number(tok.slice(0, at)), deg = Number(tok.slice(at + 1));
      if (!Number.isFinite(reach) || reach <= 0 || !Number.isFinite(deg))
        throw new Error(`Brush spec "${spec}": bad tip "${tok}"`);
      tips.push({ reach, deg });
    }
  });
  if (base === 0 && tips.length === 0) throw new Error(`Brush spec "${spec}": empty brush`);
  return { base, tips };
}

/**
 * Build a convex CCW brush: a base disc (tangent-edge polygon) plus tips.
 * @param {number} base  Base radius (0 for none).
 * @param {{reach:number, deg:number}[]} tips
 * @param {number} [arcTol=0.25]  Arc tolerance for the base disc, in coordinate units.
 * @param {boolean} [yDown=false]  Negate angles for y-down coordinates.
 */
export function makeBrush(base, tips, arcTol = 0.25, yDown = false) {
  const pts = [];
  if (base > 0) {
    const steps = Math.min(720, Math.max(8,
      Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - arcTol / base)))));
    const r = base / Math.cos(Math.PI / steps);   // tangent edges: straight sides offset by exactly `base`
    for (let i = 0; i < steps; i++) {
      const a = 2 * Math.PI * i / steps;
      pts.push([Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))]);
    }
  } else {
    pts.push([0, 0]);   // the brush must contain the origin for the per-edge sweep to be valid
  }
  for (const t of tips) {
    const a = (yDown ? -t.deg : t.deg) * Math.PI / 180;
    pts.push([Math.round(t.reach * Math.cos(a)), Math.round(t.reach * Math.sin(a))]);
  }
  const hull = convexHull(pts);
  if (hull.length < 2)
    throw new Error('Brush collapsed to a single point after rounding; use larger reaches or scale up');
  return hull;
}

const brushCache = new Map();

/** Recall or create a brush from its spec string. The cache key includes arcTol and yDown. */
export function getBrush(spec, arcTol = 0.25, yDown = false) {
  const key = `${spec}|${arcTol}|${yDown ? 1 : 0}`;
  let brush = brushCache.get(key);
  if (brush === undefined) {
    const { base, tips } = parseBrushSpec(spec);
    brush = makeBrush(base, tips, arcTol, yDown);
    brushCache.set(key, brush);
  }
  return brush;
}

export const clearBrushCache = () => brushCache.clear();
