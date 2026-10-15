const assert = require('node:assert/strict');
const {calculate} = require('../dist/bands.js');
const rows = values => values.map(spread=>({spread}));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
assert.deepEqual(calculate([],20),[]);
assert.deepEqual(calculate(rows([1,2]),3),[null,null]);
const known=calculate(rows([1,2,3,4,5]),5).at(-1);
near(known.mean,3);near(known.sigma,Math.sqrt(2));near(known.upper2,3+2*Math.sqrt(2));
const flat=calculate(rows(Array(20).fill(-900)),20).at(-1);
assert.deepEqual(flat,{mean:-900,sigma:0,upper1:-900,lower1:-900,upper2:-900,lower2:-900});
const history=rows(Array.from({length:100},(_,i)=>i-50));
const full=calculate(history,20);
near(full[70].mean,10.5);
assert.ok(full.slice(-30)[0]); // Pre-visible history supplies the first band's window.
assert.deepEqual(calculate(history.slice(0,71),20).at(-1),full[70]); // No future leakage.
history[99].spread=1e12;
assert.deepEqual(calculate(history,20)[70],full[70]);
const gap=calculate(rows([1,2,NaN,4,5,6]),3);
assert.equal(gap[4],null);near(gap[5].mean,5);
assert.throws(()=>calculate([],1),RangeError);
assert.throws(()=>calculate([],2.5),RangeError);
console.log('Bollinger calculations: known population deviation, warm-up, constant/negative spreads, full history, gaps and no future data PASS');
