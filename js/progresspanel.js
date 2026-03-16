// polyfill for scheduler.yield
globalThis.scheduler = globalThis.scheduler || {};
globalThis.scheduler.yield =
  globalThis.scheduler.yield ||
  (() => new Promise((r) => setTimeout(r, 0)));

class ProgressPanel {
  constructor(interval=32, func) {
    this._interval = interval;
    this._next = performance.now() + this._interval;
    this._func = func;
    this.showAbort = false;
  }
  _elapsed() {
    const now = performance.now();
    if (now < this._next) return false;
    while (now > this._next) this._next += this._interval;
    return true;
  }
  setInterval(interval) {
    this._interval = interval;
  }
  _update() {
    function secondsToHHSSMM(t) {
      if (isNaN(t) || !isFinite(t)) return '-';
      if (t < 3600)
        return new Date(t*1000).toISOString().substring(14,19);
      else
        return new Date(t*1000).toISOString().substring(11,19);
    }
    const max = this._max;
    const i   = this._i;
    const started = this._started;
    progress_panel_progress.max   = max;
    progress_panel_progress.value = i;
    const overallTime = (Date.now() - started) / 1000.0;
    let rate;
    if (i < 0)
      rate = Math.round(max / overallTime);
    else
      rate = Math.round(i / overallTime);      
    let eta = (max - i) / rate;
    if (isNaN(eta)) eta = '-';
    if (isNaN(rate)) rate = '-';
    let html = `${i} / ${max}\r\n${secondsToHHSSMM(overallTime)} / ${secondsToHHSSMM(eta)} ${rate}/s`;
    progress_panel_eta.innerText = html;
  }
  start(max, message, allowAbort) {
    this._abort = false;
    this._running = true;
    this._started = Date.now();
    this._next = performance.now() + this._interval;
    this._max = max;
    this._i = 0;
    this._update();
    progress_panel_title.innerText = message || '';
    if (allowAbort) progress_panel_abort.hidden = false;
    progress_panel.style.display = 'block';
    this._timeout = setTimeout(() => { clearTimeout(this._timeout); }, 25);
    //await scheduler.yield(); -- call this on return
    return true;
  }
  abort() {
    if (this.running)
      this._abort = true;
  }
  aborted() {
    return this._abort;
  }
  done() {
    this._update();
    if (this._func) this._func(this, this._i, this._max);
    progress_panel_abort.hidden = true;
    progress_panel.style.display = 'none';
    this._running = false;
    return true;
  }
  running() {
    return this._running;
  }
  setProgress(i) {
    this._i = i;    
    return this.update();
  }
  update() {
    if (this._elapsed()) {
      this._update();
      if (this._func) this._func(this, this._i, this._max);
      //await scheduler.yield(); -- call this in the top level function
      return true;
    }
  }
};

let progressPanel = new ProgressPanel();


window.document.write(`
<style>
  #progress_panel {
  position: fixed;
  top: 20px;
  right: 20px;
  background-color: #c0f0c0;
  border: 2px solid #262;
  padding: 10px;
  display: none;
}
</style>

<div id='progress_panel'>
  <table border=0>
    <tr>
      <td valign='top'><b><span style='font-size:120%;' id='progress_panel_title'></span></b>&nbsp;</td>
      <td valign='top'>
        <progress id='progress_panel_progress' max=100 value=100 width='100%'></progress>
        <div id='progress_panel_eta'>&nbsp;</div>
      </td>
      <td valign='center'>
        <button id='progress_panel_abort' onclick='progressPanel.abort();' hidden>Abort</button>
      </td>
    </tr>
  </table>
</div>
`);