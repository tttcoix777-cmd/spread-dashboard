const assert=require('node:assert/strict'),fs=require('node:fs');
const S=require('../dist/viewer-series.js'),M=require('../dist/viewer-math.js'),V1=require('./fixtures/viewer-math-v1.cjs');
const {audit}=require('../scripts/audit-viewer.cjs');
const data=JSON.parse(fs.readFileSync('dist/metals-viewer.json','utf8')),calendar=JSON.parse(fs.readFileSync('dist/viewer-calendar.json','utf8'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const frozen=JSON.stringify(data),chain=S.continuous(data,calendar);
assert.equal(chain.rows[0].date,'2023-09-11');assert.equal(chain.rows.at(-1).date,'2026-10-20');assert.equal(chain.rolls.length,3);
assert.deepEqual(chain.rolls.map(e=>[e.anchor,e.date]),[['2024-10-01','2024-10-02'],['2025-10-01','2025-10-02'],['2026-10-01','2026-10-02']]);
for(const event of chain.rolls){
  const anchor=chain.rows.find(r=>r.date===event.anchor),next=chain.rows.find(r=>r.date===event.date);
  for(const k of S.legs){
    const p=event.prices[k];near(p.old*anchor.factors[k],p.next*p.factor); // No contract-basis jump.
    near(next[k]/anchor[k],next.raw[k]/p.next); // Preserve actual new-contract return; never flatten market movement.
    near(next[k],next.raw[k]*p.factor);
  }
  assert.equal(next.sourceContract,event.to);
}
for(const method of ['back-difference','back-ratio']){
  const until='2024-09-30',prefix={...data,rows:data.rows.filter(r=>r.date<=until),sources:data.sources.filter(s=>s.date<=until)};
  assert.notEqual(S.continuous(data,calendar,{method}).rows[0].Gold,S.continuous(prefix,calendar,{method}).rows[0].Gold);
}
// Appending future data must not change a single past adjusted observation or past indicator.
for(const until of ['2024-09-30','2024-10-01','2024-10-02','2025-10-01','2025-10-02','2026-10-01','2026-10-02']){
  const prefix={...data,rows:data.rows.filter(r=>r.date<=until),sources:data.sources.filter(s=>s.date<=until)};
  const partial=S.continuous(prefix,calendar);
  assert.deepEqual(partial.rows,chain.rows.filter(r=>r.date<=until));
  assert.deepEqual(M.calculate(partial.rows),M.calculate(chain.rows).filter(r=>r.date<=until));
}
// Missing one of six anchor closes postpones ALL THREE contracts together, no per-leg/asynchronous roll.
const bad=structuredClone(data);bad.rows.find(r=>r.contract==='2025'&&r.date==='2024-10-01').Silver=null;
const postponed=S.continuous(bad,calendar);assert.equal(postponed.rolls[0].anchor,'2024-10-02');assert.equal(postponed.rolls[0].date,'2024-10-03');
const none=structuredClone(data);none.rows=none.rows.filter(r=>r.contract!=='2025');
const unconnected=S.continuous(none,calendar);assert.equal(unconnected.rolls.length,0);assert.ok(unconnected.issues.some(r=>r.date>'2024-12-19'));
// A missing contract row INSIDE a known report calendar is retained as a genuine gap.
const hole=structuredClone(data);hole.rows=hole.rows.filter(r=>!(r.contract==='2026'&&r.date==='2026-03-10'));
assert.equal(S.contractRows(hole,'2026',calendar).find(r=>r.date==='2026-03-10').quality,'missing');
const original=data.rows.filter(r=>r.contract==='2026'),annotated=S.contractRows(data,'2026',calendar);
const before=V1.calculate(original),after=M.calculate(annotated);
for(const day of ['2025-12-25','2026-04-03']){
  const i=after.findIndex(r=>r.date===day);assert.equal(after[i].value,null);assert.equal(after[i].z,null);assert.equal(after[i].quality,'closed');
  assert.equal(before[i+1].mean,null);assert.notEqual(after[i+1].mean,null);
  const valid=after.slice(0,i+2).filter(r=>r.value!==null).slice(-20).map(r=>r.value),mean=valid.reduce((s,v)=>s+v,0)/20;
  near(after[i+1].mean,mean);near(after[i+1].sd,Math.sqrt(valid.reduce((s,v)=>s+(v-mean)**2,0)/20));
}
const week=M.calculate(annotated,{frame:'week'});assert.ok(week.find(r=>r.date==='2026-04-02')?.value);assert.notEqual(week.find(r=>r.date==='2026-04-10').mean,null);
const genuine=structuredClone(annotated);genuine.find(r=>r.date==='2026-04-02').Silver=null;genuine.find(r=>r.date==='2026-04-02').quality='missing';
const g=M.calculate(genuine);const ix=g.findIndex(r=>r.date==='2026-04-02');assert.equal(g[ix].value,null);assert.equal(g[ix+2].mean,null);
assert.equal(M.calculate(genuine,{frame:'week'}).find(r=>r.period==='2026-03-30').value,null);
for(const pair of [['Gold','Silver'],['Gold','Platinum'],['Silver','Platinum']])for(const frame of ['day','week','month'])for(const mode of ['ratio','spread']){
  const result=M.calculate(chain.rows,{a:pair[0],b:pair[1],frame,mode,beta:.7});assert.notEqual(result.at(-1).z,null);
  const valid=result.filter(r=>r.value!==null).slice(-20),mean=valid.reduce((s,v)=>s+v.value,0)/20;near(result.at(-1).mean,mean);
  const sd=Math.sqrt(valid.reduce((s,v)=>s+(v.value-mean)**2,0)/20);near(result.at(-1).sd,sd);near(result.at(-1).upper2,mean+2*sd);near(result.at(-1).z,(result.at(-1).value-mean)/sd);
  for(const months of [3,6,12,24,60,0])assert.ok(M.range(result,months).length);
  const contract=M.calculate(annotated,{a:pair[0],b:pair[1],frame,mode,beta:.7});
  if(frame==='month')assert.equal(contract.at(-1).mean,null);else assert.notEqual(contract.at(-1).z,null);
  for(const months of [3,6,12,24,60,0])assert.ok(M.range(contract,months).length);
}
// Explicitly recorded closure is required. Null alone never means 'holiday'.
assert.equal(S.annotate({date:'2026-04-03',contract:'2026',Gold:null,Silver:1,Platinum:1},calendar).quality,'missing');
const fake=S.annotate({date:'2026-03-10',contract:'2026',Gold:-1,Silver:1,Platinum:1},calendar);assert.equal(fake.Gold,null);assert.equal(fake.raw.Gold,-1);
const report=audit(data,calendar);
assert.equal(report.quality.filter(r=>['2024','2025','2026','2027'].includes(r.contract)).length,10);
assert.equal(report.quality.filter(r=>['2024','2025','2026','2027'].includes(r.contract)&&r.quality==='missing').length,0);
for(const e of report.rolls){const o=report.overlaps.find(o=>o.from===e.from);assert.ok(o.start<=e.anchor&&o.end>=e.date);}
assert.equal(JSON.stringify(data),frozen);
assert.equal(S.warnings(annotated).length,3);
assert.equal(JSON.stringify(audit(data,calendar)),JSON.stringify(report));
console.log('Viewer V2 PASS: original preservation, causal roll anchors/next-day activation, simultaneous contracts, gap recovery, genuine gaps, all pairs/frames/ranges, monthly MA/BB/Z, exhaustive audit');
