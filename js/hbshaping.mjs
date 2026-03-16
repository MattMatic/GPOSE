// HarfBuzz Shaping and Tracing Module
// github.com/MattMatic
// 2026-02
//
// Includes some JSON/SVG glyph path functions
//    HarfBuzzShaping.glyphToRelative(gid) -- extracts path into relative JSON and extents data
//    jsonToSvg(jsonArray) -- converts JSON array into an SVG.
//
// TODO: JSDoc documentation

"use strict";
import * as opentype from './opentype.min.mjs';
import Layout from './opentype.layout.gdef.mjs';

/*
 * Class to handle pairs of cursive attachments,
 * and also maintain chained sets (where several glyph indexes
 * will join in one cursive block)
 * 
 */
class CursivesSets {
  constructor() {
    this.cursives = [];
    this.entries = [];
  }
  find(index) {
    return this.cursives.find(e=>e.has(index));
  }
  addPair(index1, index2) {
    this.entries.push([index1, index2]);
    const f1 = this.find(index1);
    if (f1) {
      f1.add(index2);
      return;
    }
    const f2 = this.find(index2);
    if (f2) {
      f2.add(index1);
      return;
    }
    const s = new Set();
    s.add(index1);
    s.add(index2);
    this.cursives.push(s);
  }
  hasPair(index1, index2) {
    const f1 = this.find(index1);
    if (!f1) return undefined;
    return (f1.has(index2));
  }
  reverseIndexes(glyphCount) {
    const max = this.cursives.length;
    for (let i=0; i<max; i++) {
      const e = this.cursives[i];
      const r = new Set();
      e.forEach(ee=>{
        r.add(glyphCount - ee - 1);
      });
      this.cursives[i] = r;
    }
    for (let i=0; i<this.entries.length; i++) {
      const e = this.entries[i];
      e[0] = glyphCount - e[0] - 1;
      e[1] = glyphCount - e[1] - 1;
    }
  }
}

/*
 * Class to handle pairs of markIndex+glyphIndex
 * where marks are attached to the base glyph
 * 
 */
class MarksSets {
  constructor() {
    this.marks = [];
  }
  find(index) {
    return this.marks.find(e=> (e[0] == index) || (e[1] == index));
  }
  addPair(markIndex, glyphIndex) {
    this.marks.push([markIndex, glyphIndex]);
  }
  findPair(index1, index2) {
    return this.marks.find(e=>
      (e[0] == index1) && (e[1] == index2) ||
      (e[0] == index2) && (e[1] == index1)
      );
  }
  reverseIndexes(glyphCount) {
    this.marks.forEach(e=>{
      e[0] = glyphCount - e[0] - 1;
      e[1] = glyphCount - e[1] - 1;
    });
  }
}

/*
 * Class to perform HarfBuzz shaping and various tracing tasks.
 * 
 */
