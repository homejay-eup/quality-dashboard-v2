/**
 * js/report.js — 全量原始分頁快照（匯出／解析，掛 App.report）
 *
 * 快照 = 全部原始分頁的完整內容（不篩選期間、不投影欄位：SQL_派工全18欄、
 * 回廠/維修/報廢全量歷史）＋四張對照表＋當下上線量。不管日後 CRM 是否清除舊資料、
 * 或判斷邏輯如何演進，快照都保留足夠原始素材可重新套用 transform/metrics 重算。
 *
 * bundle 結構與 App.sheets.loadAll() 相同的 key，故可直接當「合成 raw」餵給
 * App.transform.buildDetail / App.metrics.buildOnlineList。
 *
 * 2026-07-20 決策變更：原「期間原始資料包」（只存該期相關列＋投影欄位）因派工
 * 投影僅 8/18 欄、未來邏輯若需其餘欄位會缺料，改為此「全量原始分頁」版本。
 */
window.App = window.App || {};

App.report = (() => {
  const SNAP_TYPE = 'eup-quality-snapshot';
  const SNAP_VER = 2; // v2 = 全量原始分頁（v1 為期間篩選版，已棄用）

  /**
   * 建立全量快照 bundle：raw 的全部分頁直接收錄（不篩選、不投影），
   * 唯一例外是「派工」——loadAll() 抓的是 8 欄投影版，這裡另外全欄重抓一次。
   * @param {Object} raw - App.sheets.loadAll() 回傳值（用於除派工外的分頁）
   * @param {{year:number, quarter:number}} [periodHint] - 純記錄用途（標示製表當下期間），不影響內容篩選
   * @returns {Promise<Object>} bundle
   */
  async function buildBundle(raw, periodHint) {
    const 派工全欄 = await App.sheets.fetchFullDispatch();
    return {
      _type: SNAP_TYPE,
      _version: SNAP_VER,
      meta: {
        period: periodHint || null,
        exportedAt: new Date().toISOString(),
        counts: {
          派工: 派工全欄.length,
          回廠: (raw.回廠 || []).length,
          維修: (raw.維修 || []).length,
          報廢: (raw.報廢 || []).length,
          上線量: (raw.上線量 || []).length,
        },
      },
      派工: 派工全欄,
      回廠: raw.回廠 || [],
      維修: raw.維修 || [],
      報廢: raw.報廢 || [],
      上線量: raw.上線量 || [],
      類型清單: raw.類型清單 || [],
      品號對照表: raw.品號對照表 || [],
      關鍵字對照表: raw.關鍵字對照表 || [],
      維修分類: raw.維修分類 || [],
      年限門檻: raw.年限門檻 || [],
    };
  }

  function snapshotFilename(bundle) {
    const p = bundle.meta.period;
    const label = p ? `${p.year}-Q${p.quarter}` : '全量';
    const ts = String(bundle.meta.exportedAt || '').replace(/[:.]/g, '-').replace('T', '_').slice(0, 16);
    return `品質快照_${label}_${ts}.json`;
  }

  /** 匯出 bundle 成 JSON 本機下載。 */
  function download(bundle) {
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = snapshotFilename(bundle);
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /**
   * 建立快照。
   * - 已設定 App.cloud（CLOUD_ENDPOINT）：直接請 Apps Script 在 Google 內部複製來源 Sheet
   *   到共用資料夾（Drive 對 Drive，不經瀏覽器上傳，快、無檔案大小限制問題）。不建立本機 37MB+ JSON。
   * - 未設定雲端：退回本機 JSON 全量快照下載（含 fetchFullDispatch 全欄派工），供離線保存/日後載入比較。
   * @returns {Promise<{meta:Object, cloud:{ok:boolean, error?:string, name?:string}|null}>}
   */
  async function exportSnapshot(raw, year, quarter) {
    if (App.cloud && App.cloud.enabled()) {
      const label = `${year}-Q${quarter}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
      try {
        const r = await App.cloud.snapshotSheet(App.config.SHEET_ID, label);
        return { meta: { period: { year, quarter } }, cloud: { ok: true, name: r.name, id: r.id } };
      } catch (err) {
        return { meta: { period: { year, quarter } }, cloud: { ok: false, error: err && err.message } };
      }
    }
    const b = await buildBundle(raw, { year, quarter });
    download(b);
    return { meta: b.meta, cloud: null };
  }

  /** 解析快照 JSON 文字 → bundle（驗證型別）。bundle 可直接當合成 raw。 */
  function parseSnapshot(text) {
    let b;
    try { b = JSON.parse(text); } catch { throw new Error('檔案不是有效的 JSON'); }
    if (!b || b._type !== SNAP_TYPE) throw new Error('這不是有效的品質快照檔（_type 不符）');
    if (!b.meta || !b.meta.period) throw new Error('快照缺少 meta.period');
    return b;
  }

  // ────────────────────────────────────────────────────────────
  // 落地頁 HTML 報告 v2（比照協作者 report_draft_v2.html 的排版風格：
  // 頂部 tab 導覽＋卡片式排版，共 5 頁。資料/邏輯仍用本工具既有的
  // aggregate()/metrics.js/transform.js，只借排版與 CSS。）
  // ────────────────────────────────────────────────────────────
  const rInt = (v) => (Number(v) || 0).toLocaleString('en-US');
  // 大數字底下的中文萬/億小提示（僅供直覺參考，未達萬不顯示，避免小數字也硬湊）
  function bigNumHint(v) {
    const n = Number(v) || 0, abs = Math.abs(n);
    if (abs < 10000) return '';
    const unit = abs >= 100000000 ? 100000000 : 10000;
    const label = abs >= 100000000 ? '億' : '萬';
    const rounded = Math.round((n / unit) * 10) / 10;
    return `約 ${rounded}${label}`;
  }
  const rPct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
  const rYear = (v) => (v == null || v === '' ? '資料缺' : `${Number(v).toFixed(1)} 年`);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const PAL = ['#009688', '#26A69A', '#4DB6AC', '#1E88E5', '#1565C0', '#80CBC4', '#B2DFDB', '#E08E00', '#9AA0A6', '#EF5350'];

  // 季度在本工具是累加制（Q1=1–3月、Q2=1–6月、Q3=1–9月、Q4=1–12月），供期間文字換算月份範圍用
  const QUARTER_MONTH_RANGE = { 1: '1–3月', 2: '1–6月', 3: '1–9月', 4: '1–12月' };
  const rocYear = (y) => y - 1911;

  function periodText(state) {
    const monthRange = (q) => QUARTER_MONTH_RANGE[q] || '';
    const yearLabel = (y, snap) => `${rocYear(y)}年${snap ? '（快照）' : ''}`;
    if (!state.cmp.on) return `${yearLabel(state.year, state.currentSnap)}　${monthRange(state.quarter)}`;
    const curLabel = yearLabel(state.year, state.currentSnap);
    const cmpLabel = yearLabel(state.cmp.year, state.cmpSnap);
    if (state.quarter === state.cmp.quarter) return `${cmpLabel} vs ${curLabel}　${monthRange(state.quarter)}`;
    return `${cmpLabel}　${monthRange(state.cmp.quarter)} vs ${curLabel}　${monthRange(state.quarter)}`;
  }

  // ── 近 N 季序列（車機分析頁 用）─────────────────
  // 資料庫實際涵蓋幾季，這裡就吐幾季（state.currentPeriods 已由 app.js 依派工
  // 資料實際涵蓋到的月份算出，見 app.js buildPeriods），不寫死季數。
  function buildQuarterSeries(state, deviceKey) {
    const scope = deviceKey ? App.app.DEVICE_TABS.find((t) => t.key === deviceKey) : null;
    const periodsAsc = [...(state.currentPeriods || [])].reverse();
    const labels = [], 不良率 = [], 過保率 = [], 再使用率 = [], 整體不良率 = [], 整體過保率 = [], 整體再使用率 = [];
    const 不良品數Raw = [], 未歸類數Raw = [], 總線上量Raw = [];
    for (const p of periodsAsc) {
      let rows = App.transform.buildDetail(state.raw, { year: p.year, quarter: p.quarter }).rows;
      let online = state.onlineList || [];
      if (scope) {
        rows = rows.filter((r) => r.設備類型 === scope.設備類型 && r.維護原因 === scope.維護原因);
        online = online.filter((o) => o.設備類型 === scope.設備類型);
      }
      const sel = scope ? state.selectionByTab[scope.key] : state.selection;
      const kpi = App.metrics.computeKPI(rows, online, sel);
      labels.push(`${p.year}-Q${p.quarter}`);
      不良率.push(+(kpi.期間不良率 * 100).toFixed(1));
      過保率.push(+(kpi.期間過保率 * 100).toFixed(1));
      再使用率.push(+(kpi.再使用率 * 100).toFixed(1));
      整體不良率.push(+(kpi.整體不良率 * 100).toFixed(1));
      整體過保率.push(+(kpi.整體過保率 * 100).toFixed(1));
      整體再使用率.push(+(kpi.整體再使用率 * 100).toFixed(1));
      不良品數Raw.push(kpi.不良品數); 未歸類數Raw.push(kpi.未歸類數); 總線上量Raw.push(kpi.總線上量);
    }
    return { labels, 不良率, 過保率, 再使用率, 整體不良率, 整體過保率, 整體再使用率, 不良品數Raw, 未歸類數Raw, 總線上量Raw };
  }

  // ── 依機型／依廠商彙整（沿用 App.metrics.aggregate，不重寫彙整邏輯）───
  function aggByType(d, selection) { return App.metrics.aggregate(d.rows, d.online, selection, { groupBy: '類型' }); }
  function aggByVendor(d, selection) { return App.metrics.aggregate(d.rows, d.online, selection, { groupBy: '廠商' }); }

  // ── 合併車機＋鏡頭的整體 KPI（供整體總覽／同期比較頁用）──────────────
  function combineKPI(a, b) {
    const 回廠量 = (a.期間回廠量 || 0) + (b.期間回廠量 || 0);
    const 良品數 = (a.良品數 || 0) + (b.良品數 || 0);
    const 不良品數 = (a.不良品數 || 0) + (b.不良品數 || 0);
    const 過保數 = (a.過保數 || 0) + (b.過保數 || 0);
    const 總線上量 = (a.總線上量 || 0) + (b.總線上量 || 0);
    const safeDiv = (n, d) => (d ? n / d : 0);
    return {
      期間回廠量: 回廠量, 良品數, 不良品數, 過保數, 總線上量,
      再使用率: safeDiv(良品數, 回廠量),
      期間不良率: safeDiv(不良品數, 回廠量),
      期間過保率: safeDiv(過保數, 回廠量),
      整體不良率: safeDiv(不良品數, 總線上量),
      整體過保率: safeDiv(過保數, 總線上量),
    };
  }

  // ── KPI delta（沿用現有 report.js 的顯示邏輯：漲跌顏色＋pp/絕對值）───
  function kpiDeltaHTML(cur, prev, fmt, better) {
    if (prev == null) return '';
    if (fmt === 'pct') {
      const pp = (cur - prev) * 100;
      const cls = Math.abs(pp) < 0.05 ? 'flat' : (better == null ? 'flat' : (((pp > 0) === better) ? 'good' : 'bad'));
      return `<div class="d d-${cls}">${pp >= 0 ? '▲ +' : '▼ '}${pp.toFixed(1)}pp</div>`;
    }
    const diff = cur - prev;
    const cls = diff === 0 ? 'flat' : (better == null ? 'flat' : (((diff > 0) === better) ? 'good' : 'bad'));
    return `<div class="d d-${cls}">${diff >= 0 ? '▲ +' : '▼ '}${rInt(diff)}</div>`;
  }
  function kcard(label, val, deltaHTML, tone, rawNum) {
    const hint = rawNum != null ? bigNumHint(rawNum) : '';
    return `<div class="kcard${tone ? ` ${tone}` : ''}"><div class="l">${esc(label)}</div><div class="v">${val}</div>${hint ? `<div class="vhint">${hint}</div>` : ''}${deltaHTML || ''}</div>`;
  }

  // 整體不良率 KPI 卡：數值／漲跌都改成可跟「未歸類數併入不良品數」開關連動的 uc-rate／uc-delta
  function kcardUncatRate(label, kpi, cmpKpi, hasCmp) {
    const bad = kpi.不良品數, uncat = kpi.未歸類數 || 0, den = kpi.總線上量;
    const valHTML = `<span class="uc-rate" data-bad="${bad}" data-uncat="${uncat}" data-den="${den}">${rPct(kpi.整體不良率)}</span>`;
    let deltaHTML = '';
    if (hasCmp && cmpKpi) {
      const cbad = cmpKpi.不良品數, cuncat = cmpKpi.未歸類數 || 0, cden = cmpKpi.總線上量;
      const pp = (kpi.整體不良率 - cmpKpi.整體不良率) * 100;
      const cls = Math.abs(pp) < 0.05 ? 'flat' : (pp > 0 ? 'bad' : 'good');
      deltaHTML = `<div class="d d-${cls} uc-delta" data-bad="${bad}" data-uncat="${uncat}" data-den="${den}" data-cbad="${cbad}" data-cuncat="${cuncat}" data-cden="${cden}" data-better="false">${pp >= 0 ? '▲ +' : '▼ '}${pp.toFixed(1)}pp</div>`;
    }
    return `<div class="kcard good"><div class="l">${esc(label)}</div><div class="v">${valHTML}</div>${deltaHTML}</div>`;
  }

  // 可編輯的核心發現／建議區塊：文字放進 textarea，供瀏覽時直接調整/複製
  function adviceCalloutHTML(id, title, bullets, tone) {
    if (!bullets.length) return '';
    return `<div class="callout ${tone || 'good'}"><p class="big-quote">${esc(title)}</p><textarea class="advice-edit" id="${id}">${esc(bullets.join('\n'))}</textarea></div>`;
  }

  // ════════════════════════════════════════════════════════════
  // 1. 整體總覽
  // ════════════════════════════════════════════════════════════
  const rDiff = (v) => (v > 0 ? `+${rInt(v)}` : rInt(v));

  // 預期使用年限基準（車機3年／鏡頭1年），供分析與說明判斷「多用了多久、划不划算」
  const EXPECTED_LIFE_YEARS = { 車機: 3, 鏡頭: 1 };

  // 整體總覽「分析與說明」：給主管看的精簡結論——先講結論，再講重點機型與汰換建議，控制在4行內
  // 整體總覽最下方「分析與說明」：聚焦解釋正上方「過保率／不良率（月度同期比較）」兩張圖（車機＋鏡頭），
  // 簡單講清楚本期月均與去年同期相比是升是降即可，不重複其他區塊已有的機型排名／使用年限資訊
  function overviewFindingsHTML(carQoY, lensQoY) {
    const avg = (arr) => (arr && arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
    const qoyLine = (deviceLabel, qoy) => {
      const parts = ['過保率', '不良率'].map((key) => {
        const curAvg = avg(qoy.cur[key]);
        if (!qoy.cmp) return `${key}本期月均 ${curAvg.toFixed(1)}%`;
        const cmpAvg = avg(qoy.cmp[key]);
        const diff = curAvg - cmpAvg;
        const dir = Math.abs(diff) < 0.05 ? '與去年同期持平' : (diff < 0 ? `較去年同期降低 ${Math.abs(diff).toFixed(1)}pp` : `較去年同期升高 ${diff.toFixed(1)}pp`);
        return `${key}本期月均 ${curAvg.toFixed(1)}%，${dir}`;
      });
      return `${deviceLabel}：${parts.join('；')}。`;
    };
    return [qoyLine('車機', carQoY), qoyLine('鏡頭', lensQoY)];
  }


  // 過保／不良品依機型排名表：前三名粗體＋底色標示
  function rankTableHTML(groups, countKey, ucScope) {
    const total = groups.reduce((sum, g) => sum + g.subtotal[countKey], 0);
    const rows = groups.map((g, i) => {
      const count = g.subtotal[countKey];
      const pct = total ? count / total : 0;
      const top3 = i < 3;
      const uncat = g.subtotal.未歸類數 || 0;
      const countCell = ucScope
        ? `<span class="uc-bad" data-scope="${ucScope}" data-bad="${count}" data-uncat="${uncat}">${rInt(count)}</span>`
        : rInt(count);
      const pctCell = ucScope
        ? `<span class="uc-share" data-scope="${ucScope}" data-bad="${count}" data-uncat="${uncat}">${rPct(pct)}</span>`
        : rPct(pct);
      return `<tr class="${top3 ? 'rank-top3' : ''}">
        <td class="l">${esc(g.key)}</td>
        <td class="num">${countCell}</td><td class="num">${pctCell}</td></tr>`;
    }).join('');
    return `<div class="twrap"><div class="scroll scroll--full">
      <table class="agg ranktable">
        <thead><tr><th class="l">機型</th><th class="num">數量</th><th class="num">占比</th></tr></thead>
        <tbody>${rows || `<tr><td class="l" colspan="3">本期無資料</td></tr>`}</tbody>
      </table>
    </div></div>`;
  }

  // 單一設備類型（車機／鏡頭）「回廠量分析」＋「過保／不良品」的分析與說明：
  // 整體不良率／過保率、不良品與過保占比前三名機型、平均已使用年限 vs 預期使用年限，最後一句總結。
  function deviceQualityFindingsHTML(deviceKey, gt, scrGroups, badGroups) {
    const bullets = [];
    bullets.push(`本期${deviceKey}回廠 ${rInt(gt.回廠量)} 台，其中不良品 ${rInt(gt.不良品數)} 台、過保 ${rInt(gt.過保數)} 台；以總上線量 ${rInt(gt.上線量)} 台為基準，整體不良率 ${rPct(gt.整體不良率)}、整體過保率 ${rPct(gt.整體過保率)}。`);

    const totalBad = badGroups.reduce((s, g) => s + g.subtotal.不良品數, 0);
    const totalWarr = scrGroups.reduce((s, g) => s + g.subtotal.過保數, 0);
    const badTop3 = badGroups.slice(0, 3).map((g) => `${g.key}（${rPct(totalBad ? g.subtotal.不良品數 / totalBad : 0)}）`);
    const warrTop3 = scrGroups.slice(0, 3).map((g) => `${g.key}（${rPct(totalWarr ? g.subtotal.過保數 / totalWarr : 0)}）`);
    if (badTop3.length) bullets.push(`不良品以 ${badTop3.join('、')} 為主。`);
    if (warrTop3.length) bullets.push(`過保以 ${warrTop3.join('、')} 為主。`);

    // 良品（可再循環使用）占比：回廠量扣除不良品與過保後即為檢測良品，優先呈現「大部分設備狀況良好」
    const goodQty = gt.回廠量 - gt.不良品數 - gt.過保數;
    const goodRate = gt.回廠量 ? goodQty / gt.回廠量 : 0;
    const baseline = EXPECTED_LIFE_YEARS[deviceKey];
    let ageNote = '';
    if (gt.已使用年限 != null && baseline != null) {
      const diff = gt.已使用年限 - baseline;
      ageNote = diff > 0
        ? `（平均已使用 ${gt.已使用年限.toFixed(1)} 年，超出預期使用年限 ${diff.toFixed(1)} 年，屬於延壽使用）`
        : diff < 0
          ? `（平均已使用 ${gt.已使用年限.toFixed(1)} 年，距預期使用年限尚有 ${Math.abs(diff).toFixed(1)} 年）`
          : `（平均已使用 ${gt.已使用年限.toFixed(1)} 年，恰好達預期使用年限）`;
    }
    bullets.push(`本期回廠中檢測良品（可再循環使用，整新＋送修）共 ${rInt(goodQty)} 台，占回廠量約 ${rPct(goodRate)}；其餘為不良或過保機型${ageNote}，代表現有設備已充分發揮使用效益，汰換划算。`);

    const badLeader = badTop3[0] ? badTop3[0].split('（')[0] : null;
    bullets.push(`總結：${deviceKey}不良率僅佔總上線量 ${rPct(gt.整體不良率)}，整體品質穩定良好${badLeader ? `，主要落在 ${badLeader}` : ''}。`);

    return bullets;
  }

  // 車機回廠量分析表列序：一般定位／影像機型各自依指定順序排最前面，方便同分類機型互相比對；
  // 未列在這兩組的機型（少量／未分類）維持原本「回廠量由大到小」排序，接在後面（2026-07-28 使用者裁決）
  const CAR_RANK_ORDER_GENERAL = ['S168', 'MT99', 'GO-168', 'EDR-168'];
  const CAR_RANK_ORDER_IMAGING = ['FUHO 4CH', 'FUHO 8CH', 'F6N', 'C43'];
  const CAR_RANK_ORDER_INDEX = Object.fromEntries([...CAR_RANK_ORDER_GENERAL, ...CAR_RANK_ORDER_IMAGING].map((k, i) => [k, i]));

  function deviceTypeSectionHTML(deviceKey, icon, d, selection, chartId) {
    const agg = aggByType(d, selection);
    if (deviceKey === '車機') {
      agg.groups = [...agg.groups].sort((a, b) => {
        const ai = CAR_RANK_ORDER_INDEX[a.key], bi = CAR_RANK_ORDER_INDEX[b.key];
        if (ai != null && bi != null) return ai - bi;
        if (ai != null) return -1;
        if (bi != null) return 1;
        return b.subtotal.回廠量 - a.subtotal.回廠量;
      });
    } else {
      agg.groups = [...agg.groups].sort((a, b) => b.subtotal.回廠量 - a.subtotal.回廠量); // 比照 draft：依回廠量由大到小
    }
    const ucBad = (s) => `<span class="uc-bad" data-bad="${s.不良品數}" data-uncat="${s.未歸類數 || 0}">${rInt(s.不良品數)}</span>`;
    const ucBadRate = (s) => `<span class="uc-rate" data-bad="${s.不良品數}" data-uncat="${s.未歸類數 || 0}" data-den="${s.回廠量}">${rPct(s.不良率)}</span>`;
    const ucOverallRate = (s) => `<span class="uc-rate" data-bad="${s.不良品數}" data-uncat="${s.未歸類數 || 0}" data-den="${s.上線量}">${rPct(s.整體不良率)}</span>`;
    const ucUncat = (s) => `<span class="uc-uncat" data-uncat="${s.未歸類數 || 0}">${rInt(s.未歸類數)}</span>`;
    const ucUncatRate = (s) => `<span class="uc-uncat-rate" data-uncat="${s.未歸類數 || 0}" data-den="${s.回廠量}">${rPct(s.未歸類率)}</span>`;
    const rows = agg.groups.map((g) => {
      const s = g.subtotal;
      return `<tr><td class="l">${esc(g.key)}</td><td>${rInt(s.上線量)}</td><td>${rInt(s.回廠量)}</td>
        <td>${rInt(s.良品數)}<span class="colRate">（${rPct(s.再使用率)}）</span></td><td>${ucBad(s)}<span class="colRate">（${ucBadRate(s)}）</span></td>
        <td>${rInt(s.過保數)}<span class="colRate">（${rPct(s.過保率)}）</span></td>
        <td class="hl">${ucOverallRate(s)}</td><td class="hl2">${rPct(s.整體過保率)}</td><td class="hl3">${rYear(s.已使用年限)}</td>
        <td class="colUncat">${ucUncat(s)}<span class="colRate">（${ucUncatRate(s)}）</span></td></tr>`;
    }).join('');
    const gt = agg.grandTotal;
    const donutLabels = agg.groups.map((g) => g.key);
    const donutData = agg.groups.map((g) => g.subtotal.回廠量);

    // 當季過保／不良品依機型占比（供兩張圓餅圖用，各自依該指標由大到小排序、濾掉 0）
    const scrGroups = [...agg.groups].filter((g) => g.subtotal.過保數 > 0).sort((a, b) => b.subtotal.過保數 - a.subtotal.過保數);
    const badGroups = [...agg.groups].filter((g) => g.subtotal.不良品數 > 0).sort((a, b) => b.subtotal.不良品數 - a.subtotal.不良品數);
    const scrChartId = `${chartId}-scr`, badChartId = `${chartId}-bad`;

    return {
      html: `<div class="sech sech-lg">${icon} 回廠量分析（${esc(deviceKey)}）</div>
      <div class="card">
        <div class="chead"><div class="chead-top"><div class="ct">${esc(deviceKey)}</div>
          <div class="toggle-group">
            <label class="uncat-toggle" title="顯示良品/不良品/過保比率"><input type="checkbox" onchange="this.closest('.card').classList.toggle('show-rate',this.checked)"><span class="uncat-icon">%</span></label>
            <label class="uncat-toggle" title="顯示未歸類數"><input type="checkbox" onchange="this.closest('.card').classList.toggle('show-uncat',this.checked)"><span class="uncat-icon">▦</span></label>
            <label class="uncat-toggle uc-merge-toggle" title="未歸類數併入不良品數"><input type="checkbox" class="uc-merge-checkbox" checked><span class="uncat-icon">⊕</span></label>
          </div>
        </div></div>
        <div class="rlayout3">
          <div class="legendgrid">${agg.groups.map((g, i) => `<div class="litem"><span class="dot" style="background:${PAL[i % PAL.length]}"></span>${esc(g.key)}</div>`).join('')}</div>
          <div><div class="donutbox"><canvas id="${chartId}"></canvas></div>
            <div class="donutlegend">${esc(deviceKey)}　｜　總上線量 ${rInt(gt.上線量)}</div></div>
          <div class="twrap"><div class="scroll scroll--full">
            <table class="rtable">
              <thead><tr><th rowspan="2">機型</th><th rowspan="2">上線量</th><th colspan="4">回廠量</th><th rowspan="2">整體不良率</th><th rowspan="2">整體過保率</th><th rowspan="2">平均已使用年限</th><th rowspan="2" class="colUncat">未歸類數</th></tr>
              <tr><th>回廠量</th><th>良品數(再使用)</th><th>不良品數</th><th>過保數</th></tr></thead>
              <tbody>${rows}
                <tr class="grand"><td class="l">總計</td><td>${rInt(gt.上線量)}</td><td>${rInt(gt.回廠量)}</td>
                  <td>${rInt(gt.良品數)}<span class="colRate">（${rPct(gt.再使用率)}）</span></td><td>${ucBad(gt)}<span class="colRate">（${ucBadRate(gt)}）</span></td>
                  <td>${rInt(gt.過保數)}<span class="colRate">（${rPct(gt.過保率)}）</span></td>
                  <td class="hl">${ucOverallRate(gt)}</td><td class="hl2">${rPct(gt.整體過保率)}</td><td class="hl3">${rYear(gt.已使用年限)}</td>
                  <td class="colUncat">${ucUncat(gt)}<span class="colRate">（${ucUncatRate(gt)}）</span></td></tr>
              </tbody>
            </table>
          </div></div>
        </div>
      </div>
      <div class="card">
        <div class="chead"><div class="ct">過保／不良品（${esc(deviceKey)}）</div><div class="cs">當季，各自依數量由大到小排序</div></div>
        <div class="g2-eq">
          <div class="rlayout3">
            <div class="legendgrid">${scrGroups.map((g, i) => `<div class="litem"><span class="dot" style="background:${PAL[i % PAL.length]}"></span>${esc(g.key)}</div>`).join('')}</div>
            <div class="chartbox pie"><canvas id="${scrChartId}"></canvas></div>
            ${rankTableHTML(scrGroups, '過保數')}
          </div>
          <div class="rlayout3">
            <div class="legendgrid">${badGroups.map((g, i) => `<div class="litem"><span class="dot" style="background:${PAL[i % PAL.length]}"></span>${esc(g.key)}</div>`).join('')}</div>
            <div class="chartbox pie"><canvas id="${badChartId}"></canvas></div>
            ${rankTableHTML(badGroups, '不良品數', `${badChartId}-rank`)}
          </div>
        </div>
      </div>
      ${adviceCalloutHTML(`advice-${chartId}`, `分析與說明（${esc(deviceKey)}）`, deviceQualityFindingsHTML(deviceKey, gt, scrGroups, badGroups), gt.整體不良率 >= 0.03 ? 'bad' : gt.整體不良率 >= 0.01 ? 'warn' : 'good')}`,
      chartScript: `new Chart(document.getElementById('${chartId}'),{type:'doughnut',
        data:{labels:${JSON.stringify(donutLabels)},datasets:[{data:${JSON.stringify(donutData)},backgroundColor:PAL,borderColor:'#fff',borderWidth:1}]},
        options:{maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false}}}});
      new Chart(document.getElementById('${scrChartId}'),{type:'pie',
        data:{labels:${JSON.stringify(scrGroups.map((g) => g.key))},datasets:[{data:${JSON.stringify(scrGroups.map((g) => g.subtotal.過保數))},backgroundColor:PAL,borderColor:'#fff',borderWidth:1}]},
        options:{maintainAspectRatio:false,plugins:{legend:{display:false},title:{display:true,text:'過保設備占比'}}}});
      new Chart(document.getElementById('${badChartId}'),{type:'pie',
        data:{labels:${JSON.stringify(badGroups.map((g) => g.key))},datasets:[{data:${JSON.stringify(badGroups.map((g) => g.subtotal.不良品數))},backgroundColor:PAL,borderColor:'#fff',borderWidth:1}]},
        options:{maintainAspectRatio:false,plugins:{legend:{display:false},title:{display:true,text:'不良品設備占比'}}}});
      window.__ucCharts=window.__ucCharts||[];
      window.__ucCharts.push({id:'${badChartId}',bad:${JSON.stringify(badGroups.map((g) => g.subtotal.不良品數))},uncat:${JSON.stringify(badGroups.map((g) => g.subtotal.未歸類數 || 0))}});`,
    };
  }

  function trendChartSectionHTML(deviceKey, trend, chartId) {
    return {
      html: `<div class="card">
        <div class="chead"><div class="ct">過保率／不良率／再使用率</div><div class="cs"><span class="trend-device">${esc(deviceKey)}</span>　｜　${trend.labels[0] || ''} ～ ${trend.labels[trend.labels.length - 1] || ''}</div></div>
        <div class="chartbox"><canvas id="${chartId}"></canvas></div>
      </div>`,
      chartScript: `new Chart(document.getElementById('${chartId}'),{type:'line',
        data:{labels:${JSON.stringify(trend.labels)},datasets:[
          {label:'過保率%',data:${JSON.stringify(trend.整體過保率)},borderColor:AMBER,backgroundColor:'rgba(224,142,0,.1)',fill:true,tension:.3,pointRadius:3,yAxisID:'y1'},
          {label:'不良率%',data:${JSON.stringify(trend.整體不良率)},borderColor:RED,fill:false,tension:.3,pointRadius:3,yAxisID:'y1'},
          {label:'再使用率%',data:${JSON.stringify(trend.再使用率)},borderColor:TREND,fill:false,tension:.3,pointRadius:3,yAxisID:'y'}
        ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'top'}},
          scales:{
            y:{beginAtZero:true,position:'left',ticks:{callback:v=>v+'%'}},
            y1:{beginAtZero:true,position:'right',grid:{drawOnChartArea:false},ticks:{callback:v=>v+'%'}}
          }}});
      window.__ucLineCharts=window.__ucLineCharts||[];
      window.__ucLineCharts.push({id:'${chartId}',dsIndex:1,bad:${JSON.stringify(trend.不良品數Raw)},uncat:${JSON.stringify(trend.未歸類數Raw)},den:${JSON.stringify(trend.總線上量Raw)}});`,
    };
  }

  // ── 過保率／不良率／再使用率 月度同期比較（本期 vs 去年同期），X軸1~quarter*3月 ──
  function buildQualityMonthlySeries(ctx, deviceKey) {
    const { state, hasCmp } = ctx;
    const scope = App.app.DEVICE_TABS.find((t) => t.key === deviceKey);
    const monthOf = (ym) => parseInt(String(ym || '').split('-')[1], 10) || null;
    const buildForPeriod = (year, quarter) => {
      const monthCount = periodMonths(quarter);
      const allRows = App.transform.buildDetail(state.raw, { year, quarter }).rows;
      const online = (state.onlineList || []).filter((o) => o.設備類型 === scope.設備類型);
      const rowsScoped = allRows.filter((r) => r.設備類型 === scope.設備類型 && r.維護原因 === scope.維護原因);
      const sel = state.selectionByTab[deviceKey];
      const 過保率 = [], 不良率 = [], 再使用率 = [], 不良品數Raw = [], 未歸類數Raw = [], 總線上量Raw = [];
      for (let m = 1; m <= monthCount; m++) {
        const rowsM = rowsScoped.filter((r) => monthOf(r.年月) === m);
        const kpi = App.metrics.computeKPI(rowsM, online, sel);
        過保率.push(+(kpi.整體過保率 * 100).toFixed(1));
        不良率.push(+(kpi.整體不良率 * 100).toFixed(1));
        再使用率.push(+(kpi.再使用率 * 100).toFixed(1));
        不良品數Raw.push(kpi.不良品數); 未歸類數Raw.push(kpi.未歸類數); 總線上量Raw.push(kpi.總線上量);
      }
      return { monthCount, 過保率, 不良率, 再使用率, 不良品數Raw, 未歸類數Raw, 總線上量Raw };
    };
    const cur = buildForPeriod(state.year, state.quarter);
    const cmp = hasCmp ? buildForPeriod(state.cmp.year, state.cmp.quarter) : null;
    const monthCount = Math.max(cur.monthCount, cmp ? cmp.monthCount : 0);
    const months = Array.from({ length: monthCount }, (_, i) => i + 1);
    return { months, curLabel: `${state.year}年`, cmpLabel: cmp ? `${state.cmp.year}年（同期）` : null, cur, cmp };
  }

  function qoyTrendChartSectionHTML(deviceKey, qseries, chartId) {
    const monthLabels = qseries.months.map((m) => `${m}月`);
    const pad = (arr, n) => { const a = (arr || []).slice(); while (a.length < n) a.push(null); return a; };
    const n = qseries.months.length;
    const curLabel = esc(qseries.curLabel), cmpLabel = qseries.cmp ? esc(qseries.cmpLabel) : null;
    const metrics = [
      { key: '過保率', color: 'AMBER', id: `${chartId}-scr` },
      { key: '不良率', color: 'RED', id: `${chartId}-bad` },
      // 再使用率預設隱藏，靠「顯示再使用率（月度同期比較）」按鈕切換（見 overviewPageHTML）
      { key: '再使用率', color: 'TREND', id: `${chartId}-reuse`, hidden: true },
    ];
    const panels = metrics.map((m) => `<div class="${m.hidden ? 'qoy-reuse-panel' : ''}"${m.hidden ? ' style="display:none"' : ''}><div class="mini-title">${esc(m.key)}</div><div class="chartbox sm"><canvas id="${m.id}"></canvas></div></div>`).join('');
    const chartCalls = metrics.map((m) => {
      const curData = JSON.stringify(pad(qseries.cur[m.key], n));
      const cmpDs = qseries.cmp ? `,{label:'${cmpLabel}',data:${JSON.stringify(pad(qseries.cmp[m.key], n))},borderColor:${m.color},borderDash:[5,4],fill:false,tension:.3,pointRadius:3}` : '';
      let ucReg = '';
      if (m.key === '不良率') {
        ucReg = `window.__ucLineCharts=window.__ucLineCharts||[];
        window.__ucLineCharts.push({id:'${m.id}',dsIndex:0,bad:${JSON.stringify(pad(qseries.cur.不良品數Raw, n))},uncat:${JSON.stringify(pad(qseries.cur.未歸類數Raw, n))},den:${JSON.stringify(pad(qseries.cur.總線上量Raw, n))}});`;
        if (qseries.cmp) {
          ucReg += `\n        window.__ucLineCharts.push({id:'${m.id}',dsIndex:1,bad:${JSON.stringify(pad(qseries.cmp.不良品數Raw, n))},uncat:${JSON.stringify(pad(qseries.cmp.未歸類數Raw, n))},den:${JSON.stringify(pad(qseries.cmp.總線上量Raw, n))}});`;
        }
      }
      return `new Chart(document.getElementById('${m.id}'),{type:'line',
        data:{labels:${JSON.stringify(monthLabels)},datasets:[
          {label:'${curLabel}',data:${curData},borderColor:${m.color},backgroundColor:${m.color}_BG,fill:true,tension:.3,pointRadius:3}${cmpDs}
        ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{boxWidth:10}}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}}});
      ${ucReg}`;
    }).join('\n      ');
    return {
      html: `<div class="card">
        <div class="chead"><div class="ct">過保率／不良率<span class="qoy-reuse-title-suffix" style="display:none">／再使用率</span>（月度同期比較）</div><div class="cs"><span class="trend-device">${esc(deviceKey)}</span>　｜　1～${n}月，${curLabel}${cmpLabel ? `　vs　${cmpLabel}` : ''}</div></div>
        <div class="g3">${panels}</div>
      </div>`,
      chartScript: chartCalls,
    };
  }

  function overviewPageHTML(ctx) {
    const { car, lens, carSelection, lensSelection } = ctx;
    const combined = combineKPI(car.kpi, lens.kpi);
    const combinedCmp = (ctx.hasCmp && car.cmpKpi && lens.cmpKpi) ? combineKPI(car.cmpKpi, lens.cmpKpi) : null;
    const carSec = deviceTypeSectionHTML('車機', App.icons.car(), car, carSelection, 'ov-donut-car');
    const lensSec = deviceTypeSectionHTML('鏡頭', App.icons.camera(), lens, lensSelection, 'ov-donut-lens');
    const carTrend = buildQuarterSeries(ctx.state, '車機');
    const lensTrend = buildQuarterSeries(ctx.state, '鏡頭');
    const carTrendSec = trendChartSectionHTML('車機', carTrend, 'ov-trend-car');
    const lensTrendSec = trendChartSectionHTML('鏡頭', lensTrend, 'ov-trend-lens');
    const carQoY = buildQualityMonthlySeries(ctx, '車機');
    const lensQoY = buildQualityMonthlySeries(ctx, '鏡頭');
    const carQoYSec = qoyTrendChartSectionHTML('車機', carQoY, 'ov-qoy-car');
    const lensQoYSec = qoyTrendChartSectionHTML('鏡頭', lensQoY, 'ov-qoy-lens');
    const findings = overviewFindingsHTML(carQoY, lensQoY);
    const tone = combined.整體不良率 >= 0.03 ? 'bad' : combined.整體不良率 >= 0.01 ? 'warn' : 'good';

    return {
      html: `<section class="page on" id="page-overview">
        <div class="ph"><div><span class="ph-l">${App.icons.pin()} 整體總覽</span><span class="ph-s">車機＋鏡頭　｜　期間：${esc(periodText(ctx.state))}</span></div></div>
        <details class="lowkey-toggle">
          <summary>${App.icons.book()} 分析流程與品質分析範圍</summary>
          <div class="lowkey-toggle-body">
            <div class="flow">
              <div class="flow-step">${App.icons.clipboard()} 派工</div><div class="flow-arrow">→</div>
              <div class="flow-step">${App.icons.inbox()} 回廠</div><div class="flow-arrow">→</div>
              <div class="flow-step">${App.icons.wrench()} 維修</div><div class="flow-arrow">→</div>
              <div class="flow-step">${App.icons.trash()} 報廢</div>
            </div>
            <p class="note" style="text-align:center;margin-top:10px">全部分析皆以「期間內」的派工→回廠→維修→報廢 完整處理鏈為基礎。</p>
            <div class="twrap" style="margin-top:14px"><table class="agg">
              <thead><tr><th class="l">項目</th><th class="l">${App.icons.car()} 車機</th><th class="l">${App.icons.camera()} 鏡頭</th></tr></thead>
              <tbody>
                <tr><td class="l">維護原因</td><td class="l">訊號異常</td><td class="l">影像異常(鏡頭)</td></tr>
                <tr><td class="l">故障原因</td><td class="l">AB點、失聯、定位異常、訊號異常</td><td class="l">黑畫面、進水/模糊、水波紋、時有時無</td></tr>
              </tbody>
            </table></div>
          </div>
        </details>
        <div class="sech">整體數值 · 車機</div>
        <div class="krow">
          ${kcard('車機線上量', rInt(car.kpi.總線上量), '', '', car.kpi.總線上量)}
          ${kcard('車機期間回廠量', rInt(car.kpi.期間回廠量), '', '', car.kpi.期間回廠量)}
          ${kcardUncatRate('車機整體不良率', car.kpi, car.cmpKpi, ctx.hasCmp)}
          ${kcard('車機整體過保率', rPct(car.kpi.整體過保率), ctx.hasCmp ? kpiDeltaHTML(car.kpi.整體過保率, car.cmpKpi.整體過保率, 'pct', false) : '', 'good')}
        </div>
        <div class="sech">整體數值 · 鏡頭</div>
        <div class="krow">
          ${kcard('鏡頭線上量', rInt(lens.kpi.總線上量), '', '', lens.kpi.總線上量)}
          ${kcard('鏡頭期間回廠量', rInt(lens.kpi.期間回廠量), '', '', lens.kpi.期間回廠量)}
          ${kcardUncatRate('鏡頭整體不良率', lens.kpi, lens.cmpKpi, ctx.hasCmp)}
          ${kcard('鏡頭整體過保率', rPct(lens.kpi.整體過保率), ctx.hasCmp ? kpiDeltaHTML(lens.kpi.整體過保率, lens.cmpKpi.整體過保率, 'pct', false) : '', 'good')}
        </div>
        ${carSec.html}
        ${lensSec.html}
        <div class="g2-eq">
          ${carQoYSec.html}
          ${lensQoYSec.html}
        </div>
        <button type="button" class="lowkey-btn icon-collapse" id="qoy-reuse-toggle" title="顯示再使用率（月度同期比較）">${App.icons.chart()}<span class="lowkey-toggle-text">顯示再使用率（月度同期比較）</span></button>
        <details class="lowkey-toggle icon-collapse">
          <summary title="顯示過保率／不良率／再使用率趨勢圖（車機＋鏡頭）">${App.icons.chart()}<span class="lowkey-toggle-text">顯示過保率／不良率／再使用率趨勢圖（車機＋鏡頭）</span></summary>
          <div class="lowkey-toggle-body">
            <div class="g2-eq">
              ${carTrendSec.html}
              ${lensTrendSec.html}
            </div>
          </div>
        </details>
        ${adviceCalloutHTML('advice-overview', '分析與說明', findings, tone)}
      </section>`,
      chartScript: `
        ${carTrendSec.chartScript}
        ${lensTrendSec.chartScript}
        ${carQoYSec.chartScript}
        ${lensQoYSec.chartScript}
        ${carSec.chartScript}
        ${lensSec.chartScript}
        (function(){
          var btn=document.getElementById('qoy-reuse-toggle');
          if(!btn)return;
          var on=false;
          var textEl=btn.querySelector('.lowkey-toggle-text');
          btn.addEventListener('click',function(){
            on=!on;
            document.querySelectorAll('.qoy-reuse-panel').forEach(function(el){
              el.style.display=on?'':'none';
              if(on){ var c=Chart.getChart(el.querySelector('canvas')); if(c)c.resize(); }
            });
            document.querySelectorAll('.qoy-reuse-title-suffix').forEach(function(el){ el.style.display=on?'inline':'none'; });
            btn.classList.toggle('is-on',on);
            var label=on?'隱藏再使用率（月度同期比較）':'顯示再使用率（月度同期比較）';
            textEl.textContent=label; btn.title=label;
          });
        })();`,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 3. 再使用率（內部檢測數量／省下的成本／送修運費）
  // ════════════════════════════════════════════════════════════
  const SHIP_COST_PER_TRIP = 300, SHIP_TRIPS_PER_WEEK = 2, SHIP_WEEKS_PER_MONTH = 4;
  function periodMonths(quarter) { return quarter * 3; }
  function shippingCost(months) { return SHIP_COST_PER_TRIP * SHIP_TRIPS_PER_WEEK * SHIP_WEEKS_PER_MONTH * months; }

  // 車機機型分類預設（可於報告內用 checkbox 彈性調整，未勾選視為未分類、不計入省下的成本）
  const CAR_GENERAL_MODELS_DEFAULT = ['S168', 'EDR-168', 'GO-168', 'MT99'];
  const CAR_IMAGING_MODELS_DEFAULT = ['FUHO 8CH', 'HS', 'FUHO 4CH', 'C43', 'F6N'];

  // ── 使用率頁「省下的成本」月度序列：本期＋去年同期（依 state.cmp）各月車機機型內部檢測數(回廠QC)＋鏡頭內部檢測數 ──
  // 「季度」在本工具是累積制（Q2＝1~6月、Q3＝1~9月），buildDetail(year,quarter) 本身就回傳該範圍全部列，
  // 這裡再依每列自己的 年月 欄位（YYYY-MM）拆回單月，取得逐月數字。
  // 分類（一般定位／影像）在瀏覽器端依當下 checkbox 狀態即時加總，故這裡吐出「依機型」的原始數，不預先分類。
  function buildUsageMonthlySeries(ctx) {
    const { state, hasCmp } = ctx;
    const carScope = App.app.DEVICE_TABS.find((t) => t.key === '車機');
    const lensScope = App.app.DEVICE_TABS.find((t) => t.key === '鏡頭');

    const monthOf = (ym) => parseInt(String(ym || '').split('-')[1], 10) || null;

    const buildForPeriod = (year, quarter) => {
      const monthCount = periodMonths(quarter);
      const allRows = App.transform.buildDetail(state.raw, { year, quarter }).rows;
      const online = state.onlineList || [];
      const carRowsAll = allRows.filter((r) => r.設備類型 === carScope.設備類型 && r.維護原因 === carScope.維護原因);
      const carOnline = online.filter((o) => o.設備類型 === carScope.設備類型);
      const lensRowsAll = allRows.filter((r) => r.設備類型 === lensScope.設備類型 && r.維護原因 === lensScope.維護原因);
      const lensOnline = online.filter((o) => o.設備類型 === lensScope.設備類型);
      const carModelQCByMonth = [], lensQCByMonth = [];
      for (let m = 1; m <= monthCount; m++) {
        const carRowsM = carRowsAll.filter((r) => monthOf(r.年月) === m);
        const lensRowsM = lensRowsAll.filter((r) => monthOf(r.年月) === m);
        const carAgg = App.metrics.aggregate(carRowsM, carOnline, state.selectionByTab['車機'], { groupBy: '類型' });
        const modelQC = {};
        carAgg.groups.forEach((g) => { modelQC[g.key] = g.subtotal['回廠QC'] || 0; });
        const lensKpi = App.metrics.computeKPI(lensRowsM, lensOnline, state.selectionByTab['鏡頭']);
        carModelQCByMonth.push(modelQC);
        lensQCByMonth.push(lensKpi.內部檢測數);
      }
      return { monthCount, carModelQCByMonth, lensQCByMonth };
    };

    const cur = buildForPeriod(state.year, state.quarter);
    const cmp = hasCmp ? buildForPeriod(state.cmp.year, state.cmp.quarter) : null;
    const monthCount = Math.max(cur.monthCount, cmp ? cmp.monthCount : 0);
    const months = Array.from({ length: monthCount }, (_, i) => i + 1);
    return {
      months,
      curLabel: `${state.year}年`, cmpLabel: cmp ? `${state.cmp.year}年（同期）` : null,
      cur, cmp,
    };
  }

  function reuseUsagePageHTML(ctx) {
    const { car, lens, state } = ctx, hasCmp = ctx.hasCmp;
    const months = periodMonths(state.quarter);
    const freight = shippingCost(months);

    // 車機機型分類設定：依本期回廠QC數由大到小排序，供分類表勾選
    const carTypeAgg = aggByType(car, ctx.carSelection);
    const carModels = [...carTypeAgg.groups].sort((a, b) => (b.subtotal['回廠QC'] || 0) - (a.subtotal['回廠QC'] || 0));
    const carModelQC = {};
    carModels.forEach((g) => { carModelQC[g.key] = g.subtotal['回廠QC'] || 0; });
    const usageTrend = buildUsageMonthlySeries(ctx);

    const bullets1 = [
      `車機內部檢測（回廠QC）${rInt(car.kpi.內部檢測數)} 件，鏡頭 ${rInt(lens.kpi.內部檢測數)} 件；這些機台因內部檢測判定良品，不需送外部維修。`,
      `送修運費為固定物流排班成本（每次300元、一週2次、一個月4週 × ${months}個月），與送修件數無關，本期共 ${rInt(freight)} 元。`,
    ];
    const bullets2 = hasCmp ? [
      `車機內部檢測數量 ${rInt(car.kpi.內部檢測數)} 件，較去年同期 ${rInt(car.cmpKpi.內部檢測數)} 件，變化 ${rDiff(car.kpi.內部檢測數 - car.cmpKpi.內部檢測數)} 件。`,
      `鏡頭內部檢測數量 ${rInt(lens.kpi.內部檢測數)} 件，較去年同期 ${rInt(lens.cmpKpi.內部檢測數)} 件，變化 ${rDiff(lens.kpi.內部檢測數 - lens.cmpKpi.內部檢測數)} 件。`,
    ] : [];
    return {
      html: `<section class="page" id="page-usage">
        <div class="ph"><div><span class="ph-l">${App.icons.refresh()} 再使用</span><span class="ph-s">內部檢測與送修成本｜期間：${esc(periodText(state))}</span></div></div>
        <div class="krow">
          ${kcard('車機內部檢測數量', rInt(car.kpi.內部檢測數), hasCmp ? kpiDeltaHTML(car.kpi.內部檢測數, car.cmpKpi.內部檢測數, 'int', true) : '', 'good', car.kpi.內部檢測數)}
          ${kcard('鏡頭內部檢測數量', rInt(lens.kpi.內部檢測數), hasCmp ? kpiDeltaHTML(lens.kpi.內部檢測數, lens.cmpKpi.內部檢測數, 'int', true) : '', 'good', lens.kpi.內部檢測數)}
          <div class="kcard"><div class="l">預估省下的成本</div><div class="v" id="kpi-saved-cost-total">0 元</div><div class="vhint" id="kpi-saved-cost-hint"></div><div class="p">內部檢測數量 × 單位成本</div></div>
          <div class="kcard" style="border-top-color:var(--warn)"><div class="l">送修運費（固定物流成本）</div><div class="v">${rInt(freight)} 元</div>${bigNumHint(freight) ? `<div class="vhint">${bigNumHint(freight)}</div>` : ''}<div class="p">300元/次 × 2次/週 × 4週/月 × ${months}個月，與件數無關</div></div>
        </div>
        <div class="${hasCmp ? 'g2-eq' : ''}">
          <div class="card">
            <div class="chead"><div class="ct">省下的成本走勢</div><div class="cs">${esc(usageTrend.curLabel)} 1～${usageTrend.months.length}月${usageTrend.cmpLabel ? `　vs　${esc(usageTrend.cmpLabel)}` : ''}，隨上方分類／單位成本即時變化</div></div>
            <div class="chartbox"><canvas id="usage-trend-chart"></canvas></div>
            <div class="twrap" style="margin-top:14px"><table class="agg">
              <thead><tr><th class="l">期間</th><th class="num">省下的成本合計（元）</th></tr></thead>
              <tbody id="usage-yearly-tbody"></tbody>
            </table></div>
          </div>
          ${hasCmp ? `<div class="card">
            <div class="chead"><div class="ct">與去年同期比較</div><div class="cs">${esc(periodText(state))}　｜　內部檢測數量（件）</div></div>
            <div class="chartbox"><canvas id="usage-yoy-chart"></canvas></div>
            <div class="twrap" style="margin-top:14px"><table class="agg">
              <thead><tr><th class="l">指標</th><th class="num">對比期間</th><th class="num">目前期間</th><th class="num">差異</th></tr></thead>
              <tbody>
                <tr><td class="l">車機內部檢測數量（件）</td><td class="num">${rInt(car.cmpKpi.內部檢測數)}</td><td class="num">${rInt(car.kpi.內部檢測數)}</td><td class="num">${rDiff(car.kpi.內部檢測數 - car.cmpKpi.內部檢測數)}</td></tr>
                <tr><td class="l">鏡頭內部檢測數量（件）</td><td class="num">${rInt(lens.cmpKpi.內部檢測數)}</td><td class="num">${rInt(lens.kpi.內部檢測數)}</td><td class="num">${rDiff(lens.kpi.內部檢測數 - lens.cmpKpi.內部檢測數)}</td></tr>
              </tbody>
            </table></div>
          </div>` : ''}
        </div>
        ${adviceCalloutHTML('advice-usage', '整體建議說明', bullets1.concat(bullets2))}
        <details class="lowkey-toggle">
          <summary>${App.icons.settings()} 車機機型分類設定</summary>
          <div class="lowkey-toggle-body">
            <p class="lowkey-toggle-desc">勾選「一般定位」或「影像」，決定下方成本試算與趨勢圖如何加總；同一機型只能勾一邊，都不勾視為未分類（不計入試算）</p>
            <div class="twrap"><div class="scroll">
              <table class="agg" id="usage-class-table">
                <thead><tr><th class="l">機型</th><th class="num">本期回廠QC數</th><th class="num">一般定位</th><th class="num">影像</th></tr></thead>
                <tbody>
                  ${carModels.map((g) => {
                    const key = g.key;
                    const qc = g.subtotal['回廠QC'] || 0;
                    const isGeneral = CAR_GENERAL_MODELS_DEFAULT.includes(key);
                    const isImaging = CAR_IMAGING_MODELS_DEFAULT.includes(key);
                    return `<tr><td class="l">${esc(key)}</td><td class="num">${rInt(qc)}</td>
                      <td class="num"><input type="checkbox" class="cls-general" data-model="${esc(key)}" ${isGeneral ? 'checked' : ''}></td>
                      <td class="num"><input type="checkbox" class="cls-imaging" data-model="${esc(key)}" ${isImaging ? 'checked' : ''}></td></tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div></div>
          </div>
        </details>
        <details class="lowkey-toggle">
          <summary>${App.icons.calculator()} 省下的成本試算（可編輯）</summary>
          <div class="lowkey-toggle-body">
            <p class="lowkey-toggle-desc">內部檢測數量（QC=回廠QC）× 單位成本；車機依上方分類設定分兩類，鏡頭單位成本可另外調整，預設一般定位2,000元、影像7,000元、鏡頭2,000元</p>
            <div class="twrap"><div class="scroll">
              <table class="agg" id="usage-cost-table">
                <thead><tr><th class="l">設備</th><th class="num">內部檢測數量（件）</th><th class="num">單位成本（元）</th><th class="num">省下的成本（元）</th></tr></thead>
                <tbody>
                  <tr>
                    <td class="l">車機（一般定位）</td><td class="num" id="qty-car-general">0</td>
                    <td class="num"><input type="number" class="cost-input in-unitcost" id="uc-car-general-cost" value="2000" step="100" style="width:100px;text-align:right"></td>
                    <td class="num" id="saved-car-general">0</td>
                  </tr>
                  <tr>
                    <td class="l">車機（影像）</td><td class="num" id="qty-car-imaging">0</td>
                    <td class="num"><input type="number" class="cost-input in-unitcost" id="uc-car-imaging-cost" value="7000" step="100" style="width:100px;text-align:right"></td>
                    <td class="num" id="saved-car-imaging">0</td>
                  </tr>
                  <tr data-device="鏡頭" data-qty="${lens.kpi.內部檢測數}">
                    <td class="l">鏡頭</td><td class="num">${rInt(lens.kpi.內部檢測數)}</td>
                    <td class="num"><input type="number" class="cost-input in-unitcost" id="uc-lens-cost" value="2000" step="100" style="width:100px;text-align:right"></td>
                    <td class="num" id="saved-lens">0</td>
                  </tr>
                </tbody>
                <tfoot><tr class="grand"><td class="l" colspan="3">總計</td><td class="num" id="usage-saved-total">0</td></tr></tfoot>
              </table>
            </div></div>
          </div>
        </details>
      </section>`,
      chartScript: `
        window.__carModelQC=${JSON.stringify(carModelQC)};
        window.__usageTrend=${JSON.stringify(usageTrend)};
        window.__usageLensQty=${lens.kpi.內部檢測數 || 0};

        function __categoryQty(cls){
          var total=0;
          document.querySelectorAll('.'+cls+':checked').forEach(function(cb){ total+=window.__carModelQC[cb.dataset.model]||0; });
          return total;
        }
        window.__recomputeUsageSaving=function(){
          var genCostEl=document.getElementById('uc-car-general-cost');
          if(!genCostEl)return;
          var qtyGeneral=__categoryQty('cls-general');
          var qtyImaging=__categoryQty('cls-imaging');
          var costGeneral=parseFloat(genCostEl.value)||0;
          var costImaging=parseFloat(document.getElementById('uc-car-imaging-cost').value)||0;
          var costLens=parseFloat(document.getElementById('uc-lens-cost').value)||0;
          var savedGeneral=qtyGeneral*costGeneral, savedImaging=qtyImaging*costImaging, savedLens=window.__usageLensQty*costLens;
          document.getElementById('qty-car-general').textContent=qtyGeneral.toLocaleString('en-US');
          document.getElementById('qty-car-imaging').textContent=qtyImaging.toLocaleString('en-US');
          document.getElementById('saved-car-general').textContent=Math.round(savedGeneral).toLocaleString('en-US');
          document.getElementById('saved-car-imaging').textContent=Math.round(savedImaging).toLocaleString('en-US');
          document.getElementById('saved-lens').textContent=Math.round(savedLens).toLocaleString('en-US');
          var total=savedGeneral+savedImaging+savedLens;
          var totalEl=document.getElementById('usage-saved-total'); if(totalEl)totalEl.textContent=Math.round(total).toLocaleString('en-US');
          var kpiEl=document.getElementById('kpi-saved-cost-total'); if(kpiEl)kpiEl.textContent=Math.round(total).toLocaleString('en-US')+' 元';
          var kpiHintEl=document.getElementById('kpi-saved-cost-hint'); if(kpiHintEl)kpiHintEl.textContent=window.__bigNumHint(total);
          if(window.__recomputeUsageTrend)window.__recomputeUsageTrend();
        };
        window.__usageMonthlySeriesFor=function(periodData,costGeneral,costImaging,costLens,generalModels,imagingModels){
          if(!periodData)return null;
          return window.__usageTrend.months.map(function(m,i){
            if(i>=periodData.monthCount)return null;
            var modelQC=periodData.carModelQCByMonth[i]||{};
            var g=0,im=0;
            generalModels.forEach(function(mo){g+=modelQC[mo]||0;});
            imagingModels.forEach(function(mo){im+=modelQC[mo]||0;});
            var lensQty=periodData.lensQCByMonth[i]||0;
            return g*costGeneral+im*costImaging+lensQty*costLens;
          });
        };
        window.__recomputeUsageTrend=function(){
          var t=window.__usageTrend; if(!t)return;
          var costGeneral=parseFloat(document.getElementById('uc-car-general-cost').value)||0;
          var costImaging=parseFloat(document.getElementById('uc-car-imaging-cost').value)||0;
          var costLens=parseFloat(document.getElementById('uc-lens-cost').value)||0;
          var generalModels=[].slice.call(document.querySelectorAll('.cls-general:checked')).map(function(cb){return cb.dataset.model;});
          var imagingModels=[].slice.call(document.querySelectorAll('.cls-imaging:checked')).map(function(cb){return cb.dataset.model;});
          var curSeries=window.__usageMonthlySeriesFor(t.cur,costGeneral,costImaging,costLens,generalModels,imagingModels);
          var cmpSeries=window.__usageMonthlySeriesFor(t.cmp,costGeneral,costImaging,costLens,generalModels,imagingModels);
          if(window.__usageTrendChart){
            window.__usageTrendChart.data.datasets[0].data=curSeries;
            window.__usageTrendChart.data.datasets[1].data=cmpSeries||[];
            window.__usageTrendChart.update();
          }
          var sum=function(arr){return (arr||[]).reduce(function(a,b){return a+(b||0);},0);};
          var curTotal=sum(curSeries), cmpTotal=cmpSeries?sum(cmpSeries):null;
          var rows='<tr><td class="l">'+t.curLabel+'</td><td class="num">'+Math.round(curTotal).toLocaleString('en-US')+' 元</td></tr>';
          if(cmpSeries){
            var diff=curTotal-cmpTotal;
            rows+='<tr><td class="l">'+t.cmpLabel+'</td><td class="num">'+Math.round(cmpTotal).toLocaleString('en-US')+' 元</td></tr>';
            rows+='<tr class="grand"><td class="l">差異</td><td class="num">'+(diff>=0?'+':'')+Math.round(diff).toLocaleString('en-US')+' 元</td></tr>';
          }
          var tbody=document.getElementById('usage-yearly-tbody');
          if(tbody)tbody.innerHTML=rows;
        };
        window.__usageTrend.monthLabels=window.__usageTrend.months.map(function(m){return m+'月';});
        window.__usageTrendChart=new Chart(document.getElementById('usage-trend-chart'),{type:'line',
          data:{labels:window.__usageTrend.monthLabels,datasets:[
            {label:window.__usageTrend.curLabel,data:[],borderColor:GOOD,backgroundColor:'rgba(26,156,83,.1)',fill:true,tension:.3,pointRadius:3},
            {label:window.__usageTrend.cmpLabel||'去年同期',data:[],borderColor:'#9AA0A6',borderDash:[5,4],fill:false,tension:.3,pointRadius:3}
          ]},
          options:{maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{beginAtZero:true,ticks:{callback:function(v){return v.toLocaleString('en-US');}}}}}});
        ${hasCmp ? `new Chart(document.getElementById('usage-yoy-chart'),{type:'bar',
          data:{labels:['車機','鏡頭'],datasets:[
            {label:'${esc(usageTrend.cmpLabel || '去年同期')}',data:[${Math.round(car.cmpKpi.內部檢測數) || 0},${Math.round(lens.cmpKpi.內部檢測數) || 0}],backgroundColor:'rgba(26,156,83,.35)'},
            {label:'${esc(usageTrend.curLabel)}',data:[${Math.round(car.kpi.內部檢測數) || 0},${Math.round(lens.kpi.內部檢測數) || 0}],backgroundColor:GOOD}
          ]},
          options:{maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{beginAtZero:true}}}});` : ''}
        document.querySelectorAll('#page-usage .cost-input').forEach(function(el){el.addEventListener('input',window.__recomputeUsageSaving);});
        document.querySelectorAll('.cls-general').forEach(function(cb){
          cb.addEventListener('change',function(){
            if(this.checked){
              var other=document.querySelector('.cls-imaging[data-model="'+CSS.escape(this.dataset.model)+'"]');
              if(other)other.checked=false;
            }
            window.__recomputeUsageSaving();
          });
        });
        document.querySelectorAll('.cls-imaging').forEach(function(cb){
          cb.addEventListener('change',function(){
            if(this.checked){
              var other=document.querySelector('.cls-general[data-model="'+CSS.escape(this.dataset.model)+'"]');
              if(other)other.checked=false;
            }
            window.__recomputeUsageSaving();
          });
        });
        window.__recomputeUsageSaving();`,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 4. 重點廠商比較（同期）
  // ════════════════════════════════════════════════════════════
  const CAR_SPOTLIGHT_VENDORS_DEFAULT = ['馥鴻科技', '深圳市銳明技術'];
  const LENS_SPOTLIGHT_VENDORS_DEFAULT = ['新眾', '呈岳科技'];

  // 精簡 kpi 只留圖表／卡片需要的欄位，embed 進報告的 JSON 體積不隨 computeKPI 未來擴充欄位而膨脹
  function vendorKPISlim(kpi) {
    return {
      過保數: kpi.過保數, 不良品數: kpi.不良品數, 良品數: kpi.良品數, 未歸類數: kpi.未歸類數, 期間回廠量: kpi.期間回廠量,
      期間不良率: kpi.期間不良率, 期間過保率: kpi.期間過保率, 再使用率: kpi.再使用率,
    };
  }

  function vendorSpotlightPageHTML(ctx) {
    const { car, lens, state } = ctx, hasCmp = ctx.hasCmp;

    // 出現過的廠商，依回廠量由大到小，並依主畫面「廠商」篩選面板目前的勾選收斂範圍（未勾選＝不限制）
    const carVendorSel = state.selectionByTab.車機.廠商;
    const lensVendorSel = state.selectionByTab.鏡頭.廠商;
    const allCarVendors = [...aggByVendor(car, {}).groups].sort((a, b) => b.subtotal.回廠量 - a.subtotal.回廠量).map((g) => g.key)
      .filter((v) => !carVendorSel.length || carVendorSel.includes(v));
    const allLensVendors = [...aggByVendor(lens, {}).groups].sort((a, b) => b.subtotal.回廠量 - a.subtotal.回廠量).map((g) => g.key)
      .filter((v) => !lensVendorSel.length || lensVendorSel.includes(v));

    const buildVendorData = (d, vendors) => {
      const out = {};
      vendors.forEach((v) => {
        const kpi = App.metrics.computeKPI(d.rows, d.online, { 廠商: [v] });
        const cmpKpi = (hasCmp && d.cmpRows) ? App.metrics.computeKPI(d.cmpRows, d.cmpOnline, { 廠商: [v] }) : null;
        out[v] = { kpi: vendorKPISlim(kpi), cmpKpi: cmpKpi ? vendorKPISlim(cmpKpi) : null };
      });
      return out;
    };
    const carVendorData = buildVendorData(car, allCarVendors);
    const lensVendorData = buildVendorData(lens, allLensVendors);

    // 已使用年限比較：攤平成「廠商・機型」清單（依回廠量排序前先攤平，null（無報廢資訊）不列入），
    // 車機另補上分類（一般定位／影像，比對頁本頁獨立勾選、與「再使用」頁籤各自互不影響，預設分類相同）
    const buildAgeFlat = (d, vendors) => {
      const cmpEnabled = hasCmp && d.cmpRows;
      const out = [];
      vendors.forEach((v) => {
        const agg = aggByType(d, { 廠商: [v] });
        const cmpAgg = cmpEnabled ? App.metrics.aggregate(d.cmpRows, d.cmpOnline, { 廠商: [v] }, { groupBy: '類型' }) : null;
        agg.groups.forEach((g) => {
          if (g.subtotal.已使用年限 == null) return;
          let yearCmp = null;
          if (cmpAgg) {
            const cg = cmpAgg.groups.find((x) => x.key === g.key);
            if (cg && cg.subtotal.已使用年限 != null) yearCmp = cg.subtotal.已使用年限;
          }
          out.push({ vendor: v, model: g.key, year: g.subtotal.已使用年限, yearCmp, bad: g.subtotal.不良品數 || 0, uncat: g.subtotal.未歸類數 || 0, warr: g.subtotal.過保數 || 0 });
        });
      });
      return out;
    };
    const carAgeFlat = buildAgeFlat(car, allCarVendors);
    const lensAgeFlat = buildAgeFlat(lens, allLensVendors);

    // 車機機型分類清單（全部機型，含本期回廠QC數，供分類勾選表使用）
    const carAllModels = [...aggByType(car, {}).groups].sort((a, b) => (b.subtotal['回廠QC'] || 0) - (a.subtotal['回廠QC'] || 0));

    // 車機依預設分類拆成一般定位／影像兩份清單，各自獨立比較（不含未分類機型）
    const carGeneralAgeFlat = carAgeFlat.filter((r) => CAR_GENERAL_MODELS_DEFAULT.includes(r.model));
    const carImagingAgeFlat = carAgeFlat.filter((r) => CAR_IMAGING_MODELS_DEFAULT.includes(r.model));

    // 已使用年限比較「分析與說明」：以預設分類為準靜態產生一次，不隨勾選即時變動（與本報告其他建議說明區塊一致）
    const ageFindingsHTML = (id, flat) => {
      if (!flat.length) return '';
      const top = [...flat].sort((a, b) => b.year - a.year)[0];
      const bullets = [`已使用年限最長的是 ${esc(top.vendor)}・${esc(top.model)}，已使用 ${rYear(top.year)}，代表這台設備的汰換效益最佳。`];
      const withDelta = flat.filter((r) => r.yearCmp != null);
      if (withDelta.length) {
        const biggestUp = [...withDelta].sort((a, b) => (b.year - b.yearCmp) - (a.year - a.yearCmp))[0];
        const biggestDown = [...withDelta].sort((a, b) => (a.year - a.yearCmp) - (b.year - b.yearCmp))[0];
        if (biggestUp.year - biggestUp.yearCmp > 0.05) bullets.push(`${esc(biggestUp.vendor)}・${esc(biggestUp.model)} 已使用年限較去年同期增加 ${rYear(biggestUp.year - biggestUp.yearCmp)}，持續延長使用中。`);
        if (biggestDown !== biggestUp && biggestDown.year - biggestDown.yearCmp < -0.05) bullets.push(`${esc(biggestDown.vendor)}・${esc(biggestDown.model)} 已使用年限較去年同期縮短 ${rYear(biggestDown.yearCmp - biggestDown.year)}，可能有提前送修或報廢情形，建議留意。`);
      }
      return adviceCalloutHTML(id, '分析與說明', bullets);
    };

    // 已使用年限比較卡：純 CSS 橫條圖＋最划算 Top3＋可排序明細表，車機拆成一般定位／影像各自獨立一張卡，皆由前端 JS 依分類勾選即時重繪
    const ageCardHTML = (device, deviceLabel, flat, splitLayout) => {
      const chartBlock = `<div class="vage-top3" id="vage-top3-${device}"></div>
        <div class="vage-legend" id="vage-legend-${device}" style="display:none">
          <span class="li"><span class="sw"></span>本期已使用年限</span>
          <span class="li"><span class="mk"></span>去年同期已使用年限</span>
        </div>
        <div id="vage-groups-${device}"></div>`;
      const tableBlock = `<table class="agg vage-table" id="vage-table-${device}" data-device="${device}">
          <thead><tr>
            <th class="l" data-key="model">機型<span class="arrows"><span>▲</span><span>▼</span></span></th>
            <th class="l" data-key="vendor">廠商<span class="arrows"><span>▲</span><span>▼</span></span></th>
            <th class="num" data-key="bad">不良品數<span class="arrows"><span>▲</span><span>▼</span></span></th>
            <th class="num" data-key="warr">過保數<span class="arrows"><span>▲</span><span>▼</span></span></th>
            <th class="num" data-key="year">已使用年限<span class="arrows"><span>▲</span><span>▼</span></span></th>
          </tr></thead>
          <tbody id="vage-tbody-${device}"></tbody>
        </table>`;
      const body = splitLayout
        ? `<div class="g2">
            <div>${chartBlock}</div>
            <div class="twrap">${tableBlock}</div>
          </div>`
        : `${chartBlock}
          <div class="twrap" style="margin-top:16px">${tableBlock}</div>`;
      return `<div class="card">
      <div class="chead">
        <div class="ct">已使用年限比較（${esc(deviceLabel)}）</div>
      </div>
      ${body}
    </div>
    ${ageFindingsHTML(`advice-vage-${device}`, flat)}`;
    };

    const carClassSettingsHTML = `<details class="lowkey-toggle icon-collapse">
      <summary title="車機機型分類設定">${App.icons.settings()}<span class="lowkey-toggle-text">車機機型分類設定</span></summary>
      <div class="lowkey-toggle-body">
        <p class="lowkey-toggle-desc">勾選「一般定位」或「影像」，決定左右兩張卡片如何分類；同一機型只能勾一邊，都不勾視為未分類（不列入任一卡片比較）</p>
        <div class="twrap"><div class="scroll">
          <table class="agg" id="vage-class-table">
            <thead><tr><th class="l">機型</th><th class="num">本期回廠QC數</th><th class="num">一般定位</th><th class="num">影像</th></tr></thead>
            <tbody>
              ${carAllModels.map((g) => {
                const key = g.key;
                const qc = g.subtotal['回廠QC'] || 0;
                const isGeneral = CAR_GENERAL_MODELS_DEFAULT.includes(key);
                const isImaging = CAR_IMAGING_MODELS_DEFAULT.includes(key);
                return `<tr><td class="l">${esc(key)}</td><td class="num">${rInt(qc)}</td>
                  <td class="num"><input type="checkbox" class="vage-cls-general" data-model="${esc(key)}" ${isGeneral ? 'checked' : ''}></td>
                  <td class="num"><input type="checkbox" class="vage-cls-imaging" data-model="${esc(key)}" ${isImaging ? 'checked' : ''}></td></tr>`;
              }).join('')}
            </tbody>
          </table>
        </div></div>
      </div>
    </details>`;

    const pickerHTML = (device, vendors, defaults) => vendors.map((v) =>
      `<label class="vp-item"><input type="checkbox" class="vp-${device}" value="${esc(v)}" ${defaults.includes(v) ? 'checked' : ''}> ${esc(v)}</label>`
    ).join('');

    // 鏡頭 VP／CR 維修整新成本（使用者提供的廠商對帳彙整，非彙總常數可推得，故獨立列出）：
    // 新眾 VP 為送外維修／整新的實際花費；呈岳科技 CR 為內部整新對應省下的外部維修成本
    const LENS_VP_COST = {
      y114: { qty: 61, refurb: 28, repair: 33, total: 28290 },
      y115: { qty: 15, refurb: 14, repair: 1, total: 9818 },
    };
    const LENS_CR_COST = {
      y114: { qty: 150, refurb: 150, unitCost: 780, total: 117000 },
      y115: { qty: 316, refurb: 360, unitCost: 780, total: 280800 },
    };
    // VP／CR 上線量：115年（本期）直接從鏡頭現有資料依廠商過濾算出；
    // 114年系統無歷史快照可查（「上線量」來源表只有當下單一快照，cmpRows 對應的仍是同一份快照，算出來會跟本期重複而失真），
    // 故改用使用者提供的舊檔案 舊文件/設備品質分析_資料庫_25_Q1.xlsm「上線量(PQ)」分頁固定值：
    // 依「類型清單」（替換前品項→廠商，缺則以ERP品號 join 品號對照表→主供應商名稱）比照 transform.js buildDetail() 的廠商判斷邏輯，
    // 篩出 QP_ProductKind=鏡頭 且廠商=新眾／呈岳科技 的筆數統計而得（60890筆鏡頭中128筆缺對照，忽略不計）
    const vpOnlineCur = App.metrics.computeKPI(lens.rows, lens.online, { 廠商: ['新眾'] }).總線上量;
    const crOnlineCur = App.metrics.computeKPI(lens.rows, lens.online, { 廠商: ['呈岳科技'] }).總線上量;
    const vpOnlineY114 = 16258;
    const crOnlineY114 = 12708;

    const vpDiff = LENS_VP_COST.y115.total - LENS_VP_COST.y114.total;
    const vpGrowth = LENS_VP_COST.y114.total ? vpDiff / LENS_VP_COST.y114.total : 0;
    const crDiff = LENS_CR_COST.y115.total - LENS_CR_COST.y114.total;
    const crGrowth = LENS_CR_COST.y114.total ? crDiff / LENS_CR_COST.y114.total : 0;

    const lensCostBullets = [
      `新眾 VP 鏡頭以外部維修／整新為主，115年1–6月花費 ${rInt(LENS_VP_COST.y115.total)} 元，較114年同期 ${rInt(LENS_VP_COST.y114.total)} 元${vpDiff <= 0 ? '減少' : '增加'} ${rInt(Math.abs(vpDiff))} 元（${kpiGrowthLabel(vpGrowth)}），對外維修依賴降低。`,
      `呈岳科技 CR 鏡頭以內部QC檢測／整新為主，對應省下的外部維修成本115年1–6月達 ${rInt(LENS_CR_COST.y115.total)} 元，較114年同期 ${rInt(LENS_CR_COST.y114.total)} 元${crDiff >= 0 ? '成長' : '減少'} ${rInt(Math.abs(crDiff))} 元（${kpiGrowthLabel(crGrowth)}）。`,
      `兩者對比：VP 對外花費下降、CR 內部整新省下持續攀升，顯示內部整新／檢測的成本效益優於外部維修，建議持續強化鏡頭內部整新流程。`,
    ];

    const lensCostCardHTML = `<div class="card">
      <div class="chead">
        <div class="ct">VP／CR 維修整新成本比較</div>
        <div class="cs">新眾 VP：外部維修＋整新花費　｜　呈岳科技 CR：內部整新省下的外部成本　｜　114 vs 115年1–6月</div>
      </div>
      <div class="chartbox"><canvas id="lens-vpcr-chart"></canvas></div>
      <div class="twrap" style="margin-top:14px">
        <table class="agg compact vpcr-table">
          <colgroup><col style="width:24%"><col style="width:14%"><col style="width:18%"><col style="width:14%"><col style="width:14%"><col style="width:16%"></colgroup>
          <thead><tr><th class="l">新眾 VP<span class="pill bad" style="margin-left:8px">花費</span></th><th class="num">線上量</th><th class="num">品項數</th><th class="num">整新(件)</th><th class="num">維修(件)</th><th class="num">總計（元）</th></tr></thead>
          <tbody>
            <tr><td class="l">114年</td><td class="num">${rInt(vpOnlineY114)}</td><td class="num">${rInt(LENS_VP_COST.y114.qty)}</td><td class="num">${rInt(LENS_VP_COST.y114.refurb)}</td><td class="num">${rInt(LENS_VP_COST.y114.repair)}</td><td class="num hl-total-bad">${rInt(LENS_VP_COST.y114.total)}</td></tr>
            <tr><td class="l">115年</td><td class="num">${rInt(vpOnlineCur)}</td><td class="num">${rInt(LENS_VP_COST.y115.qty)}</td><td class="num">${rInt(LENS_VP_COST.y115.refurb)}</td><td class="num">${rInt(LENS_VP_COST.y115.repair)}</td><td class="num hl-total-bad">${rInt(LENS_VP_COST.y115.total)}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="twrap" style="margin-top:14px">
        <table class="agg compact vpcr-table">
          <colgroup><col style="width:24%"><col style="width:14%"><col style="width:18%"><col style="width:14%"><col style="width:14%"><col style="width:16%"></colgroup>
          <thead><tr><th class="l">呈岳科技 CR<span class="pill good" style="margin-left:8px">省下</span></th><th class="num">線上量</th><th class="num">內部QC檢測數</th><th class="num">整新(件)</th><th class="num">整新單價（元）</th><th class="num">總計（省下，元）</th></tr></thead>
          <tbody>
            <tr><td class="l">114年</td><td class="num">${rInt(crOnlineY114)}</td><td class="num">${rInt(LENS_CR_COST.y114.qty)}</td><td class="num">${rInt(LENS_CR_COST.y114.refurb)}</td><td class="num">${rInt(LENS_CR_COST.y114.unitCost)}</td><td class="num hl-total-good">${rInt(LENS_CR_COST.y114.total)}</td></tr>
            <tr><td class="l">115年</td><td class="num">${rInt(crOnlineCur)}</td><td class="num">${rInt(LENS_CR_COST.y115.qty)}</td><td class="num">${rInt(LENS_CR_COST.y115.refurb)}</td><td class="num">${rInt(LENS_CR_COST.y115.unitCost)}</td><td class="num hl-total-good">${rInt(LENS_CR_COST.y115.total)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    ${adviceCalloutHTML('advice-lens-cost', '分析與說明', lensCostBullets)}`;

    return {
      html: `<section class="page" id="page-vendor">
        <div class="ph"><div><span class="ph-l">${App.icons.factory()} 廠商比較</span><span class="ph-s">期間：${esc(periodText(state))}</span></div></div>
        <div class="sech">車機</div>
        <div class="g2-eq vage-split">
          <div>${ageCardHTML('car-general', '一般定位', carGeneralAgeFlat)}</div>
          <div>${ageCardHTML('car-imaging', '影像', carImagingAgeFlat)}</div>
        </div>
        <div class="icon-toggle-row">
          ${carClassSettingsHTML}
          <details class="lowkey-toggle icon-collapse">
            <summary title="顯示不良率／過保率／再使用率比較">${App.icons.chart()}<span class="lowkey-toggle-text">顯示不良率／過保率／再使用率比較（車機）</span></summary>
            <div class="lowkey-toggle-body">
              <div class="chartbox"><canvas id="vendor-chart-car"></canvas></div>
              <div class="twrap" style="margin-top:14px"><table class="agg">
                <thead><tr><th class="l">廠商</th><th class="num">不良品數</th><th class="num">過保數</th><th class="num">再使用數</th></tr></thead>
                <tbody id="vendor-summary-car"></tbody>
              </table></div>
            </div>
          </details>
          <details class="lowkey-toggle icon-collapse">
            <summary title="比較廠商（車機）">${App.icons.filter()}<span class="lowkey-toggle-text">比較廠商（車機）</span></summary>
            <div class="lowkey-toggle-body">
              <p class="lowkey-toggle-desc">可複選，預設：${esc(CAR_SPOTLIGHT_VENDORS_DEFAULT.join('、'))}</p>
              <div class="vendor-picker">${pickerHTML('car', allCarVendors, CAR_SPOTLIGHT_VENDORS_DEFAULT)}</div>
            </div>
          </details>
        </div>

        <div class="sech">鏡頭</div>
        <div class="g2-eq">
          <div>${ageCardHTML('lens', '鏡頭', lensAgeFlat, false)}</div>
          <div>${lensCostCardHTML}</div>
        </div>
        <div class="icon-toggle-row">
          <details class="lowkey-toggle icon-collapse">
            <summary title="顯示不良率／過保率／再使用率比較">${App.icons.chart()}<span class="lowkey-toggle-text">顯示不良率／過保率／再使用率比較（鏡頭）</span></summary>
            <div class="lowkey-toggle-body">
              <div class="chartbox"><canvas id="vendor-chart-lens"></canvas></div>
              <div class="twrap" style="margin-top:14px"><table class="agg">
                <thead><tr><th class="l">廠商</th><th class="num">不良品數</th><th class="num">過保數</th><th class="num">再使用數</th></tr></thead>
                <tbody id="vendor-summary-lens"></tbody>
              </table></div>
            </div>
          </details>
          <details class="lowkey-toggle icon-collapse">
            <summary title="比較廠商（鏡頭）">${App.icons.filter()}<span class="lowkey-toggle-text">比較廠商（鏡頭）</span></summary>
            <div class="lowkey-toggle-body">
              <p class="lowkey-toggle-desc">可複選，預設：${esc(LENS_SPOTLIGHT_VENDORS_DEFAULT.join('、'))}</p>
              <div class="vendor-picker">${pickerHTML('lens', allLensVendors, LENS_SPOTLIGHT_VENDORS_DEFAULT)}</div>
            </div>
          </details>
        </div>
      </section>`,
      chartScript: `
        window.__vendorAllData={car:${JSON.stringify(carVendorData)},lens:${JSON.stringify(lensVendorData)}};
        function __vendorSummaryRowHTML(name,kpi){
          var uc=window.__uncatMerged, bad=kpi.不良品數+(uc?(kpi.未歸類數||0):0);
          return '<tr><td class="l">'+name+'</td><td class="num">'+Math.round(bad).toLocaleString('en-US')+'</td>'+
            '<td class="num">'+Math.round(kpi.過保數).toLocaleString('en-US')+'</td><td class="num">'+Math.round(kpi.良品數).toLocaleString('en-US')+'</td></tr>';
        }
        window.__renderVendorSection=function(device){
          var checked=[].slice.call(document.querySelectorAll('.vp-'+device+':checked')).map(function(cb){return cb.value;});
          var all=window.__vendorAllData[device];
          var summaryEl=document.getElementById('vendor-summary-'+device);
          if(summaryEl)summaryEl.innerHTML=checked.map(function(v){ var rec=all[v]; return rec?__vendorSummaryRowHTML(v,rec.kpi):''; }).join('')||'<tr><td class="l" colspan="4">尚未選擇廠商</td></tr>';
          var canvas=document.getElementById('vendor-chart-'+device);
          var existing=Chart.getChart(canvas); if(existing)existing.destroy();
          var uc=window.__uncatMerged;
          var datasets=checked.map(function(v,i){
            var rec=all[v]; if(!rec)return null;
            var k=rec.kpi;
            var badRate=k.期間回廠量?((k.不良品數+(uc?(k.未歸類數||0):0))/k.期間回廠量):0;
            return {label:v,data:[+(badRate*100).toFixed(1),+(k.期間過保率*100).toFixed(1),+(k.再使用率*100).toFixed(1)],backgroundColor:PAL[i%PAL.length]};
          }).filter(Boolean);
          new Chart(canvas,{type:'bar',data:{labels:['不良率%','過保率%','再使用率%'],datasets:datasets},
            options:{maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{beginAtZero:true,ticks:{callback:function(v){return v+'%';}}}}}});
        };
        new Chart(document.getElementById('lens-vpcr-chart'),{type:'bar',
          data:{labels:['新眾 VP（花費）','呈岳科技 CR（省下）'],
            datasets:[
              {label:'114年1-6月',data:[${LENS_VP_COST.y114.total},${LENS_CR_COST.y114.total}],backgroundColor:'#9AA0A6'},
              {label:'115年1-6月',data:[${LENS_VP_COST.y115.total},${LENS_CR_COST.y115.total}],backgroundColor:'#009688'}
            ]},
          options:{maintainAspectRatio:false,plugins:{legend:{position:'top'},title:{display:true,text:'維修／整新成本對比（元）'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v.toLocaleString('en-US')}}}},
          plugins:[{
            id:'lensVpcrValueLabels',
            afterDatasetsDraw(chart){
              const ctx=chart.ctx;
              ctx.save();
              ctx.fillStyle='#1F2535';
              ctx.font='bold 11px -apple-system,"Segoe UI","Microsoft JhengHei",sans-serif';
              ctx.textAlign='center';
              ctx.textBaseline='bottom';
              chart.data.datasets.forEach(function(ds,dsIndex){
                chart.getDatasetMeta(dsIndex).data.forEach(function(bar,i){
                  var val=ds.data[i];
                  if(val==null)return;
                  ctx.fillText(val.toLocaleString('en-US'),bar.x,bar.y-4);
                });
              });
              ctx.restore();
            }
          }]});
        document.querySelectorAll('.vp-car').forEach(function(cb){cb.addEventListener('change',function(){window.__renderVendorSection('car');});});
        document.querySelectorAll('.vp-lens').forEach(function(cb){cb.addEventListener('change',function(){window.__renderVendorSection('lens');});});
        window.__renderVendorSection('car');
        window.__renderVendorSection('lens');

        window.__vageData={car:${JSON.stringify(carAgeFlat)},lens:${JSON.stringify(lensAgeFlat)}};
        window.__vageSort={'car-general':{key:'year',dir:'desc'},'car-imaging':{key:'year',dir:'desc'},lens:{key:'year',dir:'desc'}};
        window.__vageRendered={};
        var __VAGE_DEVICES=['car-general','car-imaging','lens'];

        function __vageMedalHTML(rank){ return rank<=3?'<span class="medal">'+rank+'</span>':''; }

        function __vageCatOf(model){
          var genSet={},imgSet={};
          document.querySelectorAll('.vage-cls-general:checked').forEach(function(cb){genSet[cb.dataset.model]=true;});
          document.querySelectorAll('.vage-cls-imaging:checked').forEach(function(cb){imgSet[cb.dataset.model]=true;});
          if(genSet[model])return 'general';
          if(imgSet[model])return 'imaging';
          return null;
        }

        function __vageBarRowHTML(item,rank,maxVal,cls){
          var pct=maxVal?Math.round(item.year/maxVal*100):0;
          var hasCmp=item.yearCmp!=null;
          var markerPct=hasCmp&&maxVal?Math.min(100,Math.round(item.yearCmp/maxVal*100)):null;
          var deltaHTML='';
          if(hasCmp){
            var diff=item.year-item.yearCmp;
            if(Math.abs(diff)<0.05)deltaHTML='<span class="delta flat">－ 持平</span>';
            else if(diff>0)deltaHTML='<span class="delta up">▲ '+diff.toFixed(1)+'</span>';
            else deltaHTML='<span class="delta down">▼ '+Math.abs(diff).toFixed(1)+'</span>';
          }
          return '<div class="barrow">'+
            '<div class="lbl">'+item.model+'<span class="vd">'+item.vendor+'</span></div>'+
            '<div class="track"><div class="fill '+cls+(rank<=3?' rank':'')+'" style="width:'+pct+'%">'+__vageMedalHTML(rank)+'</div>'+
            (markerPct!=null?'<div class="marker" style="left:'+markerPct+'%"></div>':'')+'</div>'+
            '<div class="yr">'+item.year.toFixed(1)+' 年'+deltaHTML+'</div>'+
          '</div>';
        }
        function __vageGroupHTML(list,maxVal,rankMap,cls){
          return list.map(function(it){ return __vageBarRowHTML(it,rankMap.get(it.vendor+'|'+it.model)||99,maxVal,cls); }).join('');
        }

        window.__renderVendorAge=function(device){
          var srcKey=device==='lens'?'lens':'car';
          var data=window.__vageData[srcKey]||[];
          var barCls='general', pool=data;
          if(device==='car-general'){ pool=data.filter(function(it){return __vageCatOf(it.model)==='general';}); barCls='general'; }
          else if(device==='car-imaging'){ pool=data.filter(function(it){return __vageCatOf(it.model)==='imaging';}); barCls='imaging'; }

          var maxVal=(pool.reduce(function(m,it){return Math.max(m,it.year,it.yearCmp||0);},0)*1.08)||1;

          var ranked=[].concat(pool).sort(function(a,b){return b.year-a.year;});
          var rankMap=new Map();
          ranked.forEach(function(it,i){ rankMap.set(it.vendor+'|'+it.model,i+1); });
          var top3=ranked.slice(0,3);
          var top3El=document.getElementById('vage-top3-'+device);
          if(top3El){
            top3El.innerHTML=top3.map(function(it,i){
              return '<div class="top3-item"><div class="top3-rank"><span class="num">'+(i+1)+'</span>TOP'+(i+1)+'</div>'+
                '<div class="top3-name">'+it.model+'</div>'+
                '<div class="top3-vendor">'+it.vendor+'</div>'+
                '<div class="top3-years">'+it.year.toFixed(1)+' 年</div></div>';
            }).join('')||'<p class="lowkey-toggle-desc">尚無可比較資料</p>';
          }

          var legendEl=document.getElementById('vage-legend-'+device);
          if(legendEl)legendEl.style.display=pool.some(function(it){return it.yearCmp!=null;})?'':'none';

          var groupsEl=document.getElementById('vage-groups-'+device);
          if(groupsEl){
            groupsEl.innerHTML=ranked.length?'<div class="grp">'+__vageGroupHTML(ranked,maxVal,rankMap,barCls)+'</div>':'<p class="lowkey-toggle-desc">尚無資料</p>';
          }

          window.__vageRendered[device]=pool.map(function(it){ return {model:it.model,vendor:it.vendor,year:it.year,bad:it.bad||0,uncat:it.uncat||0,warr:it.warr||0}; });
          __vageRenderTable(device);
        };

        function __vageRenderTable(device){
          var tbody=document.getElementById('vage-tbody-'+device);
          if(!tbody)return;
          var sort=window.__vageSort[device];
          var rows=[].concat(window.__vageRendered[device]||[]);
          var uc=window.__uncatMerged;
          rows.sort(function(a,b){
            if(sort.key==='year'){ var av=a.year||0,bv=b.year||0; return sort.dir==='asc'?av-bv:bv-av; }
            if(sort.key==='bad'){ var ab=(a.bad||0)+(uc?(a.uncat||0):0),bb=(b.bad||0)+(uc?(b.uncat||0):0); return sort.dir==='asc'?ab-bb:bb-ab; }
            if(sort.key==='warr'){ var aw=a.warr||0,bw=b.warr||0; return sort.dir==='asc'?aw-bw:bw-aw; }
            var as=String(a[sort.key]||''),bs=String(b[sort.key]||'');
            return sort.dir==='asc'?as.localeCompare(bs,'zh-Hant'):bs.localeCompare(as,'zh-Hant');
          });
          tbody.innerHTML=rows.map(function(r){
            var bad=(r.bad||0)+(uc?(r.uncat||0):0);
            return '<tr><td class="l">'+r.model+'</td><td class="l">'+r.vendor+'</td>'+
              '<td class="num">'+bad.toLocaleString('en-US')+'</td>'+
              '<td class="num">'+(r.warr||0).toLocaleString('en-US')+'</td>'+
              '<td class="num hl-year">'+r.year.toFixed(1)+' 年</td></tr>';
          }).join('')||'<tr><td class="l" colspan="5">尚無資料</td></tr>';
          var table=document.getElementById('vage-table-'+device);
          if(table){
            table.querySelectorAll('th').forEach(function(th){
              var active=th.dataset.key===sort.key;
              th.classList.toggle('sorted',active);
              var arrows=th.querySelectorAll('.arrows span');
              arrows.forEach(function(a){a.classList.remove('active');});
              if(active)arrows[sort.dir==='asc'?0:1].classList.add('active');
            });
          }
        }

        __VAGE_DEVICES.forEach(function(device){
          var table=document.getElementById('vage-table-'+device);
          if(table){
            table.querySelectorAll('th[data-key]').forEach(function(th){
              th.addEventListener('click',function(){
                var sort=window.__vageSort[device];
                if(sort.key===th.dataset.key){ sort.dir=sort.dir==='asc'?'desc':'asc'; }
                else { sort.key=th.dataset.key; sort.dir=th.dataset.key==='year'?'desc':'asc'; }
                __vageRenderTable(device);
              });
            });
          }
        });
        document.querySelectorAll('.vage-cls-general').forEach(function(cb){
          cb.addEventListener('change',function(){
            if(this.checked){
              var other=document.querySelector('.vage-cls-imaging[data-model="'+CSS.escape(this.dataset.model)+'"]');
              if(other)other.checked=false;
            }
            window.__renderVendorAge('car-general');
            window.__renderVendorAge('car-imaging');
          });
        });
        document.querySelectorAll('.vage-cls-imaging').forEach(function(cb){
          cb.addEventListener('change',function(){
            if(this.checked){
              var other=document.querySelector('.vage-cls-general[data-model="'+CSS.escape(this.dataset.model)+'"]');
              if(other)other.checked=false;
            }
            window.__renderVendorAge('car-general');
            window.__renderVendorAge('car-imaging');
          });
        });
        __VAGE_DEVICES.forEach(function(device){ window.__renderVendorAge(device); });`,
    };
  }


  // ════════════════════════════════════════════════════════════
  // KPI 分類彙總（114 vs 115 年 1–6月比較）— 獨立頁籤，不影響其他頁
  // 來源：使用者提供的 KPI_分類彙總.xlsx／分頁「114vs115比較」，屬人工整理的
  // 半年度金額彙總，不在 App.sheets 的即時資料源之內，故以常數方式內嵌；
  // 差異／成長率／建議文字皆由這組常數即時算出，不是寫死的敘述。
  // ════════════════════════════════════════════════════════════
  const KPI_CATEGORY_COMPARISON = [
    { label: '整新品循環/主機', y114: 1985310, y115: 2920950 },
    { label: '整新品循環/配件', y114: 1246545, y115: 845380 },
    { label: '內部QC',         y114: 1455560, y115: 1435430 },
    { label: '整新循環/出口QC', y114: 139080,  y115: 193760 },
  ];

  function kpiCategoryRow(row) {
    const diff = row.y115 - row.y114;
    const growth = row.y114 ? diff / row.y114 : 0;
    return { ...row, diff, growth };
  }
  function kpiGrowthPillCls(growth) {
    if (Math.abs(growth) < 0.02) return '';
    return growth > 0 ? 'good' : 'bad';
  }
  function kpiGrowthLabel(growth) { return `${growth >= 0 ? '+' : ''}${(growth * 100).toFixed(1)}%`; }

  function kpiPageHTML() {
    const rows = KPI_CATEGORY_COMPARISON.map(kpiCategoryRow);
    const total114 = rows.reduce((s, r) => s + r.y114, 0);
    const total115 = rows.reduce((s, r) => s + r.y115, 0);
    const totalDiff = total115 - total114;
    const totalGrowth = total114 ? totalDiff / total114 : 0;
    const best = [...rows].sort((a, b) => b.growth - a.growth)[0];

    const tableRows = rows.map((r) => `<tr><td class="l">${esc(r.label)}</td>
        <td class="num">${rInt(r.y114)}</td><td class="num">${rInt(r.y115)}</td>
        <td class="num">${rDiff(r.diff)}</td>
        <td class="num"><span class="pill ${kpiGrowthPillCls(r.growth)}">${kpiGrowthLabel(r.growth)}</span></td></tr>`).join('');

    const [mainUnit, accessory, qc, exportQc] = rows;
    const stableTotal = accessory.y115 + qc.y115;

    // 配件類鏡頭整新數量／主機類影像主機台數（使用者提供的補充明細，非彙總常數可推得，故獨立列出）
    const LENS_QTY = { y114: 841, y115: 782 };
    const lensQtyDiff = LENS_QTY.y115 - LENS_QTY.y114;
    const MAIN_UNIT_QTY = { y114: 57, y115: 200 };
    const mainUnitQtyDiff = MAIN_UNIT_QTY.y115 - MAIN_UNIT_QTY.y114;

    // 金額差異補充說明（獨立於 AI 建議說明，放在明細表旁的說明欄）；
    // 配件兩點僅在配件115年金額低於114年時顯示、主機一點僅在主機115年金額高於114年時顯示，
    // 各自獨立判斷，避免跟未來資料方向不一致時說明文字對不上
    const ACCESSORY_NOTES = [
      ...(accessory.diff < 0 ? [
        `「${esc(accessory.label)}」114年同期金額較高，主要因當年度執行 Mobileye ADAS(AM)、DMS控制盒(CM) 等大型整新專案；115年無同等規模之一次性整新案，故整體金額相對降低。`,
        `配件類差異亦反映在鏡頭整新數量：114年1–6月共整新 ${rInt(LENS_QTY.y114)} 顆，115年同期 ${rInt(LENS_QTY.y115)} 顆，減少 ${rInt(Math.abs(lensQtyDiff))} 顆，與金額端變化方向一致。`,
      ] : []),
      ...(mainUnit.diff > 0 ? [
        `「${esc(mainUnit.label)}」成長主要來自影像主機台數增加：114年1–6月共 ${rInt(MAIN_UNIT_QTY.y114)} 台，115年同期 ${rInt(MAIN_UNIT_QTY.y115)} 台，成長 ${rInt(mainUnitQtyDiff)} 台，是主機整新費用大幅成長的主要因素。`,
      ] : []),
    ];

    const bullets = [
      `115年1–6月整新循環總價值達 ${rInt(total115)} 元，較114年同期增加 ${rDiff(totalDiff)} 元（${kpiGrowthLabel(totalGrowth)}），相當於再為公司省下同等金額的外部採購／維修支出。`,
      `主機整新是最具優勢的一環：115年整新價值 ${rInt(mainUnit.y115)} 元，較114年成長 ${rDiff(mainUnit.diff)} 元（${kpiGrowthLabel(mainUnit.growth)}），是本期效益提升的主要動能。`,
      `出口QC同步成長 ${kpiGrowthLabel(exportQc.growth)}（${rDiff(exportQc.diff)} 元）；配件與內部QC合計仍創造 ${rInt(stableTotal)} 元的115年整新價值，持續支撐整新循環的穩定基礎。`,
      `整體而言，115年整新循環為公司帶來逾 ${rInt(total115)} 元的成本節省效益；建議將主機端的整新流程優勢複製到其他分類，進一步擴大整體節省規模。`,
    ];

    return {
      html: `<section class="page" id="page-kpi">
        <div class="ph"><div><span class="ph-l">${App.icons.chart()} KPI 分類彙總</span><span class="ph-s">114年 vs 115年　1–6月　｜　來源：KPI_分類彙總.xlsx／114vs115比較</span></div></div>
        <div class="krow">
          ${kcard('114年1–6月總計', `${rInt(total114)} 元`, '', '', total114)}
          ${kcard('115年1–6月總計', `${rInt(total115)} 元`, '', '', total115)}
          ${kcard('總計成長率', kpiGrowthLabel(totalGrowth), '', totalGrowth >= 0 ? 'good' : '')}
          ${kcard('成長最多分類', esc(best.label), `<div class="d d-good">${kpiGrowthLabel(best.growth)}</div>`)}
        </div>
        <div class="g2">
          <div class="card">
            <div class="chead"><div class="ct">KPI 分類彙總明細</div><div class="cs">114vs115比較｜金額單位：元｜金額皆以車機成本計算</div></div>
            <div class="twrap"><table class="agg">
              <thead><tr><th class="l">分類</th><th class="num">114年1-6月</th><th class="num">115年1-6月</th><th class="num">差異(115-114)</th><th class="num">成長率</th></tr></thead>
              <tbody>${tableRows}
                <tr class="grand"><td class="l">總計</td><td class="num">${rInt(total114)}</td><td class="num">${rInt(total115)}</td><td class="num">${rDiff(totalDiff)}</td><td class="num">${kpiGrowthLabel(totalGrowth)}</td></tr>
              </tbody>
            </table></div>
          </div>
          <div class="card">
            <div class="chead"><div class="ct">分類金額對比（114 vs 115，1–6月）</div><div class="cs">單位：元</div></div>
            <div class="chartbox"><canvas id="kpi-c1"></canvas></div>
          </div>
        </div>
        ${adviceCalloutHTML('advice-kpi', 'AI 建議說明', bullets)}
        ${ACCESSORY_NOTES.length ? `<div class="card">
          <div class="chead"><div class="ct">說明</div><div class="cs">關於差異金額的補充</div></div>
          <div class="kpi-note-row">
            <textarea class="advice-edit" id="advice-kpi-notes">${esc(ACCESSORY_NOTES.join('\n'))}</textarea>
            <div class="minichart-row">
              ${accessory.diff < 0 ? `<div><div class="minichart-title">配件類鏡頭整新數量（顆）</div><div class="chartbox xs"><canvas id="kpi-c2"></canvas></div></div>` : ''}
              ${mainUnit.diff > 0 ? `<div><div class="minichart-title">主機類影像主機台數（台）</div><div class="chartbox xs"><canvas id="kpi-c3"></canvas></div></div>` : ''}
            </div>
          </div>
        </div>` : ''}
      </section>`,
      chartScript: `
        const KPI_TEAL='#009688',KPI_GRAY='#9AA0A6';
        new Chart(document.getElementById('kpi-c1'),{type:'bar',
          data:{labels:${JSON.stringify(rows.map((r) => r.label))},
            datasets:[
              {label:'114年1-6月',data:${JSON.stringify(rows.map((r) => r.y114))},backgroundColor:KPI_GRAY},
              {label:'115年1-6月',data:${JSON.stringify(rows.map((r) => r.y115))},backgroundColor:KPI_TEAL}
            ]},
          options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{position:'top'},title:{display:true,text:'分類金額對比（元）'}},scales:{x:{beginAtZero:true,ticks:{callback:v=>v.toLocaleString('en-US')}}}},
          plugins:[{
            id:'kpiValueLabels',
            afterDatasetsDraw(chart){
              const ctx=chart.ctx;
              ctx.save();
              ctx.fillStyle='#1F2535';
              ctx.font='bold 11px -apple-system,"Segoe UI","Microsoft JhengHei",sans-serif';
              ctx.textAlign='left';
              ctx.textBaseline='middle';
              chart.data.datasets.forEach((ds,dsIndex)=>{
                chart.getDatasetMeta(dsIndex).data.forEach((bar,i)=>{
                  const val=ds.data[i];
                  if(val==null)return;
                  ctx.fillText(val.toLocaleString('en-US'),bar.x+4,bar.y);
                });
              });
              ctx.restore();
            }
          }]});
        ${accessory.diff < 0 ? `new Chart(document.getElementById('kpi-c2'),{type:'bar',
          data:{labels:['114年1-6月','115年1-6月'],
            datasets:[{data:[${LENS_QTY.y114},${LENS_QTY.y115}],backgroundColor:[KPI_GRAY,KPI_TEAL]}]},
          options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{maxTicksLimit:4}}}},
          plugins:[{
            id:'lensQtyValueLabels',
            afterDatasetsDraw(chart){
              const ctx=chart.ctx;
              ctx.save();
              ctx.fillStyle='#1F2535';
              ctx.font='bold 11px -apple-system,"Segoe UI","Microsoft JhengHei",sans-serif';
              ctx.textAlign='center';
              ctx.textBaseline='bottom';
              chart.getDatasetMeta(0).data.forEach((bar,i)=>{
                ctx.fillText(chart.data.datasets[0].data[i]+' 顆',bar.x,bar.y-4);
              });
              ctx.restore();
            }
          }]});` : ''}
        ${mainUnit.diff > 0 ? `new Chart(document.getElementById('kpi-c3'),{type:'bar',
          data:{labels:['114年1-6月','115年1-6月'],
            datasets:[{data:[${MAIN_UNIT_QTY.y114},${MAIN_UNIT_QTY.y115}],backgroundColor:[KPI_GRAY,KPI_TEAL]}]},
          options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{maxTicksLimit:4}}}},
          plugins:[{
            id:'mainUnitQtyValueLabels',
            afterDatasetsDraw(chart){
              const ctx=chart.ctx;
              ctx.save();
              ctx.fillStyle='#1F2535';
              ctx.font='bold 11px -apple-system,"Segoe UI","Microsoft JhengHei",sans-serif';
              ctx.textAlign='center';
              ctx.textBaseline='bottom';
              chart.getDatasetMeta(0).data.forEach((bar,i)=>{
                ctx.fillText(chart.data.datasets[0].data[i]+' 台',bar.x,bar.y-4);
              });
              ctx.restore();
            }
          }]});` : ''}`,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 組裝
  // ════════════════════════════════════════════════════════════
  function generateReportHTML(state) {
    if (!App.app || !App.app.dataForDevice || !App.app.DEVICE_TABS) {
      throw new Error('報告產生需要 App.app.dataForDevice／DEVICE_TABS（app.js 尚未載入或版本過舊）');
    }
    const car = App.app.dataForDevice('車機');
    const lens = App.app.dataForDevice('鏡頭');
    const hasCmp = !!(state.cmp.on && car.cmpKpi && lens.cmpKpi);
    const ctx = { state, car, lens, carSelection: state.selectionByTab['車機'], lensSelection: state.selectionByTab['鏡頭'], hasCmp };
    const genAt = new Date().toLocaleString('zh-TW');
    const defaultFilename = `品質分析報告_${state.year}-Q${state.quarter}_${new Date().toISOString().slice(0, 10)}.html`;

    const pages = [
      overviewPageHTML(ctx),
      vendorSpotlightPageHTML(ctx),
      reuseUsagePageHTML(ctx),
      kpiPageHTML(),
    ];

    return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>設備品質分析報告 ${esc(periodText(state))}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
:root{--teal:#009688;--teal-d:#00695C;--ink:#1F2535;--muted:#6B7384;--line:#DDE1E9;--bg:#F5F7FA;--good:#1a9c53;--warn:#e08e00;--bad:#D32F2F;
--gold:#b8860b;--gold-bg:#fbf3e0;--bar-general:var(--teal);--bar-imaging:#9AA0A6;--marker:#5c6470}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;font-weight:700;font-size:16px}
.icon{vertical-align:-0.15em;flex-shrink:0}
.topbar{position:sticky;top:0;z-index:20;background:var(--teal-d);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.15)}
.topbar-inner{max-width:1520px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.brand{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.brand .t{font-size:25px;font-weight:800;white-space:nowrap}
.brand .s{font-size:19px;font-weight:700;opacity:.9;white-space:nowrap}
.tabs{display:flex;flex-wrap:wrap;gap:8px}
.tab-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:17.5px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .15s}
.tab-btn:hover{background:rgba(255,255,255,.24)}
.tab-btn.on{background:#fff;color:var(--teal-d);box-shadow:0 2px 6px rgba(0,0,0,.18)}
.main{max-width:1520px;margin:0 auto;padding:24px 24px 80px;min-width:0}
.page{display:none}.page.on{display:block}
.ph{border-bottom:2px solid var(--line);padding-bottom:12px;margin-bottom:20px;display:flex;align-items:baseline;flex-wrap:wrap;gap:4px}
.ph-l{font-size:26.5px;font-weight:800;color:var(--teal-d)}
.ph-s{font-size:17.5px;color:var(--muted);margin-left:10px;font-weight:700}
.sech{font-size:18.5px;font-weight:800;color:var(--teal-d);margin:26px 0 12px;display:flex;align-items:center;gap:8px}
.sech::before{content:'';width:4px;height:15px;border-radius:3px;background:var(--teal);display:inline-block}
.sech:first-child{margin-top:0}
.sech-lg{font-size:23.5px}
.sech-lg::before{height:18px}
.krow{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:18px}
.kcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:15px 17px;border-top:3px solid var(--teal);box-shadow:0 1px 3px rgba(0,0,0,.05)}
.kcard .l{font-size:17px;color:var(--muted)}
.kcard .v{font-size:33.5px;font-weight:800;margin-top:2px}
.kcard .d{font-size:17px;font-weight:700;margin-top:5px}
.kcard .p{font-size:15.5px;color:var(--muted)}
.kcard .vhint{font-size:13.5px;font-weight:400;color:var(--muted);margin-top:1px}
.kcard .vhint:empty{display:none}
.kcard.good{border-top-color:var(--good)}
.d-good{color:var(--teal)}.d-bad{color:var(--teal)}.d-flat{color:var(--muted)}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.chead{margin-bottom:12px}
.ct{font-size:19px;font-weight:700;display:flex;align-items:center;gap:8px}
.ct::before{content:'';width:4px;height:15px;border-radius:3px;background:var(--teal);display:inline-block;flex-shrink:0}
.cs{font-size:16px;color:var(--muted);margin-top:2px;margin-left:12px}
.trend-device{font-size:19px;font-weight:800;color:var(--ink)}
.mini-title{font-size:17px;font-weight:700;color:var(--ink);text-align:center;margin-bottom:6px}
.g2{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;min-width:0}
.g2>*{min-width:0}
.g2-eq{display:grid;grid-template-columns:1fr 1fr;gap:16px;min-width:0}
.g2-eq>*{min-width:0}
.vage-split>div{display:flex;flex-direction:column}
.vage-split>div>.card{flex:1;display:flex;flex-direction:column}
.vage-split>div>.card>.twrap{flex:1}
.rlayout3{display:grid;grid-template-columns:140px 220px 1fr;gap:18px;align-items:center;min-width:0}
.rlayout3>*{min-width:0}
.g3{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:14px;min-width:0}
.g3>*{min-width:0}
.chartbox{position:relative;height:280px}
.chartbox.sm{height:220px}
.chartbox.pie{height:260px}
.chartbox.xs{height:150px}
.minichart-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px}
.minichart-row .minichart-title{font-size:13px;color:var(--muted);text-align:center;margin-bottom:4px}
.kpi-note-row{display:grid;grid-template-columns:1.3fr 1fr;gap:20px;align-items:start}
.kpi-note-row .advice-edit{margin-bottom:0;min-height:180px}
.kpi-note-row .minichart-row{margin-top:0}
@media(max-width:900px){.kpi-note-row{grid-template-columns:1fr}}
.twrap{border:1px solid var(--line);border-radius:10px;overflow:hidden}
.scroll{overflow:auto;max-height:420px}
.scroll--full{max-height:none;overflow-x:auto;overflow-y:visible}
table.agg{border-collapse:collapse;width:100%;font-size:17.5px}
table.agg th{background:var(--teal);color:#fff;padding:8px 10px;text-align:left;white-space:nowrap;position:sticky;top:0}
table.agg th.num,table.agg td.num{text-align:right}
table.agg td.l{text-align:left}
table.agg td{padding:7px 10px;border-bottom:1px solid #eef0f4;white-space:nowrap}
tr.grand td{background:#1F2535;color:#fff;font-weight:700}
table.agg.compact{font-size:14.5px}
table.agg.compact th,table.agg.compact td{padding:6px 6px;white-space:normal;line-height:1.3}
table.vpcr-table{table-layout:fixed}
.vendorgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.vcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.vcard .vh{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid #eef2f7;padding-bottom:8px;margin-bottom:10px}
.vcard .vh .nm{font-size:19px;font-weight:800;color:var(--ink)}
.vrow{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dashed #eee;font-size:17.5px}
.vrow:last-child{border-bottom:none}
.vrow .k{color:var(--muted)}.vrow .v{font-weight:700}
.donutbox{position:relative;height:220px}
.legendgrid{display:flex;flex-direction:column;gap:5px;margin-top:10px;padding:0 4px}
.legendgrid .litem{display:flex;align-items:center;gap:7px;font-size:16px;color:var(--ink);white-space:nowrap}
.legendgrid .dot{width:9px;height:9px;border-radius:2px;flex:0 0 auto}
.donutlegend{margin-top:6px;font-size:16px;color:var(--muted);text-align:center}
table.rtable{width:100%;border-collapse:collapse;font-size:17px}
table.rtable thead{position:sticky;top:0;z-index:2}
table.rtable th{background:#f4f4f5;color:#333;padding:7px 8px;text-align:center;border:1px solid var(--line);font-weight:700}
table.rtable td{padding:6px 8px;text-align:center;border:1px solid var(--line)}
table.rtable td.l{text-align:left}
table.rtable td.hl{background:#c7ecdf;font-weight:800;color:#04342c}
table.rtable td.hl2{background:#a9dcd0;font-weight:800;color:#04342c}
table.rtable td.hl3{background:var(--gold-bg);font-weight:800;color:#8a6a00}
.hl-year{color:var(--gold);font-weight:800}
.hl-total-bad{color:var(--bad);font-weight:800}
.hl-total-good{color:var(--good);font-weight:800}
table.rtable tr.grand td{background:#1F2535;color:#fff;font-weight:700}
table.rtable tr.grand td.hl{background:#085041;color:#fff}
table.rtable tr.grand td.hl2{background:#04342c;color:#fff}
table.rtable tr.grand td.hl3{background:#7a5c06;color:#fff}
table.rtable .colUncat{display:none}
.card.show-uncat table.rtable .colUncat{display:table-cell}
table.rtable .colRate{display:none}
.card.show-rate table.rtable .colRate{display:inline}
.chead-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.toggle-group{display:flex;align-items:center;gap:6px}
.uncat-toggle{position:relative;cursor:pointer;user-select:none;display:inline-flex}
.uncat-toggle input{position:absolute;opacity:0;width:16px;height:16px;margin:0;cursor:pointer}
.uncat-toggle .uncat-icon{font-size:18px;color:#c7cbd1;line-height:1;padding:2px;border-radius:4px;transition:color .15s,background .15s}
.uncat-toggle:hover .uncat-icon{color:var(--muted);background:#f0f2f4}
.uncat-toggle input:checked ~ .uncat-icon{color:var(--teal);background:#e6f4f2}
.uncat-toggle input:focus-visible ~ .uncat-icon{outline:2px solid var(--teal);outline-offset:1px}
table.ranktable tr.rank-top3 td{background:#fff8e6;font-weight:700}
.lowkey-toggle{margin:10px 2px 0}
.icon-toggle-row{display:flex;flex-wrap:wrap;align-items:flex-start;gap:14px;margin:10px 2px 0}
.icon-toggle-row>.lowkey-toggle{margin:0;flex:0 0 auto}
.icon-toggle-row>.lowkey-toggle[open]{flex:1 1 100%}
.lowkey-toggle summary{display:flex;align-items:center;gap:6px;font-size:17px;color:var(--muted);cursor:pointer;user-select:none;list-style:none}
.lowkey-toggle summary::-webkit-details-marker{display:none}
.lowkey-toggle summary:hover{color:var(--teal-d)}
.lowkey-toggle-body{margin-top:10px;padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:8px}
.lowkey-toggle-desc{font-size:17px;color:var(--muted);margin:0 0 10px}
.lowkey-btn{display:inline-flex;align-items:center;gap:6px;font-size:17px;color:var(--muted);cursor:pointer;user-select:none;background:none;border:none;padding:0;margin:8px 2px 0;font-family:inherit}
.lowkey-btn:hover{color:var(--teal-d)}
.icon-collapse .lowkey-toggle-text{display:none}
details.icon-collapse[open]>summary .lowkey-toggle-text{display:inline}
.lowkey-btn.icon-collapse.is-on .lowkey-toggle-text{display:inline}
.vendor-picker{display:flex;flex-wrap:wrap;gap:8px 16px}
/* 已使用年限比較：Top3 排行 */
.vage-top3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.top3-item{border-radius:10px;padding:10px 12px;background:var(--gold-bg);border:1px solid var(--gold);display:flex;flex-direction:column;gap:4px}
.top3-rank{display:inline-flex;align-items:center;gap:5px;font-size:15.5px;font-weight:800;color:var(--gold)}
.top3-rank .num{width:18px;height:18px;border-radius:50%;background:var(--gold);color:#fff;font-size:14px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.top3-name{font-size:17px;font-weight:800;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top3-vendor{font-size:15px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top3-years{font-size:17px;font-weight:800;color:var(--gold)}

/* 已使用年限比較：去年同期圖例 */
.vage-legend{display:flex;align-items:center;gap:16px;font-size:15.5px;color:var(--muted);margin:2px 0 14px}
.vage-legend .li{display:flex;align-items:center;gap:5px}
.vage-legend .sw{width:16px;height:11px;border-radius:2px;background:linear-gradient(90deg,var(--bar-general),color-mix(in srgb,var(--bar-general) 75%,white))}
.vage-legend .mk{width:2px;height:13px;background:var(--marker);position:relative}
.vage-legend .mk::after{content:'';position:absolute;top:-3px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-top:4px solid var(--marker)}

/* 已使用年限比較：分組橫條圖 */
.grp{margin-bottom:16px}
.grp:last-child{margin-bottom:0}
.grp-label{display:inline-flex;align-items:center;gap:6px;font-size:16px;font-weight:800;color:#fff;padding:2px 10px;border-radius:20px;margin-bottom:9px}
.grp-label.general{background:var(--bar-general)}
.grp-label.imaging{background:var(--bar-imaging)}
.barrow{display:grid;grid-template-columns:170px 1fr 84px;align-items:center;gap:8px;margin-bottom:8px}
.barrow .lbl{font-size:16px;color:var(--ink);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.barrow .lbl .vd{display:block;font-size:14px;color:var(--muted);font-weight:600}
.barrow .track{background:var(--bg);border-radius:5px;height:22px;position:relative;border:1px solid var(--line)}
.barrow .fill{height:100%;border-radius:5px 0 0 5px;display:flex;align-items:center;position:relative;overflow:hidden}
.barrow .fill.general{background:linear-gradient(90deg,var(--bar-general),color-mix(in srgb,var(--bar-general) 75%,white))}
.barrow .fill.imaging{background:linear-gradient(90deg,var(--bar-imaging),color-mix(in srgb,var(--bar-imaging) 75%,white))}
.barrow .fill.rank{outline:2px solid var(--gold);outline-offset:-2px}
.barrow .marker{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--marker);z-index:2}
.barrow .marker::after{content:'';position:absolute;top:-4px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-top:4px solid var(--marker)}
.barrow .yr{font-size:16px;font-weight:800;color:var(--gold);text-align:left;display:flex;flex-direction:column;line-height:1.25}
.barrow .yr .delta{font-size:14px;font-weight:700}
.barrow .delta.up{color:var(--teal)}.barrow .delta.down{color:var(--teal)}.barrow .delta.flat{color:var(--muted)}
.medal{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--gold);color:#fff;font-size:10px;font-weight:800;margin-right:4px;flex:none}

/* 已使用年限比較：可排序機型明細表 */
table.agg.vage-table th{cursor:pointer;user-select:none}
table.agg.vage-table th .arrows{display:inline-flex;flex-direction:column;margin-left:3px;vertical-align:middle;line-height:.6}
table.agg.vage-table th .arrows span{font-size:9px;color:rgba(255,255,255,.5)}
table.agg.vage-table th .arrows span.active{color:#fff;text-shadow:0 0 2px rgba(0,0,0,.4)}
.catchip{font-size:14px;font-weight:800;color:#fff;padding:1px 8px;border-radius:20px}
.catchip.general{background:var(--bar-general)}
.catchip.imaging{background:var(--bar-imaging)}
.vp-item{display:flex;align-items:center;gap:6px;font-size:17.5px;cursor:pointer;user-select:none}
.vp-item input{cursor:pointer}
.pill{display:inline-block;padding:2px 10px;border-radius:10px;font-size:17px;font-weight:700}
.pill.good{background:#e6f4ec;color:var(--good)}.pill.warn{background:#fdf1dd;color:#a86a00}.pill.bad{background:#fde7ea;color:var(--bad)}
.cmp-note{font-size:16px;color:var(--muted);margin-top:8px}
.cmp-wrap{border-radius:10px;overflow:hidden;border:1px solid var(--line);overflow-x:auto}
table.cmp{width:100%;border-collapse:collapse;font-size:18px}
table.cmp th{background:var(--teal-d);color:#fff;padding:10px 12px;text-align:center;font-weight:700;white-space:nowrap}
table.cmp th:first-child{text-align:left}
table.cmp td{padding:9px 12px;text-align:center;border-bottom:1px solid var(--line)}
table.cmp td.l{text-align:left;color:var(--muted);font-weight:700;white-space:nowrap}
table.cmp tbody tr:nth-child(even) td{background:#fafafa}
table.cmp tr.hl td{background:#e6f4f2;font-weight:700}
.cost-input{border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-family:inherit;font-size:17.5px}
.flow{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:0;padding:6px 0 4px}
.flow-step{background:var(--teal);color:#fff;padding:12px 26px;border-radius:10px;font-weight:800;font-size:20.5px;box-shadow:0 2px 6px rgba(0,0,0,.15);white-space:nowrap}
.flow-arrow{font-size:27.5px;color:var(--muted);padding:0 14px;font-weight:700}
@media(max-width:640px){.flow-arrow{transform:rotate(90deg);padding:4px 0}}
td.cond{text-align:left;font-size:17px;color:var(--ink)}
.formula-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.formula-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.formula-card .fn{font-size:18px;font-weight:800;color:var(--teal-d);margin-bottom:8px;display:flex;align-items:center;gap:6px}
.formula-card .fx{font-family:"DM Mono",Consolas,monospace;font-size:18.5px;background:#f7f9fa;border:1px dashed var(--line);border-radius:8px;padding:10px 12px;text-align:center;line-height:1.7;color:var(--ink)}
.formula-card .fd{font-size:16px;color:var(--muted);margin-top:8px;line-height:1.7}
.callout{background:#fff;border-left:5px solid var(--teal);border-radius:8px;padding:14px 18px;margin:0 0 16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.callout.bad{border-left-color:var(--bad);background:#fff8f9}
.callout.warn{border-left-color:var(--warn);background:#fffcf5}
.callout.good{border-left-color:var(--good);background:#f6fbf8}
.callout ul{margin:8px 0 0 20px}.callout li{margin:6px 0;font-size:21px;font-weight:700}
.big-quote{font-size:23px;font-weight:800;color:var(--teal-d)}
.note{font-size:17px;color:var(--muted);margin:4px 0 10px}
.advice-edit{white-space:pre-wrap;font-size:21px;font-weight:700;line-height:1.7;background:#fafbfc;border:1px solid var(--line);border-radius:8px;padding:14px 16px;width:100%;min-height:150px;font-family:inherit;resize:vertical;margin-bottom:10px}
.save-bar{text-align:center;margin-top:10px}
.save-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 22px;border:none;border-radius:8px;font-size:18.5px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#4DB6AC 0%,#26A69A 38%,#1E88E5 100%);color:#fff;box-shadow:0 2px 8px rgba(0,150,136,.35)}
.foot{color:var(--muted);font-size:17px;margin-top:14px;text-align:center}
.save-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:39px;height:39px;margin-left:4px;border:none;border-radius:8px;font-size:19px;cursor:pointer;background:rgba(255,255,255,.12);color:#fff;transition:background .15s}
.save-icon-btn:hover{background:rgba(255,255,255,.24)}
.gen-time.hidden{display:none}
.save-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);opacity:0;pointer-events:none;background:#1F2535;color:#fff;padding:13px 20px;border-radius:10px;font-size:15.5px;font-weight:700;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:90vw;z-index:50;transition:opacity .2s,transform .2s}
.save-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
.save-toast .fn{color:#8fd6cd;font-weight:800}
@media(max-width:900px){.topbar-inner{padding:10px 16px}.main{padding:16px}.g2,.g2-eq,.g3,.vendorgrid,.rlayout3{grid-template-columns:1fr}}
@media(max-width:820px){.two{grid-template-columns:1fr}}
</style></head><body>
<header class="topbar"><div class="topbar-inner">
  <div class="brand"><span class="t">${App.icons.chart()} 設備品質分析報告</span><span class="s gen-time hidden" id="gen-time">製表：${esc(genAt)}</span></div>
  <nav class="tabs">
    <button class="tab-btn on" data-tab="overview">${App.icons.pin()} 整體總覽</button>
    <button class="tab-btn" data-tab="vendor">${App.icons.factory()} 廠商比較</button>
    <button class="tab-btn" data-tab="kpi">${App.icons.chart()} KPI</button>
    <button class="save-icon-btn" id="btn-toggle-gentime" title="顯示／隱藏製表時間">${App.icons.clock()}</button>
    <button class="save-icon-btn" id="btn-save-edits" title="儲存編輯內容">${App.icons.save()}</button>
  </nav>
</div></header>
<main class="main">
${pages.map((p) => p.html).join('\n')}
</main>
<div class="save-toast" id="save-toast"></div>
<script>
const PAL=${JSON.stringify(PAL)};
const AMBER='#e08e00',RED='#D32F2F',GOOD='#1a9c53',TREND='#1E88E5';
const AMBER_BG='rgba(224,142,0,.18)',RED_BG='rgba(211,47,47,.15)',TREND_BG='rgba(30,136,229,.15)';
window.__bigNumHint=function(v){
  var n=Number(v)||0,abs=Math.abs(n);
  if(abs<10000)return '';
  var unit=abs>=100000000?100000000:10000, label=abs>=100000000?'億':'萬';
  var rounded=Math.round((n/unit)*10)/10;
  return '約 '+rounded+label;
};
window.__uncatMerged=true;
window.addEventListener('load',function(){
  // 「分析與說明」文字框依內容自動撐開高度，不使用內部捲軸（切到隱藏分頁時內容還沒顯示，
  // scrollHeight量不到，故切換分頁當下也要重新撐開一次）
  function __autoGrowAdvice(ta){
    ta.style.height='auto';
    ta.style.height=(ta.scrollHeight+2)+'px';
  }
  document.querySelectorAll('.advice-edit').forEach(function(ta){
    ta.addEventListener('input',function(){ __autoGrowAdvice(ta); });
  });
  document.querySelectorAll('.tab-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('on');});
      document.querySelectorAll('.page').forEach(function(p){p.classList.remove('on');});
      btn.classList.add('on');
      var pageEl=document.getElementById('page-'+btn.dataset.tab);
      pageEl.classList.add('on');
      pageEl.querySelectorAll('.advice-edit').forEach(__autoGrowAdvice);
      window.scrollTo(0,0);
    });
  });
  document.querySelectorAll('#page-overview .advice-edit').forEach(__autoGrowAdvice);
  if(typeof Chart!=='undefined'){
    Chart.defaults.font.size=13;
    Chart.defaults.font.weight=700;
    Chart.defaults.color='#4A5264';
    ${pages.map((p) => p.chartScript).join('\n')}
  }

  // ── 未歸類數併入不良品數：全報告連動（表格數字／KPI卡／長條圖／折線圖／圓餅圖）──
  function __ucFmtInt(v){ return Math.round(v).toLocaleString('en-US'); }
  function __ucFmtPct(v){ return (v*100).toFixed(1)+'%'; }
  function __ucPct(bad,uncat,den,on){ return den?(on?bad+uncat:bad)/den:0; }
  window.__ucApplyAll=function(){
    var on=window.__uncatMerged;
    document.querySelectorAll('.uc-bad:not([data-scope])').forEach(function(el){
      var bad=+el.dataset.bad,uncat=+el.dataset.uncat;
      el.textContent=__ucFmtInt(on?bad+uncat:bad);
    });
    document.querySelectorAll('.uc-rate').forEach(function(el){
      var bad=+el.dataset.bad,uncat=+el.dataset.uncat,den=+el.dataset.den;
      el.textContent=__ucFmtPct(__ucPct(bad,uncat,den,on));
    });
    document.querySelectorAll('.uc-uncat').forEach(function(el){
      el.textContent=__ucFmtInt(on?0:(+el.dataset.uncat));
    });
    document.querySelectorAll('.uc-uncat-rate').forEach(function(el){
      var uncat=+el.dataset.uncat,den=+el.dataset.den;
      el.textContent=__ucFmtPct(den?(on?0:uncat)/den:0);
    });
    var scopeTotals={};
    document.querySelectorAll('.uc-bad[data-scope]').forEach(function(el){
      var scope=el.dataset.scope,bad=+el.dataset.bad,uncat=+el.dataset.uncat;
      var v=on?bad+uncat:bad;
      el.textContent=__ucFmtInt(v);
      scopeTotals[scope]=(scopeTotals[scope]||0)+v;
    });
    document.querySelectorAll('.uc-share').forEach(function(el){
      var scope=el.dataset.scope,bad=+el.dataset.bad,uncat=+el.dataset.uncat;
      var v=on?bad+uncat:bad, total=scopeTotals[scope]||0;
      el.textContent=__ucFmtPct(total?v/total:0);
    });
    document.querySelectorAll('.uc-delta').forEach(function(el){
      var bad=+el.dataset.bad,uncat=+el.dataset.uncat,den=+el.dataset.den;
      var cbad=+el.dataset.cbad,cuncat=+el.dataset.cuncat,cden=+el.dataset.cden;
      var cur=__ucPct(bad,uncat,den,on), prev=__ucPct(cbad,cuncat,cden,on);
      var pp=(cur-prev)*100;
      var better=el.dataset.better==='true';
      var cls=Math.abs(pp)<0.05?'flat':(((pp>0)===better)?'good':'bad');
      el.className='d uc-delta d-'+cls;
      el.textContent=(pp>=0?'▲ +':'▼ ')+pp.toFixed(1)+'pp';
    });
    (window.__ucCharts||[]).forEach(function(spec){
      var c=Chart.getChart(spec.id); if(!c)return;
      c.data.datasets[0].data=spec.bad.map(function(b,i){ return on?b+(spec.uncat[i]||0):b; });
      c.update();
    });
    (window.__ucLineCharts||[]).forEach(function(spec){
      var c=Chart.getChart(spec.id); if(!c)return;
      var ds=c.data.datasets[spec.dsIndex]; if(!ds)return;
      ds.data=spec.bad.map(function(b,i){ var den=spec.den[i]||0; var u=spec.uncat[i]||0; return den?+((on?(b+u):b)/den*100).toFixed(1):0; });
      c.update();
    });
    if(window.__renderVendorSection){ window.__renderVendorSection('car'); window.__renderVendorSection('lens'); }
    if(window.__renderVendorAge){ ['car-general','car-imaging','lens'].forEach(function(d){ window.__renderVendorAge(d); }); }
  };
  var ucChecks=document.querySelectorAll('.uc-merge-checkbox');
  ucChecks.forEach(function(cb){
    cb.addEventListener('change',function(){
      window.__uncatMerged=cb.checked;
      ucChecks.forEach(function(other){ other.checked=cb.checked; });
      window.__ucApplyAll();
    });
  });
  window.__ucApplyAll();

  // ── 儲存編輯內容：把目前所有「分析與說明／AI建議說明」文字框的內容，連同整份報告重新存成一個新檔案 ──
  var DEFAULT_REPORT_FILENAME='${defaultFilename}';
  function __saveFilename(){
    try {
      if (location.protocol === 'file:') {
        var name = decodeURIComponent(location.pathname.split('/').pop() || '');
        if (name) return name;
      }
    } catch (e) {}
    return DEFAULT_REPORT_FILENAME;
  }
  var saveToastEl=document.getElementById('save-toast');
  var saveToastTimer=null;
  function __showSaveToast(name){
    if(!saveToastEl)return;
    saveToastEl.innerHTML='${App.icons.checkCircle()} 已儲存編輯內容，新檔案已下載：<span class="fn">'+name+'</span>　請用這份新檔案覆蓋原本的檔案';
    saveToastEl.classList.add('on');
    if(saveToastTimer)clearTimeout(saveToastTimer);
    saveToastTimer=setTimeout(function(){ saveToastEl.classList.remove('on'); },6000);
  }
  var genTimeBtn=document.getElementById('btn-toggle-gentime');
  var genTimeEl=document.getElementById('gen-time');
  if(genTimeBtn&&genTimeEl){
    genTimeBtn.addEventListener('click',function(){ genTimeEl.classList.toggle('hidden'); });
  }
  var saveBtn=document.getElementById('btn-save-edits');
  if(saveBtn){
    saveBtn.addEventListener('click',function(){
      document.querySelectorAll('textarea.advice-edit').forEach(function(ta){ ta.textContent=ta.value; });
      var html='<!DOCTYPE html>\\n'+document.documentElement.outerHTML;
      var blob=new Blob([html],{type:'text/html;charset=utf-8'});
      var name=__saveFilename();
      var a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      __showSaveToast(name);
    });
  }
});
</script></body></html>`;
  }

  /**
   * 生成落地頁報告：本機下載一律執行；若 App.cloud 已設定 CLOUD_ENDPOINT，同時上傳到共用雲端。
   * @returns {Promise<{cloud:{ok:boolean, error?:string, name?:string}|null}>}
   */
  async function exportReport(state) {
    const html = generateReportHTML(state);
    const filename = `品質分析報告_${state.year}-Q${state.quarter}_${new Date().toISOString().slice(0, 10)}.html`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);

    let cloud = null;
    if (App.cloud && App.cloud.enabled()) {
      try {
        const r = await App.cloud.upload(html, filename, 'text/html');
        cloud = { ok: true, name: r.name };
      } catch (err) { cloud = { ok: false, error: err && err.message }; }
    }
    return { cloud };
  }

  return { buildBundle, exportSnapshot, download, parseSnapshot, generateReportHTML, exportReport };
})();
