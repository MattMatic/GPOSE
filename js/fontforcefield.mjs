// Font Force Field Logic
// github.com/MattMatic
// 2026-02
//
'use strict';

import { CursivesSets, MarksSets, HarfBuzzShaping } from './hbshaping.mjs';
import { CPaths64, HarfBuzzGlyphs, Clipper2Z } from './hbclipper.mjs';
import JSON5 from './json5.index.min.mjs'

function oldOrNew(theOld, theNew) {
  if (typeof theOld !== 'undefined') return theOld;
  return theNew;
}

function isAssigned(v) {
  return (typeof v !== 'undefined') && (v !== null);
}

const FORCEFIELD_QUALITY = {
  COLLISION_GLYPH: 4,
  COLLISION_NEAR : 3,
  KERNING: 2,
  MAYBE: 1,
  OK: 0,
}

class FontForceField {
  constructor(harfbuzzglyphs) {
    this.setHarfBuzzGlyphs(harfbuzzglyphs);
    this.jsonSetFarValues([10,25,50]);
    this.farValues.ok = false;
    this.groups = {};
    this.ICONS = {
      'GG'   : String.fromCodePoint(0x1f7e5), // 🟥 - glyphs that collide (serious)
      'cb'   : String.fromCodePoint(0x1f7e7), // 🟧 - collision near base-base
      'cx'   : String.fromCodePoint(0x1f7ea), // 🟪 - collision near base-mark
      'cm'   : String.fromCodePoint(0x1f7e6), // 🟦 - collision near mark-mark
      'glue' : String.fromCodePoint(0x1f7e2), // 🟢 - mark glyph that glues together two far islands
      //'island' : String.fromCodePoint(10052), // ❄️ - base glyph island marker (not this as it shows black on Calibri in FCWL)
      'island' : String.fromCodePoint(0x1F7E1), // 🟡 - base glyph island marker
      'rtl'    : String.fromCodePoint(0x2190),  // ←
      'ltr'    : String.fromCodePoint(0x2192),  // →      
    }
  }
  setHarfBuzzGlyphs(harfbuzzglyphs) {
    this.hbg = harfbuzzglyphs;
    this.bar = {};
    this.overlaps = [];
    this.glyphData = new Map();
    this.defaults = {};
  }
  addGlyphData(gid, dataObj) {
    let e = this.glyphData.get(gid);
    if (!e) e = {};
    Object.keys(dataObj).forEach((k,i) => { e[k] = dataObj[k]; });
    this.glyphData.set(gid, e);
  }
  getGlyphData(gid) {
    return this.glyphData.get(gid);
  }
  glyphInBars(gid) {
    return (this?.bar?.gids && this.bar.gids.has(gid));
  }
  getBarCPath() {
    return this.bar.cpaths64;
  }
  glyphsCanOverlap(gid1, gid2) {
    const max = this.overlaps.length;
    if (max == 0) return false;
    for (let i=0; i<max; i++) {
      const set = this.overlaps[i];
      if (set.has(gid1) && set.has(gid2)) return true;
    }
    return false;
  }
  /*
   * @param {array} shaping - the result from HarfBuzzShaping, with delta applied
   *                          should be from a trace operation with traceAttachments=true
   * @return {array} shaping array with each glyph entry marked up with collisions and glue information
   */
  evaluate(shaping, options={}) {
    const {
      returnFields=false,
      deeperKerning=true,
    } = options;
    const shapingFields = this.hbg.addGlyphFieldsToResult(shaping);
    const cursives = shapingFields.attachments?.cursives;
    const marks = shapingFields.attachments?.marks;
    const hbs = this.hbg.hbs;
    const overallFar = new CPaths64();
    const overallMarks = new CPaths64();
    let overallAll; // = new CPaths64(); // Will be duplicated
    const collisions = new CPaths64();
    const collisionsGlyphs = new CPaths64();
    const counts = {
      near:  0,
      glyph: 0,
      glue:  0,
    };

    const max = shaping.length;
    const thisObj = this;

    for (let index=0; index<max; index++) {
      const e = shapingFields.hb[index];
      e.i = index;
      const gf = e.gf;
      if (hbs.isGlyphMark(e.g)) {
        overallMarks.unionWith(gf.getField('far'));
      } else {
        if (this.glyphInBars(e.g))
          overallFar.unionWith(gf.getField('farBar'));
        else
          overallFar.unionWith(gf.getField('far'));
      }
    }

    function getMarkCollision(i1, e1, i2, e2, markPair) {
      let base, mark, result;
      if (i1 == markPair[0]) {
        mark = e1; base = e2;
      } else {
        mark = e2; base = e1;
      }
      const nearBase = mark.gf.getField('nearBase');
      const near = base.gf.getField('near');
      if (nearBase) return nearBase.collisionCPath(near);
      return mark.gf.getField().collisionCPath(near);
    }

    function isClusterOverlap(i1, e1, i2, e2) {
      if (e1.cl != e2.cl) return false;
      // Check whether e1.g or e2.g are in the JSON set that allow same cluster overlaps
      return (thisObj.getGlyphData(e1.g)?.cl || thisObj.getGlyphData(e2.g)?.cl);
    }

    function processPair(i1, e1, i2, e2) {
      if (cursives && cursives.hasPair(i1, i2)) return; // Allowed to overlap
      if (thisObj.glyphsCanOverlap(e1.g, e2.g)) return; // Allowed to overlap by the JSON rule
      let collision;
      const markPair = marks && marks.findPair(i1, i2);
      if (markPair &&
          (
            (i1==markPair[1]) || (i2==markPair[1]) ||
            (cursives.hasPair(i1, markPair[1])) ||
            (cursives.hasPair(i2, markPair[1]))
          ))
      {
        collision = getMarkCollision(i1, e1, i2, e2, markPair);
      } else {
        // Check if both are part of the 'bar' set for Indic
        if (thisObj.glyphInBars(e1.g) && thisObj.glyphInBars(e2.g)) {
          collision = e1.gf.getField('nearBar').collisionCPath(e2.gf.getField('nearBar'));
        }
        else
        if (markPair && isClusterOverlap(i1,e1, i2,e2)) {
          // Allowed to overlap
        }
        else {
          collision = e1.gf.getField('near').collisionCPath(e2.gf.getField('near'));
        }
      }
      if (collision) {
        collisions.unionWith(collision);
        // NOTE: Can deduce which type of collision we have: MarkMark, MarkBase, BaseBase
        //       based on the mark/base flag of each glyph
        if (!e1.collisionsNear) e1.collisions = [];
        if (!e2.collisionsNear) e2.collisions = [];
        let area = collision.getArea().area;
        e1.collisions.push({i:e2.i, near:area});
        e2.collisions.push({i:e1.i, near:area});
        counts.near++;

        // Check whether the glyphs themselves also overlap
        collision = e1.gf.getField().collisionCPath(e2.gf.getField());
        if (collision) {
          // Serious glyph overlap
          collisionsGlyphs.unionWith(collision);
          if (!e1.collisionsGlyph) e1.collisions = [];
          if (!e2.collisionsGlyph) e2.collisions = [];
          area = collision.getArea().area;
          e1.collisions.push({i:e2.i, glyph:area});
          e2.collisions.push({i:e1.i, glyph:area});
          counts.glyph++;
        }
      }
    }

    for (let i1=0; i1<max; i1++) {
      const e1 = shapingFields.hb[i1];
      for (let i2=i1+1; i2<max; i2++) {
        const e2 = shapingFields.hb[i2];
        processPair(i1, e1, i2, e2);
      }
    }

    // Now count the islands to see if we have "Far" situations
    const islandsBase = overallFar.getArea();
    overallAll = overallMarks.duplicatePath();
    overallAll.unionWith(overallFar);
    const islandsAll = overallAll.getArea();
    const islandsBaseCount = islandsBase.fillCount;
    const islandsAllCount  = islandsAll.fillCount;

    // Find the island counts
    for (let idx=0; idx<max; idx++) {
      const e = shapingFields.hb[idx];
      const p = e.gf.getField('far');
      const firstPoint = p.getPathPoint(0,0);
      if (!hbs.isGlyphMark(e.g)) {
        // Only take account of base glyphs
        const island = overallFar.findPointInPaths(firstPoint)+1;//islandIndexForPoint(overallFar, firstPoint);
        e.island = island;
      }
    }

    if ((islandsAllCount > 1) || (islandsBaseCount > 1)) {
      // Have at least one "far" situation
      if (islandsAllCount < islandsBaseCount) {
        // Find which individual mark glyph(s) could be gluing the base far field together
        for (let index=0; index<max; index++) {
          const e = shapingFields.hb[index];
          if (hbs.isGlyphMark(e.g)) {
            const of = overallFar.duplicatePath();
            const mf = e.gf.getField('far');
            of.unionWith(mf);
            const oi = of.getArea().fillCount;
            if (oi < islandsBaseCount) {
              e.glue = true;
              counts.glue++;
            }
            of.freePath();
          }
        }
      }
    }

    shapingFields.counts = counts;
    shapingFields.counts.collisionNear   = collisions.getArea().area;
    shapingFields.counts.collisionsGlyphs = collisionsGlyphs.getArea().area;
    shapingFields.counts.islandsAll  = islandsAll/*Count*/;
    shapingFields.counts.islandsBase = islandsBase/*Count*/;
    shapingFields.counts.farBase  = islandsBaseCount > 1;
    shapingFields.counts.farMarks = islandsAllCount > islandsBaseCount;
    shapingFields.counts.ok       = islandsAllCount == 1;

    // Add a tag summary 'quality' output
    if (counts.collisionsGlyphs > 0)
      shapingFields.quality = FORCEFIELD_QUALITY.COLLISION_GLYPH; // Worse
    else
    if (counts.collisionNear > 0)
      shapingFields.quality = FORCEFIELD_QUALITY.COLLISION_NEAR;
    else
    if (counts.islandsAll.fillCount > 1) {
      // Decide whether to take account of X overlap
      if (deeperKerning) { //~~//
        shapingFields.quality = FORCEFIELD_QUALITY.MAYBE;
        // NOTE: the paths are not necessarily in visual order!
        const pnmax = overallAll.getPathCount();
        const bb = [];
        for (let pn=0; pn<pnmax; pn++) {
          const pbb = overallAll.findPathBoundingBox(pn);
          if (pbb.positive) {
            bb.push( pbb );
          }
        }
        // First, do this in the X-direction
        bb.sort( (a,b) => {
          if (a.x.min < b.x.min) return -1;
          if (a.x.min > b.x.min) return  1;
          return 0;
        });

        for (let pn=1; pn<bb.length; pn++) {
          const bb1 = bb[pn-1];
          const bb2 = bb[pn];
          if (bb1.x.min > bb2.x.max) {
            //~~//console.log('Xmin>max',pn, pnmax, bb1, bb2); //~~
            shapingFields.quality = FORCEFIELD_QUALITY.KERNING;
          }
          if (bb1.x.max < bb2.x.min) {
            //~~//console.log('Xmax<min',pn, pnmax, bb1, bb2); //~~
            shapingFields.quality = FORCEFIELD_QUALITY.KERNING;            
          }
        }

        // Next, repeat in the Y-direction
        bb.sort( (a,b) => {
          if (a.y.min < b.y.min) return -1;
          if (a.y.min > b.y.min) return 1;
          return 0;
        });
        for (let pn=1; pn<bb.length; pn++) {
          const bb1 = bb[pn-1];
          const bb2 = bb[pn];
          if (bb1.y.min > bb2.y.max) {
            //~~//console.log('Ymin>max',pn, pnmax, bb1, bb2); //~~
            shapingFields.quality = FORCEFIELD_QUALITY.KERNING;
          }
          if (bb1.y.max < bb2.y.min) {
            //~~//console.log('Ymax<min',pn, pnmax, bb1, bb2); //~~
            shapingFields.quality = FORCEFIELD_QUALITY.KERNING;            
          }
        }
      } else {
        shapingFields.quality = FORCEFIELD_QUALITY.KERNING;
      }
    }
    else
    if ((counts.islandsAll.fillCount == 1) && (counts.islandsBase.fillCount > 1) && counts.ok)
      shapingFields.quality = FORCEFIELD_QUALITY.MAYBE;
    else
      shapingFields.quality = FORCEFIELD_QUALITY.OK;

    if (returnFields) {
      shapingFields.fields = {};
      shapingFields.fields.collisionsGlyphs = collisionsGlyphs;
      shapingFields.fields.collisions   = collisions;
      shapingFields.fields.overallMarks = overallMarks;
      shapingFields.fields.overallFar = overallFar;
      shapingFields.fields.overallAll = overallAll;
    } else {
      collisionsGlyphs.freePath();
      collisions.freePath();
      overallMarks.freePath();
      overallFar.freePath();
      overallAll.freePath();
    }

    // Remove the 'gf' fields from all
    for (let idx=0; idx<shapingFields.hb.length; idx++) {
      const e = shapingFields.hb[idx];
      e.gf.destroy();
      delete(e.gf);
    }

    return shapingFields;
  }

