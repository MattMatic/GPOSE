// GPOS Adjustment Tool - main word list
// github.com/MattMatic
// 2026-02

import { HarfBuzzShaping, jsonToSvg } from './hbshaping.mjs';
import { FontForceField, FORCEFIELD_QUALITY } from './fontforcefield.mjs';
import { lcsWithGapConstraints } from './lcsgap.mjs';

// Unicode Default_Ignorable codepoints that HarfBuzz skips in GPOS matching.
// Source: Unicode DerivedCoreProperties.txt, filtered to characters that
// HarfBuzz actually skips during GSUB/GPOS lookup matching.
const DEFAULT_IGNORABLE_CODEPOINTS = new Set([
  0x200C, // ZERO WIDTH NON-JOINER
  0x200D, // ZERO WIDTH JOINER
  0x034F, // COMBINING GRAPHEME JOINER
  0x00AD, // SOFT HYPHEN
  0x200B, // ZERO WIDTH SPACE
  0x200E, // LEFT-TO-RIGHT MARK
  0x200F, // RIGHT-TO-LEFT MARK
  0xFEFF, // ZERO WIDTH NO-BREAK SPACE (BOM)
  0x2060, // WORD JOINER
  0x2061, // FUNCTION APPLICATION
  0x2062, // INVISIBLE TIMES
  0x2063, // INVISIBLE SEPARATOR
  0x2064, // INVISIBLE PLUS
]);

class WordListEntry {
  constructor(word) {
    this.w = word;
    //this.hb = [];
    //this.ev = [];
    //this.delta = [];
  }
  shape(wordlist, gposGids) {
    let needTrace = false;
    for (const ch of this.w) {
      if (DEFAULT_IGNORABLE_CODEPOINTS.has(ch.codePointAt(0))) needTrace = true;
    }
    if (!needTrace) gposGids = false; // No need to do this trace!
    const options = {
      traceKeep: gposGids,
      traceAttachments: true,
      traceStack: false,
    }
    wordlist.hbs.setDirection(this.direction);
    this.hb = wordlist.hbs.trace(this.w, options);    
    this.ev = null;
    this.clearDelta();
    wordlist.hbs.clearDirection();
    if (gposGids) {
      const gposStart = this.hb.gpos_point;
      if (typeof gposStart === 'number') {
        const ge = this.hb.trace[gposStart].t;
        const geLen = ge.length;
        if (this.hb.rtl) {
          for (let i=0; i<geLen; i++) {
            this.hb[geLen-i-1].g = ge[i].g;
          }          
        } else {
          for (let i=0; i<geLen; i++) {
            this.hb[i].g = ge[i].g;
          }          
        }
      }
      delete this.hb.trace;
      delete this.hb.gpos_point;
      delete this.hb.gsub_point;    
    }
    return this;
  }
  clearDirection() {
    delete this.direction;
  }
  setDirection(direction) {
    if (typeof direction !== 'string') {
      this.clearDirection();
    } else {
      this.direction = direction;
    }
  }
  getDirection() {
    if ((typeof this.direction === 'string') && (this.direction.length > 0))
      return this.direction;
    return undefined;
  }
  evaluate(wordlist, options={}) {
    if (!this.hb) return this;
    const hb = wordlist.hbs.applyDeltaArray(this.hb, this.delta);
    this.ev = wordlist.fff.evaluate(hb, options);
    this.note = wordlist.fff.evaluationToNote(this.ev, options);
    return this;
  }
  clearEdits() {
    this.delta.forEach(e=>{
      e.edited = false;
    });
  }
  hasEdits() {
    for (let i=0; i<this.delta; i++) {
      if (this.delta[i].edited) return true;
    }
    return false;
  }
  getGlyphPattern(wordlist) {
    //const note = wordlist.fff.evaluationToNote(this.ev, {includeIcons:false, forceLTR:true});
    let note = '';
    for (let i=0; i<this.ev.hb.length; i++) {
      const e = this.ev.hb[i];
      const d = this.delta[i];
      if ((d.ax || d.dx || d.dy) && d.edited) note += '*'; // CHANGE
      note += wordlist.hbs.getGlyphName(e.g) + ' ';
    }
    return note.trim();
  }
  shapeAndEvaluate(wordlist, options={}) {
    this.shape(wordlist);
    this.evaluate(wordlist, options);
  }
  clearDelta() {
    this.delta = [];
    this.hb.forEach(e=>{
      this.delta.push({});
    });
  }
  updateDelta(gidx, idName, value) {
    if (gidx >= this.delta.length)
      throw new Error(`${gidx} does not apply to length ${this.delta.length}`);
    const de = this.delta[gidx];
    value = parseInt(value);
    if (isNaN(value)) {
      de[idName] = null;
      de.edited = false;
      return false;
    } else {
      de[idName] = value;
      de.edited = true;
      return true;
    }
  }
  getDelta(gidx, idName) {
    const de = this.delta[gidx];
    if (!de) return;
    return de[idName];
  }
  hasDelta() {
    return this.delta && (this.delta.length > 0) && (this.delta.find(e=>(!isNaN(e.dx) || !isNaN(e.dy) || !isNaN(e.ax))));
  }
  hasDeltaAt(gidx) {
    if (!this.delta || (gidx >= this.delta.length)) return false;
    const e = this.delta[gidx];
    return (!isNaN(e.dx) || !isNaN(e.dy) || !isNaN(e.ax) || !isNaN(e.ay));
  }
  getQuality() {
    return this?.ev?.quality;
  }
  getQualityString() {
    const qs = ['ok', 'maybe', 'kern', 'near', 'glyph'];
    return qs[this.getQuality()];
  }
  getWord() {
    return this.w;
  }
  toSVG(wordlist, options={}) {
    let sh;
    sh = wordlist.hbs.applyDeltaArray(this.hb, this.delta);
    options.delta = this.delta;
    return wordlist.fff.toSVG(sh, options);
  }
  toSVGBefore(wordlist, optionsSVG={}, optionsEvaluate={}) {
    const hb = this.hb;
    const ev = wordlist.fff.evaluate(hb, optionsEvaluate);
    const note = wordlist.fff.evaluationToNote(ev, optionsEvaluate);

    return {
      svg: wordlist.fff.toSVG(hb, optionsSVG),
      ev: ev,
      note: note,
    }
  }
  saveDelta() {
    const da = [];
    this.delta.forEach(de=>{
      const nde = {};
      if (typeof de.dx === 'number') nde.dx = de.dx;
      if (typeof de.dy === 'number') nde.dy = de.dy;
      if (typeof de.ax === 'number') nde.ax = de.ax;
      da.push(nde);
    });
    return da;
  }
  restoreDelta(da) {
    this.clearDelta();
    for (let i=0; i<da.length; i++) {
      const nde = {};
      const de = da[i];
      if (typeof de.dx === 'number') nde.dx = de.dx;
      if (typeof de.dy === 'number') nde.dy = de.dy;
      if (typeof de.ax === 'number') nde.ax = de.ax;
      this.delta[i] = nde;
    }
  }
}

