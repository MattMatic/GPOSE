// Pool of shapeworker.js workers for parallel HarfBuzz shape + FontForceField evaluate.
// github.com/MattMatic
// 2026-08

const MAX_WORKERS = 8;

class ShapePool {
  constructor(size) {
    this.size = size || Math.min(MAX_WORKERS, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4);
    console.log(`ShapePool size: ${this.size}`);
    this.workers = [];
    this._nextJobId = 1;
  }

  /*
   * Spawn the worker pool and load the font + JSON config into each worker.
   * Terminates any previously running pool first.
   */
  async init(fontBlob, jsonText) {
    this.destroy();
    const initPromises = [];
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker('./js/shapeworker.js');
      const readyPromise = new Promise((resolve, reject) => {
        const onMessage = (e) => {
          const msg = e.data;
          if (msg.op === 'ready') {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            resolve();
          } else if (msg.op === 'error') {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            reject(new Error(msg.message));
          }
        };
        const onError = (err) => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          reject(err);
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
      });
      worker.postMessage({ op: 'init', fontBlob, jsonText });
      this.workers.push(worker);
      initPromises.push(readyPromise);
    }
    await Promise.all(initPromises);
  }

  /*
   * Signal that in-flight (and any not-yet-collected) results should be
   * dropped. Workers can't be interrupted mid-word, so this just makes
   * process() stop waiting for/collecting further results.
   */
  abort() {
    this._aborted = true;
  }

  /*
   * Distribute `jobs` (array of {ref, word, direction, needsShape, gposGids, hb, deltaOverrides})
   * round-robin across the pool, run shape+evaluate for each, and resolve
   * with a Map<ref, {ref, hb, delta, ev, note}>. Calls onProgress(completed, total)
   * as batches of results stream back.
   */
  async process(jobs, evaluateOptions, onProgress) {
    this._aborted = false;
    const results = new Map();
    if (this.workers.length === 0 || jobs.length === 0) {
      return results;
    }

    const jobId = this._nextJobId++;
    const total = jobs.length;
    let completed = 0;

    const chunks = this.workers.map(() => []);
    jobs.forEach((job, i) => {
      chunks[i % this.workers.length].push(job);
    });

    return new Promise((resolve, reject) => {
      let pending = chunks.filter(c => c.length > 0).length;
      let settled = false;
      const cleanupFns = [];

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanupFns.forEach(fn => fn());
        resolve(results);
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        cleanupFns.forEach(fn => fn());
        reject(err);
      };

      this.workers.forEach((worker, idx) => {
        const chunk = chunks[idx];
        if (chunk.length === 0) return;

        const onMessage = (e) => {
          const msg = e.data;
          if (msg.jobId !== jobId) return;
          if (msg.op === 'result') {
            if (this._aborted || settled) return;
            msg.results.forEach(r => results.set(r.ref, r));
            completed += msg.results.length;
            if (onProgress) onProgress(completed, total);
          } else if (msg.op === 'done') {
            pending--;
            if (this._aborted) { finish(); return; }
            if (pending === 0) finish();
          } else if (msg.op === 'error') {
            fail(new Error(msg.message));
          }
        };
        const onError = (err) => fail(err);

        cleanupFns.push(() => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
        });
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage({ op: 'process', jobId, items: chunk, evaluateOptions });
      });
    });
  }

  destroy() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
  }
}

export { ShapePool };
