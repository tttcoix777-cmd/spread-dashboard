/* Deterministic derived diagnostics only. No network and no writes to source prices. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),site=path.resolve(process.argv[2]||path.join(root,'dist'));
const S=require('../dist/viewer-series.js'),M=require('../dist/viewer-math.js'),V1=require('../tests/fixtures/viewer-math-v1.cjs');
function audit(data,calendar){
  const years=[...new Set(data.rows.map(r=>r.contract))].sort(),pairs={gs:['Gold','Silver'],gp:['Gold','Platinum'],sp:['Silver','Platinum']};
  const breaks=[],quality=[],contracts=[];
  for(const c of years){
    const raw=data.rows.filter(r=>r.contract===c),annotated=S.contractRows(data,c,calendar);
    for(const r of annotated)if(r.quality!=='ok')quality.push({date:r.date,contract:c,quality:r.quality,reason:r.reason,evidence:r.evidence||'',missing:S.legs.filter(k=>!S.valid(r[k]))});
    const common=raw.filter(S.complete);
    contracts.push({contract:c,codes:Object.fromEntries(S.legs.map((k,i)=>[k,['G','V','P'][i]+c.slice(2)+'/JPY'])),report_start:raw[0].date,report_end:raw.at(-1).date,common_start:common[0]?.date||null,common_end:common.at(-1)?.date||null,common_days:common.length});
    for(const [pair,[a,b]] of Object.entries(pairs))for(const frame of ['day','week','month'])for(const mode of ['ratio','spread']){
      for(const [version,rows,calc] of [['V1',raw,V1],['V2',annotated,M]]){
        const values=calc.calculate(rows,{a,b,frame,mode,beta:1});
        for(const [key,label] of [['value','サヤ'],['mean','MA・BB'],['z','Z']]){
          const enriched=values.map(r=>{
            const orig=annotated.find(x=>x.date===r.date);
            if(version==='V2')return r;
            return {...r,reason:r.value===null?(orig?.reason||'公式終値なし'):r.mean===null?'20足未満（初期／欠損後のV1窓リセット）':r.sd===0?'標準偏差0':''};
          });
          for(const g of S.gaps(enriched,key))breaks.push({version,view:'contract',contract:c,pair,frame,mode,beta:mode==='spread'?1:'',line:label,...g});
        }
      }
    }
  }
  const chain=S.continuous(data,calendar),overlaps=[];
  for(const from of ['2024','2025','2026']){
    const to=String(+from+1),old=new Map(data.rows.filter(r=>r.contract===from).map(r=>[r.date,r]));
    const overlap=data.rows.filter(r=>r.contract===to&&S.complete(r)&&S.complete(old.get(r.date)));
    overlaps.push({from,to,start:overlap[0]?.date||null,end:overlap.at(-1)?.date||null,days:overlap.length});
  }
  for(const [pair,[a,b]] of Object.entries(pairs))for(const frame of ['day','week','month'])for(const mode of ['ratio','spread']){
    const values=M.calculate(chain.rows,{a,b,frame,mode,beta:1});
    for(const [key,label] of [['value','サヤ'],['mean','MA・BB'],['z','Z']])for(const g of S.gaps(values,key))breaks.push({version:'V2',view:'continuous',contract:'continuous',pair,frame,mode,beta:mode==='spread'?1:'',line:label,...g});
  }
  const comparison=['raw','back-difference','back-ratio','forward-ratio'].map(method=>{
    const series=S.continuous(data,calendar,{method});
    return {method,rolls:series.rolls.map(e=>{
      const i=series.rows.findIndex(r=>r.date===e.date),prev=series.rows[i-1],next=series.rows[i];
      return {from:e.from,to:e.to,anchor:e.anchor,date:e.date,
        overnight:Object.fromEntries(S.legs.map(k=>[k,next[k]/prev[k]-1])),
        ratio_jump:(next.Gold/next.Silver)/(prev.Gold/prev.Silver)-1};
    })};
  });
  return {schema:2,data_date:data.sources.at(-1).date,source_days:data.sources.length,source_rows:data.rows.length,
    source_rows_sha256:crypto.createHash('sha256').update(JSON.stringify(data.rows)).digest('hex'),
    contracts,quality,overlaps,rolls:chain.rolls,comparison,breaks,
    anomalies:years.flatMap(c=>S.warnings(S.contractRows(data,c,calendar))),
    note:'V1全欠落区間＋V2全欠落区間。β差は監査用β=1。任意βは画面で再計算。MA・BBは同じ欠落区間。'};
}
function csv(rows){
  const keys=['version','view','contract','pair','frame','mode','beta','line','start','end','count','previous','next','reason'];
  const quote=s=>'"'+String(s??'').replaceAll('"','""')+'"';
  return '\uFEFF'+[keys.join(','),...rows.map(r=>keys.map(k=>quote(r[k])).join(','))].join('\n')+'\n';
}
if(require.main===module){
  const report=audit(JSON.parse(fs.readFileSync(path.join(site,'metals-viewer.json'),'utf8')),JSON.parse(fs.readFileSync(path.join(root,'dist/viewer-calendar.json'),'utf8')));
  for(const [name,content] of [['metals-viewer-audit.json',JSON.stringify(report,null,2)+'\n'],['viewer-v1-gaps.csv',csv(report.breaks.filter(r=>r.version==='V1'))],['viewer-v2-gaps.csv',csv(report.breaks.filter(r=>r.version==='V2'))]]){
    const file=path.join(site,name);fs.writeFileSync(file+'.tmp',content);fs.renameSync(file+'.tmp',file);
  }
  console.log(JSON.stringify({data_date:report.data_date,quality_records:report.quality.length,rolls:report.rolls.length,break_intervals:report.breaks.length}));
}
module.exports={audit,csv};
