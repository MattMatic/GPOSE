// HarfBuzz to Clipper Conversion Classes
// github.com/MattMatic
// 2026-02-06
//
// TODO: JSDoc documentation
//
// CAUTION: When using CPaths64 objects you SHOULD call `.destroy()` to free the
//          WASM memory. Although garbage collection does mostly work, you cannot
//          guarantee the timing of gc, or even if the JS engine will actually call it.
//          So, GC is there as a failsafe, but *please* call `.destroy()`!
//          It also seems to be about 10% quicker to destroy.
//
// NOTE: The CPaths64 objects are handled by garbage collection.
//       The WASM objects *must* have .clear()/.delete() called,
//       otherwise there will be memory remaining linked to the WASM
//
'use strict';

import Clipper2ZFactory from "./clipper2z.js"
import {quadBezFlatten, cubicBezNumQuadratics, evalQuadBez } from "./flatbezier.js"
import { HarfBuzzShaping } from "./hbshaping.mjs"

const promises = [
      Clipper2ZFactory(),
    ];

let Clipper2Z;

/* Garbage Collection tracing and testing */
let clipperGC = {
  frees: 0,
  stale: 0,
};
/**/

// Used to clean up the WASM memory when an object goes out of scope
const clipperRegistry = new FinalizationRegistry((ps64) => {
  try {
    if (ps64) {
      /**/clipperGC.frees++;/**/
      ps64.clear();
      ps64.delete();
      ps64 = null;
    } else {
      /**/clipperGC.stale++;/**/
    }
  } catch (err) {
    console.error('GC failed ', err, ps64);
  }
});

const clipperReady = Promise.all(promises).then(([aClipper2Z]) => {
  Clipper2Z = aClipper2Z;
});

/*
 * Class to wrap up a Clipper2 Paths64 and Bounding Box
 * and provide some basic optimisation calculations
 */
