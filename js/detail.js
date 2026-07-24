/**
 * js/detail.js — 明細彙整表（掛 App.detail）
 *
 * 依 App.metrics.aggregate 產生「依 ERP品號 彙整、依 類型/廠商 分組、含小計/總計」的表。
 * 這個模組同時管理畫面上的兩張表（各自獨立的欄位設定／折疊依據／只顯示小計／拖曳排序／
 * 逐欄 Excel 風格下拉篩選，篩選元件由 App.tablefilter 共用）：
 *   1. 比率表（#detail-simple-slot）：固定精簡欄位，車機／鏡頭皆同一組欄位。
 *   2. 分析表（#detail-slot）：完整欄位（含故障原因細項、維修/報廢分類），
 *      車機／鏡頭欄位不同（faultCols 依 deviceTab 動態插入），置於比率表下方。
 * 由 app.js 的 rerender() 呼叫 App.detail.onRerender(state)。
 */
window.App = window.App || {};

App.detail = (() => {
  const $ = (id) => document.getElementById(id);
  const fmtInt = (v) => (Number(v) || 0).toLocaleString('en-US');
  const fmtPct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
  const fmtYear = (v) => (v == null || v === '' ? '' : Number(v).toFixed(1));
  const fmtCell = (c, v) => c.fmt === 'pct' ? fmtPct(v) : c.fmt === 'int' ? fmtInt(v) : c.fmt === 'year' ? fmtYear(v) : (v ?? '');
  const esc = App.tablefilter.esc;

  function faultColsFor(deviceTab) {
    const cfg = App.config.FAULT_COLS_BY_DEVICE || {};
    return cfg[deviceTab] || cfg.車機 || [];
  }

  // ── 分析表：完整欄位（故障原因 5 欄依 deviceTab 動態插入，見 buildAnalysisCols）──
  const ANALYSIS_PRE = [
    { key: '期間', label: '期間', fmt: 'text' },
    { key: '類型', label: '類型', fmt: 'text' },
    { key: '廠商', label: '廠商', fmt: 'text' },
    { key: 'ERP品號', label: 'ERP品號', fmt: 'text' },
    { key: '品名', label: '品名', fmt: 'text' },
    { key: '上線量', label: '上線量', fmt: 'int', num: true },
  ];
  const ANALYSIS_POST = [
    { key: '回廠量', label: '回廠量', fmt: 'int', num: true },
    { key: '回廠不良品數(全)', label: '回廠不良品數(全)', fmt: 'int', num: true },
    { key: '回廠良品數', label: '回廠良品數', fmt: 'int', num: true },
    { key: '回廠不良品數', label: '回廠不良品數', fmt: 'int', num: true },
    { key: '回廠過保數', label: '回廠過保數', fmt: 'int', num: true },
    { key: '回廠人為數', label: '回廠人為數', fmt: 'int', num: true },
    { key: 'D /停產報廢', label: 'D /停產報廢', fmt: 'int', num: true },
    { key: 'E /過保報廢', label: 'E /過保報廢', fmt: 'int', num: true },
    { key: 'G /評估後退修', label: 'G /評估後退修', fmt: 'int', num: true },
    { key: 'H /人為報廢', label: 'H /人為報廢', fmt: 'int', num: true },
    { key: 'O /測試正常', label: 'O /測試正常', fmt: 'int', num: true },
    { key: 'X /已完修', label: 'X /已完修', fmt: 'int', num: true },
    { key: 'V /已完修 人為', label: 'V /已完修 人為', fmt: 'int', num: true },
    { key: '維修換貨＋換貨條碼', label: '維修換貨＋換貨條碼', fmt: 'int', num: true },
    { key: '回廠QC', label: '回廠QC', fmt: 'int', num: true },
    { key: '回廠報廢', label: '回廠報廢', fmt: 'int', num: true },
    { key: '其他(良品)', label: '其他(良品)', fmt: 'int', num: true },
    { key: '其他(回廠)', label: '其他(回廠)', fmt: 'int', num: true },
    { key: '已使用年限', label: '已使用年限(年)', fmt: 'year', num: true },
  ];
  function buildAnalysisCols(deviceTab) {
    const faultCols = faultColsFor(deviceTab).map((f) => ({ key: f, label: f, fmt: 'int', num: true }));
    return [...ANALYSIS_PRE, ...faultCols, ...ANALYSIS_POST].map((c) => ({ ...c, on: true }));
  }

  // ── 比率表：固定精簡欄位，車機／鏡頭共用同一組 ──────────────────────
  // 預設關閉：期間、未歸類數、未歸類率(%)、整體不良率(%)、整體過保率(%)（仍可從欄位顯示手動開啟）
  const SUMMARY_DEFAULT_OFF = new Set(['期間', '未歸類數', '未歸類率', '整體不良率', '整體過保率']);
  const SUMMARY_COLS = [
    { key: '期間', label: '期間', fmt: 'text' },
    { key: '廠商', label: '廠商', fmt: 'text' },
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
    { key: '未歸類數', label: '未歸類數', fmt: 'int', num: true },
    { key: '未歸類率', label: '未歸類率(%)', fmt: 'pct', num: true },
    { key: '已使用年限', label: '已使用年限(年)', fmt: 'year', num: true },
    { key: '整體不良率', label: '整體不良率(%)', fmt: 'pct', num: true },
    { key: '整體過保率', label: '整體過保率(%)', fmt: 'pct', num: true },
  ].map((c) => ({ ...c, on: !SUMMARY_DEFAULT_OFF.has(c.key) }));

  /**
   * 建立一張獨立的彙整明細表控制器（各自的 DOM／欄位設定／折疊依據／小計狀態／逐欄下拉篩選）。
   * @param {{ slotId: string, title: string, colsInit: Array|Function, deviceAware: boolean }} cfg
   *   colsInit 為 Function 時依 deviceTab 動態算欄位（分析表）；為固定陣列時兩分頁共用（比率表）。
   */
  function makeTable({ slotId, title, colsInit, deviceAware }) {
    const ids = {
      title: `${slotId}-title`, count: `${slotId}-count`, wrap: `${slotId}-wrap`,
      chips: `${slotId}-col-chips`, colsToggle: `${slotId}-cols-toggle`,
      groupName: `${slotId}-groupBy`, onlySub: `${slotId}-only-subtotal`,
    };
    const ui = {
      groupBy: '類型',
      onlySubtotal: false,
      colsPanelOpen: false,
      colFilters: {},   // { [colKey]: Set<string>|undefined }
      cols: deviceAware ? colsInit('車機') : colsInit.map((c) => ({ ...c })),
      dragKey: null,
    };
    let built = false;
    let lastDeviceTab = '車機';
    let lastOptionsByKey = {};

    function buildShell() {
      $(slotId).innerHTML = `
        <section class="card detail">
          <div class="detail__bar">
            <span class="detail__title" id="${ids.title}">${title}</span>
            <span class="detail__count" id="${ids.count}"></span>
          </div>
          <div class="detail__opts">
            <div class="opt-row">
              <span class="opt-label">折疊依據</span>
              <label class="radio"><input type="radio" name="${ids.groupName}" value="類型" checked/> 類型</label>
              <label class="radio"><input type="radio" name="${ids.groupName}" value="廠商"/> 廠商</label>
              <label class="radio"><input type="checkbox" id="${ids.onlySub}"/> 只顯示小計</label>
            </div>
            <div class="opt-row opt-row--cols">
              <button type="button" class="cols-toggle" id="${ids.colsToggle}">
                欄位顯示（可拖曳排序）<span class="cols-toggle__arrow">▸</span>
              </button>
              <div class="col-chips" id="${ids.chips}" hidden></div>
            </div>
          </div>
          <div class="detail__scroll" id="${ids.wrap}"></div>
        </section>`;
      $(slotId).querySelectorAll(`input[name="${ids.groupName}"]`).forEach((r) =>
        r.addEventListener('change', (e) => { ui.groupBy = e.target.value; render(); }));
      $(ids.onlySub).addEventListener('change', (e) => { ui.onlySubtotal = e.target.checked; render(); });
      $(ids.colsToggle).addEventListener('click', () => {
        ui.colsPanelOpen = !ui.colsPanelOpen;
        $(ids.chips).hidden = !ui.colsPanelOpen;
        $(ids.colsToggle).classList.toggle('cols-toggle--open', ui.colsPanelOpen);
      });
      // 欄位下拉篩選按鈕／ERP品號 逆查連結（事件委派：innerHTML 每次重建表格，監聽器掛在不變的容器上）
      $(ids.wrap).addEventListener('click', (e) => {
        const erpCell = e.target.closest('.erp-link');
        if (erpCell) {
          if (App.rawtable && App.rawtable.focusERP) App.rawtable.focusERP(erpCell.dataset.erp);
          return;
        }
        const btn = e.target.closest('.col-filter-btn');
        if (!btn) return;
        const key = btn.dataset.key;
        if (App.tablefilter.isOpenFor($(ids.wrap), key)) { App.tablefilter.close(); return; }
        App.tablefilter.open($(ids.wrap), key, {
          options: lastOptionsByKey[key] || [],
          selectedSet: ui.colFilters[key] || null,
          onFilterChange: (newSet) => {
            if (newSet) ui.colFilters[key] = newSet; else delete ui.colFilters[key];
            renderTable();
          },
        }, btn);
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

    function render() { renderChips(); renderTable(); }

    function renderTable() {
      const st = App.app.state;
      if (deviceAware && st.deviceTab && st.deviceTab !== lastDeviceTab) {
        lastDeviceTab = st.deviceTab;
        ui.cols = colsInit(lastDeviceTab);
        if (built) renderChips();
      }
      const faultCols = deviceAware ? faultColsFor(st.deviceTab || lastDeviceTab) : null;
      const agg = App.metrics.aggregate(st.rows, st.onlineList, st.selection, { groupBy: ui.groupBy, faultCols });
      const periodLabel = `${st.year}-Q${st.quarter}`;
      const cols = ui.cols.filter((c) => c.on);
      const labelIdx = Math.max(0, cols.findIndex((c) => c.key === ui.groupBy));
      const cellVal = (c, row) => c.key === '期間' ? periodLabel : fmtCell(c, row[c.key]);

      // 逐欄下拉篩選選項（非串接式：一律以完整未篩選資料算不同值，避免清單邊勾邊變動）
      const baseRows = agg.groups.flatMap((g) => g.rows);
      lastOptionsByKey = {};
      for (const c of cols) lastOptionsByKey[c.key] = App.tablefilter.uniqueOptions(baseRows, (row) => cellVal(c, row));

      const rowMatches = (row) => App.tablefilter.matches(ui.colFilters, cols, cellVal, row);
      const groups = agg.groups
        .map((g) => ({ key: g.key, rows: g.rows.filter(rowMatches) }))
        .filter((g) => g.rows.length)
        .map((g) => ({ ...g, subtotal: App.metrics.summarizeRows(g.rows, faultCols) }));
      const allRows = groups.flatMap((g) => g.rows);
      const grandTotal = App.metrics.summarizeRows(allRows, faultCols);

      $(ids.title).textContent = title;
      $(ids.count).textContent = `${groups.length} 組 / ${allRows.length.toLocaleString()} 品號`;

      const head = `<tr>${cols.map((c) => App.tablefilter.headerCellHTML(c, ui.colFilters)).join('')}</tr>`;
      const cell = (c, row) => {
        const v = cellVal(c, row);
        if (c.key === 'ERP品號' && row.ERP品號) {
          return `<td class="erp-link" data-erp="${esc(row.ERP品號)}" title="點擊查看彙整表原始資料">${v}</td>`;
        }
        return `<td class="${c.num ? 'num' : ''}">${v}</td>`;
      };

      let body = '';
      for (const g of groups) {
        if (!ui.onlySubtotal) {
          for (const r of g.rows) body += `<tr>${cols.map((c) => cell(c, r)).join('')}</tr>`;
        }
        const subLabel = ui.onlySubtotal ? g.key : `${g.key} 小計`;
        body += `<tr class="sub">${cols.map((c, i) => {
          if (i === labelIdx) return `<td class="sub__label">${esc(subLabel)}</td>`;
          return `<td class="num">${c.num ? fmtCell(c, g.subtotal[c.key]) : ''}</td>`;
        }).join('')}</tr>`;
      }
      // 總計
      body += `<tr class="grand">${cols.map((c, i) => {
        if (i === labelIdx) return `<td>總計</td>`;
        return `<td class="num">${c.num ? fmtCell(c, grandTotal[c.key]) : ''}</td>`;
      }).join('')}</tr>`;

      $(ids.wrap).innerHTML = `<table class="agg-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
      App.tablefilter.reposition();
    }

    function onRerender() {
      if (!built) { buildShell(); renderChips(); }
      renderTable();
    }

    return { onRerender };
  }

  const summaryTable = makeTable({ slotId: 'detail-simple-slot', title: '比率表', colsInit: SUMMARY_COLS, deviceAware: false });
  const analysisTable = makeTable({ slotId: 'detail-slot', title: '分析表', colsInit: buildAnalysisCols, deviceAware: true });

  function onRerender() {
    summaryTable.onRerender();
    analysisTable.onRerender();
  }

  return { onRerender };
})();