  clearFields() {
    this.hbg.clearFields();       // Clear the cache
  }
  /*
   * Process JSON text
   */
  applyJsonText(txt) {
    this.data = JSON5.parse(txt);
    const data = this.data;
    this.setHarfBuzzGlyphs(this.hbg);  // Reset all the data
    this.clearFields();
    const hbg = this.hbg;
    const hbs = hbg.getHarfBuzzShaping();
    if (data.font.name && (data.font.name != hbs.getFontFullName())) {
      throw new Error('Font name mismatch!');
    }
    if (data.font.version && (data.font.version != hbs.getFontVersion())) {
      throw new Error('Font version mismatch!');
    }
    for (let key in data) {
      const v = data[key];
      if (key === 'base') this.jsonSetBase(oldOrNew(v.min, v.n), oldOrNew(v.max, v.f));
      else if (key === 'mark') this.jsonSetMark(oldOrNew(v.min, v.n), oldOrNew(v.min_base, v.nb), oldOrNew(v.max, v.f));
      else if (key === 'font') this.font = v;
      else if (key === 'harfbuzz') this.jsonSetScriptLanguage(v.script, v.language);
      else if (key === 'groups') this.jsonSetGroups(v);
      else if (key === 'bar') this.jsonSetBar(v);
      else if (key === 'overlaps') this.jsonSetOverlaps(v);
      else if (key === 'defaults') this.defaults.clusterOverlap = v.cl;
      else if (key === 'far') this.jsonSetFar(v);
      else {
        if (typeof key === 'string') {
          this.jsonSetStringValue(key, v);
        }
      }
    }

    // Create all the appropriate cached glyph fields
    const max = hbs.getGlyphCount();
    for (let gid=0; gid<max; gid++) {
      const gv = this.jsonGetGlyphValues(gid);
      hbg.addField(gid, 'near', gv.near);
      hbg.addField(gid, 'far',  gv.far);
      if (typeof gv.nearBase === 'number') {
        hbg.addField(gid, 'nearBase', gv.nearBase);
      }
      if (this.glyphInBars(gid)) {
        const bar = this.getBarCPath();
        const options = {
          remove: bar,
        };
        hbg.addField(gid, 'nearBar', gv.near, options);
        hbg.addField(gid, 'farBar', gv.far, options);
      }
    }
  }
  jsonGetGlyphValues(gid) {
    const hbg = this.hbg;
    const hbs = hbg.hbs;
    const isMark = hbs.isGlyphMark(gid);
    const gd = this.getGlyphData(gid);
    var near = this.defaults.baseNear || 30;
    var far  = this.defaults.baseFar  || 90;
    let nearBase;
    let clusterOverlap;
    if (isMark) {
      near  = this.defaults.markNear || 30;
      far   = this.defaults.markFar  || 90;
      nearBase = this.defaults.markNearBase || 1;
    }
    if (gd) {
      function toValue(txt, v) {
        if (txt === null) return v;
        if (!isAssigned(txt)) return v;
        if (typeof txt !== 'string') return txt;
        const n = parseFloat(txt);
        if (isNaN(n)) return v;
        if (txt.includes('%')) {
          const rv = Math.round((v*n)/100.0);
          return rv;
        }
        return Math.round(n);
      }
      far  = toValue(gd.far, far);
      near = toValue(gd.near, near);
      if (isMark) nearBase = toValue(gd.nearBase, nearBase);
      clusterOverlap = gd.clusterOverlap;
    }
    return {
      far: far,
      near: near,
      nearBase: nearBase,
      clusterOverlap: clusterOverlap,
    }
  }
  jsonSetBase(near, far) {
    if ((near != this.defaults.baseNear) || (far != this.defaults.baseFar)) {
      this.clearFields();
    }
    this.defaults.baseNear = near;
    this.defaults.baseFar  = far;
  }
  jsonSetMark(near, nearBase, far) {
    if ((near != this.defaults.markNear) || (nearBase != this.defaults.markNearBase) || (far != this.defaults.markFar)) {
      this.clearFields();
    }
    this.defaults.markNear = near;
    this.defaults.markNearBase = nearBase;
    this.defaults.markFar = far;
  }
  jsonSetScriptLanguage(script, language) {
    this.script = script;
    this.language = language;
    this.hbg.hbs.setScriptLanguage(script, language);
  }
  processRangeInteger(txt, groupSet, func) {
    let count = 0;
    if (typeof txt === 'number') {
      func(txt);
      return 1;
    }
    if (typeof txt !== 'string') {
      throw new Error(`Group/Range error "${txt}"`);
      return 0;
    }
    const hasLetters = new RegExp('[A-Za-z]');
    const sets = txt.split(',');
    for (let set of sets) {
      let range;
      if (hasLetters.test(set)) {
        range = [set];
      } else {
        range = set.split('-');
      }
      if (range.length === 1) {
        const v = range[0];
        if (!isNaN(v)) {
          const gid = parseInt(v);
          func(gid);
          count++;
        } else
        if (groupSet && groupSet[v]) {
          for (let vv of groupSet[v]) {
            func(vv);
            count++;
          }
        } else
        if (this.processGlyphName(v, func)) {
          // Found!
        } else
        {
          throw new Error(`Group/Range error "${v}"`);
        }
      }
      else {
        // TODO(maybe?): handle ranges of glyph names
        const rangeFrom = parseInt(range[0]);
        const rangeTo = parseInt(range[1]);
        if (rangeTo <= rangeFrom) {
          throw new Error(`Range error "${set}"`);
        }
        for (let v = rangeFrom; v<=rangeTo; v++) {
          func(v);
          count++;
        }
      }
    }
    return count;
  }
  jsonSetGroups(data) {
    this.groups = {};
    const obj = this;
    Object.keys(data).forEach((k) => {
      const v = data[k];
      const size = v.length;
      const group = [];
      for (let i=0; i<size; i++) {
        const gid = v[i];
        this.processRangeInteger(gid, null, function(g,n) { group.push(g); });
      }
      group.src = String(v);
      obj.groups[k] = group;
    });
  }
  jsonGetGroup(id) {
    return this.groups[id];
  }
  jsonSetBar(barObject) {
    if (this?.bar?.cpaths64) this.bar.cpaths64.destroy();
    this.bar = {};
    this.bar.area = barObject.area; // An array of either y1,y2 or x1,y1,x2,y2
    this.bar.gids = new Set(this.gidArrayExpand(barObject.gids));
    this.bar.far = barObject.far;
    this.bar.src = String(barObject);
    const p = new CPaths64();
    for (let i in barObject.area) {
      const e = barObject.area[i];
      if (e.length == 2) {
        const y1 = e[0];
        const y2 = e[1];
        p.addPoint(-10000, y1);
        p.addPoint(-10000, y1);
        p.addPoint( 10000, y1);
        p.addPoint( 10000, y2);
        p.addPoint(-10000, y2);
        p.closePath();
      } else
      if (e.length == 4) {
        const x1 = e[0];
        const y1 = e[1];
        const x2 = e[2];
        const y2 = e[3];
        p.addPoint(x1, y1);
        p.addPoint(x2, y1);
        p.addPoint(x2, y2);
        p.addPoint(x1, y2);
        p.closePath();
      }
    }
    this.bar.cpaths64 = p;
  }
  processGlyphName(txt, func) {
    let exp='';
    const specials = '*+?{}[]\\$^:,-'
    if (txt.startsWith('/') && txt.endsWith('/')) {
      // regexp
      exp = txt.slice(1, -1);
    } else {
      // Convert DOS style...
      let hasAsterisk = false;
      let endAnchor = false;
      if (txt.endsWith('$')) {
        // Partial grep syntax - to anchor to the end
        endAnchor = true;
        txt = txt.slice(0, txt.length-1);
      }
      if (txt.startsWith('*')) {
        hasAsterisk = true;
        txt = txt.slice(1);
      } else {
        exp += '^'; // Anchor at the start
      }
      const len = txt.length;
      for (let i=0; i<len; i++) {
        const ch = txt[i];
        if (ch == '*') {
          exp += '.*'; // 0 or more of any character
          hasAsterisk = true;
        } else
        if (ch == '?') {
          exp += '.';  // Any character
        } else
        if (ch == '.') {
          exp += '[.]'; // Literal
        } else
        if (specials.includes(ch)) {
          exp += '\\x'+ch.charCodeAt(0).toString(16).padStart(2,'0');
        } else {
          exp += ch;
        }
      }
      if ((hasAsterisk && !txt.endsWith('*')) || endAnchor) {
        exp += '$'; // anchor to the end
      }
    }
    const re = new RegExp(exp);
    const hbs = this.hbg.getHarfBuzzShaping();
    const max = hbs.getGlyphCount();
    let found = false;
    for (let i=0; i<max; i++) {
      const name = hbs.getGlyphName(i);
      if (re.test(name)) {
        found = true;
        func(i, name);
      }
    }
    return found;
  }
  gidArrayExpand(gids) {
    // Expand using this.groups if needed
    const res = [];
    const size = gids?.length;
    for (let i=0; i<size; i++) {
      const v = gids[i];
      if (typeof v === 'number')
        res.push(v);
      else
      if (typeof v === 'string') {
        const group = this.groups[v];
        if (group) {
          const size = group.length;
          for (let ii=0; ii<size; ii++) {
            const g = group[ii];
            if (typeof g === 'number')
              res.push(g);
            else
              throw new Error(`Group "${v}" recursion not allowed`);
          }
        } else
        if (this.processGlyphName(v, (gid)=> {
          res.push(gid);
        })) {
          // We added at least one GID
        } else {
          throw new Error(`Group "${v}" not found!`);
        }
      }
    }
    return res;
  }
  jsonSetOverlaps(overlapsArray) {
    this.overlaps = [];
    const size = overlapsArray.length;
    for (let i=0; i<size; i++) {
      const a = overlapsArray[i];
      const obj = new Set(this.gidArrayExpand(a));
      obj.src = String(a);
      this.overlaps.push(obj);
    }
  }
  jsonSetFarValues(arr) {
    const ok = this?.farValues?.ok;
    const markPath = this?.farValues?.markPath;
    this.farValues = arr;
    // Sort ascending
    this.farValues.sort((a,b)=>{
      if (a<b) return 1;
      if (a>b) return -1;
      return 0;
    });
    this.farValues.ok = ok;
    this.farValues.markPath = markPath;
  }
  jsonSetFar(obj) {
    // Not used in this implementation of the `evalute` method (yet)
    const values = obj.values;
    if (values) this.jsonSetFarValues(values);
    this.farValues.ok = obj.ok;
    this.farValues.markPath = obj.markPath;
  }
  jsonSetGlyphValues(gid, far, near, nearBase, clusterOverlap) {
    if (!isAssigned(clusterOverlap))
      clusterOverlap = this.defaults.clusterOverlap;
    const gv = {};
    if (isAssigned(far))  gv.far = far;
    if (isAssigned(near)) gv.near = near;
    if (isAssigned(nearBase)) gv.nearBase = nearBase;
    if (isAssigned(clusterOverlap)) gv.clusterOverlap = clusterOverlap;

    this.addGlyphData(gid, gv);
  }
  jsonSetStringValue(key, value) {
    const n  = oldOrNew(value.min, value.n);
    const nb = oldOrNew(value.min_base, value.nb);
    const f  = oldOrNew(value.max, value.f);
    const cl = value.cl;
    this.processRangeInteger(key, this.groups,
      (gid) => {
        this.jsonSetGlyphValues(gid, f,n,nb,cl);
      });
  }