class CPaths64 {
  constructor(paths64, dontFindBoundingBox) {
    this.bbox = {x:{min:NaN, max:NaN},y:{min:NaN, max:NaN},width:0,height:0};
    if (paths64) {
      this.setPaths64(paths64, dontFindBoundingBox);
    }
    else {
      this.paths64 = new Clipper2Z.Paths64();
      clipperRegistry.register(this, this.paths64, this);
    }
  }
  destroy() {
    this.freePath();
  }
  freePath() {
    if (!this.paths64) return;
    let ps64 = this.paths64;
    clipperRegistry.unregister(this);
    this.paths64 = null;
    ps64.clear();
    ps64.delete();
    ps64 = null;
  }
  // Set this CPaths64 to a Clipper2Z Paths64 value, updating the bounding box
  setPaths64(ps64, dontFindBoundingBox) {
    if (ps64 !== this.paths64) {
      this.freePath();
    }
    this.paths64 = ps64;
    clipperRegistry.register(this, this.paths64, this);
    if (!dontFindBoundingBox) this.findBoundingBox();
  }
  getPathCount() { return this.paths64.size(); }
  findPathBoundingBox(i) {
    const { IsPositive64 } = Clipper2Z;
    if (i >= this.paths64.size()) return undefined;
    const bbox = {x:{min:NaN, max:NaN}, y:{min:NaN, max:NaN}};
    const path = this.paths64.get(i);
    const sizep = path.size();
    for (let ii=0; ii<sizep; ii++) {
      const point = path.get(ii);
      const x = Number(point.x);
      const y = Number(point.y);
      if ((ii===0) || (x < bbox.x.min)) bbox.x.min = x;
      if ((ii===0) || (x > bbox.x.max)) bbox.x.max = x;
      if ((ii===0) || (y < bbox.y.min)) bbox.y.min = y;
      if ((ii===0) || (y > bbox.y.max)) bbox.y.max = y;
      point.delete();
    }
    bbox.positive = IsPositive64(path);
    path.delete();
    return bbox;
  }
  // Iterate through the paths and each path to find bounding box
  findBoundingBox() {
    const bb = {x:{min:NaN, max:NaN}, y:{min:NaN, max:NaN}}
    const size = this.paths64.size();
    for (let i=0; i<size; i++) {
      const pbb = this.findPathBoundingBox(i);
      if ((i===0) || (pbb.x.min < bb.x.min)) bb.x.min = pbb.x.min;
      if ((i===0) || (pbb.x.max > bb.x.max)) bb.x.max = pbb.x.max;
      if ((i===0) || (pbb.y.min < bb.y.min)) bb.y.min = pbb.y.min;
      if ((i===0) || (pbb.y.max > bb.y.max)) bb.y.max = pbb.y.max;
    }
    this.bbox = bb;
    this.updateWidthHeight();
  }
  // Update just the bounding box width and height
  updateWidthHeight() {
    this.bbox.width  = (this.bbox.x.max - this.bbox.x.min);
    this.bbox.height = (this.bbox.y.max - this.bbox.y.min);
  }
  // Return the bound box
  getBoundingBox() {
    return this.bbox;
  }
  // Iterate through all paths and remove any that are smaller than `minArea`
  removeSmallAreas(minArea) {
    const { AreaPath64, Paths64 } = Clipper2Z;
    const count = this.paths64.size();
    const output = new Paths64();
    for (let i=0; i<count;i++) {
      const path = this.paths64.get(i);
      const area = Math.abs(AreaPath64(path));
      if (area >= minArea) {
        output.push_back(path);
      } else {
        path.delete();
      }
    }
    this.freePath();
    this.setPaths64(output);
    this.findBoundingBox(); // Might have changed if small areas were on the outside edges
  }
  // Translate this path by (oxi, oyi) and return a new CPaths64
  translateToNewCPaths64(oxi, oyi) {
    oxi = Math.round(Number(oxi));
    oyi = Math.round(Number(oyi));
    const { TranslatePaths64 } = Clipper2Z;
    const result = new CPaths64(TranslatePaths64(this.paths64, oxi, oyi), true);
    result.bbox.x.min = this.bbox.x.min + oxi;
    result.bbox.x.max = this.bbox.x.max + oxi;
    result.bbox.y.min = this.bbox.y.min + oyi;
    result.bbox.y.max = this.bbox.y.max + oyi;
    result.updateWidthHeight();
    return result;
  }
  duplicatePath() {
    const { TranslatePaths64 } = Clipper2Z;
    const result = new CPaths64();
    result.setPaths64(TranslatePaths64(this.paths64, 0, 0), true);
    return result;
  }
  // Inflate this path by `idelta` and return a new CPaths64 object.
  // options.
  //   .jointype = JoinType.Miter
  //   .mitreLimit = 25
  //   .arcTolerance = 0.1
  //   .simplifyFactor = 0.5
  inflateToNewCPaths64(idelta, options={}) {
    const { MakePath64, Paths64, InflatePaths64, SimplifyPaths64, Difference64, FillRule, JoinType, EndType } = Clipper2Z;
    const {
      mitreLimit=25,
      arcTolerance=0.1,
      simplifyFactor=0.1,
      jointype=JoinType.Round,
      remove=undefined,
    } = options;
    const result = new CPaths64();
    let p = this.paths64;
    if (remove) {
      p = Difference64(p, remove.paths64, FillRule.NonZero);
    }
    let newpaths64 = InflatePaths64(p, idelta, jointype, EndType.Polygon, mitreLimit, arcTolerance);
    if (simplifyFactor > 0) {
      const oldpaths64 = newpaths64;
      newpaths64 = SimplifyPaths64(oldpaths64, simplifyFactor);
      oldpaths64.clear();
      oldpaths64.delete();
    }
    result.setPaths64(newpaths64);
    //--//this.removeSmallAreas(idelta * idelta);
    return result;
  }
  // Check whether this and `cp` are far away (using the bounding boxes)
  isFarAway(cp) {
    // Comparing bounding boxes to optimise calculations
    if (isNaN(cp?.bbox?.x.min)) return false;
    if (isNaN(cp?.bbox?.x.max)) return false;
    if (isNaN(cp?.bbox?.y.min)) return false;
    if (isNaN(cp?.bbox?.y.max)) return false;
    if (isNaN(this?.bbox?.x.min)) return false;
    if (isNaN(this?.bbox?.x.max)) return false;
    if (isNaN(this?.bbox?.y.min)) return false;
    if (isNaN(this?.bbox?.y.max)) return false;
    if (cp.bbox.x.min > this.bbox.x.max) return true;
    if (cp.bbox.x.max < this.bbox.x.min) return true;
    if (cp.bbox.y.min > this.bbox.y.max) return true;
    if (cp.bbox.y.max < this.bbox.y.min) return true;
    return false; // _might_ collide. Need to do geometry
  }
  // Check for collisions between this and `cp`
  // Returns null if no collision.
  // Otherwise returns a new CPaths64 with the intersection
  collisionCPath(cp) {
    const { Intersect64, FillRule } = Clipper2Z;
    if (this.isFarAway(cp)) {
      return null;
    }
    const intersect = Intersect64(this.paths64, cp.paths64, FillRule.NonZero);
    if (intersect.size() == 0) {
      intersect.clear();
      intersect.delete();
      return null;
    }
    const result = new CPaths64(intersect);
    return result;
  }
  // Meld `cp` into this CPaths64
  unionWith(cp) {
    const { Union64, FillRule } = Clipper2Z;
    const res = Union64(this.paths64, cp.paths64, FillRule.NonZero);
    this.setPaths64(res, true);
    if (cp.bbox.x.min < this.bbox.x.min) this.bbox.x.min = cp.bbox.x.min;
    if (cp.bbox.x.max > this.bbox.x.max) this.bbox.x.max = cp.bbox.x.max;
    if (cp.bbox.y.min < this.bbox.y.min) this.bbox.y.min = cp.bbox.y.min;
    if (cp.bbox.y.max > this.bbox.y.max) this.bbox.y.max = cp.bbox.y.max;
    this.updateWidthHeight();
  }
  xorWith(cp) {
    const { Xor64, FillRule } = Clipper2Z;
    const res = Xor64(this.paths64, cp.paths64, FillRule.NonZero);
    this.freePath();
    this.setPaths64(res);
  }
  differenceToNewCPaths64(cp) {
    const { Difference64, FillRule } = Clipper2Z;
    return new CPaths64(Difference64(this.paths64, cp.paths64, FillRule.NonZero));
  }
  xorToNewCPaths64(cp) {
    const { Xor64, FillRule } = Clipper2Z;
    return new CPaths64(Xor64(this.paths64, cp.paths64, FillRule.NonZero));
  }
  getArea() {
    const { IsPositive64, AreaPath64, Paths64 } = Clipper2Z;
    const count = this.paths64.size();
    let pcount = 0;
    let ncount = 0;
    let parea = 0;
    let narea = 0;
    for (let i=0; i<count; i++) {
      const path = this.paths64.get(i);
      const area = Math.abs(AreaPath64(path));
      if (IsPositive64(path)) {
        parea += area;
        pcount++;
      } else {
        narea += area;
        ncount++;
      }
      path.delete();
    }
    const sums = {};
    if ((narea > parea) && (ncount > 0)) {
      sums.fillArea  = narea;
      sums.fillCount = ncount;
      sums.holeArea  = parea;
      sums.holeCount = pcount;
    } else {
      sums.fillArea  = parea;
      sums.fillCount = pcount;
      sums.holeArea  = narea;
      sums.holeCount = ncount;
    }
    sums.area = sums.fillArea - sums.holeArea;
    return sums;
  }
  countIslands() {
    const { IsPositive64 } = Clipper2Z;
    const size = this.paths64.size();
    let pos = 0;
    let neg = 0;
    for (let i=0;i<size;i++) {
      const path = this.paths64.get(i);
      if (IsPositive64(path))
        pos++;
      else
        neg++;
      path.delete();
    }
    return {
      hole: pos, // Number of holes in the paths
      fill: neg, // Number of solid areas in the paths
    }
  }
  // Methods for rendering the original glyph to create the paths
  // Add a single point to the set of points
  // NOTE: updates bounding box
  addPoint(ix, iy) {  // Integer values!
    this.points = this.points || [];
    this.points.push(ix, iy);
    this.last = {x:ix, y:iy};
    if (!(this.bbox.x.min) || (ix < this.bbox.x.min)) this.bbox.x.min = ix;
    if (!(this.bbox.x.max) || (ix > this.bbox.x.max)) this.bbox.x.max = ix;
    if (!(this.bbox.y.min) || (iy < this.bbox.y.min)) this.bbox.y.min = iy;
    if (!(this.bbox.y.max) || (iy > this.bbox.y.max)) this.bbox.y.max = iy;
  }
  // Close the path, back to the beginning, and add to the paths.
  // NOTE: bounding box already updated with `addPoint`
  closePath() {
    const { MakePath64, Paths64 } = Clipper2Z;
    if (this.points.length > 0) {
      if (!this.paths64) {
        this.paths64 = new Paths64();
      }
      this.points.push(this.points[0], this.points[1]); // Close the path back to the beginning
      this.paths64.push_back(MakePath64(this.points));
      delete this.points;
      this.last = {};
      this.updateWidthHeight();
    }
  }
  getPathPoint(pn, n) {
    const psize = this.paths64.size();
    if (pn > psize) return undefined;
    let result = undefined;
    const path = this.paths64.get(pn);
    if (n < path.size()) {
      result = path.get(n);
    }
    path.delete();
    return result;
  }
  findPointInPaths(point) {
    if (!point) return -1;
    const { PointInPolygon64 } = Clipper2Z;
    const size = this.paths64.size();
    let result = undefined;
    for (let i=0; i<size; i++) {
      const path = this.paths64.get(i);
      const pip = PointInPolygon64(point, path);
      //~~//console.log('fpip', pip); //~~
      path.delete();
      if (pip.value < 2) return (i);
    }
    return -1;
  }

