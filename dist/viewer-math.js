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
      // Take the final report in each bucket, including missing legs. Never select different leg dates.
      groups.set(periodKey(row.date,frame),row);
    }
    const result=[];let window=[];
    for(const row of groups.values()){
      const ok=valid(row[a])&&valid(row[b]);
      const value=ok?(mode==='ratio'?row[a]/row[b]:row[a]-beta*row[b]):null;
      if(value===null)window=[];else window.push(value);
      if(window.length>n)window.shift();
      let mean=null,sd=null,z=null;
      if(window.length===n){mean=window.reduce((s,v)=>s+v,0)/n;sd=Math.sqrt(window.reduce((s,v)=>s+(v-mean)**2,0)/n);if(sd>0)z=(value-mean)/sd;}
      result.push({date:row.date,a:row[a],b:row[b],value,mean,sd,z,
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
