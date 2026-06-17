// CoPilot Code

/**
 * Longest Common Subsequence with gap constraints.
 *
 * @param {Array} A
 * @param {Array} B
 * @param {Object} opts
 * @param {number} opts.maxGapA - max allowed gap in A between matched elements
 * @param {number} opts.maxGapB - max allowed gap in B between matched elements
 * @param {number} opts.startA - where to start in the A array
 * @param {number} opts.startB - where to start in the B array
 * @param {Function} opts.equals - comparator (a, b) => boolean
 *
 * @returns {Array} the constrained LCS, with each entry {a: A[i], b: B[j]}
 */
function lcsWithGapConstraints(A, B, opts = {}) {
  const maxGapA = opts.maxGapA ?? Infinity;
  const maxGapB = opts.maxGapB ?? Infinity;
  const equals = opts.equals ?? ((x, y) => x === y);

  const n = A.length;
  const m = B.length;

  // DP[i][j] = best LCS ending at A[i], B[j]
  const DP = Array.from({ length: n }, () =>
    Array.from({ length: m }, () => ({
      length: 0,
      prev: null
    }))
  );

  let best = { length: 0, i: -1, j: -1 };

  const iStart = opts.startA ?? 0;
  const jStart = opts.startB ?? 0;
  for (let i = iStart; i < n; i++) {
    for (let j = jStart; j < m; j++) {
      if (!equals(A[i], B[j])) continue;

      // Start a new subsequence
      DP[i][j].length = 1;

      // Try to extend from previous matches
      for (let pi = Math.max(iStart, i - maxGapA - 1); pi < i; pi++) {
        for (let pj = Math.max(jStart, j - maxGapB - 1); pj < j; pj++) {
          if (DP[pi][pj].length + 1 > DP[i][j].length) {
            DP[i][j].length = DP[pi][pj].length + 1;
            DP[i][j].prev = [pi, pj];
          }
        }
      }

      // Track global best
      if (DP[i][j].length > best.length) {
        best = { length: DP[i][j].length, i, j };
      }
    }
  }

  // Reconstruct LCS
  const result = [];
  let cur = best.i >= 0 ? [best.i, best.j] : null;

  while (cur) {
    const [i, j] = cur;
    result.push({
      a: A[i],
      b: B[j]
    });
    cur = DP[i][j].prev;
  }

  return result.reverse();
}
//--^--^--^--

export {
  lcsWithGapConstraints,
}
