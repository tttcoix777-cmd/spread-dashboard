/* 銀・Pt 固定V3の既存判定を変更せず、更新状態だけを追加する。 */
'use strict';
const originalMetalSection = section;
const originalMetalSignal = metalSignal;
let metalsBusy = false;
state.metals.autoStatus = null;
state.metals.autoError = '';
state.metals.manualCSV = false;

function metalHealth() {
  const a = state.metals, s = a.autoStatus;
  if (a.manualCSV) return {ok:true,manual:true};
  if (a.autoError) return {ok:false,error:a.autoError};
  if (!s) return {ok:false,error:'銀−プラチナの自動更新をまだ確認できません。'};
  const age = Date.now() - Date.parse(s.last_attempt_at);
  if (!Number.isFinite(age) || age > 36*3600000 || age < -5*60000)
    return {ok:false,error:'更新確認から36時間以上経過しました。GitHub Actionsを確認してください。'};
  if (!['UPDATED','NO_NEW_DATA'].includes(s.update_status) || !s.last_success_at)
    return {ok:false,error:s.error || 'データ更新エラー。過去データは売買シグナルとして使えません。'};
  if (!a.rows.length || s.data_date !== a.rows.at(-1).date)
    return {ok:false,error:'価格CSVと更新ステータスの日付が一致しません。'};
  return {ok:true};
}

metalSignal = function(r,n) {
  const health = metalHealth();
  if (!health.ok) return '<div class="signal"><strong>判定停止（保存済み価格）</strong><p>'+esc(health.error)+'</p></div>';
  return originalMetalSignal(r,n);
};

section = function(kind) {
  let html = originalMetalSection(kind);
  if (kind !== 'metals') return html;
  const a=state.metals, s=a.autoStatus, h=metalHealth(), r=a.data.at(-1);
  const stateText = r.v3===1?'V3 拡大候補':r.v3===-1?'V3 縮小候補':'V3 候補なし';
  const banner = h.manual ?
    '<div class="auto-manual">銀−Ptは手動CSVを表示中です。自動データは下のボタンで復帰できます。</div>' :
    h.ok ? '<div class="auto-ok"><strong>'+stateText+'</strong><span>TFX更新確認済み / 価格日 '+esc(s.data_date)+'</span></div>' :
    '<div class="auto-failed" role="alert"><strong>DATA UPDATE ERROR / 未確認</strong><span>'+esc(h.error)+'</span><p>保存済み最終日：'+esc(r.date)+'。この値から新規取引を判断しないでください。</p></div>';
  const meta='<div class="auto-meta"><span>最終試行：'+esc(s?.last_attempt_at||'未確認')+'</span><span>最終正常更新：'+esc(s?.last_success_at||'未確認')+'</span><span>更新予定：毎日10:30頃（日本時間）</span><button type="button" data-metals-reload>自動データに戻す / 再確認</button></div>';
  html=html.replace('<div class="metrics">',banner+meta+'<div class="metrics">');
  if(!h.ok) html=html.replace('最新サヤ','保存済みサヤ（参考）');
  return html;
};

async function loadMetals(force=false) {
  if (metalsBusy || (state.metals.manualCSV && !force)) return;
  metalsBusy = true;
  try {
    const response = await fetch('./silver-platinum-status.json', {cache:'no-store'});
    if (!response.ok) throw Error('銀−Pt更新状態JSONを取得できません（HTTP '+response.status+'）。');
    const status = await response.json();
    if (!status.data_date || !status.latest) throw Error('銀−Ptの最新日・固定V3判定が確認できません。');
    const csvResponse = await fetch('./silver-platinum.csv', {cache:'no-store'});
    if (!csvResponse.ok) throw Error('銀−Ptの日足CSVを取得できません。');
    const rows = E.parse(await csvResponse.text(), 'metals');
    const last = E.derive(rows, 'metals').at(-1);
    const expected = status.latest;
    if (last.date !== status.data_date || Math.abs(last.spread - expected.spread) > 1e-5 || last.v3 !== expected.v3)
      throw Error('銀−Ptの価格CSVと固定V3判定が一致しません。');
    state.metals.rows = rows;
    state.metals.autoStatus = status;
    state.metals.autoError = '';
    state.metals.name = 'TFX公式自動取得';
    if (force) state.metals.manualCSV = false;
  } catch (error) {
    state.metals.autoError = error.message;
  } finally {
    metalsBusy = false;
    if(state.metals.rows.length && state.indices.rows.length) render();
  }
}

document.addEventListener('change', async (event)=>{
  if (event.target.dataset.import !== 'metals') return;
  const file = event.target.files[0];
  if (!file || file.size > 5*1024*1024) return;
  try {
    const rows = E.parse(await file.text(), 'metals');
    if (rows.length > 20000) return;
    state.metals.manualCSV = true;
    // 元のapp.jsが画面更新したあとに状態バナーを再描画
    if (state.metals.rows.length && state.indices.rows.length) render();
  } catch (_) { /* 元のCSVエラー処理に委譲 */ }
});
document.addEventListener('click',(event)=>{
  if (event.target.closest('[data-metals-reload]')) loadMetals(true);
});
document.addEventListener('visibilitychange',()=>{
  if (!document.hidden) loadMetals();
});
setInterval(()=>loadMetals(),5*60000);
loadMetals();