class WordList {
  constructor(harfBuzzShaping, forceField) {
    this.hbs = harfBuzzShaping;
    this.fff = forceField;
    this.list = [];
    this.map = new Map();
    this.deltaChoices = new Map();
    this.filtered = {
      all: [],
      collision: [],
      near: [],
      kerning: [],
      maybe: [],
      edited: [],
      pattern: [],
    };
    this.currentIndex = 0;
    this.currentEntry = null;
  }
  destroy () {
    // Nothing (yet)
  }
  findWord(word) {
    //return this.list.find(e=>e.w == word);
    return this.map.get(word);
  }
  addWord(word) {
    if (!this.findWord(word)) {
      const entry = new WordListEntry(word);
      this.list.push(entry);
      this.map.set(word, entry);
      return true;
    }
    return false;
  }
  addWords(words) {
    words.forEach(w=> {
      this.addWord(w);
    });
  }
  length() { return this.list.length; }
  get(index) {
    return this.list[index];
  }
  shape(index, gposGids) {
    return this.list[index].shape(this, gposGids);
  }
  evaluate(index, options={}) {
    return this.list[index].evaluate(this, options);
  }
  /*
   * Create sets of adjustment values for each glyph ID
   */
  buildDeltaChoices() {
    this.list.forEach(we=>{
      const delta = we.delta;
      const hb = we.hb;
      const ev = we.ev;
      const evhb = ev.hb;
      if (delta) {
        for (let gi=0; gi<evhb.length; gi++) {
          const e = evhb[gi];
          const de = delta[gi];
          let dc = this.deltaChoices.get(e.g);
          if (!dc) {
            dc = {
              ax: new Set(),
              dx: new Set(),
              dy: new Set(),
            }
            this.deltaChoices.set(e.g, dc);
          }
          if (de.ax) dc.ax.add(de.ax);
          if (de.dx) dc.dx.add(de.dx);
          if (de.dy) dc.dy.add(de.dy);
        }
      }
    });
  }
  getDeltaChoice(gid, idName) {
    const dc = this.deltaChoices.get(gid);
    if (!dc) return;
    const dci = dc[idName];
    if (!dci) return;
    const da = Array.from(dci);
    da.sort((a,b) => a-b);
    return da; //dc[idName];
  }
  /*
   * Return whether there are choices for this GID and 'ax'/'dx'/'dy'
   */
  hasDeltaChoices(gid, idName) {
    const dci = this.getDeltaChoice(gid, idName);
    if (!dci) return false;
    return dci.length > 0;
  }
  /*
   * Build filtered tables of indexes, and return the counts
   */
  buildStatistics() {
    const f = this.filtered;
    f.collision.length = 0;
    f.near.length = 0;
    f.kerning.length = 0;
    f.maybe.length = 0;
    f.edited.length = 0;
    f.all.length = 0;
    const max = this.list.length;
    for (let idx=0; idx<max; idx++) {
      const we = this.list[idx];
      f.all.push(idx);
      switch (we.getQuality()) {
        case FORCEFIELD_QUALITY.COLLISION_GLYPH :
          f.collision.push(idx);
          break;
        case FORCEFIELD_QUALITY.COLLISION_NEAR:
          f.near.push(idx);
          break;
        case FORCEFIELD_QUALITY.KERNING:
          f.kerning.push(idx);
          break;
        case FORCEFIELD_QUALITY.MAYBE:
          f.maybe.push(idx);
          break;
      }
      if (we.hasDelta())
        f.edited.push(idx);
    }
    return this.getStatistics();
  }
  getStatistics() {
    const f = this.filtered;
    return {
      total:      this.list.length,
      collision:  f.collision.length,
      near:       f.near.length,
      kerning:    f.kerning.length,
      maybe:      f.maybe.length,
      edited:     f.edited.length,
      pattern:    f.pattern.length,
    }    
  }
  /*
   * Create the delta array for JSON5 + saving
   */
  createDeltaArrayForSave() {
    const da = [];
    this.list.forEach(we=> {
      if (we.delta) {
        const delta = [];
        we.delta.forEach((de, dei)=> {
          let diff = false;
          const den = {i:dei};
          if (de.ax) { diff = true; den.ax = de.ax; }
          if (de.dx) { diff = true; den.dx = de.dx; }
          if (de.dy) { diff = true; den.dy = de.dy; }
          if (diff) delta.push(den);
        });
        if (delta.length > 0) {
          da.push({
            w: we.w,
            d: delta,
            dir: we.getDirection(),
          });
        }
      }
    });
    return da;
  }
  /*
   * Apply a deltaArray that has been loaded from JSON5
   */
  applyDeltaArrayEntry(de, options={}) {
    const {addNewWords = true} = options;
      let wse = this.findWord(de.w);
      if (!wse && addNewWords) {
        const we = new WordListEntry(de.w);
        we.setDirection(de.dir);
        we.shape(this);
        we.evaluate(this, options);
        this.list.push(we);
        wse = we;
        this._unfound++;
      } else {
        this._found++;
        if (de.dir && (de.dir !== wse.getDirection())) {
          wse.setDirection(de.dir);
          wse.shape(this);
          wse.evaluate(this, options);
        }
      }
      // Now apply the delta...
      if (wse) {
        wse.clearDelta();
        de.d.forEach(ed=> {
          if (ed.i >= wse.delta.length) {
            console.log('!!', ed.i, wse.delta.length, ed, de, wse); //~~!!!!~~
          } else {
            const wed = wse.delta[ed.i];
            if (typeof ed.dx == 'number') wed.dx = ed.dx;
            if (typeof ed.dy == 'number') wed.dy = ed.dy;
            if (typeof ed.ax == 'number') wed.ax = ed.ax;            
          }
        });
        // Now apply the delta
        wse.evaluate(this, options);
      }
  }
  applyDeltaArrayFromLoad(da, options={}) {
    const {addNewWords = true} = options;
    this._unfound = 0;
    this._found = 0;
    da.forEach(de=> {
      this.applyDeltaArrayEntry(de);
    });
    this.buildDeltaChoices();
    this.buildStatistics();
    return {
      found: this._found,
      unfound: this._unfound,
    }
  }

