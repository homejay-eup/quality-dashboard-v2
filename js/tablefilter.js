/**
 * js/tablefilter.js — Excel 風格欄位下拉篩選（掛 App.tablefilter）
 *
 * 提供給 detail.js（比率表／分析表）、rawtable.js（彙整表）共用的表頭篩選下拉元件。
 * 下拉清單本體是「單一共用 portal」，直接掛在 document.body 上（position:fixed），
 * 避免被各表格自身的 overflow:auto 捲動容器裁切。同一時間只會開啟一個下拉。
 *
 * 使用方式（呼叫端負責維護自己的 ui.colFilters = { [key]: Set<string>|undefined }）：
 *   1. 表頭儲存格用 headerCellHTML(col, ui.colFilters, options) 產生 <th>（含 ▾ 篩選按鈕）。
 *   2. 在表格容器上委派 click，命中 `.col-filter-btn` 時呼叫 open(wrapEl, key, {...}, btnEl)。
 *   3. 每次重新渲染表格（含篩選變更觸發的重渲染）結束後呼叫一次 reposition()，
 *      讓下拉重新對齊（若該欄已被隱藏或表格已非目前開啟對象，reposition 會自動關閉)。
 *   4. matches(colFilters, cols, getDisplay, row) 判斷某列是否通過目前所有作用中的欄位篩選。
 */
window.App = window.App || {};

