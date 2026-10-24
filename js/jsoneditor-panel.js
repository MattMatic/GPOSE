// Floating, draggable/resizable panel for live-editing the force-field JSON.
//
//  - Typing (debounced) previews the JSON on the current word only. The rest of the
//    word list is NOT re-evaluated, so the bin counts are flagged "preview only".
//  - "Test" (enabled once the JSON differs from the applied one) evaluates every word of the
//    currently selected list under the edited JSON WITHOUT changing anything: it uses a
//    temporary worker pool and only records which words would change quality. It shows
//    how many words move into / out of each bin, can copy the changes to the clipboard
//    (summary, then "word <TAB> change" per line) and can replace the Pattern List with
//    the changed words. The summary has a close button; Test brings it back.
//  - "Apply to all" pushes the JSON to the worker pool, re-evaluates every word
//    (deltas are kept) and rebuilds the Collision/Near/Kerning/Maybe bins.
//  - "Download" saves the text as a .json file.
//
// Relies on globals from index.html: fff, wordList, JSON5, hbs, evaluateOptions,
// renderSVG, showStatistics, progressPanel, saveTextToFile, DateTimeForFilename,
// myYield, applyShapeResult, getShapePool, getLastJsonText, setLastJsonText,
// reinitShapePool, createShapePool, setPatternList, GlyphQuery (js/glyph-query.js).
'use strict';

