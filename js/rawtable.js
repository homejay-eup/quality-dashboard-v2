/**
 * js/rawtable.js — 設備品質分析_彙整總表（逐筆明細，掛 App.rawtable）
 *
 * 依目前篩選（廠商/類型/ERP品號 + 期間 + 車機/鏡頭分頁）即時顯示逐筆明細，21 欄，
 * 欄位與計算邏輯對齊 新版產出/build_分析總表.py 的 build_detail()（見 report.js RAWCOLS）。
 * 由 app.js 的 rerender() 呼叫 App.rawtable.onRerender(state)。
 */
window.App = window.App || {};

App.rawtable = (() => {
  const $ = (id) => document.getElementById(id);
  const MAX_ROWS = 500;
  const fmtInt = (v) => (Number(v) || 0).toLocaleString('en-US');
  const fmtYear = (v) => (v == null || v === '' ? '' : Number(v).toFixed(1));
  let search = '';
  let built = false;

  // [顯示標題, row 欄位 key]；'_period'／'_上線量' 為即時運算補上的欄位
  const COLS = [
    ['期間', '_period'], ['品項完工日期', '品項完工日期'], ['設備類型', '設備類型'], ['廠牌型號', '廠牌型號'],
    ['廠商', '廠商'], ['ERP品號', 'ERP品號'], ['替換前品項', '替換前品項'], ['替換前品項條碼', '條碼'],
    ['維護原因', '維護原因'], ['維護細節', '維護細節'], ['輸入年月', '輸入年月'], ['輸入時間', '輸入時間'],
    ['完成原因', '完成原因'], ['報廢單狀態', '報廢單狀態'], ['報廢原因', '報廢原因'], ['上線量', '_上線量'],
    ['維護類型', '維護類型'], ['維修分類', '維修分類'], ['進貨日', '進貨日'], ['已使用年限', '已使用年限'],
    ['QC', 'QC'],
  ];

  function build() {
    $('raw-slot').innerHTML = `
      <section class="card detail">
        <div class="detail__head">
          <span class="detail__title" id="raw-title">設備品質分析_彙整總表</span>
          <input type="search" id="raw-search" class="detail__search" placeholder="搜尋明細（品號、品名、廠商、故障…）" />
          <span class="detail__count" id="raw-count"></span>
        </div>
        <div class="detail__scroll" id="raw-wrap"></div>
      </section>`;
    $('raw-search').addEventListener('input', (e) => { search = e.target.value.trim(); render(); });
    built = true;
  }

  function cellVal(k, v) {
    if (k === '已使用年限') return fmtYear(v);
    if (k === '_上線量') return fmtInt(v);
    return v ?? '';
  }

  function render() {
    const st = App.app.state;
    const periodLabel = `${st.year}-Q${st.quarter}`;

    const onlineByERP = new Map();
    for (const o of (st.onlineList || [])) {
      const e = String(o.ERP品號 || '');
      onlineByERP.set(e, (onlineByERP.get(e) || 0) + (Number(o.上線量) || 0));
    }

    let rows = App.metrics.applyFilter(st.rows, st.selection).map((r) => ({
      ...r, _period: periodLabel, _上線量: onlineByERP.get(String(r.ERP品號 || '')) || 0,
    }));
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => COLS.some(([, k]) => String(r[k] ?? '').toLowerCase().includes(q)));
    }
    const total = rows.length;
    const shown = rows.slice(0, MAX_ROWS);
    $('raw-title').textContent = `設備品質分析_彙整總表（${st.deviceTab || ''}）`;
    $('raw-count').textContent = total > MAX_ROWS ? `顯示前 ${MAX_ROWS} / 共 ${total.toLocaleString()} 筆` : `共 ${total.toLocaleString()} 筆`;
    const head = `<tr>${COLS.map(([h]) => `<th>${h}</th>`).join('')}</tr>`;
    const body = shown.map((r) => `<tr>${COLS.map(([, k]) => `<td>${cellVal(k, r[k])}</td>`).join('')}</tr>`).join('');
    $('raw-wrap').innerHTML = `<table class="detail-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  function onRerender() {
    if (!built) build();
    render();
  }

  return { onRerender };
})();
