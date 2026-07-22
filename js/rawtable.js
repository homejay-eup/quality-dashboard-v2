/**
 * js/rawtable.js — 明細（逐筆原始判定，掛 App.rawtable）
 *
 * 呈現篩選後每一筆 cohort 記錄（詳細資料的彙整即由這些逐筆判定加總而來）。
 * 由 app.js 的 rerender() 呼叫 App.rawtable.onRerender(state)。
 */
window.App = window.App || {};

App.rawtable = (() => {
  const $ = (id) => document.getElementById(id);
  const MAX_ROWS = 500;
  let search = '';
  let built = false;

  // [顯示標題, row 欄位 key]
  const COLS = [
    ['條碼', '條碼'], ['品名', '替換前品項'], ['ERP品號', 'ERP品號'],
    ['設備類型', '設備類型'], ['類型', '廠牌型號'], ['廠商', '廠商'],
    ['完工日期', '品項完工日期'], ['維護類型', '維護類型'], ['回廠狀態', '回廠狀態'],
    ['完成原因', '完成原因'], ['維修分類', '維修分類'], ['QC', 'QC'],
    ['已使用年限', '已使用年限'], ['報廢狀態', '報廢單狀態'], ['品質判定', '_判定'],
  ];

  function 判定(r) {
    const returned = r.回廠狀態 && r.回廠狀態 !== '無記錄' && r.回廠狀態 !== '不回廠';
    if (!returned) return r.回廠狀態 === '不回廠' ? '未回廠' : '無回廠記錄';
    const parts = [];
    if (r.良品) parts.push('良品');
    if (r.不良品) parts.push('不良品');
    if (r.過保) parts.push('過保');
    return parts.join('＋') || '—';
  }

  function build() {
    $('raw-slot').innerHTML = `
      <section class="card detail">
        <div class="detail__head">
          <span class="detail__title">明細（逐筆）</span>
          <input type="search" id="raw-search" class="detail__search" placeholder="搜尋明細（條碼、品名、廠商、故障…）" />
          <span class="detail__count" id="raw-count"></span>
        </div>
        <div class="detail__scroll" id="raw-wrap"></div>
      </section>`;
    $('raw-search').addEventListener('input', (e) => { search = e.target.value.trim(); render(); });
    built = true;
  }

  function render() {
    const st = App.app.state;
    let rows = App.metrics.applyFilter(st.rows, st.selection).map((r) => ({ ...r, _判定: 判定(r) }));
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => COLS.some(([, k]) => String(r[k] ?? '').toLowerCase().includes(q)));
    }
    const total = rows.length;
    const shown = rows.slice(0, MAX_ROWS);
    $('raw-count').textContent = total > MAX_ROWS ? `顯示前 ${MAX_ROWS} / 共 ${total.toLocaleString()} 筆` : `共 ${total.toLocaleString()} 筆`;
    const head = `<tr>${COLS.map(([h]) => `<th>${h}</th>`).join('')}</tr>`;
    const body = shown.map((r) => `<tr>${COLS.map(([, k]) => `<td>${r[k] ?? ''}</td>`).join('')}</tr>`).join('');
    $('raw-wrap').innerHTML = `<table class="detail-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  function onRerender() {
    if (!built) build();
    render();
  }

  return { onRerender };
})();
