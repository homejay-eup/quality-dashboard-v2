/**
 * js/rawtable.js — 彙整表（逐筆明細，掛 App.rawtable）
 *
 * 依目前篩選（廠商/類型/ERP品號 + 期間 + 車機/鏡頭分頁）即時顯示逐筆明細，21 欄，
 * 欄位與計算邏輯對齊 新版產出/build_分析總表.py 的 build_detail()（見 report.js RAWCOLS）。
 * 支援欄位顯示開關／拖曳排序（同比率表/分析表）＋逐欄 Excel 風格下拉篩選（App.tablefilter 共用）。
 *
 * 逆查連結（2026-07-24 新增，見 detail.js）：
 *   - focusERPAndLogic(erp, label, test)：比率表/分析表點擊數量或分類欄位時呼叫，
 *     同時鎖定該列的 ERP品號 欄位篩選＋依對應的維修分類／QC 邏輯（單一或多值 OR）
 *     篩選逐筆資料，兩者一起顯示在可清除的篩選提示列。
 *
 * 由 app.js 的 rerender() 呼叫 App.rawtable.onRerender(state)。
 */
window.App = window.App || {};

App.rawtable = (() => {
  const $ = (id) => document.getElementById(id);
  const MAX_ROWS = 500;
  const fmtInt = (v) => (Number(v) || 0).toLocaleString('en-US');
  const fmtYear = (v) => (v == null || v === '' ? '' : Number(v).toFixed(1));
  const esc = App.tablefilter.esc;

  // [顯示標題, row 欄位 key]；'_period'／'_上線量' 為即時運算補上的欄位
  const BASE_COLS = [
    ['期間', '_period'], ['品項完工日期', '品項完工日期'], ['設備類型', '設備類型'], ['廠牌型號', '廠牌型號'],
    ['廠商', '廠商'], ['ERP品號', 'ERP品號'], ['替換前品項', '替換前品項'], ['替換前品項條碼', '條碼'],
    ['維護原因', '維護原因'], ['維護細節', '維護細節'], ['輸入年月', '輸入年月'], ['輸入時間', '輸入時間'],
    ['完成原因', '完成原因'], ['報廢單狀態', '報廢單狀態'], ['報廢原因', '報廢原因'], ['上線量', '_上線量'],
    ['維護類型', '維護類型'], ['維修分類', '維修分類'], ['進貨日', '進貨日'], ['已使用年限', '已使用年限'],
    ['QC', 'QC'],
  ];

  // 預設關閉：輸入年月、輸入時間、報廢單狀態、報廢原因、上線量（仍可從欄位顯示手動開啟）
  const RAW_DEFAULT_OFF = new Set(['輸入年月', '輸入時間', '報廢單狀態', '報廢原因', '_上線量']);

  const ids = {
    chips: 'raw-col-chips', colsToggle: 'raw-cols-toggle', logicBar: 'raw-logic-bar',
  };
  const ui = {
    colsPanelOpen: false,
    colFilters: {}, // { [key]: Set<string>|undefined }
    cols: BASE_COLS.map(([label, key]) => ({ key, label, on: !RAW_DEFAULT_OFF.has(key) })),
    dragKey: null,
  };
  let logicFilter = null; // { label, test(row) } | null
  let built = false;
  let lastOptionsByKey = {};
  let lastExport = null; // { headers, rows } 依畫面目前顯示內容（欄位/篩選皆已套用，含被 500 筆上限截掉的部分）

  function cellVal(k, v) {
    if (k === '已使用年限') return fmtYear(v);
    if (k === '_上線量') return fmtInt(v);
    return v ?? '';
  }

  function build() {
    $('raw-slot').innerHTML = `
      <section class="card detail">
        <div class="detail__bar">
          <span class="detail__title" id="raw-title">彙整表</span>
          <span class="detail__count" id="raw-count"></span>
          <button type="button" class="btn-ghost detail__download" id="raw-download">📥 下載 CSV</button>
        </div>
        <div class="detail__opts">
          <div class="opt-row opt-row--cols">
            <button type="button" class="cols-toggle" id="${ids.colsToggle}">
              欄位顯示（可拖曳排序）<span class="cols-toggle__arrow">▸</span>
            </button>
            <div class="col-chips" id="${ids.chips}" hidden></div>
          </div>
          <div class="logic-bar" id="${ids.logicBar}" hidden></div>
        </div>
        <div class="detail__scroll" id="raw-wrap"></div>
      </section>`;
    $(ids.colsToggle).addEventListener('click', () => {
      ui.colsPanelOpen = !ui.colsPanelOpen;
      $(ids.chips).hidden = !ui.colsPanelOpen;
      $(ids.colsToggle).classList.toggle('cols-toggle--open', ui.colsPanelOpen);
    });
    $(ids.logicBar).addEventListener('click', (e) => {
      if (e.target.closest('.logic-bar__clear')) clearLogicFilter();
    });
    $('raw-wrap').addEventListener('click', (e) => {
      const btn = e.target.closest('.col-filter-btn');
      if (!btn) return;
      const key = btn.dataset.key;
      if (App.tablefilter.isOpenFor($('raw-wrap'), key)) { App.tablefilter.close(); return; }
      App.tablefilter.open($('raw-wrap'), key, {
        options: lastOptionsByKey[key] || [],
        selectedSet: ui.colFilters[key] || null,
        onFilterChange: (newSet) => {
          if (newSet) ui.colFilters[key] = newSet; else delete ui.colFilters[key];
          render();
        },
      }, btn);
    });
    $('raw-download').addEventListener('click', () => {
      if (!lastExport) return;
      const st = App.app.state;
      App.tablefilter.downloadCsv(`彙整表_${st.deviceTab || ''}_${st.year}-Q${st.quarter}.csv`, lastExport.headers, lastExport.rows);
    });
    built = true;
  }

  function renderChips() {
    const el = $(ids.chips);
    el.innerHTML = ui.cols.map((c) =>
      `<span class="col-chip ${c.on ? 'col-chip--on' : ''}" draggable="true" data-key="${c.key}">
        <span class="col-chip__dot"></span>${c.label}
      </span>`).join('');
    el.querySelectorAll('.col-chip').forEach((chip) => {
      const key = chip.dataset.key;
      chip.addEventListener('click', () => {
        const c = ui.cols.find((x) => x.key === key); c.on = !c.on;
        chip.classList.toggle('col-chip--on'); render();
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
        ui.dragKey = null; renderChips(); render();
      });
    });
  }

  function renderLogicBar() {
    const el = $(ids.logicBar);
    if (!logicFilter) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<span class="logic-bar__label">邏輯篩選中：${esc(logicFilter.label)}</span>
      <button type="button" class="logic-bar__clear">✕ 清除</button>`;
  }

  function render() {
    const st = App.app.state;
    const periodLabel = `${st.year}-Q${st.quarter}`;

    const onlineByERP = new Map();
    for (const o of (st.onlineList || [])) {
      const e = String(o.ERP品號 || '');
      onlineByERP.set(e, (onlineByERP.get(e) || 0) + (Number(o.上線量) || 0));
    }

    // 無「替換前品項條碼」的列查不到維修/回廠/報廢 join，回廠狀態固定為「無記錄」、不計入任何比率，
    // 彙整表（逐筆明細）不顯示這批空殼列（2026-07-28 使用者裁決；不影響比率表/分析表數字）。
    const allRows = App.metrics.applyFilter(st.rows, st.selection).filter((r) => r.條碼).map((r) => ({
      ...r, _period: periodLabel, _上線量: onlineByERP.get(String(r.ERP品號 || '')) || 0,
    }));

    const cols = ui.cols.filter((c) => c.on);
    lastOptionsByKey = {};
    for (const c of cols) lastOptionsByKey[c.key] = App.tablefilter.uniqueOptions(allRows, (r) => cellVal(c.key, r[c.key]));

    const getDisplay = (c, row) => cellVal(c.key, row[c.key]);
    let rows = allRows.filter((r) => App.tablefilter.matches(ui.colFilters, cols, getDisplay, r));
    if (logicFilter) rows = rows.filter(logicFilter.test);

    renderLogicBar();

    const total = rows.length;
    const shown = rows.slice(0, MAX_ROWS);
    $('raw-title').textContent = `彙整表（${st.deviceTab || ''}）`;
    $('raw-count').textContent = total > MAX_ROWS ? `顯示前 ${MAX_ROWS} / 共 ${total.toLocaleString()} 筆` : `共 ${total.toLocaleString()} 筆`;
    const head = `<tr>${cols.map((c) => App.tablefilter.headerCellHTML(c, ui.colFilters)).join('')}</tr>`;
    const body = shown.map((r) => `<tr>${cols.map((c) => `<td>${cellVal(c.key, r[c.key])}</td>`).join('')}</tr>`).join('');
    $('raw-wrap').innerHTML = `<table class="detail-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    App.tablefilter.reposition();
    // 下載匯出完整篩選結果（不受畫面 500 筆顯示上限影響）
    lastExport = { headers: cols.map((c) => c.label), rows: rows.map((r) => cols.map((c) => cellVal(c.key, r[c.key]))) };
  }

  function onRerender() {
    if (!built) { build(); renderChips(); }
    render();
  }

  /**
   * 逆查：依分析表分類欄位的邏輯（維修分類／QC 值，單一或多值 OR）篩選逐筆資料。
   * 疊加在既有欄位篩選（含 ERP品號）之上，不會清掉；只會取代上一個邏輯篩選。
   * @param {string} label - 顯示於篩選提示列的說明文字
   * @param {(row: Object) => boolean} test
   */
  function focusLogic(label, test) {
    logicFilter = { label, test };
    render();
    if (built) $('raw-slot').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * 逆查：同時鎖定 ERP品號 欄位篩選＋依邏輯篩選（比率表/分析表點擊某一列的
   * 良品數/不良品數/過保數/未歸類數或分類欄位時呼叫，兩者一起套用並一起顯示在篩選提示列）。
   * @param {string} erp
   * @param {string} label
   * @param {(row: Object) => boolean} test
   */
  function focusERPAndLogic(erp, label, test) {
    ui.colFilters = { 'ERP品號': new Set([erp]) };
    logicFilter = { label: `${label}（ERP品號=${erp}）`, test };
    render();
    if (built) $('raw-slot').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function clearLogicFilter() {
    logicFilter = null;
    render();
  }

  return { onRerender, focusLogic, focusERPAndLogic, clearLogicFilter };
})();
