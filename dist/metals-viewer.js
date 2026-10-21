/* Display-only viewer: no dependencies on SpreadEngine or strategy state. */
(()=>{
  'use strict';
  const host=document.getElementById('metals-viewer'),M=MetalsViewerMath,S=MetalsViewerSeries;
  const names={Gold:'金ETF',Silver:'銀ETF',Platinum:'プラチナETF'};
  const pairs={gs:['Gold','Silver'],gp:['Gold','Platinum'],sp:['Silver','Platinum']};
  let data=null,status=null,calendar=null,loading=null,loadError='',charts=[],rolls=[];
  const state={view:'contract',pair:'gs',contract:'2026',frame:'day',months:12,mode:'ratio',ma:true,bb1:true,bb2:true,z:true,beta:{gs:'',gp:'',sp:''}};
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
      const responses=await Promise.all(['metals-viewer.json','metals-viewer-status.json','viewer-calendar.json'].map(p=>fetch(p,{cache:'no-store'})));
      if(responses.some(r=>!r.ok))throw new Error('Viewerデータの読み込みに失敗しました');
      const [next,nextStatus,nextCalendar]=await Promise.all(responses.map(r=>r.json()));
      if(!Array.isArray(next.rows)||!next.rows.length)throw new Error('価格データがありません');
      if(!Array.isArray(next.sources)||!nextCalendar.contracts||!nextCalendar.holidays)throw new Error('日付原本・取引日情報の形式を確認してください');
      if(next.unit!=='JPY price points'||S.legs.some(k=>next.multiplier?.[k]!==100))throw new Error('価格単位・取引乗数が未確認です');
      data=next;status=nextStatus;calendar=nextCalendar;loadError='';
    }catch(error){loadError=error.message;}
    finally{loading=false;if(!host.hidden)render();}
  }
  function options(values,selected){return values.map(([v,label])=>`<option value="${v}" ${String(v)===String(selected)?'selected':''}>${label}</option>`).join('');}
  function render(){
    const [a,b]=pairs[state.pair];
    const contracts=data?[...new Set(data.rows.map(r=>r.contract))].sort().reverse():['2026'];
    let rows=[],seriesError='';rolls=[];
    const continuous=state.view==='continuous',seriesName=continuous?'連続・前方比率調整（2024→2027年限）':state.contract+'年限';
    try{if(data&&calendar){if(continuous){const chain=S.continuous(data,calendar);rows=chain.rows;rolls=chain.rolls;}else rows=S.contractRows(data,state.contract,calendar);}}catch(e){seriesError=e.message;}
    let calculated=[],error='';
    try{calculated=M.calculate(rows,{a,b,frame:state.frame,mode:state.mode,beta:state.beta[state.pair]===''?null:Number(state.beta[state.pair])});}catch(e){error=e.message;try{calculated=M.calculate(rows,{a,b,frame:state.frame}).map(r=>({...r,value:null,mean:null,sd:null,z:null,upper1:null,lower1:null,upper2:null,lower2:null,indicatorReason:error}));}catch{calculated=[];}}
    const visible=M.range(calculated,state.months),last=calculated.at(-1),missing=rows.filter(r=>!(r[a]>0&&r[b]>0)).length;
    host.innerHTML=`<div class="sectionhead"><div><div class="titleline"><span class="section-index">03</span><h2>金属サヤチャート</h2></div><p class="formula">くりっく株365 / TFX公式確定終値 / 閲覧・比較</p></div><button type="button" data-refresh>データを再読込</button></div>
    <div class="viewer-status ${loadError||status?.error?'viewer-error':''}" role="status">${escape(loadError||status?.error||(data?'公式データ読込済み':'データを読み込んでいます…'))}<br>最終成功更新：${escape(status?.last_success_at||'未取得')}　データ最終日：${escape(status?.data_date||'—')}　最終取得試行：${escape(status?.last_attempt_at||'—')}${status?.data_date&&(Date.now()-Date.parse(status.data_date+'T00:00:00+09:00'))/86400000>4?'　⚠ データ最終日から4日超：保存済みの過去値':''}</div>
    <div class="viewer-layout"><aside class="viewer-controls card">
    <label>表示方式<select data-control="view">${options([['contract','A：年限別表示'],['continuous','B：長期連続チャート']],state.view)}</select></label>
    <label>銘柄ペア<select data-control="pair">${options([['gs','金 − 銀'],['gp','金 − プラチナ'],['sp','銀 − プラチナ']],state.pair)}</select></label>
    <label>リセット年限<select data-control="contract" ${continuous?'disabled':''}>${options(contracts.map(c=>[c,c+'年']),state.contract)}</select></label>
    <label>時間足<select data-control="frame">${options([['day','日足'],['week','週足'],['month','月足']],state.frame)}</select></label>
    <label>表示期間<select data-control="months">${options([[3,'3か月'],[6,'6か月'],[12,'1年'],[24,'2年'],[60,'5年'],[0,'全期間']],state.months)}</select></label>
    <label>表示指標<select data-control="mode">${options([['ratio','サヤ比 A ÷ B'],['spread','サヤ差 A − βB']],state.mode)}</select></label>
    <label>β（ペア別に設定）<input data-control="beta" type="number" min="0" step="any" placeholder="サヤ差では設定必須" value="${escape(state.beta[state.pair])}"></label>
    <p class="viewer-help">3銘柄とも価格×100円/枚。β = B枚数×100 ÷ (A枚数×100)。枚数比は任意に設定してください。サヤ差はA 1枚あたりの価格ポイントで、V3の「3×銀−Pt」とは別表示です。</p>
    <div class="viewer-toggles">${[['ma','20期間移動平均'],['bb1','±1σ'],['bb2','±2σ'],['z','Zスコアチャート']].map(([key,label])=>`<label><input type="checkbox" data-control="${key}" ${state[key]?'checked':''}>${label}</label>`).join('')}</div>
    <p class="viewer-help">母標準偏差（ddof=0）、N=20。選択した系列を足ごとに再集約・再計算します。確認済み休業日は観測数に含めず、真の欠損後は20有効足を必要とします。週・月足は最後の共通有効終値。末尾は進行中の足を含みます。年限別の月足20期間指標は期間不足です。</p></aside>
    <div class="viewer-plots"><div class="metrics"><div class="metric"><div class="label">現在${state.mode==='ratio'?'サヤ比':'サヤ差'}</div><div class="value">${fmt(last?.value)}</div><div class="sub">${escape(last?.date||'データなし')}</div></div><div class="metric"><div class="label">Zスコア（20期間）</div><div class="value">${fmt(last?.z,2)}</div><div class="sub">${last?.sd===0?'標準偏差0：算出不可':'(現在値 − MA) ÷ SD'}</div></div><div class="metric"><div class="label">収録・同期状況</div><div class="value viewer-small">${rows.length}日 / 欠損 ${missing}日</div><div class="sub">${escape(rows[0]?.date||'—')} 〜 ${escape(rows.at(-1)?.date||'—')}</div></div></div>
    ${error||seriesError?`<p class="viewer-status viewer-error">${escape(error||seriesError)}</p>`:''}
    ${continuous?'<div class="viewer-status viewer-analysis"><strong>分析用の調整系列：実際の約定価格・保有損益とは異なります。</strong><br>2024年限を基準に、毎年10月1日以降で旧・新年限の3金属すべての終値がそろう最初の日に係数を確定。次の帳票日から3銘柄同時に切替。新係数＝旧係数×旧終値÷新終値。過去値の事後変更なし。サヤ比・β差も調整価格から計算するため、生の価格比・損益ではありません。</div>':''}
    <div class="card"><h3>${names[a]} − ${names[b]}　${state.mode==='ratio'?'サヤ比':'サヤ差'} <small>${seriesName}</small></h3><div class="legend"><span>青：サヤ</span>${state.ma?'<span>緑：20MA</span>':''}${state.bb1?'<span>橙：±1σ</span>':''}${state.bb2?'<span>薄青：±2σ</span>':''}<span>橙背景：終値なし</span>${continuous?'<span>紫破線：ロール適用日</span>':''}</div><canvas data-plot="main" aria-label="サヤ推移" role="img" tabindex="0"></canvas><output data-readout>チャートにマウスを合わせるか、左右キーで日付を選択</output></div>
    ${state.z?'<div class="card"><h3>Zスコア</h3><canvas data-plot="z" aria-label="Zスコア推移" role="img" tabindex="0"></canvas></div>':''}
    <div class="card"><h3>金・銀・プラチナの個別価格 <small>独立軸 / ${continuous?'2024年限基準の調整価格':'公式終値（円価格ポイント）'}</small></h3>${S.legs.map((leg,i)=>`<p style="color:${['#236fbd','#c28729','#7c6ab5'][i]}">${names[leg]}</p><canvas data-plot="${leg}" aria-label="${names[leg]}価格推移" role="img" tabindex="0"></canvas>`).join('')}</div>
    ${continuous?rollTable():''}
    ${qualityTable(rows,visible)}
    <p class="viewer-help">期間は最終収録日が基準。2023年9月11日以前の銀・Pt価格は生成しません。休業日の価格・サヤ・Zは欠損として線を切断し、その後の正常価格から計算を再開します。確認済み休業日が週末・月末の場合は同じ週・月の最終共通取引日を採用。未知の欠損を含む足は無効です。</p>
    <details><summary>出典・計算仕様・表示データ</summary><p><a href="https://www.tfx.co.jp/historical/cfd/" target="_blank" rel="noreferrer">TFX公式ヒストリカルデータ</a> 日次帳票の終値（列12）。原資産ETFの東証終値・現物地金・米ドル建価格とは異なります。翌営業日午前に公表、毎日10:30 JST頃に自動取得。<a href="https://www.clickkabu365.jp/start/publication/pdf/clickkabu365_pamph_notonbo.pdf" target="_blank" rel="noreferrer">取引単位の出典</a>。N=20、母標準偏差、MA±SD/2SD、Z=(現在値−MA)/SD。SD=0は算出不可。未来参照なし。</p><div class="tablewrap"><table><thead><tr><th>日付</th><th>年限</th><th>${names[a]}</th><th>${names[b]}</th><th>サヤ</th><th>MA</th><th>SD</th><th>Z</th></tr></thead><tbody>${visible.slice(-20).reverse().map(r=>`<tr><td>${r.date}</td><td>${escape(r.sourceContract)}</td>${[r.a,r.b,r.value,r.mean,r.sd,r.z].map(v=>`<td>${fmt(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></div></div>`;
    charts=[];
    plot('main',visible,[['value','#236fbd',2.2],...(state.ma?[['mean','#26975d',1.4]]:[]),...(state.bb1?[['upper1','#d88738',1],['lower1','#d88738',1]]:[]),...(state.bb2?[['upper2','#73aaff',1],['lower2','#73aaff',1]]:[])],360);
    if(state.z)plot('z',visible,[['z','#8975df',1.5]],120);
    S.legs.forEach((leg,i)=>plot(leg,visible,[[leg,['#236fbd','#c28729','#7c6ab5'][i],1.5]],145));
  }
  function rollTable(){
    return `<details class="card" open><summary>ロール日・原本価格差・累積調整係数（3銘柄同時）</summary><div class="tablewrap"><table><thead><tr><th>切替</th><th>係数確定日</th><th>適用日</th><th>銘柄</th><th>旧終値</th><th>新終値</th><th>新−旧</th><th>累積係数</th></tr></thead><tbody>${rolls.flatMap(e=>S.legs.map(k=>`<tr><td>${e.from}→${e.to}</td><td>${e.anchor}</td><td>${e.date}</td><td>${names[k]}</td><td>${fmt(e.prices[k].old,1)}</td><td>${fmt(e.prices[k].next,1)}</td><td>${fmt(e.prices[k].difference,1)}</td><td>${fmt(e.prices[k].factor,8)}</td></tr>`)).join('')}</tbody></table></div><p class="viewer-help">価格差は同じ係数確定日の旧・新年限の比較です。市場の日々の変動は残します。紫線は上記適用日（週・月足では該当足）。公式の自動乗換日ではなく、Viewerの分析ルールです。</p></details>`;
  }
  function qualityTable(rows,visible){
    const problems=rows.filter(r=>r.quality!=='ok'),gaps=[...S.gaps(visible,'value').map(r=>({...r,line:'サヤ'})),...S.gaps(visible,'mean').map(r=>({...r,line:'MA・BB'})),...S.gaps(visible,'z').map(r=>({...r,line:'Z'}))];
    const warnings=S.warnings(rows).map(r=>({...r,reason:`${names[r.leg]} ${fmt(r.previous,1)}→${fmt(r.close,1)} (${fmt(100*r.change,2)}%)：${r.reason}`}));
    return `<details class="card viewer-quality" open><summary>データ品質・線切れ区間（現在の選択）</summary><p class="viewer-help">休業／年限終了／未確認欠損：${problems.length}帳票日。異常変動警告：${warnings.length}件。休業日でも価格を作りません。下表は全収録期間、指標不足の表は表示範囲です。<a href="viewer-v1-gaps.csv" download>V1全線切れ一覧CSV</a> / <a href="viewer-v2-gaps.csv" download>V2全線切れ一覧CSV（差はβ=1）</a> / <a href="metals-viewer-audit.json" download>年限・重複期間・調整比較JSON</a></p><div class="tablewrap viewer-audit-scroll"><table><thead><tr><th>日付</th><th>年限</th><th>原因</th><th>確認元</th></tr></thead><tbody>${problems.map(r=>`<tr><td>${r.date}</td><td>${escape(r.sourceContract||r.contract)}</td><td>${escape(r.reason)}</td><td>${r.evidence?`<a href="${escape(r.evidence)}" target="_blank" rel="noreferrer">公式通知</a>`:'未確認'}</td></tr>`).join('')}${warnings.map(r=>`<tr><td>${r.date}</td><td>—</td><td>${r.reason}</td><td>原本</td></tr>`).join('')||''}</tbody></table></div><div class="tablewrap viewer-audit-scroll"><table><thead><tr><th>線</th><th>開始</th><th>終了</th><th>足数</th><th>原因</th></tr></thead><tbody>${gaps.map(g=>`<tr><td>${g.line}</td><td>${g.start}</td><td>${g.end}</td><td>${g.count}</td><td>${escape(g.reason)}</td></tr>`).join('')||'<tr><td colspan="5">表示範囲に線切れなし</td></tr>'}</tbody></table></div></details>`;
  }
  function plot(id,rows,series,height){
    const canvas=$(`[data-plot="${id}"]`),ctx=canvas.getContext('2d'),w=Math.max(240,canvas.getBoundingClientRect().width),dpr=devicePixelRatio||1;
    canvas.width=w*dpr;canvas.height=height*dpr;canvas.style.height=height+'px';ctx.scale(dpr,dpr);
    const left=76,right=w-14,top=12,bottom=height-27;
    const values=rows.flatMap(r=>series.map(([k])=>r[k])).filter(Number.isFinite);
    if(!values.length){ctx.fillStyle='#687582';ctx.font='14px system-ui';ctx.fillText('表示可能なデータがありません',left,50);return;}
    let min=Math.min(...values),max=Math.max(...values),pad=(max-min)*.12||1;min-=pad;max+=pad;
    const x=i=>left+(right-left)*i/Math.max(1,rows.length-1),y=v=>bottom-(bottom-top)*(v-min)/(max-min);
    const spacing=(right-left)/Math.max(1,rows.length-1);
    ctx.fillStyle='#fff0dd';rows.forEach((r,i)=>{if(r.quality!=='ok')ctx.fillRect(Math.max(left,x(i)-spacing/2),top,Math.max(2,spacing),bottom-top);});
    ctx.font='11px system-ui';ctx.fillStyle='#687582';ctx.strokeStyle='#e2e8ee';
    for(let i=0;i<5;i++){const v=min+(max-min)*i/4;ctx.beginPath();ctx.moveTo(left,y(v));ctx.lineTo(right,y(v));ctx.stroke();ctx.textAlign='right';ctx.fillText(fmt(v,id==='a'||id==='b'?1:3),left-8,y(v)+4);}
    ctx.textAlign='left';ctx.fillText(rows[0].date,left,height-6);ctx.textAlign='right';ctx.fillText(rows.at(-1).date,right,height-6);
    ctx.strokeStyle='#9879c4';ctx.lineWidth=1;ctx.setLineDash([4,4]);
    for(const [rollIndex,event] of rolls.entries()){const i=rows.findIndex(r=>r.period===M.periodKey(event.date,state.frame));if(i<0)continue;ctx.beginPath();ctx.moveTo(x(i),top);ctx.lineTo(x(i),bottom);ctx.stroke();if(id==='main'){ctx.fillStyle='#7c5ca3';ctx.textAlign=x(i)>right-90?'right':'left';ctx.fillText(event.date,x(i)>right-90?x(i)-3:x(i)+3,top+12+(right-left<400?rollIndex%2*14:0));}}
    ctx.setLineDash([]);
    for(const [key,color,width] of series){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;let started=false;rows.forEach((r,i)=>{const v=r[key];if(!Number.isFinite(v)){started=false;return;}if(started)ctx.lineTo(x(i),y(v));else ctx.moveTo(x(i),y(v));started=true;});ctx.stroke();
      rows.forEach((r,i)=>{if(Number.isFinite(r[key])&&!Number.isFinite(rows[i-1]?.[key])&&!Number.isFinite(rows[i+1]?.[key])){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(i),y(r[key]),2.5,0,Math.PI*2);ctx.fill();}});}
    const saved=ctx.getImageData(0,0,canvas.width,canvas.height);
    const mark=i=>{ctx.putImageData(saved,0,0);ctx.beginPath();ctx.strokeStyle='#8496a8';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.moveTo(x(i),top);ctx.lineTo(x(i),bottom);ctx.stroke();ctx.setLineDash([]);};
    charts.push({mark});let selected=rows.length-1;
    function select(i){selected=i;charts.forEach(c=>c.mark(i));const r=rows[i],[a,b]=pairs[state.pair];$('[data-readout]').textContent=`${r.date}　${r.sourceContract}年限　${names[a]} ${fmt(r.a,1)} / ${names[b]} ${fmt(r.b,1)}　サヤ ${fmt(r.value)}　MA ${fmt(r.mean)}　SD ${fmt(r.sd)}　Z ${fmt(r.z,2)}${state.view==='continuous'?`　原本 金 ${fmt(r.raw?.Gold,1)} / 銀 ${fmt(r.raw?.Silver,1)} / Pt ${fmt(r.raw?.Platinum,1)}`:''}　${r.reason||r.indicatorReason||''}`;}
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