class HarfBuzzShaping {
  constructor(hb) {
    this.setHarfBuzz(hb);
    this.hbFix = false;
    this.freeFont();
  }
  destroy() {
    this.freeFont();
  }
  setHarfBuzz(hb) {
    const fontBlobOld = this.fontBlob;
    this.freeFont();
    this.hb = hb;
    this.setFontBlob(fontBlobOld);
  }
  freeFont() {
    if (this.font) { this.font.destroy(); delete(this.font); }
    if (this.face) { this.face.destroy(); delete(this.face); }
    if (this.blob) { this.blob.destroy(); delete(this.blob); }
    delete(this.otLayout);
    delete(this.otFont);
    this.cacheGlyphData = new Map();
  }
  setScriptLanguage(script, language) {
    this.script = script;
    this.language = language;
  }
  clearScriptLanguage() {
    this.script = null;
    this.language = null;
  }
  setFeatures(features) {
    this.features = features;
  }
  clearFeatures() {
    this.features = null;
  }
  setFontBlob(fb) {
    this.freeFont();
    this.fontBlob = fb;
    if (!fb) return;
    this.blob = this.hb.createBlob(this.fontBlob);
    this.face = this.hb.createFace(this.blob, 0);
    this.font = this.hb.createFont(this.face);

    this.otFont = opentype.parse(this.fontBlob);
    this.otLayout = new Layout(this.otFont, 'GPOS');

    const debgTable = this.face.reference_table("Debg");
    if (debgTable) {
      this.debugInfo = JSON.parse(new TextDecoder("utf8").decode(debgTable));
      this.debugInfo = this.debugInfo["com.github.fonttools.feaLib"];
    } else this.debugInfo = null;
  }
  getFontFullName() {
    return this.otFont?.getEnglishName('fullName');
  }
  getFontVersion() {
    return this.otFont?.getEnglishName('version');
  }
  async getFontHash() {
    // NOTE: The crypto is async. Always.
    const hash = await window.crypto.subtle.digest('SHA-256', this.fontBlob);
    return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  setHarfBuzzFix(enabled) {
    //Workaround for pre HarfBuzz 12.2.0 with Indic shaping
    this.hbFix = enabled;
  }
  /*
   * Create a HarfBuzz buffer with the current script/language settings
   * @param {string} txt - word/phrase to use
   * @return {buffer} - HarfBuzz buffer.
   * @note Use buffer.destroy() when done.
   */
  _createBuffer(txt) {
    let buffer = this.hb.createBuffer();
    buffer.addText(txt);
    buffer.guessSegmentProperties();
    if ((typeof this.script === 'string') && (this.script.length > 0)) {
      buffer.setScript(this.script);
    }
    if ((typeof this.language === 'string') && (this.language.length > 0)) {
      buffer.setLanguage(this.language);
    }
    return buffer;
  }
  shape(txt) {
    let buffer = this._createBuffer(txt);
    if (!this.hbFix) {
      this.hb.shape(this.font, buffer, this.features, 0);
    } else {
      //Workaround for pre HarfBuzz 12.2.0 with Indic shaping (e.g. Noto Sans Begali 3.000)
      const exports = this.hb.hooks.exports;
      const addFunction = this.hb.hooks.addFunction;
      const removeFunction = this.hb.hooks.removeFunction;
      const utf8Decoder = this.hb.hooks.utf8Decoder;
      const Module = this.hb.hooks.Module;
      const traceFunc = function(bufferPtr, fontPtr, messagePtr, user_data) {
        return 1;
      }
      const traceFuncPtr = addFunction(traceFunc, 'iiiii');
      exports.hb_buffer_set_message_func(buffer.ptr, traceFuncPtr, 0, 0);
      this.hb.shape(this.font, buffer, this.features, 0);
      removeFunction(traceFuncPtr);
    }
    let result = buffer.json(this.font);
    result.rtl = ((result.length > 0) && (result[0].cl > result[result.length-1].cl));
    buffer.destroy();
    return result;
  }
  /*
   * Shapes and optionally builds tables for cursives and marks
   * @param {string} txt - word/phrase to shape
   * @param {object} options
   * @param {bool} options.traceStack=true - whether to keep track of the stack level
   * @param {bool} options.traceKeep=true - whether to keep the whole trace array
   * @param {bool} options.traceAttachments=true - whether to find cursive and mark associations
   * 
   * @return {array} - array of HarfBuzz result objects g:glyph, cl:cluster, ax:advanceX, ay:advanceY, dx:offsetX, dy:offsetY, flags
   * @return {array} attachments.cursive - pairs of glyph indexes
   * @return {array} attachments.marks   - pairs of mark+glyph indexes
   * @return {bool} rtl - whether the rendering is for RTL text (and visual order is now LTR)
   * @return {array} .trace - full array of HarfBuzz results with {m: message, t:traceGlyphs, s:stackDump, d:stackDepth}
   */
  trace(txt, options = {}) {

    function hb_tag(s) {
      return (
        (s.charCodeAt(0) & 0xFF) << 24 |
        (s.charCodeAt(1) & 0xFF) << 16 |
        (s.charCodeAt(2) & 0xFF) <<  8 |
        (s.charCodeAt(3) & 0xFF) <<  0
      );
    }
    const HB_BUFFER_SERIALIZE_FORMAT_JSON = hb_tag('JSON');
    const HB_BUFFER_SERIALIZE_FLAG_NO_GLYPH_NAMES = 4;

    const { traceStack=true, traceAttachments=true, traceKeep=true } = options;
    let buffer = this._createBuffer(txt);
    const exports = this.hb.hooks.exports;
    const addFunction = this.hb.hooks.addFunction;
    const removeFunction = this.hb.hooks.removeFunction;
    const utf8Decoder = this.hb.hooks.utf8Decoder;
    const Module = this.hb.hooks.Module;
    var trace = [];
    let stack = [];
    let stage;
    let maxDepth = 0;
    const cursives = new CursivesSets;
    const marks = new MarksSets;
    let gpos_point = -1;
    let gsub_point = -1;
    let traceCount = 0;

    var traceBufLen = 1024 * 1024;
    var traceBufPtr = exports.malloc(traceBufLen);

    function pullGlyphIndexes(txt) {
      const parts = / at ([\d]+).* at ([\d]+)/.exec(txt);
      if (!parts) return null;
      return parts.slice(1).map((p) => parseInt(p));
    }

    function traceFunc(bufferPtr, fontPtr, messagePtr, user_data) {
      let m = utf8Decoder.decode(Module.HEAPU8.subarray(messagePtr, Module.HEAPU8.indexOf(0, messagePtr)));
      const tr = {
        m: m,
      }
      if (traceAttachments) {
        if (m.startsWith('cursive attached')) {
          const gis = pullGlyphIndexes(m);
          cursives.addPair(gis[0], gis[1]);
        } else
        if (m.startsWith('attached mark')) {
          const gis = pullGlyphIndexes(m);
          marks.addPair(gis[0], gis[1]);
        }
      }

      // Find key start of GSUB and GPOS
      const mts = m.match(/^start table (\w+)/);
      if (mts) {
        stage = mts[1];
        if (stage === 'GPOS')
          gpos_point = traceCount;
        else
        if (stage === 'GSUB')
          gsub_point = traceCount;
      }

      if (traceStack && traceKeep) {
        // check for stack changes...
        if (m.match(/^end table G/)) {
          stack = [];
        } else {
          const mls = m.match(/^start lookup (\d+) feature '(\w+)'/);
          if (mls) stack.push({t: parseInt(mls[1]), f: mls[2]});
          const mle = m.match(/^end lookup (\d+) feature '(\w+)'/);
          if (mle) {
            const tn = parseInt(mle[1]);
            while (stack.length > 0) {
              const se = stack.pop();
              if ((se.t === tn) && (se.f === mle[2])) break;
            }
          }
          // NOTE: the glyph index 'g' is in order of the trace at this point
          //       For RTL, the glyph order is reversed as the _final_ step in whole sequence
          const mrs = m.match(/^recursing to lookup (\d+) at (\d+)/);
          if (mrs) stack.push({t: parseInt(mrs[1]), g: parseInt(mrs[2])});
          const mre = m.match(/^recursed to lookup (\d+)/);
          if (mre) {
            const tn = parseInt(mre[1]);
            while (stack.length > 0) {
              const se = stack.pop();
              if (se.t === tn) break;
            }
          }
        }
        tr.s = [...stack];  // Don't really need the whole stack for each trace entry...
        tr.d = stack.length;
        if (tr.d > maxDepth) maxDepth = tr.d;
        tr.s.stage = stage;
      }

      if (traceKeep) {
        exports.hb_buffer_serialize_glyphs(
          bufferPtr,
          0, exports.hb_buffer_get_length(bufferPtr),
          traceBufPtr, traceBufLen, 0,
          fontPtr,
          HB_BUFFER_SERIALIZE_FORMAT_JSON,
          HB_BUFFER_SERIALIZE_FLAG_NO_GLYPH_NAMES);

        tr.t =  JSON.parse(utf8Decoder.decode(Module.HEAPU8.subarray(traceBufPtr, Module.HEAPU8.indexOf(0, traceBufPtr))));
        //tr.glyphs = exports.hb_buffer_get_content_type(bufferPtr) == HB_BUFFER_CONTENT_TYPE_GLYPHS,

        // look for glyphs that are modified...
        const t = tr.t;
        const sets = m.match(/ at [\d,]+/g);
        if (sets && !m.includes('try ') && !m.includes('tried ')) {
          for (let i=0; i<sets.length; i++) {
            const indices = sets[i].match(/\d+/g);
            for (let j=0; j<indices.length; j++) {
              const n = parseInt(indices[j]);
              t[n].H = i+1;
            }
          }
        }
        trace.push(tr);
      }
      traceCount++;
      return 1;
    }
    const traceFuncPtr = addFunction(traceFunc, 'iiiii');
    exports.hb_buffer_set_message_func(buffer.ptr, traceFuncPtr, 0, 0);
    this.hb.shape(this.font, buffer, this.features, 0);
    removeFunction(traceFuncPtr);
    exports.free(traceBufPtr);
    const result = buffer.json(this.font);
    buffer.destroy();

    result.rtl = (result.length > 0) && (result[0].cl > result[result.length-1].cl);

    if (traceKeep) {
      result.trace = trace;
      result.gpos_point = gpos_point;
      result.gsub_point = gsub_point;
    }

    if (traceAttachments) {
      if (result.rtl) {
        // The messages are in original order, and need to be reversed to match the final ordering
        // These attachments relate to the order of the _final_ glyph output order
        const glyphCount = result.length;
        cursives.reverseIndexes(glyphCount);
        marks.reverseIndexes(glyphCount);
      }
      result.attachments = {
        cursives: cursives,   // [ [glyphIndex,glyphIndex], ... ]
        marks: marks,         // [ [markIndex,glyphIndex], ... ]
      }
    }
    if (traceStack) {
      result.maxDepth = maxDepth;
    }
    return result;
  }
  _getGlyphData(gid) {
    const data = this.cacheGlyphData.get(gid);
    if (data) return data;
    const path = this.font.glyphToPath(gid);
    const json = this.font.glyphToJson(gid);
    const newData = {
      class: this.otLayout.getGlyphClass(this.otFont?.tables?.gdef?.classDef, gid),
      name: this.otFont?.glyphs?.get(gid)?.name,
      path: path, 
      json: this._glyphToRelativeJson(json),
      jsonAbsolute : json,
    };
    this.cacheGlyphData.set(gid, newData);
    return newData;
  }
  getGlyphClass(gid) {
    const data = this._getGlyphData(gid);
    return data.class;
  }
  isGlyphMark(gid) {
    return (this.getGlyphClass(gid) === 3);
  }
  getGlyphName(gid) {
    const data = this._getGlyphData(gid);
    return data.name;
  }
  getGlyphCount() {
    //return this.otFont?.glyphs?.length;
    return this.otFont?.numGlyphs;
  }
  /* getDebugInfo - find the debug line information, if available
   * ix{number}     : the table index of GSUB or GPOS
   * stage{string}  : either 'GSUB' or 'GPOS'
  */
  getDebugInfo(ix/*: number*/, stage/*: string*/) {
    if (this.debugInfo && this.debugInfo[stage] && this.debugInfo[stage][ix]) {
      const debugData = this.debugInfo[stage][ix];
      return {
        source: debugData[0],
        name: debugData[1],
        script: debugData[2] && debugData[2][0],
        language: debugData[2] && debugData[2][1],
        feature: debugData[2] && debugData[2][2],
      };
    }
    return null;
  }
  /*
   * glyphToRelativeJson
   * Convert a GID to a json path and extents
   *
   * @param {number} gid - the GID number
   * @return {object} obj
   * @return {string} obj.json - JSON data describing the path
   * @return {object} obj.ext  - Object describing extents
   * @return {number} obj.ext.xl - X lower
   * @return {number} obj.ext.xh - X higher
   * @return {number} obj.ext.yl - Y lower
   * @return {number} obj.ext.yh - Y higher
   * @return {number} obj.ext.w - width
   * @return {number} obj.ext.h - height
   */
  glyphToRelativeJson(gid) {
    const data = this._getGlyphData(gid);
    return data.json;
  }
  _glyphToRelativeJson(json) {
    const j = json; //this.font.glyphToJson(gid);
    let r = [];
    let x = 0;
    let y = 0;
    let last_x, last_y;
    let ext = {xl:null, yl:null, xh:null, yh:null};
    let res = j.reduce( (acc,w) => {
      let v = {};
      v.type = w.type.toLowerCase();
      v.values = w.values.map( function(z, i) {
        if (i%2)
        {
          last_y = z;
          return -(z - y);
        } else
        {
          last_x = z;
          return z - x;
        }
        });
      x = last_x;
      y = last_y;
      if ((ext.xh === null) || (x>ext.xh)) ext.xh = x;
      if ((ext.yh === null) || (y>ext.yh)) ext.yh = y;
      if ((ext.xl === null) || (x<ext.xl)) ext.xl = x;
      if ((ext.yl === null) || (y<ext.yl)) ext.yl = y;
      return acc.concat(v);
    }, []);
    if (!ext.xl) ext.xl = 0;
    if (!ext.xh) ext.xh = 0;
    if (!ext.yl) ext.yl = 0;
    if (!ext.yh) ext.yh = 0;
    ext.w = ext.xh - ext.xl;
    ext.h = ext.yh - ext.yl;
    return {
      json: res,
      ext: ext,
    }
  }
  applyDeltaArray(hbresult, hbdelta) {
    const res = [];
    let indexDelta = 0;
    const maxDelta = hbdelta?hbdelta.length:0;
    for (let i=0; i<hbresult.length; i++) {
      const entry = hbresult[i];
      const entryDelta = (i<maxDelta) ? hbdelta[i] : {};
      const entryNew = {
        g:  entry.g,
        cl: entry.cl,
        ax: entry.ax + (entryDelta?.ax || 0),
        ay: entry.ay + (entryDelta?.ay || 0),
        dx: entry.dx + (entryDelta?.dx || 0),
        dy: entry.dy + (entryDelta?.dy || 0),
        flags: entry.flags,
      }
      res.push(entryNew);
    }
    res.rtl = hbresult.rtl;
    res.attachments = hbresult.attachments;
    return res;
  }
}

// Convert a JSON array into SVG
function jsonToSvg(pathArray) {
  let res = pathArray.reduce( (acc, gl) => {
    const v = gl.type + gl.values.join(' ');
    return acc.concat(v);
  }, '');
  return res;
}

export { 
  CursivesSets,
  MarksSets,
  HarfBuzzShaping, 
  jsonToSvg,
}