  // Convert the paths to SVG format
  toSVG(options={}) {
    const ps64 = this.paths64;
    if (!ps64) return;
    const {
      id=null,
      fillColor=null,
      fillOpacity=0.5,
      strokeColor='black',
      strokeOpacity=1.0,
      strokeWidth=2,
      mixBlendMode='normal',
      x=0,                    // x offset
      y=0,                    // y offset
    } = options;

    let svg = '<path ';

    function pathToSVG(p64) {
      const size = p64.size();
      for (let i=0; i<size; i++) {
        const point = p64.get(i);
        const xx = (Number(point.x) + x) * 1;
        const yy = (Number(point.y) + y) *-1; // SVG is upside down for this requirement
        if (i==0)
          svg += `M${xx},${yy}`;
        else
          svg += `L${xx},${yy}`;
        point.delete(); //??
      }
      svg += 'z';
    }

    if (id) svg += `id="${id}" `;
    let style = '';
    if (fillColor) {
      style += `fill:${fillColor};fill-opacity:${fillOpacity};`;
    } else {
      style += 'fill-opacity:0;';
    }
    if (strokeColor) {
      style += `stroke:${strokeColor};stroke-opacity:${strokeOpacity};stroke-width:${strokeWidth};stroke-linejoin=\'round\';`
    }
    if (mixBlendMode !== 'normal') {
      style += `mix-blend-mode:\'${mixBlendMode}\';`;
    }
    if (style != '') {
      svg += `style="${style}" `;
    }
    svg += 'd="';
    const size = ps64.size();
    for (let i=0; i<size; i++) {
      const p64 = ps64.get(i);
      pathToSVG(p64);
      p64.delete();
    }
    svg += '"/>\r\n';
    return svg;
  }
}