App.tablefilter = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const toDisplay = (v) => { const s = String(v == null ? '' : v); return s === '' ? '(空白)' : s; };

  /** 從 rows 依 getDisplay(row) 取得該欄所有不同顯示值（已排序，空值顯示為 (空白)）。 */
  function uniqueOptions(rows, getDisplay) {
    const set = new Set();
    for (const r of rows) set.add(toDisplay(getDisplay(r)));
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }

  /** 判斷 row 是否通過 colFilters 裡所有作用中的欄位篩選（未設定的欄位＝不限制）。 */
  function matches(colFilters, cols, getDisplay, row) {
    for (const key in colFilters) {
      const set = colFilters[key];
      if (!set) continue;
      const c = cols.find((x) => x.key === key);
      if (!c) continue;
      if (!set.has(toDisplay(getDisplay(c, row)))) return false;
    }
    return true;
  }

  /** 產生表頭儲存格 HTML（欄名 + ▾ 篩選按鈕；篩選中會標示 .col-filter-btn--on）。 */
  function headerCellHTML(c, colFilters) {
    const isFiltered = !!colFilters[c.key];
    return `<th class="${c.num ? 'num' : ''}" data-key="${c.key}">
      <span class="th-label">${esc(c.label)}</span>
      <button type="button" class="col-filter-btn ${isFiltered ? 'col-filter-btn--on' : ''}" data-key="${c.key}">▾</button>
    </th>`;
  }

  // ── 共用下拉 portal（同時間只開一個，直接掛在 body 上以避開表格捲動容器的裁切）──
  // backdrop：全螢幕透明遮罩，點擊任何「下拉本體以外」的地方都會關閉——比逐一判斷
  // e.target 是否在 portal 內／是否等於觸發按鈕更可靠，不受特定瀏覽器點擊事件細節影響。
  let portal = null;
  let backdrop = null;
  let current = null; // { wrapEl, key }
  let cleanupListeners = null;
  let rafId = null;

  function ensurePortal() {
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'col-filter-backdrop';
      backdrop.hidden = true;
      backdrop.addEventListener('click', close);
      document.body.appendChild(backdrop);
    }
    if (!portal) {
      portal = document.createElement('div');
      portal.className = 'col-filter-pop';
      portal.hidden = true;
      document.body.appendChild(portal);
    }
    return portal;
  }

  function position(anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    const p = ensurePortal();
    p.style.left = `${Math.round(Math.min(r.left, window.innerWidth - 232))}px`;
    p.style.top = `${Math.round(r.bottom + 4)}px`;
  }

  function close() {
    if (!portal || portal.hidden) return;
    portal.hidden = true;
    if (backdrop) backdrop.hidden = true;
    current = null;
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    if (cleanupListeners) { cleanupListeners(); cleanupListeners = null; }
  }

  function isOpenFor(wrapEl, key) {
    return !!(current && portal && !portal.hidden && current.wrapEl === wrapEl && current.key === key);
  }

  /** 重新對齊目前開啟中的下拉（表格重渲染後呼叫）；找不到對應按鈕（如該欄已隱藏）就關閉。 */
  function reposition() {
    if (!current || !portal || portal.hidden) return;
    const anchor = current.wrapEl.querySelector(`.col-filter-btn[data-key="${current.key}"]`);
    if (!anchor) { close(); return; }
    position(anchor);
  }

  /**
   * 開啟欄位篩選下拉。
   * @param {HTMLElement} wrapEl - 表格容器（供之後 reposition 重新尋找按鈕）
   * @param {string} key - 欄位 key
   * @param {{ options: string[], selectedSet: Set<string>|null, onFilterChange: (newSetOrNull) => void }} opts
   * @param {HTMLElement} anchorEl - 觸發按鈕（用於初次定位）
   */
  function open(wrapEl, key, opts, anchorEl) {
    close(); // 確保先前開啟的下拉（不論哪張表/哪個欄位）先關閉，避免監聽器堆疊
    ensurePortal();
    current = { wrapEl, key };
    let search = '';
    let workingSet = opts.selectedSet ? new Set(opts.selectedSet) : null; // null = 全選

    function renderList() {
      const q = search.toLowerCase();
      const shown = q ? opts.options.filter((v) => v.toLowerCase().includes(q)) : opts.options;
      portal.innerHTML = `
        <div class="col-filter-pop__head">
          <input type="text" class="col-filter-pop__search" placeholder="搜尋值…" value="${esc(search)}"/>
          <button type="button" class="col-filter-pop__close" title="關閉">✕</button>
        </div>
        <div class="col-filter-pop__actions">
          <button type="button" data-act="all">全選</button>
          <button type="button" data-act="none">清空</button>
        </div>
        <div class="col-filter-pop__list">
          ${shown.length ? shown.map((v) => `<label class="col-filter-pop__item">
            <input type="checkbox" value="${esc(v)}" ${(!workingSet || workingSet.has(v)) ? 'checked' : ''}/>
            <span>${esc(v)}</span>
          </label>`).join('') : '<div class="col-filter-pop__empty">無符合項目</div>'}
        </div>`;

      portal.querySelector('.col-filter-pop__close').addEventListener('click', close);
      const searchEl = portal.querySelector('.col-filter-pop__search');
      searchEl.addEventListener('input', (e) => {
        search = e.target.value;
        const pos = e.target.selectionStart;
        renderList();
        const newSearchEl = portal.querySelector('.col-filter-pop__search');
        newSearchEl.focus();
        try { newSearchEl.setSelectionRange(pos, pos); } catch { /* 忽略 */ }
      });
      portal.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => {
        workingSet = btn.dataset.act === 'all' ? null : new Set();
        renderList();
        opts.onFilterChange(workingSet);
      }));
      portal.querySelectorAll('.col-filter-pop__item input').forEach((cb) => cb.addEventListener('change', () => {
        if (!workingSet) workingSet = new Set(opts.options);
        if (cb.checked) workingSet.add(cb.value); else workingSet.delete(cb.value);
        if (workingSet.size === opts.options.length) workingSet = null;
        opts.onFilterChange(workingSet);
      }));
    }

    renderList();
    portal.hidden = false;
    backdrop.hidden = false;
    position(anchorEl);

    // 關閉方式：點 X／點背景遮罩（涵蓋整個畫面，點下拉本體以外任何地方）／按 Esc。
    // 對齊改用 requestAnimationFrame 每禎重新計算位置（而非監聽 scroll/resize），
    // 不管是哪個容器捲動、捲動事件有沒有正確傳到 window，下拉都會持續跟著按鈕跑，
    // 不會發生「頁面捲走了，下拉還留在原地」而看起來對不上/點了沒反應的狀況。
    const onKeydown = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKeydown, true);
    const tick = () => { reposition(); if (!portal.hidden) rafId = requestAnimationFrame(tick); };
    rafId = requestAnimationFrame(tick);
    cleanupListeners = () => {
      document.removeEventListener('keydown', onKeydown, true);
    };
  }

  /**
   * 凍結欄（比率表/分析表/彙整表共用；規格見 kit 互動慣例 C 類／TT-1 第 1 項）：
   * 依目前欄位順序/開關狀態，把從索引 0 開始「連續」屬於 freezeKeys 的前幾欄設為凍結欄
   * （position:sticky; left:...）。
   *   - 只認「從最左邊開始、連續在名單裡」的前綴；使用者拖曳打亂順序或關掉某個凍結欄，
   *     導致不再連續 → 後面部分不凍結，屬合理降級，不特別提示。
   *   - 累積 left 偏移量用當下實際 offsetWidth 量出來，不寫死像素（欄寬會因內容/字級變動）。
   *   - 呼叫端（detail.js／rawtable.js）表格重繪（欄位開關/拖曳排序/篩選）與 window.resize
   *     後都要重新呼叫一次，讓凍結位置跟著重算。
   * @param {HTMLElement} wrapEl - 表格捲動容器（內含 <table>，th/td 皆已標 data-key）
   * @param {Array<{key:string}>} cols - 目前顯示中的欄位（依畫面順序，已套用開關/拖曳排序）
   * @param {string[]|Set<string>} freezeKeys - 這張表允許凍結的欄位 key 名單
   */
  function applyStickyCols(wrapEl, cols, freezeKeys) {
    if (!wrapEl) return;
    const table = wrapEl.querySelector('table');
    if (!table) return;
    const freezeSet = freezeKeys instanceof Set ? freezeKeys : new Set(freezeKeys || []);

    // 先清掉舊的凍結標記——欄位順序/開關/視窗大小改變都可能讓「連續前綴」跟上次不一樣。
    table.querySelectorAll('.frozen-col').forEach((el) => {
      el.classList.remove('frozen-col', 'frozen-col--head', 'frozen-col--last');
      el.style.position = '';
      el.style.left = '';
    });

    const prefixKeys = [];
    for (const c of cols) {
      if (!freezeSet.has(c.key)) break;
      prefixKeys.push(c.key);
    }
    if (!prefixKeys.length) return;

    let offset = 0;
    prefixKeys.forEach((key, i) => {
      const th = table.querySelector(`th[data-key="${key}"]`);
      const width = th ? th.offsetWidth : 0;
      const isLast = i === prefixKeys.length - 1;
      // 只選 th／td 本身，不能用單純 [data-key="..."]：表頭篩選按鈕（.col-filter-btn）
      // 自己也帶 data-key（給點擊事件辨識用），選太寬會連按鈕也套上凍結欄的不透明底色，
      // 蓋住按鈕本來該透明、讓「▾」浮在表頭底色上的效果，變成一個空白方塊（實際踩到過）。
      table.querySelectorAll(`th[data-key="${key}"], td[data-key="${key}"]`).forEach((el) => {
        el.classList.add('frozen-col');
        el.style.position = 'sticky';
        el.style.left = `${offset}px`;
        if (el.tagName === 'TH') el.classList.add('frozen-col--head');
        if (isLast) el.classList.add('frozen-col--last');
      });
      offset += width;
    });
  }

  /**
   * 把目前畫面上的表格（依可見欄位＋已套用的篩選/排序）匯出成 CSV 並觸發下載。
   * @param {string} filename
   * @param {string[]} headers - 欄位標題（依畫面顯示順序）
   * @param {Array<Array<string|number>>} rows - 每列各欄的值（同 headers 順序）
   */
  function downloadCsv(filename, headers, rows) {
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers, ...rows].map((r) => r.map(cell).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return { esc, uniqueOptions, matches, headerCellHTML, applyStickyCols, open, close, isOpenFor, reposition, downloadCsv };
})();