  // Diagnostic output data
  evaluationToNote(ev, options = {}) {
    const { 
      forceLTR=false, 
      includeIcons=true,
    } = options;
    if (!ev) return;
    if (!ev.hb) return;
    const ICONS = this.ICONS;
    
    let txt = '';
    const rtl = (ev.rtl && !forceLTR);
    if (rtl) txt += ICONS.rtl + ' ';
    const hbg = this.hbg;
    const hbs = hbg.hbs;
    const max = ev.hb.length;
    let idx = (rtl) ? (max-1) : 0;
    let lastIsland = -1;
    while (true) {
      if (rtl) {
        if (idx < 0) break;
      } else {
        if (idx >= max) break;
      }
      const e = ev.hb[idx];
      const n = hbs.getGlyphName(e.g);
      let icons = '';
      if (e.collisions) {
        for (let ci=0; ci<e.collisions.length; ci++)
        {
          const e2 = e.collisions[ci];
          const i2 = e2.i;
          const ee2 = ev.hb[i2];
          if (e2.glyph)
            icons += ICONS.GG;
          else if (e2.near) {
            if (hbs.isGlyphMark(e.g)) {
              // Mark to Mark(cm) or Mark to Base(cx)
              if (hbs.isGlyphMark(ee2.g))
                icons += ICONS.cm;
              else
                icons += ICONS.cx;
            } else {
              // Base to Mark(cx) or Base to Base (cb)
              if (hbs.isGlyphMark(ee2.g))
                icons += ICONS.cx;
              else
                icons += ICONS.cb;
            }
          }
        }
      }
      if (e.glue) icons += ICONS.glue;

      if (e.island && (e.island > 0)) {
        if ((lastIsland > 0) && (e.island != lastIsland))
          icons += ICONS.island;
        lastIsland = e.island;
      }
      e.icons = icons;
      if (includeIcons) {
        txt += icons;
      }

      if (n)
        txt += `${n} `;
      else
        txt += `${e.g} `;

      if (rtl)
        idx--;
      else
        idx++;
    }
    return txt.trimEnd();
  }