  getEntry(index) {
    return this.list[index];
  }

  getCurrentEntry() { 
    if (typeof this.currentIndex != 'number') return null;
    return this.list[this.currentIndex];
  }
  getCurrentIndex(oneBased) {
    return this.currentIndex + (oneBased?1:0);
  }
  gotoIndex(index, oneBased) {
    if (oneBased) index--;
    if (index < 0) index = 0;
    if (index >= this.list.length) index = this.list.length-1;
    this.leavingCurrentEntry();
    this.currentIndex = index;
  }
  leavingCurrentEntry() {
    /*
    const ce = this.getCurrentEntry();
    if (!ce) return;
    if (!ce.hasEdits()) return;
    */
  }
  gotoNext(which, forwards, firstLast) {
    const patternList = this.filtered.pattern;
    function checkEntry(we, index) {
      if (typeof which == 'number')
        return (which == we.getQuality());
      if (typeof which === 'undefined')
        return true;
      if (typeof which === 'string') {
        if (which === 'edited')
          return we.hasDelta();
        if (which === 'pattern')
          return patternList.indexOf(index)>=0;
        if (which === 'all')
          return true;
      }
      return false;
    }

    this.leavingCurrentEntry();
    const max = this.length();
    const index = this.currentIndex;
    let i;
    if (firstLast) {
      if (forwards)
        i = 0;
      else
        i = max-1;
    } else {
      i = (forwards) ? index+1 : index-1;
    }

    while ((i >= 0) && (i < max)) {
      const entry = wordList.get(i);
      if (checkEntry(entry, i)) {
        this.currentIndex = i;
        return entry;
      }
      if (forwards)
        i++;
      else
        i--;
    }
  }
}

export {
  WordListEntry,
  WordList,
}