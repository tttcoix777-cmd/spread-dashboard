const assert=require('node:assert/strict');
const fs=require('node:fs');
const M=require('../dist/viewer-math.js');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const rows=Array.from({length:90},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),contract:'2026',Gold:i+1,Silver:1,Platinum:2}));
const daily=M.calculate(rows);
near(daily[19].mean,10.5);near(daily[19].sd,Math.sqrt(33.25));near(daily[19].z,9.5/Math.sqrt(33.25));
near(daily[19].upper2,10.5+2*Math.sqrt(33.25));near(daily[19].lower1,10.5-Math.sqrt(33.25));
assert.equal(daily[18].mean,null);
assert.deepEqual(M.calculate(rows.slice(0,40)).at(-1),daily[39]);
const changed=structuredClone(rows);changed[89].Gold=1e9;assert.deepEqual(M.calculate(changed)[39],daily[39]);
near(M.calculate(rows,{mode:'spread',beta:3}).at(-1).value,87);
assert.throws(()=>M.calculate(rows,{mode:'spread'}));
assert.throws(()=>M.calculate(rows,{mode:'spread',beta:Infinity}));
const flat=M.calculate(rows.map(r=>({...r,Gold:5})));
assert.equal(flat.at(-1).sd,0);assert.equal(flat.at(-1).z,null);
const gap=structuredClone(rows);gap[40].Silver=null;
const g=M.calculate(gap);assert.equal(g[40].value,null);assert.equal(g[59].mean,null);assert.notEqual(g[60].mean,null);
const w=M.calculate(rows,{frame:'week'}),m=M.calculate(rows,{frame:'month'});
assert.equal(w[0].date,'2026-01-04');assert.equal(m[0].date,'2026-01-31');assert.equal(m[1].date,'2026-02-28');assert.equal(m.at(-1).mean,null);
const long=Array.from({length:900},(_,i)=>({...rows[0],date:new Date(Date.UTC(2023,0,i+1)).toISOString().slice(0,10),Gold:i+1}));
for(const frame of ['week','month']){
  const r=M.calculate(long,{frame});const last=r.at(-1),values=r.slice(-20).map(p=>p.value),mean=values.reduce((a,b)=>a+b)/20;
  near(last.mean,mean);near(last.sd,Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/20));
}
const weekGap=structuredClone(rows);weekGap[3].Silver=null;assert.equal(M.calculate(weekGap,{frame:'week'})[0].value,null);
assert.throws(()=>M.calculate([rows[0],rows[0]]));assert.throws(()=>M.calculate([rows[0],{...rows[1],contract:'2025'}]));
assert.ok(M.range(long,3).length<100);assert.equal(M.range(long,0).length,900);
const real=JSON.parse(fs.readFileSync('dist/metals-viewer.json','utf8'));
for(const pair of [['Gold','Silver'],['Gold','Platinum'],['Silver','Platinum']])for(const frame of ['day','week','month'])for(const mode of ['ratio','spread']){
  const r=M.calculate(real.rows.filter(r=>r.contract==='2026'),{a:pair[0],b:pair[1],frame,mode,beta:1});
  assert.ok(r.some(x=>x.value!==null));for(const months of [3,6,12,24,60,0])assert.ok(M.range(r,months).length);
}
console.log('Viewer math PASS: pairs, frames, ranges, ratio/spread, population bands/Z, gaps, no future leakage, real TFX data');