/*
 * Class to contain glyph flattened geometry path
 * and various named fields.
 */
class GlyphFields {
  constructor(cp64) {
    this.cp64 = cp64;
    this.fields = new Map();
  }
  destroy() {
    this.fields.forEach((fv, fk) => {
      fv.destroy();
    });
    this.fields = new Map();
    this.cp64.destroy();
    delete(this.cp64);
  }
  addField(key, amount, options={}) {
    const gf = this.fields.get(key);
    if (gf) {
      gf.destroy();
      this.fields.delete(key);
    }
    const p = this.cp64.inflateToNewCPaths64(amount, options);
    p.amount = amount;
    this.fields.set(key, p);
    return p;
  }
  getField(key) {
    if (!key) return this.cp64;
    const gf = this.fields.get(key);
    return gf;
  }
  clearFields() {
    this.fields.forEach((v,k) => {
      v.destroy();
    });
    this.fields.clear();
  }
  copyOffset(x, y) {
    const ngf = new GlyphFields( this.cp64.translateToNewCPaths64(x, y) );
    this.fields.forEach((v,k) => {
      const p = v.translateToNewCPaths64(x, y);
      ngf.fields.set(k, p);
    });
    return ngf;
  }
}

/*
 * Creates and caches glyph outlines linked to a HarfBuzzShaping instance
 * Also creates and caches fields for each glyph.
 *
 */