  getGlyphColor(index) {
    const glyphColors = ['#bb87e3','#bc6b0e','#57118c','#64902e','#91bbec','#d65e02','#1d5799','#984c11','#271909'];
    const max = glyphColors.length;
    return glyphColors[index % max];
  }
  toSVG(shaping, options={}) {
    const {
      glyphColor=true,
      showName=true,
      showGID=true,
      showNear=true,
      showNearBase=true,
      showFarBase=false,
      showFarMarks=false,
      showFarAll=true,
      showCollisions=true,
      showGlue=true,
      showBase=true,
      showMark=true,
      showBaseLine=true,
      showEdits=false,
      stretch=0,
    } = options;

    let svg = '';
    const fixedOpacity = stretch>0 ? 0.25 : 1.0;

    const ev = this.evaluate(shaping,
      {
        returnFields: true,
        deeperKerning: false,
      });
    Object.keys(ev.fields).forEach(k=>ev.fields[k].findBoundingBox());

    if (showFarAll) {
      svg += ev.fields.overallAll.toSVG({strokeColor:'#8af',strokeWidth:8,strokeOpacity:fixedOpacity,});
    }
    if (showFarMarks) {
      svg += ev.fields.overallMarks.toSVG({strokeColor:'#acf',strokeWidth:8,strokeOpacity:fixedOpacity,});
    }
    if (showFarBase) {
      svg += ev.fields.overallFar.toSVG({strokeColor:'#8af',strokeWidth:8,strokeOpacity:fixedOpacity,});
    }
    const hbg = this.hbg;
    const hbs = hbg.hbs;
    const delta = options?.delta;
    let x = 0;
    let y = 0;
    for (let idx=0; idx<ev.hb.length; idx++) {
      const e = ev.hb[idx];
      const gf = hbg.getField(e.g);
      const options = {};

      options.x = x + e.dx + (idx * stretch);
      options.y = y + e.dy;
      options.id = `n${idx}_g${e.g}_c${e.cl}`;
      options.strokeWidth = 8;

      const glyphColorThis = this.getGlyphColor(idx);

      const isMark = hbs.isGlyphMark(e.g);
      let glyphColorOne = isMark ? '#222' : '#222';
      let glyphOpacity = 1.0;

      let strokeColor='black';
      let strokeOpacity=1.0;
      let strokeWidth=2;

      if (glyphColor) {
        glyphColorOne = glyphColorThis;
        glyphOpacity  = 0.7;
      } else {
        if (showEdits && delta && delta[idx].edited) {
          glyphColorOne = '#2c2';
          strokeColor = glyphColorOne;
        }
      }

      const f = gf.getField();
      if (e.glue && showGlue) {
        svg += f.toSVG({...options, ...{fillColor:'#8f8',fillOpacity:0.25,strokeColor:'#8f8',strokeWidth:100,}}); // Green highlight
      }

      // Merge options: const merged = {...options, ...seconds, ...thirds}
      if (showNear) {
        const f = gf.getField('near');
        if (f) svg += f.toSVG({...options, ...{strokeColor:'#4d4',}});
      }
      if (showNearBase) {
        const f = gf.getField('nearBase');
        if (f) svg += f.toSVG({...options, ...{strokeColor:'#f8c',}});
      }

      /*
      if (showFarBase) {
        const f = gf.getField('far');
        if (f) {
          if (isMark)
            svg += f.toSVG({...options, ...{strokeColor:'#acf',}});
          else
            svg += f.toSVG({...options, ...{strokeColor:'#8af',}});
        }
      }
      */
      if (e.collisions && showCollisions) {
        //glyphColorOne = '#f44';
        //glyphOpacity  = 0.75;
        options.strokeColor = '#f44';
        options.strokeOpacity = 0.6;
        options.strokeWidth = 30;
      }
      if (isMark) {
        if (showMark) {
          svg += f.toSVG({...options, ...{
            fillColor:glyphColorOne, 
            fillOpacity:glyphOpacity,
            strokeColor:strokeColor,
            strokeWidth:strokeWidth,
            strokeOpacity:strokeOpacity,
          }});
        }
      } else {
        if (showBase) {
          svg += f.toSVG({...options, ...{
            fillColor:glyphColorOne, 
            fillOpacity:glyphOpacity,
            strokeColor:strokeColor,
            strokeWidth:strokeWidth,
            strokeOpacity:strokeOpacity,
          }});
        }
      }

      if (showGID || showName) {
        const fontSize = 100;
        const yOfs = y + 660 + (idx % 5) * 110;
        const xOfs = options.x + 0;
        const name = hbs.getGlyphName(e.g);
        let txt = '';
        if (isMark) txt += '\'';
        if (showGID || !name)
          txt += `${e.g}`;
        if (showName && name) {
          if (showGID) txt += ':';
          txt += name;
        }
        svg += `<text font-size='${fontSize}' x='${xOfs}' y='${yOfs}' fill='${glyphColorThis}'>${txt}</text>`;
      }

      x += e.ax;
      y += e.ay;
    }

    if (showBaseLine) {
      svg +=
          `<path style="stroke:#ff4040;stroke-opacity:0.5;stroke-width:5" d="M-300 0 L16000 ${y}"></path>`+
          `<path style="stroke:#ff4040;stroke-opacity:0.5;stroke-width:5" d="M0 -1500 L0 3000"></path>`+
          `<path style="stroke:#ff4040;stroke-opacity:0.5;stroke-width:5" d="M${x} -1500 L${x} ${y+3000}"></path>`;
    }

    if (showCollisions) {
      const colOptions = {
        fillColor:    '#f44',
        fillOpacity:  0.8,
        strokeColor:  '#f44',
        strokeWidth:  20,
        strokeOpacity:fixedOpacity,
      }
      svg += ev.fields.collisions.toSVG({...colOptions});
      svg += ev.fields.collisionsGlyphs.toSVG({...colOptions});
    }

    Object.keys(ev.fields).forEach(k=>{
      ev.fields[k].freePath();
    });

    return {
      svg: svg,
      note: this.evaluationToNote(ev),
    };
  }
}

export {
  FontForceField,
  FORCEFIELD_QUALITY
}