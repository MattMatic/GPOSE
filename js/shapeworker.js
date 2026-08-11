// HarfBuzz Shape + FontForceField Evaluate Worker
// github.com/MattMatic
// 2026-08
//
// Runs the same shape()/evaluate() work that WordListEntry does on the main
// thread, but inside a dedicated Worker so a pool of these can crunch many
// (independent) words in parallel. Reuses the existing ES module classes
// unmodified -- no shaping/evaluate logic is duplicated here.
//
// Message protocol (see js/workerpool.mjs for the main-thread side):
//   in  {op:'init', fontBlob, jsonText}
//   out {op:'ready'} | {op:'error', message}
//
//   in  {op:'process', jobId, items:[{ref, word, direction, needsShape, gposGids, hb, deltaOverrides}], evaluateOptions}
//   out {op:'result', jobId, results:[{ref, hb, delta, ev, note}]}  -- streamed in batches
//   out {op:'done', jobId}
//   out {op:'error', jobId, message}

importScripts('./hbjs-12.3.0/hb.js', './hbjs.js');

let hbs, hbg, fff;
let CursivesSetsRef, MarksSetsRef, WordListEntryRef;
const fakeWordlist = {};
let initPromise = null;

async function initModules() {
  const [hbShapingMod, fffMod, clipperMod, wordListMod] = await Promise.all([
    import('./hbshaping.mjs'),
    import('./fontforcefield.mjs'),
    import('./hbclipper.mjs'),
    import('./wordlist.mjs'),
  ]);
  CursivesSetsRef = hbShapingMod.CursivesSets;
  MarksSetsRef = hbShapingMod.MarksSets;
  WordListEntryRef = wordListMod.WordListEntry;

  await clipperMod.clipperReady;

  // importScripts() doesn't set document.currentScript, so Emscripten's default
  // scriptDirectory detection falls back to this worker's own location instead of
  // hb.js's actual folder (hbjs-12.3.0/). Point it at the wasm explicitly.
  const aModuleHarfBuzz = await createHarfBuzz({
    locateFile: (path) => './hbjs-12.3.0/' + path,
  });
  const hb = hbjs(aModuleHarfBuzz);

  hbs = new hbShapingMod.HarfBuzzShaping(hb);
  hbg = new clipperMod.HarfBuzzGlyphs();
  fff = new fffMod.FontForceField(hbg);
  hbg.setHarfBuzzShaping(hbs);
  fff.setHarfBuzzGlyphs(hbg);
  fakeWordlist.hbs = hbs;
  fakeWordlist.fff = fff;
}

function restoreAttachmentPrototypes(hb) {
  if (hb && hb.attachments) {
    if (hb.attachments.cursives) Object.setPrototypeOf(hb.attachments.cursives, CursivesSetsRef.prototype);
    if (hb.attachments.marks) Object.setPrototypeOf(hb.attachments.marks, MarksSetsRef.prototype);
  }
  return hb;
}

function applyDeltaOverrides(entry, overrides) {
  if (!overrides) return;
  overrides.forEach(ed => {
    if (ed.i >= entry.delta.length) return;
    const wed = entry.delta[ed.i];
    if (typeof ed.dx === 'number') wed.dx = ed.dx;
    if (typeof ed.dy === 'number') wed.dy = ed.dy;
    if (typeof ed.ax === 'number') wed.ax = ed.ax;
  });
}

function processItem(item, evaluateOptions) {
  const entry = new WordListEntryRef(item.word);
  entry.setDirection(item.direction);
  if (item.needsShape) {
    entry.shape(fakeWordlist, item.gposGids);
    applyDeltaOverrides(entry, item.deltaOverrides);
  } else {
    entry.hb = restoreAttachmentPrototypes(item.hb);
    entry.ev = null;
    entry.clearDelta();
    applyDeltaOverrides(entry, item.deltaOverrides);
  }
  entry.evaluate(fakeWordlist, evaluateOptions);
  return {
    ref: item.ref,
    hb: entry.hb,
    delta: entry.delta,
    ev: entry.ev,
    note: entry.note,
  };
}

const BATCH_SIZE = 32;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.op === 'init') {
    try {
      initPromise = initPromise || initModules();
      await initPromise;
      hbs.setFontBlob(msg.fontBlob);
      fff.applyJsonText(msg.jsonText);
      self.postMessage({ op: 'ready' });
    } catch (err) {
      self.postMessage({ op: 'error', message: String((err && err.stack) || err) });
    }
    return;
  }
  if (msg.op === 'process') {
    const { jobId, items, evaluateOptions } = msg;
    try {
      let batch = [];
      for (let i = 0; i < items.length; i++) {
        batch.push(processItem(items[i], evaluateOptions));
        if (batch.length >= BATCH_SIZE) {
          self.postMessage({ op: 'result', jobId, results: batch });
          batch = [];
        }
      }
      if (batch.length > 0) {
        self.postMessage({ op: 'result', jobId, results: batch });
      }
      self.postMessage({ op: 'done', jobId });
    } catch (err) {
      self.postMessage({ op: 'error', jobId, message: String((err && err.stack) || err) });
    }
    return;
  }
};