const JsonEditorPanel = (() => {
  const PREVIEW_DELAY_MS = 300;
  // index = FORCEFIELD_QUALITY value (OK 0 ... COLLISION_GLYPH 4)
  const QNAMES = ['Good', 'Maybe', 'Kerning', 'Near', 'Collision'];
  const BIN_ORDER = [4, 3, 2, 1, 0];     // Collision / Near / Kerning / Maybe / Good

  let panel, ta, spanStatus, btnApply, btnRevert, btnTest;
  let goodText = null;       // JSON text currently loaded into the main-thread fff
  let appliedText = null;    // JSON text the whole word list was last evaluated with
  let timer = 0;
  let busy = false;
  let testResult = null;     // the last Test: { text, list, tested, changes:[{index, word, from, to}], bins, better, worse }
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
      #jsonEditorPanel { position:fixed; top:80px; right:40px; width:480px; height:480px; min-width:300px; min-height:200px;
        z-index:1000; display:none; flex-direction:column; background:#fff; border:1px solid #888;
        box-shadow:0 4px 16px rgba(0,0,0,.35); resize:both; overflow:hidden; }
      #jsonEditorPanel .jep-head { background:#456; color:#fff; padding:4px 8px; cursor:move; user-select:none;
        display:flex; justify-content:space-between; align-items:center; }
      #jsonEditorPanel textarea { flex:1; min-height:60px; width:100%; box-sizing:border-box; font-family:monospace; font-size:12px;
        border:0; border-bottom:1px solid #ccc; resize:none; white-space:pre; overflow:auto; }
      #jsonEditorPanel .jep-foot { padding:4px 8px; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
      #jsonEditorPanel .jep-status { font-size:12px; flex-basis:100%; }
      #jsonEditorPanel .jep-status.err { color:#c00; }
      #jsonEditorPanel .jep-status.stale { color:#a60; }
      #jsonEditorPanel .jep-results { border-top:1px solid #ccc; padding:4px 8px; font-size:12px; max-height:190px; overflow:auto; background:#f6f8fb; }
      #jsonEditorPanel .jep-results[hidden] { display:none; }
      #jsonEditorPanel .jep-results table { border-collapse:collapse; margin:3px 0; }
      #jsonEditorPanel .jep-results th, #jsonEditorPanel .jep-results td { padding:1px 10px; text-align:right; border-bottom:1px solid #dde; }
      #jsonEditorPanel .jep-results th:first-child, #jsonEditorPanel .jep-results td:first-child { text-align:left; }
      #jsonEditorPanel .jep-results .jep-stale { color:#a60; }
      #jsonEditorPanel .jep-results .jep-sumrow { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
      #jsonEditorPanel .jep-results .jep-closeres { border:0; background:transparent; font-size:18px; line-height:1; cursor:pointer; color:#555; padding:0 2px; }
      #jsonEditorPanel .jep-results .jep-closeres:hover { color:#c00; }
      #jsonEditorPanel .jep-results .jep-acts { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:3px; }
    `;
    document.head.appendChild(style);

    wordList.onLeavingEntry = onLeavingEntry;

    panel = document.createElement('div');
    panel.id = 'jsonEditorPanel';
    panel.innerHTML = `
      <div class='jep-head'><span>Force-field JSON</span><button type='button' aria-label='close'>X</button></div>
      <textarea spellcheck='false' wrap='off'></textarea>
      <div class='jep-results' hidden></div>
      <div class='jep-foot'>
        <button type='button' class='jep-apply' style='background-color:#afa;'>Apply to all</button>
        <button type='button' class='jep-test' title='Evaluate the selected list under the edited JSON and list the words that change rating (nothing is changed)' disabled>Test</button>
        <button type='button' class='jep-revert'>Revert</button>
        <button type='button' class='jep-download'>Download</button>
        <span class='jep-status'></span>
      </div>`;
    document.body.appendChild(panel);

    ta = panel.querySelector('textarea');
    spanStatus = panel.querySelector('.jep-status');
    btnApply = panel.querySelector('.jep-apply');
    btnRevert = panel.querySelector('.jep-revert');
    btnTest = panel.querySelector('.jep-test');
    panel.querySelector('.jep-head button').onclick = hide;
    panel.querySelector('.jep-download').onclick = download;
    btnApply.onclick = applyToAll;
    btnRevert.onclick = revert;
    btnTest.onclick = test;
    panel.querySelector('.jep-results').addEventListener('click', (e) => {
      if (e.target.closest('.jep-copy')) copyResults();
      else if (e.target.closest('.jep-pl')) replacePatternList();
      else if (e.target.closest('.jep-closeres')) closeResults();
    });
    ta.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(preview, PREVIEW_DELAY_MS);
      updateButtons();
      markResultsStale();
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
    else setStatus('Preview only (current word). Word ratings and bin counts are stale until "Apply to all". "Test" shows what would change.', 'stale');
  }

  // Test is only useful when the text differs from the applied JSON
  function updateButtons() {
    if (!panel) return;
    btnTest.disabled = busy || ta.value === appliedText;
    btnApply.disabled = btnRevert.disabled = busy;
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
    updateButtons();
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
    updateButtons();
    markResultsStale();
  }

  function download() {
    saveTextToFile(ta.value, `gpose-config.${DateTimeForFilename()}.json`);
  }

  // ---- Test: which words would change rating under the edited JSON? ------------------------------------

  // The job the shape workers need to re-evaluate a word (no re-shaping, current deltas)
  function evalJob(i, entry) {
    const deltaOverrides = [];
    entry.saveDelta().forEach((d, idx) => {
      if (('dx' in d) || ('dy' in d) || ('ax' in d)) deltaOverrides.push({ i: idx, ...d });
    });
    return { ref: i, word: entry.w, direction: entry.getDirection(), needsShape: false, hb: entry.hb, deltaOverrides };
  }

  async function test() {
    if (busy) return;
    clearTimeout(timer);
    const text = ta.value;
    try { JSON5.parse(text); } catch (e) { setStatus('JSON error: ' + String(e.message ?? e), 'err'); return; }

    const listKey = GlyphQuery.activeListKey();
    const indices = GlyphQuery.listIndices('active').filter(i => wordList.get(i)?.hb);
    if (!indices.length) { setStatus('The selected list has no words to test.', 'err'); return; }
    // Words with a delta may have been rated by the quicker evaluation after a manual edit, so re-rate those
    // under the APPLIED JSON the same way the new rating is made; every other word's stored rating is used.
    const deltaWords = indices.filter(i => wordList.get(i).hasDelta());

    busy = true;
    updateButtons();
    let pool = null, cancelled = false;
    try {
      await progressPanel.start(indices.length + deltaWords.length, 'Starting workers...', true);

      // 1. the new rating of every word, from a temporary pool loaded with the edited JSON
      const newQ = new Map();
      if (typeof createShapePool === 'function') {
        pool = createShapePool();
        await pool.init(hbs.fontBlob, text);
        progressPanel.setMessage('Testing words');
        const results = await pool.process(indices.map(i => evalJob(i, wordList.get(i))), evaluateOptions, (done) => {
          progressPanel.setProgress(done);
          if (progressPanel.aborted()) pool.abort();
        });
        cancelled = progressPanel.aborted();
        results.forEach((r, ref) => newQ.set(ref, r.ev?.quality ?? 0));
      } else {
        // no workers: evaluate here (no entry is changed)
        if (text !== goodText) loadIntoMain(text);
        progressPanel.setMessage('Testing words');
        for (let n = 0; n < indices.length; n++) {
          const entry = wordList.get(indices[n]);
          const ev = fff.evaluate(hbs.applyDeltaArray(entry.hb, entry.delta), evaluateOptions);
          newQ.set(indices[n], ev?.quality ?? 0);
          await progressPanel.setProgress(n);
          if (!(n % 200)) await myYield();
          if (progressPanel.aborted()) { cancelled = true; break; }
        }
      }

      // 2. the current rating of the words with a delta, from the main pool (loaded with the applied JSON)
      const oldQ = new Map();
      if (!cancelled && deltaWords.length) {
        const mainPool = await getShapePool();
        if (mainPool) {
          progressPanel.setMessage('Checking current ratings');
          const base = indices.length;
          const results = await mainPool.process(deltaWords.map(i => evalJob(i, wordList.get(i))), evaluateOptions, (done) => {
            progressPanel.setProgress(base + done);
            if (progressPanel.aborted()) mainPool.abort();
          });
          cancelled = progressPanel.aborted();
          results.forEach((r, ref) => oldQ.set(ref, r.ev?.quality ?? 0));
        }
      }
      await progressPanel.done();

      if (cancelled) {
        setStatus('Test cancelled.', 'stale');
      } else {
        const current = (i) => oldQ.get(i) ?? touched.get(wordList.get(i))?.q ?? wordList.get(i).getQuality() ?? 0;
        const changes = [];
        for (const i of indices) {
          const from = current(i), to = newQ.get(i);
          if (to !== undefined && to !== from) changes.push({ index: i, word: wordList.get(i).getWord(), from, to });
        }
        const bins = QNAMES.map(() => ({ in: 0, out: 0 }));
        let better = 0, worse = 0;
        for (const c of changes) { bins[c.to].in++; bins[c.from].out++; if (c.to < c.from) better++; else worse++; }
        testResult = { text, list: listKey, tested: indices.length, changes, bins, better, worse };
        showResults();
        setStatus(`Test done: ${changes.length} of ${indices.length} words change rating. Nothing was changed.`);
      }
    } catch (e) {
      console.error(e);
      setStatus('Test failed: ' + String(e.message ?? e), 'err');
      try { await progressPanel.done(); } catch (e2) { /* ignore */ }
    } finally {
      if (pool) pool.destroy();
      busy = false;
      updateButtons();
    }
  }

  function showResults() {
    const box = panel.querySelector('.jep-results');
    const r = testResult;
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    const sign = (n) => (n > 0 ? '+' : '') + n;
    const rows = BIN_ORDER.map(q => `<tr><td>${QNAMES[q]}</td><td>${r.bins[q].in}</td><td>${r.bins[q].out}</td><td>${sign(r.bins[q].in - r.bins[q].out)}</td></tr>`).join('');
    box.innerHTML = `
      <div class='jep-sumrow'>
        <div><b>Test of the ${r.list} list:</b> ${r.changes.length} of ${r.tested} words change rating (${r.better} better, ${r.worse} worse)</div>
        <button type='button' class='jep-closeres' title='Close this summary (Test shows it again)' aria-label='Close summary'>&times;</button>
      </div>
      <div class='jep-stale' hidden>The JSON has been edited since this test.</div>
      <table><tr><th>Bin</th><th>moves in</th><th>moves out</th><th>net</th></tr>${rows}</table>
      <div class='jep-acts'>
        <button type='button' class='jep-copy' title='Copy the summary and one "word TAB change" line per word'${r.changes.length ? '' : ' disabled'}>Copy results</button>
        <button type='button' class='jep-pl' title='Replace the Pattern List with the changed words'${r.changes.length ? '' : ' disabled'}>Replace Pattern List (${r.changes.length})</button>
      </div>`;
    box.hidden = false;
    markResultsStale();
  }

  // Dismiss the summary (and forget the results); running Test again brings it back
  function closeResults() {
    testResult = null;
    showResults();
    updateStaleStatus();
  }

  // The results describe the text that was tested; say so when the text has moved on
  function markResultsStale() {
    if (!panel) return;
    const note = panel.querySelector('.jep-results .jep-stale');
    if (note) note.hidden = !testResult || ta.value === testResult.text;
  }

  function resultsText() {
    const r = testResult;
    const lines = [`JSON test of the ${r.list} list: ${r.changes.length} of ${r.tested} words change rating (${r.better} better, ${r.worse} worse)`,
                   ['Bin', 'Moves in', 'Moves out', 'Net'].join('\t')];
    for (const q of BIN_ORDER) lines.push([QNAMES[q], r.bins[q].in, r.bins[q].out, r.bins[q].in - r.bins[q].out].join('\t'));
    lines.push('', ['Word', 'Change'].join('\t'));
    for (const c of r.changes) lines.push(`${c.word}\t${QNAMES[c.from]} -> ${QNAMES[c.to]}`);
    return lines.join('\r\n') + '\r\n';
  }

  async function copyResults() {
    if (!testResult || !testResult.changes.length) return;
    try {
      await navigator.clipboard.writeText(resultsText());
      setStatus(`Copied the summary and ${testResult.changes.length} words to the clipboard.`);
    } catch (e) {
      setStatus('Could not copy: ' + String(e.message ?? e), 'err');
    }
  }

  function replacePatternList() {
    if (!testResult || !testResult.changes.length) return;
    setPatternList(testResult.changes.map(c => c.index), 'replace');
    setStatus(`Pattern List replaced with the ${testResult.changes.length} changed words.`);
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
    updateButtons();
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
          entries.set(i, entry);
          jobs.push(evalJob(i, entry));
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
      updateButtons();
      markResultsStale();
    }
  }

  // Call when a new JSON file is loaded elsewhere (drag/drop), so the panel follows it.
  function onExternalLoad(text) {
    goodText = appliedText = text;
    touched.clear();
    testResult = null;
    if (ta) { ta.value = text; updateStaleStatus(); showResults(); updateButtons(); }
  }

  return { show, hide, toggle, onExternalLoad, isPreviewing, beforeEvaluate };
})();
