/**
 * js/advice.js — 品管 / 採購 建議（規則式，掛 App.advice）
 *
 * 依目前篩選後的 KPI、對比期間 delta、故障分佈，自動產生兩種角度的建議文字。
 * （此為規則式模板，非 LLM；真正的 AI 分析列為 v2。）
 * 由 app.js 的 rerender() 呼叫 App.advice.onRerender(state)。
 */
window.App = window.App || {};

App.advice = (() => {
  const $ = (id) => document.getElementById(id);
  const pct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
  let built = false;
  let activeTab = '品管';

  function scopeLabel(state) {
    const s = state.selection, p = [];
    if (s.廠商.length) p.push(`廠商：${s.廠商.join('、')}`);
    if (s.類型.length) p.push(`類型：${s.類型.join('、')}`);
    if (s.ERP品號.length) p.push(`品號：${s.ERP品號.length} 項`);
    return p.length ? p.join('　') : '全部設備';
  }
  function periodLabel(state) {
    const cur = `${state.year}-Q${state.quarter}`;
    return state.cmp.on ? `${cur} vs ${state.cmp.year}-Q${state.cmp.quarter}` : cur;
  }
  function deltaPP(cur, prev, on) {
    if (!on) return '';
    const pp = (cur - prev) * 100;
    return `（較對比期間 ${pp >= 0 ? '+' : ''}${pp.toFixed(1)}pp）`;
  }

  function topFault(state) {
    const dist = App.metrics.faultDistribution(state.rows, state.selection);
    const total = dist.reduce((s, d) => s + d.數量, 0);
    if (!total || !dist.length) return null;
    const t = dist[0];
    return { 類型: t.維護類型, 佔比: t.數量 / total };
  }

  function genQuality(state) {
    const k = state.kpi, c = state.cmpKpi, on = state.cmp.on && !!c;
    const L = [`【品管建議】　${scopeLabel(state)}　｜　${periodLabel(state)}`, '─'.repeat(28)];
    // 整體不良率
    const dr = k.整體不良率;
    L.push(`${dr < 0.01 ? '✅' : dr < 0.03 ? '⚠️' : '🔴'} 整體不良率 ${pct(dr)}${on ? deltaPP(dr, c.整體不良率, true) : ''}，` +
      `${dr < 0.01 ? '品質表現穩定。' : dr < 0.03 ? '略高，建議留意並追蹤。' : '偏高，建議優先排查高不良品號並要求改善。'}`);
    // 再使用率
    const u = k.再使用率;
    L.push(`${u >= 0.7 ? '✅' : u >= 0.5 ? '🔍' : '⚠️'} 期間再使用率 ${pct(u)}${on ? deltaPP(u, c.再使用率, true) : ''}，` +
      `${u >= 0.7 ? '維修/整新品質良好，可維持現行維修 SOP。' : u >= 0.5 ? '尚可，建議檢視退修與報廢原因以提升沿用率。' : '偏低，建議檢討維修流程與零件庫存。'}`);
    // 主要故障
    const f = topFault(state);
    if (f) L.push(`🔍 主要故障原因為「${f.類型}」（佔 ${pct(f.佔比)}），建議建立專項改善計畫並設定月度追蹤指標。`);
    // 整體過保率
    const sr = k.整體過保率;
    L.push(`${sr < 0.01 ? '✅' : sr < 0.03 ? '⚠️' : '🔴'} 整體過保率 ${pct(sr)}${on ? deltaPP(sr, c.整體過保率, true) : ''}，` +
      `${sr < 0.01 ? '過保狀況在可控範圍內。' : '偏高，建議追蹤高過保品號的使用年限分佈。'}`);
    L.push('', '＊以上為系統依指標自動生成之初稿，請依實際情況修改後使用。');
    return L.join('\n');
  }

  function genProcurement(state) {
    const k = state.kpi, c = state.cmpKpi, on = state.cmp.on && !!c;
    const L = [`【採購建議】　${scopeLabel(state)}　｜　${periodLabel(state)}`, '─'.repeat(28)];
    const dr = k.整體不良率, rising = on && (dr - c.整體不良率) > 0.005;
    if (dr >= 0.03 || rising) {
      L.push(`🔴 整體不良率 ${pct(dr)}${on ? deltaPP(dr, c.整體不良率, true) : ''}，建議向對應供應商提出品質檢討與改善要求，必要時評估索賠或導入第二供應商。`);
    } else {
      L.push(`✅ 整體不良率 ${pct(dr)}${on ? deltaPP(dr, c.整體不良率, true) : ''}，供應商品質穩定，維持現行採購策略。`);
    }
    const u = k.再使用率;
    if (u >= 0.7) L.push(`✅ 再使用率 ${pct(u)}，整新沿用成效佳，可評估延緩新購或降低採購量以節省成本。`);
    else L.push(`🔍 再使用率 ${pct(u)}，沿用成效有限，採購前建議一併評估維修成本與新購成本。`);
    const sr = k.整體過保率;
    if (sr >= 0.02) L.push(`⚠️ 整體過保率 ${pct(sr)}，建議檢視採購保固條款與設備汰換年限設定。`);
    L.push(`ℹ️ 期間回廠量 ${(k.期間回廠量 || 0).toLocaleString()}、總線上量 ${(k.總線上量 || 0).toLocaleString()}，可作為後續採購量與備品規劃參考。`);
    L.push('', '＊以上為系統依指標自動生成之初稿，請依實際情況修改後使用。');
    return L.join('\n');
  }

  function build() {
    $('advice-slot').innerHTML = `
      <section class="card advice">
        <div class="advice__head">
          <span class="advice__title">🧭 品管 &amp; 採購建議</span>
          <span class="advice__note">依上方篩選自動生成初稿，可於框內修改後下載</span>
        </div>
        <div class="advice__tabs">
          <button class="advice-tab advice-tab--on" data-t="品管">品管建議</button>
          <button class="advice-tab" data-t="採購">採購建議</button>
        </div>
        <textarea class="advice__text" id="advice-text" rows="10" spellcheck="false"></textarea>
        <div class="advice__actions">
          <button class="btn-ghost" id="advice-dl">下載 .txt</button>
          <button class="btn-ghost" id="advice-regen">重新生成</button>
        </div>
      </section>`;
    $('advice-slot').querySelectorAll('.advice-tab').forEach((b) =>
      b.addEventListener('click', () => {
        activeTab = b.dataset.t;
        $('advice-slot').querySelectorAll('.advice-tab').forEach((x) => x.classList.toggle('advice-tab--on', x === b));
        fill(App.app.state);
      }));
    $('advice-regen').addEventListener('click', () => fill(App.app.state));
    $('advice-dl').addEventListener('click', () => {
      const blob = new Blob([$('advice-text').value], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${activeTab}建議_${App.app.state.year}-Q${App.app.state.quarter}.txt`;
      a.click(); URL.revokeObjectURL(a.href);
    });
    built = true;
  }

  function fill(state) {
    $('advice-text').value = activeTab === '品管' ? genQuality(state) : genProcurement(state);
  }

  function onRerender(state) {
    if (!built) build();
    fill(state);
  }

  // 供落地頁報告取用
  function getTexts(state) {
    return { 品管: genQuality(state), 採購: genProcurement(state) };
  }

  // ── 核心發現（濃縮重點，仿 CR-804 報告的「核心發現」callout）──────────
  // 傳入任一 {kpi, cmpKpi} 資料（可為特定設備類型範圍，不限於目前分頁），
  // 產出 3–4 條精簡重點字串（不含表頭/註腳），供落地頁報告的重點框使用。
  function genFindings({ kpi: k, cmpKpi: c }) {
    const on = !!c;
    const bullets = [];
    const dr = k.整體不良率;
    bullets.push(`整體不良率 ${pct(dr)}${on ? deltaPP(dr, c.整體不良率, true) : ''}，` +
      `${dr < 0.01 ? '品質表現穩定' : dr < 0.03 ? '略高，建議留意並追蹤' : '偏高，建議優先排查高不良品號並要求改善'}。`);
    const u = k.再使用率;
    bullets.push(`期間再使用率 ${pct(u)}${on ? deltaPP(u, c.再使用率, true) : ''}，` +
      `${u >= 0.7 ? '維修/整新品質良好' : u >= 0.5 ? '尚可，建議檢視退修與報廢原因以提升沿用率' : '偏低，建議檢討維修流程與零件庫存'}。`);
    const sr = k.整體過保率;
    bullets.push(`整體過保率 ${pct(sr)}${on ? deltaPP(sr, c.整體過保率, true) : ''}，` +
      `${sr < 0.01 ? '過保狀況在可控範圍內' : '偏高，建議追蹤高過保品號的使用年限分佈'}。`);
    bullets.push(`期間回廠量 ${(k.期間回廠量 || 0).toLocaleString()}、總線上量 ${(k.總線上量 || 0).toLocaleString()}，` +
      `整體不良率${on && (dr - c.整體不良率) > 0.005 ? '較對比期間上升，需留意是否有批次性異常' : on ? '較對比期間持平或下降' : '為當期狀況'}。`);
    return bullets;
  }

  return { onRerender, getTexts, genFindings };
})();
