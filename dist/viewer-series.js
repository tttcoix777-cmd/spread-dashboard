/* Analysis-only derived series. Source rows are never mutated. */
(function(root){
  'use strict';
  const legs=['Gold','Silver','Platinum'];
  const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
  const complete=r=>r&&legs.every(k=>valid(r[k]));
  function annotate(row,calendar){
    const out={...row,raw:{...row},quality:'ok',reason:''};
    const missing=legs.filter(k=>!valid(row[k]));
    for(const k of missing)out[k]=null;
    if(!missing.length)return out;
    const life=calendar.contracts[row.contract],holiday=calendar.holidays[row.date];
    if(missing.length===3&&holiday){out.quality='closed';out.reason=holiday.reason;out.evidence=holiday.source;}
    else if(missing.length===3&&life&&row.date>life.last_trade){out.quality='expired';out.reason='取引最終日後（'+life.last_trade+'）';out.evidence=life.source;}
    else {out.quality='missing';out.reason=Number(row.contract)<2024?'銀・Pt上場前の年限／公式終値なし':'公式終値欠損・行欠落／休業未確認: '+missing.join(', ');}
    return out;
  }
  function contractRows(data,contract,calendar){
    const originals=data.rows.filter(r=>r.contract===contract);
    if(!originals.length)return [];
    const map=new Map();
    for(const r of originals){if(map.has(r.date))throw new Error('年限内の日付重複');map.set(r.date,r);}
    const days=[...new Set([...originals.map(r=>r.date),...data.sources.map(s=>s.date).filter(d=>d>=originals[0].date&&d<=originals.at(-1).date)])].sort();
    return days.map(date=>annotate(map.get(date)||{date,contract,Gold:null,Silver:null,Platinum:null},calendar));
  }
  function continuous(data,calendar,{method='forward-ratio'}={}){
    if(!['forward-ratio','raw','back-difference','back-ratio'].includes(method))throw new Error('Unknown roll method');
    const years=['2024','2025','2026','2027'];
    const maps=Object.fromEntries(years.map(c=>[c,new Map(contractRows(data,c,calendar).map(r=>[r.date,r]))]));
    const days=[...new Set(data.sources.map(s=>s.date))].sort();
    const rows=[],rolls=[],issues=[];
    let active='2024',factor=Object.fromEntries(legs.map(k=>[k,1])),pending=null;
    for(const date of days){
      if(date<calendar.contracts['2024'].start)continue;
      if(pending){
        active=pending.to;factor=pending.factor;
        const event={...pending,date};delete event.factor;
        rolls.push(event);pending=null;
      }
      const life=calendar.contracts[active];
      const raw=maps[active].get(date)||annotate({date,contract:active,Gold:null,Silver:null,Platinum:null},calendar);
      const row={...raw,sourceContract:active,contract:'continuous',factors:{...factor}};
      for(const k of legs)row[k]=valid(raw[k])?(method==='forward-ratio'?raw[k]*factor[k]:raw[k]):null;
      if(date>life.last_trade){row.quality='missing';row.reason='接続不能：次年限の共通価格なし／対象2027年限の終了後';for(const k of legs)row[k]=null;}
      rows.push(row);
      const next=String(Number(active)+1),newRow=maps[next]?.get(date);
      // Decision uses only both contracts' closes on THIS date; switch on the following report.
      if(next<='2027'&&date>=active+'-10-01'&&complete(raw)&&complete(newRow)){
        const prices=Object.fromEntries(legs.map(k=>[k,{old:raw[k],next:newRow[k],difference:newRow[k]-raw[k],ratio:newRow[k]/raw[k],factor:factor[k]*raw[k]/newRow[k]}]));
        pending={anchor:date,from:active,to:next,prices,factor:Object.fromEntries(legs.map(k=>[k,prices[k].factor]))};
      }
      if(row.quality==='missing')issues.push({date,reason:row.reason});
    }
    if(method==='back-difference')for(const row of rows)for(const event of rolls){
      if(row.date<=event.anchor)for(const k of legs)if(Number.isFinite(row[k]))row[k]+=event.prices[k].difference;
    }
    if(method==='back-ratio')for(const row of rows)for(const event of rolls){
      if(row.date<=event.anchor)for(const k of legs)if(Number.isFinite(row[k]))row[k]*=event.prices[k].ratio;
    }
    return {rows,rolls,issues,pending:pending?{anchor:pending.anchor,from:pending.from,to:pending.to}:null,method};
  }
  function gaps(rows,key){
    const out=[];let current=null;
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      if(!Number.isFinite(r[key])){
        const reason=(key==='mean'||key==='z'?r.indicatorReason:null)||r.reason||((key==='mean'||key==='z')?(r.sd===0?'標準偏差0':'20有効足未満（初期／真の欠損後）'):'終値なし');
        if(current&&current.reason===reason){current.end=r.date;current.count++;current.next=rows[i+1]?.date||'';}
        else {current={start:r.date,end:r.date,count:1,reason,previous:rows[i-1]?.date||'',next:rows[i+1]?.date||''};out.push(current);}
      }else current=null;
    }
    return out;
  }
  function warnings(rows){
    const out=[];let prior={},contract;
    for(const row of rows){
      const c=row.sourceContract||row.contract,raw=row.raw||row;
      if(c!==contract){prior={};contract=c;}
      for(const leg of legs)if(valid(raw[leg])){
        if(prior[leg]&&Math.abs(raw[leg]/prior[leg]-1)>.2)out.push({date:row.date,contract:c,leg,previous:prior[leg],close:raw[leg],change:raw[leg]/prior[leg]-1,reason:'原本価格変動20%超（欠損・補正対象にしない）'});
        prior[leg]=raw[leg];
      }
    }
    return out;
  }
  const api={legs,valid,complete,annotate,contractRows,continuous,gaps,warnings};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MetalsViewerSeries=api;
})(globalThis);
