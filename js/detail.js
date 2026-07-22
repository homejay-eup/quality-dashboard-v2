/**
 * js/detail.js — 彙整明細表（掛 App.detail）
 *
 * 依 App.metrics.aggregate 產生「依 ERP品號 彙整、依 類型/廠商 分組、含小計/總計」的表。
 * 功能：折疊依據(類型/廠商)切換、群組收合、只顯示小計、欄位顯示開關、欄序拖曳。
 * 由 app.js 的 rerender() 呼叫 App.detail.onRerender(state)。
 */
window.App = window.App || {};

App.detail = (() => {
  const $ = (id) => document.getElementById(id);
  const fmtInt = (v) => (Number(v) || 0).toLocaleString('en-US');
  const fmtPct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
  const fmtYear = (v) => (v == null || v === '' ? '' : Number(v).toFixed(1));

  // 欄位登錄（可開關、可拖曳排序）；num=右對齊
  const ALL_COLS = [
    { key: '廠商', label: '廠商', fmt: 'text' },
    { key: '類型', label: '類型', fmt: 'text' },
    { key: 'ERP品號', label: 'ERP品號', fmt: 'text' },
    { key: '品名', label: '品名', fmt: 'text' },
    { key: '上線量', label: '上線量', fmt: 'int', num: true },
    { key: '回廠量', label: '回廠量', fmt: 'int', num: true },
    { key: '良品數', label: '良品數', fmt: 'int', num: true },
    { key: '再使用率', label: '再使用率(%)', fmt: 'pct', num: true },
    { key: '不良品數', label: '不良品數', fmt: 'int', num: true },
    { key: '不良率', label: '不良率(%)', fmt: 'pct', num: true },
    { key: '過保數', label: '過保數', fmt: 'int', num: true },
    { key: '過保率', label: '過保率(%)', fmt: 'pct', num: true },
    { key: '已使用年限', label: '已使用年限(年)', fmt: 'year', num: true },
    { key: '整體不良率', label: '整體不良率(%)', fmt: 'pct', num: true },
    { key: '整體過保率', label: '整體過保率(%)', fmt: 'pct', num: true },
  ];

  const ui = {
    groupBy: '類型',
    onlySubtotal: false,
    cols: ALL_COLS.map((c) => ({ ...c, on: true })), // 順序可變
    collapsed: new Set(),
    dragKey: null,
  };
  let built = false;

  const fmtCell = (c, v) => c.fmt === 'pct' ? fmtPct(v) : c.fmt === 'int' ? fmtInt(v) : c.fmt === 'year' ? fmtYear(v) : (v ?? '');

  function buildShell() {
    $('detail-slot').innerHTML = `
      <section class="card detail">
        <div class="detail__bar">
          <span class="detail__title" id="detail-title">詳細資料</span>
          <span class="detail__count" id="detail-count"></span>
        </div>
        <div class="detail__opts">
          <div class="opt-row">
            <span class="opt-label">折疊依據</span>
            <label class="radio"><input type="radio" name="groupBy" value="類型" checked/> 類型</label>
            <label class="radio"><input type="radio" name="groupBy" value="廠商"/> 廠商</label>
            <label class="radio"><input type="checkbox" id="only-subtotal"/> 只顯示小計</label>
            <span class="opt-sep"></span>
            <button class="btn-ghost" id="btn-expand-all">全部展開</button>
            <button class="btn-ghost" id="btn-collapse-all">全部摺疊</button>
          </div>
          <div class="opt-row opt-row--cols">
            <span class="opt-label">欄位顯示（可拖曳排序）</span>
            <div class="col-chips" id="col-chips"></div>
          </div>
        </div>
        <div class="detail__scroll" id="detail-wrap"></div>
      </section>`;
    $('detail-slot').querySelectorAll('input[name="groupBy"]').forEach((r) =>
      r.addEventListener('change', (e) => { ui.groupBy = e.target.value; ui.collapsed.clear(); render(); }));
    $('only-subtotal').addEventListener('change', (e) => { ui.onlySubtotal = e.target.checked; render(); });
    $('btn-expand-all').addEventListener('click', () => { ui.collapsed.clear(); renderTable(); });
    $('btn-collapse-all').addEventListener('click', () => {
      (lastAgg ? lastAgg.groups : []).forEach((g) => ui.collapsed.add(g.key)); renderTable();
    });
    built = true;
  }

  function renderChips() {
    const el = $('col-chips');
    el.innerHTML = ui.cols.map((c) =>
      `<span class="col-chip ${c.on ? 'col-chip--on' : ''}" draggable="true" data-key="${c.key}">
        <span class="col-chip__dot"></span>${c.label}
      </span>`).join('');
    el.querySelectorAll('.col-chip').forEach((chip) => {
      const key = chip.dataset.key;
      chip.addEventListener('click', () => {
        const c = ui.cols.find((x) => x.key === key); c.on = !c.on;
        chip.classList.toggle('col-chip--on'); renderTable();
      });
      chip.addEventListener('dragstart', () => { ui.dragKey = key; chip.classList.add('dragging'); });
      chip.addEventListener('dragend', () => { chip.classList.remove('dragging'); });
      chip.addEventListener('dragover', (e) => { e.preventDefault(); });
      chip.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!ui.dragKey || ui.dragKey === key) return;
        const from = ui.cols.findIndex((x) => x.key === ui.dragKey);
        const to = ui.cols.findIndex((x) => x.key === key);
        const [m] = ui.cols.splice(from, 1); ui.cols.splice(to, 0, m);
        ui.dragKey = null; renderChips(); renderTable();
      });
    });
  }

  let lastAgg = null;
  function render() { renderChips(); renderTable(); }

  function renderTable() {
    const st = App.app.state;
    lastAgg = App.metrics.aggregate(st.rows, st.onlineList, st.selection, { groupBy: ui.groupBy });
    const cols = ui.cols.filter((c) => c.on);
    const groups = lastAgg.groups;
    const totalRows = groups.reduce((s, g) => s + g.rows.length, 0);
    $('detail-title').textContent = `${st.deviceTab || ''}_彙整總覽`;
    $('detail-count').textContent = `${groups.length} 組 / ${totalRows.toLocaleString()} 品號`;

    const head = `<tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}</tr>`;
    const cell = (c, row) => `<td class="${c.num ? 'num' : ''}">${fmtCell(c, row[c.key])}</td>`;

    let body = '';
    for (const g of groups) {
      const collapsed = ui.collapsed.has(g.key);
      body += `<tr class="grp" data-g="${encodeURIComponent(g.key)}">
        <td class="grp__cell" colspan="${cols.length}">
          <span class="grp__caret">${collapsed ? '▶' : '▼'}</span> ${ui.groupBy}：${g.key}
          <span class="grp__n">（${g.rows.length} 品號）</span>
        </td></tr>`;
      if (!collapsed && !ui.onlySubtotal) {
        for (const r of g.rows) body += `<tr>${cols.map((c) => cell(c, r)).join('')}</tr>`;
      }
      // 小計：不論收合與否都顯示（收合＝只留群組標題＋小計）
      body += `<tr class="sub">${cols.map((c, i) => {
        if (i === 0) return `<td class="sub__label">${g.key}</td>`;
        return `<td class="num">${['廠商', '類型', 'ERP品號', '品名'].includes(c.key) ? '' : fmtCell(c, g.subtotal[c.key])}</td>`;
      }).join('')}</tr>`;
    }
    // 總計
    body += `<tr class="grand">${cols.map((c, i) => {
      if (i === 0) return `<td>總計</td>`;
      return `<td class="num">${['廠商', '類型', 'ERP品號', '品名'].includes(c.key) ? '' : fmtCell(c, lastAgg.grandTotal[c.key])}</td>`;
    }).join('')}</tr>`;

    $('detail-wrap').innerHTML = `<table class="agg-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    $('detail-wrap').querySelectorAll('tr.grp').forEach((tr) => {
      tr.addEventListener('click', () => {
        const k = decodeURIComponent(tr.dataset.g);
        if (ui.collapsed.has(k)) ui.collapsed.delete(k); else ui.collapsed.add(k);
        renderTable();
      });
    });
  }

  function onRerender() {
    if (!built) { buildShell(); renderChips(); }
    renderTable();
  }

  return { onRerender };
})();
