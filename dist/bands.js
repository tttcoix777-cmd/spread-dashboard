(function(root){
  'use strict';
  // Calculate on the complete history before choosing the visible chart range.
  function calculate(rows, period=20) {
    if (!Number.isInteger(period) || period < 2 || period > 250)
      throw new RangeError('期間は2～250営業日で指定してください。');
    return rows.map((row, i) => {
      if (i < period - 1) return null;
      const values = rows.slice(i - period + 1, i + 1).map(r => r.spread);
      if (!values.every(Number.isFinite)) return null;
      // Center first to retain precision even when spreads have a large offset.
      const origin = values[0];
      const mean = origin + values.reduce((sum, v) => sum + (v - origin), 0) / period;
      const sigma = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period);
      return {mean, sigma, upper1:mean + sigma, lower1:mean - sigma,
        upper2:mean + 2 * sigma, lower2:mean - 2 * sigma};
    });
  }
  root.SpreadBands = {calculate};
  if (typeof module !== 'undefined') module.exports = root.SpreadBands;
})(typeof window !== 'undefined' ? window : globalThis);
