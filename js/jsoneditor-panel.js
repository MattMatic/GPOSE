// Floating, draggable/resizable panel for live-editing the force-field JSON.
//
//  - Typing (debounced) previews the JSON on the current word only. The rest of the
//    word list is NOT re-evaluated, so the bin counts are flagged "preview only".
//  - "Apply to all" pushes the JSON to the worker pool, re-evaluates every word
//    (deltas are kept) and rebuilds the Collision/Near/Kerning/Maybe bins.
//  - "Download" saves the text as a .json file.
//
// Relies on globals from index.html: fff, wordList, JSON5, hbs, evaluateOptions,
// renderSVG, showStatistics, progressPanel, saveTextToFile, DateTimeForFilename,
// myYield, applyShapeResult, getShapePool, getLastJsonText, setLastJsonText,
// reinitShapePool.
'use strict';

const JsonEditorPanel = (() => {
  const PREVIEW_DELAY_MS = 300;

  let panel, ta, spanStatus, btnApply, btnRevert;
  let goodText = null;       // JSON text currently loaded into the main-thread fff
  let appliedText = null;    // JSON text the whole word list was last evaluated with
  let timer = 0;
  let busy = false;
  // Words whose stored rating was re-evaluated under the previewed (unapplied) JSON,
  // with a snapshot of the rating they had under the applied JSON.
  const touched = new Map();   // entry -> {ev, note, q, deltaSig}

  const deltaSig = (entry) => JSON.stringify(entry.saveDelta());

  function isPreviewing() {
    return goodText !== null && appliedText !== null && goodText !== appliedText;
  }

  // Called by renderSVG just before it re-evaluates a word while previewing
  function beforeEvaluate(entry) {
    if (touched.has(entry)) return;
    touched.set(entry, { ev: entry.ev, note: entry.note, q: entry.getQuality(), deltaSig: deltaSig(entry) });
  }

  // Words moved away from whose rating changed because of the JSON go into the History breadcrumbs
  function onLeavingEntry(entry, index0) {
    const snap = touched.get(entry);
    if (!snap || !isPreviewing()) return;
    if (entry.getQuality() === snap.q) return;
    breadCrumbAdd(index0 + 1);
    divBreadCrumbs.innerHTML = breadCrumbCreateHtml();
  }

  // Put back the ratings of the touched words (the JSON is back to the applied one), and recount
  function restoreTouched() {
    touched.forEach((snap, entry) => {
      if (deltaSig(entry) === snap.deltaSig) {
        entry.ev = snap.ev;
        entry.note = snap.note;
      } else {
        entry.evaluate(wordList, evaluateOptionsFast);   // deltas were edited meanwhile
      }
    });
    touched.clear();
    wordList.buildStatistics();
    showStatistics();
  }

  function build() {
    const style = document.createElement('style');
    style.textContent = `
      #jsonEditorPanel { position:fixed; top:80px; right:40px; width:480px; height:420px; min-width:300px; min-height:200px;
        z-index:1000; display:none; flex-direction:column; background:#fff; border:1px solid #888;
        box-shadow:0 4px 16px rgba(0,0,0,.35); resize:both; overflow:hidden; }
      #jsonEditorPanel .jep-head { background:#456; color:#fff; padding:4px 8px; cursor:move; user-select:none;
        display:flex; justify-content:space-between; align-items:center; }
      #jsonEditorPanel textarea { flex:1; width:100%; box-sizing:border-box; font-family:monospace; font-size:12px;
        border:0; border-bottom:1px solid #ccc; resize:none; white-space:pre; overflow:auto; }
      #jsonEditorPanel .jep-foot { padding:4px 8px; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
      #jsonEditorPanel .jep-status { font-size:12px; flex-basis:100%; }
      #jsonEditorPanel .jep-status.err { color:#c00; }
      #jsonEditorPanel .jep-status.stale { color:#a60; }
    `;
    document.head.appendChild(style);

    wordList.onLeavingEntry = onLeavingEntry;

    panel = document.createElement('div');
    panel.id = 'jsonEditorPanel';
    panel.innerHTML = `
      <div class='jep-head'><span>Force-field JSON</span><button type='button' aria-label='close'>X</button></div>
      <textarea spellcheck='false' wrap='off'></textarea>
      <div class='jep-foot'>
        <button type='button' class='jep-apply' style='background-color:#afa;'>Apply to all</button>
        <button type='button' class='jep-revert'>Revert</button>
        <button type='button' class='jep-download'>Download</button>
        <span class='jep-status'></span>
      </div>`;
    document.body.appendChild(panel);

    ta = panel.querySelector('textarea');
    spanStatus = panel.querySelector('.jep-status');
    btnApply = panel.querySelector('.jep-apply');
    btnRevert = panel.querySelector('.jep-revert');
    panel.querySelector('.jep-head button').onclick = hide;
    panel.querySelector('.jep-download').onclick = download;
    btnApply.onclick = applyToAll;
    btnRevert.onclick = revert;
    ta.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(preview, PREVIEW_DELAY_MS);
    });
    makeDraggable(panel, panel.querySelector('.jep-head'));
  }

  function makeDraggable(el, handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      const move = (m) => {
        el.style.left = Math.max(0, Math.min(window.innerWidth - 60, m.clientX - dx)) + 'px';
        el.style.top  = Math.max(0, Math.min(window.innerHeight - 30, m.clientY - dy)) + 'px';
        el.style.right = 'auto';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  function setStatus(msg, cls='') {
    spanStatus.textContent = msg;
    spanStatus.className = 'jep-status ' + cls;
  }

  function updateStaleStatus() {
    if (ta.value === appliedText) setStatus('Applied to all words.');
    else setStatus('Preview only (current word). Word ratings and bin counts are stale until "Apply to all".', 'stale');
  }

  function show() {
    if (!panel) build();
    if (!goodText) {
      goodText = getLastJsonText() ?? '';
      appliedText = goodText;
    }
    if (!ta.value) ta.value = goodText;
    panel.style.display = 'flex';
    updateStaleStatus();
  }

  function hide() {
    if (panel) panel.style.display = 'none';
  }

  function toggle() {
    if (panel && panel.style.display === 'flex') hide(); else show();
  }

  // Parse + load into the main-thread force field, then redraw the current word.
  // On any error, the last good text is restored so the app is never left half-reset.
  function loadIntoMain(text) {
    JSON5.parse(text); // quick syntax check with a clear message, before touching fff
    try {
      fff.applyJsonText(text);
    } catch (e) {
      try { fff.applyJsonText(goodText); } catch (e2) { console.error('Restore failed', e2); }
      throw e;
    }
    goodText = text;
  }

  function preview() {
    if (busy) return;
    const text = ta.value;
    if (text === goodText) { updateStaleStatus(); return; }
    try {
      const t0 = performance.now();
      loadIntoMain(text);
      if (!isPreviewing()) restoreTouched();   // typed back to the applied JSON
      renderSVG(true);
      updateStaleStatus();
      console.log(`JSON preview ${Math.round(performance.now() - t0)}ms`);
    } catch (e) {
      setStatus(String(e.message ?? e), 'err');
    }
  }

  function revert() {
    if (busy) return;
    clearTimeout(timer);
    ta.value = appliedText ?? '';
    // Always reload (even if the text matches goodText) so every field is rebuilt from scratch
    try {
      loadIntoMain(ta.value);
      restoreTouched();
      renderSVG(true);
      updateStaleStatus();
    } catch (e) {
      setStatus(String(e.message ?? e), 'err');
    }
  }

  function download() {
    saveTextToFile(ta.value, `gpose-config.${DateTimeForFilename()}.json`);
  }

  async function applyToAll() {
    if (busy) return;
    clearTimeout(timer);
    const text = ta.value;
    try {
      if (text !== goodText) loadIntoMain(text);
    } catch (e) {
      setStatus(String(e.message ?? e), 'err');
      return;
    }
    busy = true;
    btnApply.disabled = btnRevert.disabled = true;
    let cancelled = false;
    try {
      const max = wordList.length();
      await progressPanel.start(max, 'Starting workers...', true);

      setLastJsonText(text);
      reinitShapePool();
      const pool = await getShapePool();
      progressPanel.setMessage('Re-evaluating');
      if (pool) {
        const jobs = [];
        const entries = new Map();
        for (let i = 0; i < max; i++) {
          const entry = wordList.get(i);
          if (!entry.hb) continue;
          const deltaOverrides = [];
          entry.saveDelta().forEach((d, idx) => {
            if (('dx' in d) || ('dy' in d) || ('ax' in d)) deltaOverrides.push({ i: idx, ...d });
          });
          entries.set(i, entry);
          jobs.push({ ref: i, word: entry.w, direction: entry.getDirection(), needsShape: false, hb: entry.hb, deltaOverrides });
        }
        const results = await pool.process(jobs, evaluateOptions, (done) => {
          progressPanel.setProgress(done);
          if (progressPanel.aborted()) pool.abort();
        });
        cancelled = progressPanel.aborted();
        if (!cancelled) {
          results.forEach((r, ref) => {
            const entry = entries.get(ref);
            const delta = entry.delta;   // keep the main-thread delta (incl. 'edited' flags)
            applyShapeResult(entry, r);
            entry.delta = delta;
          });
        }
      } else {
        for (let i = 0; i < max; i++) {
          wordList.evaluate(i, evaluateOptions);
          await progressPanel.setProgress(i);
          if (!(i % 200)) await myYield();
          if (progressPanel.aborted()) { cancelled = true; break; }
        }
      }
      await progressPanel.done();

      wordList.buildStatistics();
      showStatistics();
      renderSVG(true);
      if (cancelled) {
        setStatus('Cancelled. Word ratings are only partly re-evaluated; run "Apply to all" again.', 'stale');
      } else {
        appliedText = text;
        touched.clear();   // every word has just been re-evaluated with this JSON
        updateStaleStatus();
      }
    } catch (e) {
      console.error(e);
      setStatus('Apply failed: ' + String(e.message ?? e), 'err');
      try { await progressPanel.done(); } catch (e2) { /* ignore */ }
    } finally {
      busy = false;
      btnApply.disabled = btnRevert.disabled = false;
    }
  }

  // Call when a new JSON file is loaded elsewhere (drag/drop), so the panel follows it.
  function onExternalLoad(text) {
    goodText = appliedText = text;
    touched.clear();
    if (ta) { ta.value = text; updateStaleStatus(); }
  }

  return { show, hide, toggle, onExternalLoad, isPreviewing, beforeEvaluate };
})();
