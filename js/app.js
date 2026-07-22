/**
 * js/app.js — 應用控制器（掛 App.app）
 *
 * 期間來源可為：live（現行 CRM 資料的某季度）或 snapshot（載入的快照 bundle）。
 * 目前期間 / 對比期間 各自可選 live 或載入快照，解決「上線量漂移＋CRM 滾動視窗」：
 * 每份快照各自凍結當年上線量，跨年比較才正確。
 */
window.App = window.App || {};

App.app = (() => {
  // ── 車機／鏡頭分析範圍（比照原工具：先依設備類型＋維護原因縮小分析範圍，再談品質指標）──
  const DEVICE_TABS = [
    { key: '車機', label: '🚗 車機分析', 設備類型: '車機', 維護原因: '訊號異常' },
    { key: '鏡頭', label: '📷 鏡頭分析', 設備類型: '鏡頭', 維護原因: '影像異常(鏡頭)' },
  ];

  // ── 指標登錄（key 唯一；def=預設顯示；better：升為好true/壞false/中性null）──
  const METRICS = [
    { key: '總線上量',     label: '總線上量',     fmt: 'int', better: null,  def: true,  get: (k) => k.總線上量 },
    { key: '期間派工量',   label: '期間派工量',   fmt: 'int', better: null,  def: false, get: (k) => k.派工量 },
    { key: '期間回廠量',   label: '期間回廠量',   fmt: 'int', better: null,  def: true,  get: (k) => k.期間回廠量 },
    { key: '期間再使用率', label: '期間再使用率', fmt: 'pct', better: true,  def: true,  get: (k) => k.再使用率 },
    { key: '期間不良率',   label: '期間不良率',   fmt: 'pct', better: false, def: true,  get: (k) => (k.期間回廠量 ? k.不良品數 / k.期間回廠量 : 0) },
    { key: '整體不良率',   label: '整體不良率',   fmt: 'pct', better: false, def: true,  get: (k) => k.不良率 },
    { key: '整體過保率',   label: '整體過保率',   fmt: 'pct', better: false, def: true,  get: (k) => k.過保率 },
    { key: '良品數',       label: '良品數',       fmt: 'int', better: null,  def: false, get: (k) => k.良品數 },
    { key: '不良品數',     label: '不良品數',     fmt: 'int', better: null,  def: false, get: (k) => k.不良品數 },
    { key: '過保數',       label: '過保數',       fmt: 'int', better: null,  def: false, get: (k) => k.過保數 },
  ];

  const state = {
    raw: null,
    onlineList: null,
    rows: [],
    periods: [],
    deviceTab: DEVICE_TABS[0].key,   // '車機' | '鏡頭'
    year: null, quarter: 2,
    cmp: { on: false, year: null, quarter: 2 },
    currentSnap: null,   // 目前期間若為載入的快照 bundle
    cmpSnap: null,       // 對比期間若為載入的快照 bundle
    snapTarget: null,    // 檔案選取要套到 'current' | 'compare'
    selection: { 廠商: [], 類型: [], ERP品號: [] },
    visible: new Set(METRICS.filter((m) => m.def).map((m) => m.key)),
    kpi: null, cmpKpi: null,
  };

  const $ = (id) => document.getElementById(id);
  const fmtInt = (v) => (Number(v) || 0).toLocaleString('en-US');
  const fmtPct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
  const fmtVal = (v, kind) => (kind === 'pct' ? fmtPct(v) : fmtInt(v));
  const snapLabel = (s) => s.meta.period ? `${s.meta.period.year}-Q${s.meta.period.quarter}` : (s.meta.name || '雲端快照');

  function showStatus(html, isError = false) {
    const el = $('status');
    el.className = 'status' + (isError ? ' status--error' : '');
    el.innerHTML = html; el.hidden = false;
    $('content').hidden = true;
  }
  function showContent() { $('status').hidden = true; $('content').hidden = false; }

  const QLABEL = { 1: 'Q1（1–3月）', 2: 'Q2（1–6月）', 3: 'Q3（1–9月）', 4: 'Q4（1–12月）' };
  function buildPeriods() {
    const years = new Set();
    for (const r of state.raw.派工 || []) {
      const y = String(r['品項完工年月'] || r['品項完工日期'] || '').trim().slice(0, 4);
      if (/^\d{4}$/.test(y)) years.add(Number(y));
    }
    const yl = [...years].sort((a, b) => b - a);
    if (!yl.length) yl.push(2026);
    state.periods = [];
    for (const y of yl) for (let q = 4; q >= 1; q--) {
      state.periods.push({ code: `${y}-Q${q}`, year: y, quarter: q, label: `${y} ${QLABEL[q]}` });
    }
    state.year = yl[0]; state.quarter = 2;
    const prevY = yl.find((y) => y === yl[0] - 1);
    state.cmp = (prevY != null) ? { on: true, year: prevY, quarter: 2 } : { on: false, year: yl[0], quarter: 2 };
  }

  function renderDeviceTabs() {
    $('device-tabs').innerHTML = DEVICE_TABS.map((t) =>
      `<button class="device-tab ${state.deviceTab === t.key ? 'device-tab--on' : ''}" data-key="${t.key}">${t.label}</button>`
    ).join('');
    $('device-tabs').querySelectorAll('.device-tab').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.key;
        if (state.deviceTab === k) return;
        state.deviceTab = k;
        state.selection = { 廠商: [], 類型: [], ERP品號: [] };  // 切換分頁時清除舊範圍的篩選殘留
        renderDeviceTabs();
        rerender();
      });
    });
  }

  function currentScope() {
    return DEVICE_TABS.find((t) => t.key === state.deviceTab) || DEVICE_TABS[0];
  }

  function renderControls() {
    const curCode = `${state.year}-Q${state.quarter}`;
    const cmpCode = `${state.cmp.year}-Q${state.cmp.quarter}`;
    const periodOpts = (sel) => state.periods.map((p) => `<option value="${p.code}" ${p.code === sel ? 'selected' : ''}>${p.label}</option>`).join('');

    const cloudOpt = App.cloud && App.cloud.enabled() ? `<option value="__cloud__">☁️ 從共用雲端選取快照…</option>` : '';

    let cur = periodOpts(state.currentSnap ? '' : curCode);
    if (state.currentSnap) cur += `<option value="__snap__" selected>📁 ${snapLabel(state.currentSnap)}（快照）</option>`;
    cur += `<option value="__load__">📁 載入快照檔…</option>${cloudOpt}`;
    $('sel-current').innerHTML = cur;

    let cmp = `<option value="__none__" ${state.cmp.on ? '' : 'selected'}>不比較</option>`;
    cmp += state.periods.map((p) => `<option value="${p.code}" ${state.cmp.on && !state.cmpSnap && p.code === cmpCode ? 'selected' : ''}>${p.label}</option>`).join('');
    if (state.cmpSnap) cmp += `<option value="__snap__" selected>📁 ${snapLabel(state.cmpSnap)}（快照）</option>`;
    cmp += `<option value="__load__">📁 載入快照檔…</option>${cloudOpt}`;
    $('sel-compare').innerHTML = cmp;

    $('metric-chips').innerHTML = METRICS.map((m) =>
      `<button class="chip ${state.visible.has(m.key) ? 'chip--on' : ''}" data-key="${m.key}">${m.label}</button>`).join('');
    $('metric-chips').querySelectorAll('.chip').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.key;
        if (state.visible.has(k)) state.visible.delete(k); else state.visible.add(k);
        b.classList.toggle('chip--on');
        renderKpi();
      });
    });
  }

  function deltaMarkup(m) {
    if (!state.cmp.on || !state.cmpKpi) return '';
    const cur = m.get(state.kpi), prev = m.get(state.cmpKpi);
    let arrow = '→', cls = 'flat', text;
    if (m.fmt === 'pct') {
      const pp = (cur - prev) * 100;
      if (Math.abs(pp) < 0.05) { text = '±0.0pp'; }
      else { const up = pp > 0; arrow = up ? '▲' : '▼'; cls = (m.better === null) ? 'flat' : ((up === m.better) ? 'good' : 'bad'); text = `${up ? '+' : ''}${pp.toFixed(1)}pp`; }
    } else {
      const diff = cur - prev;
      if (diff === 0) { text = '±0'; }
      else { const up = diff > 0; arrow = up ? '▲' : '▼'; cls = (m.better === null) ? 'flat' : ((up === m.better) ? 'good' : 'bad'); const pct = prev ? ` (${up ? '+' : ''}${(diff / prev * 100).toFixed(1)}%)` : ''; text = `${up ? '+' : ''}${fmtInt(diff)}${pct}`; }
    }
    return `<div class="kpi__delta kpi__delta--${cls}">${arrow} ${text}</div>
            <div class="kpi__prev">對比 ${fmtVal(prev, m.fmt)}</div>`;
  }

  function renderKpi() {
    const cards = METRICS.filter((m) => state.visible.has(m.key)).map((m) =>
      `<div class="kpi">
        <div class="kpi__label">${m.label}</div>
        <div class="kpi__value">${fmtVal(m.get(state.kpi), m.fmt)}</div>
        ${deltaMarkup(m)}
      </div>`).join('');
    $('kpi-primary').innerHTML = cards || '<div class="kpi__empty">（未選任何指標）</div>';
    $('kpi-secondary').innerHTML = '';
  }

  // 解析期間來源 → { rows, online }。snapshot 用其自身凍結的上線量。
  // 有 meta.period（舊版 JSON 快照）用該固定期間；無 meta.period（雲端 Sheet 複製，含全歷史）
  // 則用目前下拉選定的年/季，可自由挑該快照內任一期間。
  // deviceKey 不傳則用目前分頁（畫面渲染路徑）；report.js 需要不受目前分頁影響、
  // 同時算車機＋鏡頭兩份資料，故顯式傳入 deviceKey。
  function resolveSource(kind, deviceKey) {
    const snap = kind === 'current' ? state.currentSnap : state.cmpSnap;
    const y = snap && snap.meta.period ? snap.meta.period.year : (kind === 'current' ? state.year : state.cmp.year);
    const q = snap && snap.meta.period ? snap.meta.period.quarter : (kind === 'current' ? state.quarter : state.cmp.quarter);
    const src = snap || state.raw;
    const online = snap ? App.metrics.buildOnlineList(snap) : state.onlineList;
    const rows = App.transform.buildDetail(src, { year: y, quarter: q }).rows;

    // 分頁範圍前置篩選（比照原工具：車機＝設備類型車機＋維護原因訊號異常；鏡頭同理）
    // 篩選後再往下送給 KPI／詳細資料／明細表，其餘模組不需感知車機/鏡頭的存在。
    const scope = deviceKey ? (DEVICE_TABS.find((t) => t.key === deviceKey) || DEVICE_TABS[0]) : currentScope();
    return {
      rows:   rows.filter((r) => r.設備類型 === scope.設備類型 && r.維護原因 === scope.維護原因),
      online: online.filter((o) => o.設備類型 === scope.設備類型),
    };
  }

  // 供落地頁報告使用：不論目前畫面停在哪個分頁，都能算出指定設備類型的完整資料
  // （rows/online/kpi/cmpKpi），讓報告能同時涵蓋車機＋鏡頭。
  function dataForDevice(deviceKey) {
    const cur = resolveSource('current', deviceKey);
    const kpi = App.metrics.computeKPI(cur.rows, cur.online, state.selection);
    let cmpKpi = null;
    if (state.cmp.on) {
      const c = resolveSource('compare', deviceKey);
      cmpKpi = App.metrics.computeKPI(c.rows, c.online, state.selection);
    }
    return { rows: cur.rows, online: cur.online, kpi, cmpKpi };
  }

  function rerender() {
    renderDeviceTabs();
    renderControls();
    const cur = resolveSource('current');
    state.rows = cur.rows;
    state.kpi = App.metrics.computeKPI(cur.rows, cur.online, state.selection);
    if (state.cmp.on) {
      const c = resolveSource('compare');
      state.cmpKpi = App.metrics.computeKPI(c.rows, c.online, state.selection);
    } else { state.cmpKpi = null; }
    renderKpi();
    if (App.filters && App.filters.onRerender) App.filters.onRerender(state);
    if (App.detail && App.detail.onRerender) App.detail.onRerender(state);
    if (App.rawtable && App.rawtable.onRerender) App.rawtable.onRerender(state);
    if (App.advice && App.advice.onRerender) App.advice.onRerender(state);
    showContent();
  }

  function openPicker(target) { state.snapTarget = target; $('snap-file').value = ''; $('snap-file').click(); }

  function reportCloudFeedback(cloud) {
    if (!cloud) return; // 未設定 CLOUD_ENDPOINT，僅本機下載，不提示
    if (cloud.ok) toast(`✅ 已同步存入共用雲端：${cloud.name}`);
    else toast(`⚠️ 本機已下載，但共用雲端上傳失敗：${cloud.error}`, true);
  }

  function toast(msg, isError = false) {
    let el = $('app-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast toast--show' + (isError ? ' toast--error' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast'; }, 4500);
  }

  // ── ☁️ 共用雲端快照選取 modal ───────────────────────
  function closeCloudModal() { const m = $('cloud-modal'); if (m) m.classList.remove('open'); }

  async function openCloudPicker(target) {
    state.snapTarget = target;
    const modal = $('cloud-modal');
    modal.classList.add('open');
    $('cloud-modal-body').innerHTML = `<div class="spinner"></div><div>讀取共用雲端清單中…</div>`;
    try {
      const files = await App.cloud.list();
      // 只列可當資料來源的快照（sheet=複製的來源Sheet全歷史、json=舊版全量快照）；報告 HTML 不列
      const items = files.filter((f) => f.kind === 'sheet' || f.kind === 'json');
      if (!items.length) {
        $('cloud-modal-body').innerHTML = `<div class="cloud-empty">共用雲端目前沒有快照。</div>`;
        return;
      }
      $('cloud-modal-body').innerHTML = items.map((f) => `
        <div class="cloud-item" data-id="${f.id}" data-kind="${f.kind}" data-name="${encodeURIComponent(f.name)}">
          <div class="cloud-item__name">${f.kind === 'sheet' ? '📊' : '📄'} ${f.name}</div>
          <div class="cloud-item__meta">${new Date(f.createdAt).toLocaleString('zh-TW')}${f.size != null ? `　·　${(f.size / 1024 / 1024).toFixed(1)} MB` : '　·　完整來源複本'}</div>
        </div>`).join('');
      $('cloud-modal-body').querySelectorAll('.cloud-item').forEach((el) => {
        el.addEventListener('click', async () => {
          el.classList.add('cloud-item--loading');
          try {
            const kind = el.dataset.kind;
            const name = decodeURIComponent(el.dataset.name);
            const b = kind === 'sheet'
              ? await App.cloud.loadSheetCopyAsRaw(el.dataset.id, name)
              : await App.cloud.fetchSnapshotById(el.dataset.id);
            if (state.snapTarget === 'current') {
              state.currentSnap = b;
              if (b.meta.period) { state.year = b.meta.period.year; state.quarter = b.meta.period.quarter; }
            } else {
              state.cmpSnap = b;
              state.cmp.on = true;
              if (b.meta.period) { state.cmp.year = b.meta.period.year; state.cmp.quarter = b.meta.period.quarter; }
            }
            closeCloudModal();
            rerender();
          } catch (err) { alert('載入雲端快照失敗：' + (err && err.message)); el.classList.remove('cloud-item--loading'); }
        });
      });
    } catch (err) {
      $('cloud-modal-body').innerHTML = `<div class="cloud-empty">讀取失敗：${err && err.message}</div>`;
    }
  }

  function bindEvents() {
    $('sel-current').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === '__snap__') return;
      if (v === '__load__') { renderControls(); openPicker('current'); return; }
      if (v === '__cloud__') { renderControls(); openCloudPicker('current'); return; }
      const p = state.periods.find((x) => x.code === v);
      if (p) { state.currentSnap = null; state.year = p.year; state.quarter = p.quarter; rerender(); }
    });
    $('sel-compare').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === '__snap__') return;
      if (v === '__load__') { renderControls(); openPicker('compare'); return; }
      if (v === '__cloud__') { renderControls(); openCloudPicker('compare'); return; }
      if (v === '__none__') { state.cmp.on = false; state.cmpSnap = null; rerender(); return; }
      const p = state.periods.find((x) => x.code === v);
      if (p) { state.cmpSnap = null; state.cmp = { on: true, year: p.year, quarter: p.quarter }; rerender(); }
    });
    $('btn-report').addEventListener('click', async () => {
      const btn = $('btn-report');
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = '生成中…';
      try {
        const r = await App.report.exportReport(state);
        reportCloudFeedback(r.cloud);
      } catch (err) { alert('生成報告失敗：' + (err && err.message)); }
      finally { btn.disabled = false; btn.textContent = orig; }
    });
    $('btn-export').addEventListener('click', async () => {
      const btn = $('btn-export');
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = (App.cloud && App.cloud.enabled()) ? '存入雲端中…' : '匯出中…（全量分頁，較大較慢）';
      try {
        if (state.currentSnap) {
          App.report.download(state.currentSnap);
        } else {
          const r = await App.report.exportSnapshot(state.raw, state.year, state.quarter);
          reportCloudFeedback(r.cloud);
        }
      } catch (err) { alert('匯出失敗：' + (err && err.message)); }
      finally { btn.disabled = false; btn.textContent = orig; }
    });
    $('snap-file').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const b = App.report.parseSnapshot(await f.text());
        const p = b.meta.period || { year: state.year, quarter: state.quarter };
        if (state.snapTarget === 'current') { state.currentSnap = b; state.year = p.year; state.quarter = p.quarter; }
        else { state.cmpSnap = b; state.cmp = { on: true, year: p.year, quarter: p.quarter }; }
        rerender();
      } catch (err) { alert('載入快照失敗：' + (err && err.message)); renderControls(); }
      e.target.value = '';
    });
    $('cloud-modal-close').addEventListener('click', closeCloudModal);
    $('cloud-modal').addEventListener('click', (e) => { if (e.target.id === 'cloud-modal') closeCloudModal(); });
  }

  async function init() {
    showStatus('<div class="spinner"></div><div>載入資料中…</div>');
    try {
      state.raw = await App.sheets.loadAll();
      state.onlineList = App.metrics.buildOnlineList(state.raw);
      buildPeriods();
      renderControls();
      bindEvents();
      rerender();
    } catch (err) {
      showStatus(
        `<div style="font-size:15px;font-weight:600;margin-bottom:8px;">無法載入資料</div>
         <div>${(err && err.message) ? err.message : '未知錯誤'}</div>
         <button class="btn" id="btn-retry">重試</button>`, true);
      const b = $('btn-retry'); if (b) b.addEventListener('click', init);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { state, rerender, fmt: { int: fmtInt, pct: fmtPct }, DEVICE_TABS, dataForDevice };
})();
