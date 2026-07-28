/**
 * js/filters.js — 三層串接篩選（廠商→類型→ERP品號）＋ 明細表（掛 App.filters）
 *
 * 與 app.js 協作：app.rerender() 會呼叫 App.filters.onRerender(state)。
 * - 期間變更（periodKey 改變）→ 依當期 rows 重建篩選勾選清單。
 * - 每次 rerender → 依 selection 過濾 rows 重繪明細表。
 * 勾選變更 → 更新 state.selection → 更新下層清單 → App.app.rerender()。
 */
window.App = window.App || {};

App.filters = (() => {
  const $ = (id) => document.getElementById(id);
  let lastPeriodKey = null;
  const searchTerms = { 廠商: '', 類型: '', 品號: '' };
  const matchTerm = (text, term) => !term || String(text).toLowerCase().includes(term.toLowerCase());

  // 每個分頁第一次載入時的預設篩選（之後使用者自行調整就不再覆蓋）
  const DEFAULT_SELECTIONS = {
    車機: { 廠商: ['SMC全球技術', '格瑪', '深圳市銳明技術', '車威視', '馥鴻科技'], 類型排除: ['R007T', '其他'] },
    鏡頭: { 廠商: ['呈岳科技', '新眾', '車威視', '馥鴻科技'] },
  };
  const defaultsApplied = { 車機: false, 鏡頭: false };

  // 套用該分頁的預設篩選（廠商指定清單；類型／ERP品號預設全選，車機類型排除 R007T／其他）
  function applyDefaultSelectionIfNeeded(state) {
    const tab = state.deviceTab;
    const cfg = DEFAULT_SELECTIONS[tab];
    if (!cfg || defaultsApplied[tab]) return false;
    defaultsApplied[tab] = true;
    const sel = state.selection;
    let opts = computeOptions(state);
    sel.廠商 = cfg.廠商.filter((v) => opts.廠商.includes(v));
    opts = computeOptions(state);
    sel.類型 = cfg.類型排除 ? opts.類型.filter((v) => !cfg.類型排除.includes(v)) : [...opts.類型];
    opts = computeOptions(state);
    sel.ERP品號 = opts.品號.map((p) => p.id);
    return true;
  }

  // 依目前 selection 從當期 rows 推導各層可選項（串接）
  function distinct(arr) { return [...new Set(arr)].filter((v) => v !== '' && v != null); }

  function computeOptions(state) {
    const rows = state.rows;
    const sel = state.selection;
    const 廠商 = distinct(rows.map((r) => r.廠商)).sort();
    const 類型 = distinct(
      rows.filter((r) => !sel.廠商.length || sel.廠商.includes(r.廠商)).map((r) => r.廠牌型號)
    ).sort();
    const 品號 = [];
    const seen = new Set();
    for (const r of rows) {
      if (sel.廠商.length && !sel.廠商.includes(r.廠商)) continue;
      if (sel.類型.length && !sel.類型.includes(r.廠牌型號)) continue;
      const id = String(r.ERP品號 || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      品號.push({ id, 品名: r.替換前品項 || '' });
    }
    品號.sort((a, b) => a.id.localeCompare(b.id));
    return { 廠商, 類型, 品號 };
  }

  function checkboxList(containerId, items, checkedSet, onToggle) {
    const el = $(containerId);
    el.innerHTML = items.map((it) => {
      const val = typeof it === 'string' ? it : it.id;
      const label = typeof it === 'string' ? it : `${it.id} ${it.品名}`;
      const checked = checkedSet.has(val) ? 'checked' : '';
      return `<label class="chk"><input type="checkbox" value="${encodeURIComponent(val)}" ${checked}/><span>${label || '(空)'}</span></label>`;
    }).join('') || '<div class="filter-empty">（無項目）</div>';
    el.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => onToggle(decodeURIComponent(inp.value), inp.checked));
    });
  }

  function filterCol(id, title) {
    return `<div class="filter-col">
      <div class="filter-col__head">${title} <span id="cnt-${id}"></span></div>
      <label class="chk chk-all"><input type="checkbox" id="selall-${id}" /><span>全選</span></label>
      <input class="filter-search" id="search-${id}" placeholder="搜尋${title}…" autocomplete="off" />
      <div class="filter-col__list" id="list-${id}"></div>
    </div>`;
  }

  // 各欄目前（依搜尋字串過濾後）可見的選項清單，供清單渲染與「全選」共用
  function getFilteredOptions(state) {
    const opts = computeOptions(state);
    return {
      opts,
      f廠商: opts.廠商.filter((v) => matchTerm(v, searchTerms.廠商)),
      f類型: opts.類型.filter((v) => matchTerm(v, searchTerms.類型)),
      f品號: opts.品號.filter((p) => matchTerm(`${p.id} ${p.品名}`, searchTerms.品號)),
    };
  }

  function buildFilterUI(state) {
    $('filter-slot').innerHTML = `
      <div class="filters">
        <div class="filters__head">
          <span class="filters__title">篩選</span>
          <button class="btn-ghost" id="filter-clear">清除篩選</button>
        </div>
        <div class="filters__cols">
          ${filterCol('廠商', '廠商')}
          ${filterCol('類型', '類型')}
          ${filterCol('品號', 'ERP品號')}
        </div>
      </div>`;
    $('filter-clear').addEventListener('click', () => {
      state.selection = { 廠商: [], 類型: [], ERP品號: [] };
      searchTerms.廠商 = searchTerms.類型 = searchTerms.品號 = '';
      ['廠商', '類型', '品號'].forEach((c) => { const s = $(`search-${c}`); if (s) s.value = ''; });
      renderLists(state);
      App.app.rerender();
    });
    ['廠商', '類型', '品號'].forEach((c) => {
      $(`search-${c}`).addEventListener('input', (e) => { searchTerms[c] = e.target.value.trim(); renderLists(state); });
    });
    const selKey = { 廠商: '廠商', 類型: '類型', 品號: 'ERP品號' };
    ['廠商', '類型', '品號'].forEach((c) => {
      $(`selall-${c}`).addEventListener('change', (e) => {
        const { f廠商, f類型, f品號 } = getFilteredOptions(state);
        const visible = c === '廠商' ? f廠商 : c === '類型' ? f類型 : f品號.map((p) => p.id);
        state.selection[selKey[c]] = e.target.checked ? [...visible] : [];
        renderLists(state);
        App.app.rerender();
      });
    });
  }

  function toggle(arr, val, on) {
    const i = arr.indexOf(val);
    if (on && i < 0) arr.push(val);
    if (!on && i >= 0) arr.splice(i, 1);
  }

  function renderLists(state) {
    const sel = state.selection;
    const { opts, f廠商, f類型, f品號 } = getFilteredOptions(state);
    // 剪掉已不在選項內的選擇
    sel.類型 = sel.類型.filter((v) => opts.類型.includes(v));
    sel.ERP品號 = sel.ERP品號.filter((v) => opts.品號.some((p) => p.id === v));

    checkboxList('list-廠商', f廠商, new Set(sel.廠商), (val, on) => {
      toggle(sel.廠商, val, on); renderLists(state); App.app.rerender();
    });
    checkboxList('list-類型', f類型, new Set(sel.類型), (val, on) => {
      toggle(sel.類型, val, on); renderLists(state); App.app.rerender();
    });
    checkboxList('list-品號', f品號, new Set(sel.ERP品號), (val, on) => {
      toggle(sel.ERP品號, val, on); renderLists(state); App.app.rerender();
    });
    $('cnt-廠商').textContent = sel.廠商.length ? `(${sel.廠商.length})` : '';
    $('cnt-類型').textContent = sel.類型.length ? `(${sel.類型.length})` : '';
    $('cnt-品號').textContent = sel.ERP品號.length ? `(${sel.ERP品號.length})` : '';

    const syncSelAll = (id, visible, selArr) => {
      const el = $(`selall-${id}`);
      if (!el) return;
      el.checked = visible.length > 0 && visible.every((v) => selArr.includes(v));
      el.indeterminate = !el.checked && visible.some((v) => selArr.includes(v));
    };
    syncSelAll('廠商', f廠商, sel.廠商);
    syncSelAll('類型', f類型, sel.類型);
    syncSelAll('品號', f品號.map((p) => p.id), sel.ERP品號);
  }

  // ── app.js 呼叫（本模組只負責篩選 UI；明細表移至 detail.js）──
  function onRerender(state) {
    const periodKey = `${state.year}-${state.quarter}-${state.deviceTab}`;
    if (periodKey !== lastPeriodKey) {
      lastPeriodKey = periodKey;
      if (!$('list-廠商')) buildFilterUI(state);
      const applied = applyDefaultSelectionIfNeeded(state);
      renderLists(state);
      if (applied) App.app.rerender();
    } else if (!$('list-廠商')) {
      buildFilterUI(state);
      const applied = applyDefaultSelectionIfNeeded(state);
      renderLists(state);
      if (applied) App.app.rerender();
    }
  }

  return { onRerender };
})();