class HarfBuzzGlyphs {
  constructor() {
    this.freeCache();
  }
  destroy() {
    this.freeCache();
  }
  setHarfBuzzShaping(/*HarfBuzzShaping*/hbs) {
    this.freeCache();
    this.hbs = hbs;
  }
  getHarfBuzzShaping() { return this.hbs; }
  fontChanged() {
    this.freeCache();
  }
  freeCache() {
    if (this.glyphs) {
      this.glyphs.forEach((gvalue, gkey) => {
        gvalue.destroy();
        gvalue.fields.forEach((fvalue, fkey) => {
          fvalue.destroy();
        });
        gvalue.fields.clear();
      });
    }
    this.glyphs = new Map();
  }

  /* Converts the glyph drawing to an array of point arrays compatible with Clipper2
   * @param {integer} glyphId - the glyph to convert
   * @return {object<GlyphFields>}
   */
  getGlyph(glyphId) {
    let gf = this.glyphs.get(glyphId);
    if (gf) return gf;
    var ptr = this.hbs.font.ptr;
    const exports = this.hbs.hb.hooks.exports;
    const addFunction = this.hbs.hb.hooks.addFunction;
    var paths = [];
    var points = [];
    const { MakePath64, Paths64, InflatePaths64, SimplifyPaths64, JoinType, EndType } = Clipper2Z;
    var cpaths = new Paths64();

    var cpaths64 = new CPaths64();
    var updatePoint = function(x, y) {
      x = Math.round(x);
      y = Math.round(y);
      cpaths64.addPoint(x, y);
    }
    if (!drawFuncsPtr) {
      var moveTo = function(dfuncs, draw_data, draw_state, to_x, to_y, user_data) {
        //pathBuffer += `M${to_x},${to_y}`;
        // Starting a new set
        updatePoint(to_x, to_y);
      }
      var lineTo = function(dfuncs, draw_data, draw_state, to_x, to_y, user_data) {
        //pathBuffer += `L${to_x},${to_y}`;
        updatePoint(to_x, to_y);
      }
      var cubicTo = function(dfuncs, draw_data, draw_state, c1_x, c1_y, c2_x, c2_y, to_x, to_y, user_data) {
        //pathBuffer += `C${c1_x},${c1_y} ${c2_x},${c2_y} ${to_x},${to_y}`;
        // Flatten Cubic Bezier to Lines...
        const last = cpaths64.last;
        let c = {p0: {x:last.x, y:last.y}, p1:{x:c1_x, y:c1_y}, p2:{x:c2_x, y:c2_y}, p3:{x:to_x, y:to_y}};
        let qs = cubicBezToQuadratics(c, quadBezState.tolerance); // Tolerance???
        for (let q of qs) {
          let ts = quadBezFlatten(q);
          for (let t of ts) {
            const {x,y} = evalQuadBez(q, t);
            updatePoint(x, y);
          }
        }
        updatePoint(to_x, to_y);
      }
      var quadTo = function(dfuncs, draw_data, draw_state, c_x, c_y, to_x, to_y, user_data) {
        //pathBuffer += `Q${c_x},${c_y} ${to_x},${to_y}`;
        // Flatten Quadratic Bezier to Lines...
        const last = cpaths64.last;
        let q = { p0: {x:last.x, y:last.y}, p1: {x:c_x, y:c_y}, p2: {x:to_x, y:to_y}};
        let ts = quadBezFlatten(q);
        for (let t of ts) {
          const {x, y} = evalQuadBez(q, t);
          updatePoint(x, y);
        }
      }
      var closePath = function(dfuncs, draw_data, draw_state, user_data) {
        cpaths64.closePath();
      }

      var moveToPtr = addFunction(moveTo, 'viiiffi');
      var lineToPtr = addFunction(lineTo, 'viiiffi');
      var cubicToPtr = addFunction(cubicTo, 'viiiffffffi');
      var quadToPtr = addFunction(quadTo, 'viiiffffi');
      var closePathPtr = addFunction(closePath, 'viiii');
      var drawFuncsPtr = exports.hb_draw_funcs_create();
      exports.hb_draw_funcs_set_move_to_func(drawFuncsPtr, moveToPtr, 0, 0);
      exports.hb_draw_funcs_set_line_to_func(drawFuncsPtr, lineToPtr, 0, 0);
      exports.hb_draw_funcs_set_cubic_to_func(drawFuncsPtr, cubicToPtr, 0, 0);
      exports.hb_draw_funcs_set_quadratic_to_func(drawFuncsPtr, quadToPtr, 0, 0);
      exports.hb_draw_funcs_set_close_path_func(drawFuncsPtr, closePathPtr, 0, 0);
    }

    var pathBuffer = "";
    exports.hb_font_draw_glyph(ptr, glyphId, drawFuncsPtr, 0);
    const mitreLimit = 25;
    const arcTolerance = 0;
    cpaths64.glyphName = this.hbs.getGlyphName(glyphId);
    cpaths64.glyphClass = this.hbs.getGlyphClass(glyphId);
    cpaths64.glyphMark = this.hbs.isGlyphMark(glyphId);
    cpaths64.findBoundingBox();
    gf = new GlyphFields(cpaths64);
    this.glyphs.set(glyphId, gf); // Result cached in this object
    return gf;
  }
  addField(glyphId, key, amount, options={}) {
    const gf = this.getGlyph(glyphId);
    if (!key) return gf;
    return gf.addField(key, amount, options);
  }
  getField(glyphId, key) {
    const gf = this.getGlyph(glyphId);
    if (!key) return gf;
    return gf.getField(key);
  }
  getFieldKeys(glyphId) {
    const gf = this.getGlyph(glyphId);
    if (!gf) return;
    return Array.from(gf.fields.keys());
  }
  clearFields(glyphId) {
    if (!glyphId) {
      const max = this.hbs.getGlyphCount();
      for (let i=0; i<max; i++) {
        const gf = this.getGlyph(i);
        if (gf) gf.clearFields();
      }
      return;
    }
    const gf = this.getGlyph(glyphId);
    if (!gf) return;
    gf.clearFields();
  }
  toSVG(glyphId) {
    const gf = this.getGlyph(glyphId);
    if (!gf) return;
    return gf.getField().toSVG();
  }
  // Attach transformed glyph fields to each result entry
  // Adds `.ox` and `.oy` for the origin
  // Adds `.fields` for the transformed field set (placed at `.ox+.dx`, `.oy+.dy`)
  // @return {array} - array of objects mirroring hbresult, but with `.gf` glyph fields added
  addGlyphFieldsToResult(hbresult) {
    const result = [];
    let x = 0;
    let y = 0;
    hbresult.forEach((r, idx) => {
      const gf = this.getGlyph(r.g);
      result.push({
        g:  r.g,
        ox: x,
        oy: y,
        ax: r.ax,
        ay: r.ay,
        dx: r.dx,
        dy: r.dy,
        cl: r.cl,
        gf: gf.copyOffset(x+r.dx, y+r.dy),
      });
      x += r.ax;
      y += r.ay;
    });
    result.rtl = hbresult.rtl;
    return {
      hb : result,
      rtl: hbresult.rtl,
      attachments: hbresult.attachments,
    }
  }
}

export {
  /**/clipperGC,/**/
  CPaths64,
  HarfBuzzGlyphs,
  Clipper2Z,
  clipperReady,
};
