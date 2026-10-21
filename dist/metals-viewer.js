/* Display-only viewer: no dependencies on SpreadEngine or strategy state. */
(()=>{
  'use strict';
  const host=document.getElementById('metals-viewer'),M=MetalsViewerMath;
  const names={Gold:'金ETF',Silver:'銀ETF',Platinum:'プラチナETF'};
  const pairs={gs:['Gold','Silver'],gp:['Gold','Platinum'],sp:['Silver','Platinum']};
  let data=null,status=null,loading=null,loadError='',charts=[];
  const state={pair:'gs',contract:'2026',frame:'day',months:12,mode:'ratio',ma:true,bb1:true,bb2:true,z:true,beta:{gs:'',gp:'',sp:''}};
  const fmt=(v,n=4)=>Number.isFinite(v)?v.toLocaleString('ja-JP',{maximumFractionDigits:n}):'—';
  const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $=s=>host.querySelector(s);
  function activate(){
    const active=location.hash==='#metal-chart';
    host.hidden=!active;document.getElementById('dashboard').hidden=active;
    if(!active)dispatchEvent(new Event('resize'));
    for(const link of document.querySelectorAll('header nav a'))link.setAttribute('aria-current',link.hash===location.hash?'page':'false');
    if(active){render();refresh();}
  }
  async function refresh(force=false){
    if(loading||data&&!force)return;
    loading=true;
    try{
      const responses=await Promise.all(['metals-viewer.json','metals-viewer-status.json'].map(p=>fetch(p,{cache:'no-store'})));
      if(responses.some(r=>!r.ok))throw new Error('Viewerデータの読み込みに失敗しました');
      const [next,nextStatus]=await Promise.all(responses.map(r=>r.json()));
      if(!Array.isArray(next.rows)||!next.rows.length)throw new Error('価格データがありません');
      data=next;status=nextStatus;loadError='';
    }catch(error){loadError=error.message;}
    finally{loading=false;if(!host.hidden)render();}
  }
  function options(values,selected){return values.map(([v,label])=>`<option value="${v}" ${String(v)===String(selected)?'selected':''}>${label}</option>`).join('');}
  function render(){
    const [a,b]=pairs[state.pair];
    const contracts=data?[...new Set(data.rows.map(r=>r.contract))].sort().reverse():['2026'];
    const rows=data?data.rows.filter(r=>r.contract===state.contract):[];
    let calculated=[],error='';
    try{calculated=M.calculate(rows,{a,b,frame:state.frame,mode:state.mode,beta:state.beta[state.pair]===''?null:Number(state.beta[state.pair])});}catch(e){error=e.message;}
    const visible=M.range(calculated,state.months),last=calculated.at(-1),missing=rows.filter(r=>!(r[a]>0&&r[b]>0)).length;
    host.innerHTML=`<div class="sectionhead"><div><div class="titleline"><span class="section-index">03</span><h2>金属サヤチャート</h2></div><p class="formula">くりっく株365 / TFX公式確定終値 / 閲覧・比較</p></div><button type="button" data-refresh>データを再読込</button></div>
    <div class="viewer-status ${loadError||status?.error?'viewer-error':''}" role="status">${escape(loadError||status?.error||(data?'公式データ読込済み':'データを読み込んでいます…'))}<br>最終成功更新：${escape(status?.last_success_at||'未取得')}　データ最終日：${escape(status?.data_date||'—')}　最終取得試行：${escape(status?.last_attempt_at||'—')}${status?.data_date&&(Date.now()-Date.parse(status.data_date+'T00:00:00+09:00'))/86400000>4?'　⚠ データ最終日から4日超：保存済みの過去値':''}</div>
    <div class="viewer-layout"><aside class="viewer-controls card">
    <label>銘柄ペア<select data-control="pair">${options([['gs','金 − 銀'],['gp','金 − プラチナ'],['sp','銀 − プラチナ']],state.pair)}</select></label>
    <label>リセット年限<select data-control="contract">${options(contracts.map(c=>[c,c+'年']),state.contract)}</select></label>
    <label>時間足<select data-control="frame">${options([['day','日足'],['week','週足'],['month','月足']],state.frame)}</select></label>
    <label>表示期間<select data-control="months">${options([[3,'3か月'],[6,'6か月'],[12,'1年'],[24,'2年'],[60,'5年'],[0,'全期間']],state.months)}</select></label>
    <label>表示指標<select data-control="mode">${options([['ratio','サヤ比 A ÷ B'],['spread','サヤ差 A − βB']],state.mode)}</select></label>
    <label>β（ペア別に設定）<input data-control="beta" type="number" min="0" step="any" placeholder="サヤ差では設定必須" value="${escape(state.beta[state.pair])}"></label>
    <p class="viewer-help">3銘柄とも価格×100円/枚。β = B枚数×100 ÷ (A枚数×100)。枚数比は任意に設定してください。サヤ差はA 1枚あたりの価格ポイントで、V3の「3×銀−Pt」とは別表示です。</p>
    <div class="viewer-toggles">${[['ma','20期間移動平均'],['bb1','±1σ'],['bb2','±2σ'],['z','Zスコアチャート']].map(([key,label])=>`<label><input type="checkbox" data-control="${key}" ${state[key]?'checked':''}>${label}</label>`).join('')}</div>
    <p class="viewer-help">標準偏差は母標準偏差（ddof=0）、N=20。足ごとに再計算。週・月足の末尾は進行中の足を含みます。欠損後は20足がそろうまで指標を表示しません。1年限は20か月未満のため月足の20MA・バンド・Zはデータ不足です。</p></aside>
    <div class="viewer-plots"><div class="metrics"><div class="metric"><div class="label">現在${state.mode==='ratio'?'サヤ比':'サヤ差'}</div><div class="value">${fmt(last?.value)}</div><div class="sub">${escape(last?.date||'データなし')}</div></div><div class="metric"><div class="label">Zスコア（20期間）</div><div class="value">${fmt(last?.z,2)}</div><div class="sub">${last?.sd===0?'標準偏差0：算出不可':'(現在値 − MA) ÷ SD'}</div></div><div class="metric"><div class="label">収録・同期状況</div><div class="value viewer-small">${rows.length}日 / 欠損 ${missing}日</div><div class="sub">${escape(rows[0]?.date||'—')} 〜 ${escape(rows.at(-1)?.date||'—')}</div></div></div>
    ${error?`<p class="viewer-status viewer-error">${escape(error)}</p>`:''}
    <div class="card"><h3>${names[a]} − ${names[b]}　${state.mode==='ratio'?'サヤ比':'サヤ差'} <small>${state.contract}年限</small></h3><div class="legend"><span>青：サヤ</span>${state.ma?'<span>緑：20MA</span>':''}${state.bb1?'<span>橙：±1σ</span>':''}${state.bb2?'<span>薄青：±2σ</span>':''}</div><canvas data-plot="main" aria-label="サヤ推移" role="img" tabindex="0"></canvas><output data-readout>チャートにマウスを合わせるか、左右キーで日付を選択</output></div>
    ${state.z?'<div class="card"><h3>Zスコア</h3><canvas data-plot="z" aria-label="Zスコア推移" role="img" tabindex="0"></canvas></div>':''}
    <div class="card"><h3>構成銘柄の終値 <small>各チャート独立軸 / 円価格ポイント</small></h3><p class="viewer-price-a">${names[a]}</p><canvas data-plot="a" aria-label="${names[a]}価格推移" role="img" tabindex="0"></canvas><p class="viewer-price-b">${names[b]}</p><canvas data-plot="b" aria-label="${names[b]}価格推移" role="img" tabindex="0"></canvas></div>
    <p class="viewer-help">表示期間は最終収録日を基準に切り出します。年限をまたいだ接続・補間は行いません。2022年は銀・Pt上場前のためペアデータなし。長期表示でも選択年限の実在する期間だけを表示します。欠損日は線を切断し、終値のない休場日に清算値を代用しません。</p>
    <details><summary>出典・計算仕様・表示データ</summary><p><a href="https://www.tfx.co.jp/historical/cfd/" target="_blank" rel="noreferrer">TFX公式ヒストリカルデータ</a> 日次帳票の終値（列12）。原資産ETFの東証終値・現物地金・米ドル建価格とは異なります。翌営業日午前に公表、毎日10:30 JST頃に自動取得。<a href="https://www.clickkabu365.jp/start/publication/pdf/clickkabu365_pamph_notonbo.pdf" target="_blank" rel="noreferrer">取引単位の出典</a>。週足は月曜始まり、月足は暦月の最終帳票日の同日終値。欠損を含む足は計算を中断します。</p><div class="tablewrap"><table><thead><tr><th>日付</th><th>${names[a]}</th><th>${names[b]}</th><th>サヤ</th><th>MA</th><th>SD</th><th>Z</th></tr></thead><tbody>${visible.slice(-20).reverse().map(r=>`<tr><td>${r.date}</td>${[r.a,r.b,r.value,r.mean,r.sd,r.z].map(v=>`<td>${fmt(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></div></div>`;
    charts=[];
    plot('main',visible,[['value','#236fbd',2.2],...(state.ma?[['mean','#26975d',1.4]]:[]),...(state.bb1?[['upper1','#d88738',1],['lower1','#d88738',1]]:[]),...(state.bb2?[['upper2','#73aaff',1],['lower2','#73aaff',1]]:[])],360);
    if(state.z)plot('z',visible,[['z','#8975df',1.5]],120);
    plot('a',visible,[['a','#236fbd',1.5]],145);plot('b',visible,[['b','#c28729',1.5]],145);
  }
  function plot(id,rows,series,height){
    const canvas=$(`[data-plot="${id}"]`),ctx=canvas.getContext('2d'),w=Math.max(240,canvas.getBoundingClientRect().width),dpr=devicePixelRatio||1;
    canvas.width=w*dpr;canvas.height=height*dpr;canvas.style.height=height+'px';ctx.scale(dpr,dpr);
    const left=76,right=w-14,top=12,bottom=height-27;
    const values=rows.flatMap(r=>series.map(([k])=>r[k])).filter(Number.isFinite);
    if(!values.length){ctx.fillStyle='#687582';ctx.font='14px system-ui';ctx.fillText('表示可能なデータがありません',left,50);return;}
    let min=Math.min(...values),max=Math.max(...values),pad=(max-min)*.12||1;min-=pad;max+=pad;
    const x=i=>left+(right-left)*i/Math.max(1,rows.length-1),y=v=>bottom-(bottom-top)*(v-min)/(max-min);
    ctx.font='11px system-ui';ctx.fillStyle='#687582';ctx.strokeStyle='#e2e8ee';
    for(let i=0;i<5;i++){const v=min+(max-min)*i/4;ctx.beginPath();ctx.moveTo(left,y(v));ctx.lineTo(right,y(v));ctx.stroke();ctx.textAlign='right';ctx.fillText(fmt(v,id==='a'||id==='b'?1:3),left-8,y(v)+4);}
    ctx.textAlign='left';ctx.fillText(rows[0].date,left,height-6);ctx.textAlign='right';ctx.fillText(rows.at(-1).date,right,height-6);
    for(const [key,color,width] of series){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;let started=false;rows.forEach((r,i)=>{const v=r[key];if(!Number.isFinite(v)){started=false;return;}if(started)ctx.lineTo(x(i),y(v));else ctx.moveTo(x(i),y(v));started=true;});ctx.stroke();
      if(rows.length===1&&Number.isFinite(rows[0][key])){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(0),y(rows[0][key]),3,0,Math.PI*2);ctx.fill();}}
    const saved=ctx.getImageData(0,0,canvas.width,canvas.height);
    const mark=i=>{ctx.putImageData(saved,0,0);ctx.beginPath();ctx.strokeStyle='#8496a8';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.moveTo(x(i),top);ctx.lineTo(x(i),bottom);ctx.stroke();ctx.setLineDash([]);};
    charts.push({mark});let selected=rows.length-1;
    function select(i){selected=i;charts.forEach(c=>c.mark(i));const r=rows[i],[a,b]=pairs[state.pair];$('[data-readout]').textContent=`${r.date}　${names[a]} ${fmt(r.a,1)} / ${names[b]} ${fmt(r.b,1)}　サヤ ${fmt(r.value)}　MA ${fmt(r.mean)}　SD ${fmt(r.sd)}　Z ${fmt(r.z,2)}`;}
    canvas.onpointermove=e=>select(Math.max(0,Math.min(rows.length-1,Math.round((e.clientX-canvas.getBoundingClientRect().left-left)/(right-left)*(rows.length-1)))));
    canvas.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();select(Math.max(0,Math.min(rows.length-1,selected+(e.key==='ArrowLeft'?-1:1))));}};
  }
  host.addEventListener('change',e=>{const key=e.target.dataset.control;if(!key)return;if(key==='beta'){state.beta[state.pair]=e.target.value;}else state[key]=e.target.type==='checkbox'?e.target.checked:key==='months'?Number(e.target.value):e.target.value;render();});
  host.addEventListener('input',e=>{if(e.target.dataset.control==='beta')state.beta[state.pair]=e.target.value;});
  host.addEventListener('click',e=>{if(e.target.closest('[data-refresh]'))refresh(true);});
  let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!host.hidden)render();},150);});
  addEventListener('hashchange',activate);activate();
  setInterval(()=>{if(!host.hidden)refresh(true);},300000);
})();
