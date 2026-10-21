(function(root){
  'use strict';
  const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
  function periodKey(day,frame){
    if(frame==='month')return day.slice(0,7);
    if(frame==='week'){
      const d=new Date(day+'T00:00:00Z');
      d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
      return d.toISOString().slice(0,10);
    }
    return day;
  }
  function calculate(rows,{a='Gold',b='Silver',frame='day',mode='ratio',beta=null,n=20}={}){
    if(!Number.isInteger(n)||n<2)throw new RangeError('N must be an integer >= 2');
    if(!['day','week','month'].includes(frame))throw new RangeError('Unknown timeframe');
    if(!['ratio','spread'].includes(mode))throw new RangeError('Unknown calculation');
    if(mode==='spread'&&!(typeof beta==='number'&&Number.isFinite(beta)&&beta>=0))throw new RangeError('βを設定してください');
    const groups=new Map();let previous='';let contract;
    for(const row of rows){
      if(row.date<=previous||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||Number.isNaN(Date.parse(row.date)))throw new Error('Date order/duplicate');
      if(contract!==undefined&&contract!==row.contract)throw new Error('Mixed reset contracts');
      contract=row.contract;previous=row.date;
      const key=periodKey(row.date,frame);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(row);
    }
    const result=[];let window=[];
    let lastReset='';
    for(const bucket of groups.values()){
      // A verified non-trading day consumes no observation. Unknown trading gaps invalidate the bucket.
      const missing=bucket.find(r=>!(valid(r[a])&&valid(r[b]))&&!['closed','expired'].includes(r.quality));
      const candidates=bucket.filter(r=>valid(r[a])&&valid(r[b]));
      const row=missing?{...bucket.at(-1),quality:'missing',reason:missing.reason||'終値欠損'}:candidates.at(-1)||bucket.at(-1);
      const ok=!missing&&valid(row[a])&&valid(row[b]);
      const value=ok?(mode==='ratio'?row[a]/row[b]:row[a]-beta*row[b]):null;
      if(value===null){if(!['closed','expired'].includes(row.quality)){window=[];lastReset=row.date;}}else window.push(value);
      if(window.length>n)window.shift();
      let mean=null,sd=null,z=null;
      if(value!==null&&window.length===n){mean=window.reduce((s,v)=>s+v,0)/n;sd=Math.sqrt(window.reduce((s,v)=>s+(v-mean)**2,0)/n);if(sd>0)z=(value-mean)/sd;}
      const indicatorReason=value===null?(row.reason||'終値欠損'):mean===null?'20有効足未満'+(lastReset?'（欠損 '+lastReset+' 後）':'（系列開始）'):sd===0?'標準偏差0':'';
      result.push({date:row.date,period:periodKey(row.date,frame),a:row[a],b:row[b],value,mean,sd,z,
        Gold:row.Gold,Silver:row.Silver,Platinum:row.Platinum,sourceContract:row.sourceContract||row.contract,
        raw:row.raw,factors:row.factors,quality:row.quality||'ok',reason:ok?'':row.reason||'終値欠損',indicatorReason,
        upper1:mean===null?null:mean+sd,lower1:mean===null?null:mean-sd,
        upper2:mean===null?null:mean+2*sd,lower2:mean===null?null:mean-2*sd});
    }
    return result;
  }
  function range(rows,months){
    if(!months||!rows.length)return rows;
    const d=new Date(rows.at(-1).date+'T00:00:00Z'),day=d.getUTCDate();
    d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-months);
    const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));
    return rows.filter(r=>r.date>=d.toISOString().slice(0,10));
  }
  const api={calculate,range,periodKey};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MetalsViewerMath=api;
})(globalThis);
