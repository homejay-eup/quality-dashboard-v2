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
  const rPct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
  const rYear = (v) => (v == null || v === '' ? '資料缺' : `${Number(v).toFixed(1)} 年`);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const PAL = ['#009688', '#26A69A', '#4DB6AC', '#1E88E5', '#1565C0', '#80CBC4', '#B2DFDB', '#E08E00', '#9AA0A6', '#EF5350'];

  function periodText(state) {
    const cur = state.currentSnap ? `${state.year}-Q${state.quarter}（快照）` : `${state.year}-Q${state.quarter}`;
    if (!state.cmp.on) return cur;
    const cmp = state.cmpSnap ? `${state.cmp.year}-Q${state.cmp.quarter}（快照）` : `${state.cmp.year}-Q${state.cmp.quarter}`;
    return `${cur}　vs　${cmp}`;
  }

  // ── 近 N 季序列（車機分析頁 用）─────────────────
  // 資料庫實際涵蓋幾季，這裡就吐幾季（state.currentPeriods 已由 app.js 依派工
  // 資料實際涵蓋到的月份算出，見 app.js buildPeriods），不寫死季數。
  function buildQuarterSeries(state, deviceKey) {
    const scope = deviceKey ? App.app.DEVICE_TABS.find((t) => t.key === deviceKey) : null;
    const periodsAsc = [...(state.currentPeriods || [])].reverse();
    const labels = [], 不良率 = [], 過保率 = [], 再使用率 = [];
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
    }
    return { labels, 不良率, 過保率, 再使用率 };
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
      return `<div class="d d-${cls}">${pp >= 0 ? '▲ +' : '▼ '}${pp.toFixed(1)}pp</div><div class="p">對比 ${rPct(prev)}</div>`;
    }
    const diff = cur - prev;
    const cls = diff === 0 ? 'flat' : (better == null ? 'flat' : (((diff > 0) === better) ? 'good' : 'bad'));
    return `<div class="d d-${cls}">${diff >= 0 ? '▲ +' : '▼ '}${rInt(diff)}</div><div class="p">對比 ${rInt(prev)}</div>`;
  }
  function kcard(label, val, deltaHTML, tone) {
    return `<div class="kcard${tone ? ` ${tone}` : ''}"><div class="l">${esc(label)}</div><div class="v">${val}</div>${deltaHTML || ''}</div>`;
  }

  // ════════════════════════════════════════════════════════════
  // 1. 整體總覽
  // ════════════════════════════════════════════════════════════
  const rDiff = (v) => (v > 0 ? `+${rInt(v)}` : rInt(v));

  // 回廠結果五桶（過保／不良／人為／仍在線＝良品／其他(未過)）＋佔回廠量／佔總上線量
  function bucketRows(kpi) {
    return [
      { label: '過保',          cls: 'warn', count: kpi.過保數,     period: kpi.期間過保率,     overall: kpi.整體過保率 },
      { label: '不良',          cls: 'bad',  count: kpi.不良品數,   period: kpi.期間不良率,     overall: kpi.整體不良率 },
      { label: '人為',          cls: '',     count: kpi.人為數,     period: kpi.期間人為率,     overall: kpi.整體人為率 },
      { label: '仍在線（良品）', cls: 'good', count: kpi.良品數,     period: kpi.再使用率,       overall: kpi.整體再使用率 },
      { label: '其他(未過)',    cls: '',     count: kpi.其他未過數, period: kpi.期間其他未過率, overall: kpi.整體其他未過率 },
    ];
  }

  function bucketBreakdownHTML(deviceKey, kpi, cmpKpi) {
    const rows = bucketRows(kpi);
    const cmpRows = cmpKpi ? bucketRows(cmpKpi) : null;
    const trs = rows.map((r, i) => {
      const cmpCell = cmpRows ? `<td class="num">${rDiff(r.count - cmpRows[i].count)}</td>` : '';
      return `<tr><td class="l"><span class="pill ${r.cls}">${esc(r.label)}</span></td><td class="num">${rInt(r.count)}</td><td class="num">${rPct(r.period)}</td><td class="num">${rPct(r.overall)}</td>${cmpCell}</tr>`;
    }).join('');
    return `<div class="card">
      <div class="chead"><div class="ct">${esc(deviceKey)}回廠結果分類</div><div class="cs">佔回廠量／佔總上線量${cmpKpi ? '　｜　含同期差異' : ''}</div></div>
      <div class="twrap"><table class="agg">
        <thead><tr><th class="l">分類</th><th class="num">數量</th><th class="num">佔回廠量</th><th class="num">佔總上線量</th>${cmpKpi ? '<th class="num">同期差異</th>' : ''}</tr></thead>
        <tbody>${trs}</tbody>
      </table></div>
    </div>`;
  }

  function deviceTypeSectionHTML(deviceKey, icon, d, selection, chartId) {
    const agg = aggByType(d, selection);
    agg.groups = [...agg.groups].sort((a, b) => b.subtotal.回廠量 - a.subtotal.回廠量); // 比照 draft：依回廠量由大到小
    const rows = agg.groups.map((g) => {
      const s = g.subtotal;
      return `<tr><td class="l">${esc(g.key)}</td><td>${rInt(s.上線量)}</td><td>${rInt(s.回廠量)}</td>
        <td>${rInt(s.良品數)}（${rPct(s.再使用率)}）</td><td>${rInt(s.不良品數)}（${rPct(s.不良率)}）</td>
        <td>${rInt(s.過保數)}（${rPct(s.過保率)}）</td><td class="hl">${rPct(s.整體不良率)}</td></tr>`;
    }).join('');
    const gt = agg.grandTotal;
    const donutLabels = agg.groups.map((g) => g.key);
    const donutData = agg.groups.map((g) => g.subtotal.回廠量);
    return {
      html: `<div class="sech">${icon} ${esc(deviceKey)}回廠量分析（依機型）</div>
      <div class="card">
        <div class="chead"><div class="ct">${esc(deviceKey)}回廠量分析</div><div class="cs">依機型分類，共 ${agg.groups.length} 類｜資料來源：${esc(deviceKey)}_彙整總覽</div></div>
        <div class="rlayout">
          <div><div class="donutbox"><canvas id="${chartId}"></canvas></div>
            <div class="donutlegend">${esc(deviceKey)}　｜　總上線量 ${rInt(gt.上線量)}</div></div>
          <div class="twrap"><div class="scroll">
            <table class="rtable">
              <thead><tr><th rowspan="2">機型</th><th rowspan="2">上線量</th><th colspan="4">回廠量</th><th rowspan="2">設備不良比率*</th></tr>
              <tr><th>回廠量</th><th>良品數/再使用率</th><th>不良品數</th><th>過保數</th></tr></thead>
              <tbody>${rows}
                <tr class="grand"><td class="l">總計</td><td>${rInt(gt.上線量)}</td><td>${rInt(gt.回廠量)}</td>
                  <td>${rInt(gt.良品數)}（${rPct(gt.再使用率)}）</td><td>${rInt(gt.不良品數)}（${rPct(gt.不良率)}）</td>
                  <td>${rInt(gt.過保數)}（${rPct(gt.過保率)}）</td><td class="hl">${rPct(gt.整體不良率)}</td></tr>
              </tbody>
            </table>
          </div></div>
        </div>
        <p class="note">*設備不良比率＝不良品數 ÷ 上線量（分母為在線設備總量，非回廠量）。</p>
      </div>`,
      chartScript: `new Chart(document.getElementById('${chartId}'),{type:'doughnut',
        data:{labels:${JSON.stringify(donutLabels)},datasets:[{data:${JSON.stringify(donutData)},backgroundColor:PAL,borderColor:'#fff',borderWidth:1}]},
        options:{maintainAspectRatio:false,cutout:'62%',plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11}}},title:{display:true,text:'${esc(deviceKey)}回廠量依機型'}}}});`,
    };
  }

  let __cpSeq = 0;
  function vendorHighlightHTML(deviceKey, d, selection) {
    const wanted = (selection && selection.廠商) || [];
    if (!wanted.length) return '';
    const agg = aggByVendor(d, selection);
    const found = wanted.map((v) => ({ v, g: agg.groups.find((g) => g.key === v) }))
      .filter((x) => x.g && x.g.subtotal.回廠量);
    if (!found.length) return '';
    const cards = found.map(({ v, g }) => {
      const s = g.subtotal;
      return `<div class="vcard"><div class="vh"><span class="nm">${esc(v)}</span></div>
        <div class="vrow"><span class="k">在線量</span><span class="v">${rInt(s.上線量)}</span></div>
        <div class="vrow"><span class="k">期間回廠量</span><span class="v">${rInt(s.回廠量)}</span></div>
        <div class="vrow"><span class="k">不良率</span><span class="v">${rPct(s.不良率)}</span></div>
        <div class="vrow"><span class="k">過保率</span><span class="v">${rPct(s.過保率)}</span></div>
        <div class="vrow"><span class="k">再使用率</span><span class="v">${rPct(s.再使用率)}</span></div>
        <div class="vrow"><span class="k">平均已使用年限</span><span class="v">${rYear(s.已使用年限)}</span></div>
      </div>`;
    }).join('');
    const gt = agg.grandTotal;
    // 動態欄數：選幾家廠商就出幾欄＋一欄「全設備平均」基準（比照 draft 的固定 2 欄格式，欄數改成動態）
    const priceRow = found.map(() => {
      const id = `cp-purchase-${++__cpSeq}`;
      return `<td><input type="number" class="cost-input" id="${id}" value="0" step="1" style="width:90px;text-align:right"></td>`;
    }).join('');
    const cmpTable = `<div class="card">
      <div class="chead"><div class="ct">${esc(deviceKey)}型號對比｜依目前篩選之廠商</div><div class="cs">${found.length} 家廠商 vs 全${esc(deviceKey)}平均</div></div>
      <div class="cmp-wrap"><table class="cmp">
        <thead><tr><th>項目</th>${found.map(({ v }) => `<th>${esc(v)}</th>`).join('')}<th>全${esc(deviceKey)}平均<br><span style="font-weight:400;font-size:11px">基準</span></th></tr></thead>
        <tbody>
          <tr><td class="l">採購參考單價 (TWD)*</td>${priceRow}<td>—</td></tr>
          <tr><td class="l">在線安裝</td>${found.map(({ g }) => `<td>${rInt(g.subtotal.上線量)}</td>`).join('')}<td>${rInt(gt.上線量)}</td></tr>
          <tr><td class="l">本期回廠量</td>${found.map(({ g }) => `<td>${rInt(g.subtotal.回廠量)}</td>`).join('')}<td>${rInt(gt.回廠量)}</td></tr>
          <tr><td class="l">不良率</td>${found.map(({ g }) => `<td>${rPct(g.subtotal.不良率)}</td>`).join('')}<td>${rPct(gt.不良率)}</td></tr>
          <tr><td class="l">過保率</td>${found.map(({ g }) => `<td>${rPct(g.subtotal.過保率)}</td>`).join('')}<td>${rPct(gt.過保率)}</td></tr>
          <tr><td class="l">再使用率</td>${found.map(({ g }) => `<td>${rPct(g.subtotal.再使用率)}</td>`).join('')}<td>${rPct(gt.再使用率)}</td></tr>
          <tr class="hl"><td class="l">平均已使用年限</td>${found.map(({ g }) => `<td>${rYear(g.subtotal.已使用年限)}</td>`).join('')}<td>—</td></tr>
        </tbody>
      </table></div>
      <p class="cmp-note">*採購參考單價尚無正式資料源，預設 0，可直接輸入試算值比較；儲存版本會保留你輸入的數字。</p>
    </div>`;
    return `<div class="sech" style="margin-top:22px">重點廠商｜${esc(deviceKey)}（依目前篩選之廠商）</div><div class="vendorgrid">${cards}</div>${cmpTable}`;
  }

  function overviewPageHTML(ctx) {
    const { car, lens, carSelection, lensSelection } = ctx;
    const combined = combineKPI(car.kpi, lens.kpi);
    const combinedCmp = (ctx.hasCmp && car.cmpKpi && lens.cmpKpi) ? combineKPI(car.cmpKpi, lens.cmpKpi) : null;
    const carSec = deviceTypeSectionHTML('車機', App.icons.car(), car, carSelection, 'ov-donut-car');
    const lensSec = deviceTypeSectionHTML('鏡頭', App.icons.camera(), lens, lensSelection, 'ov-donut-lens');
    const findings = (App.advice && App.advice.genFindings) ? App.advice.genFindings({ kpi: combined, cmpKpi: combinedCmp }) : [];
    const tone = combined.整體不良率 >= 0.03 ? 'bad' : combined.整體不良率 >= 0.01 ? 'warn' : 'good';

    // 回廠結果五桶：過保／不良／人為／仍在線（良品）／其他(未過)，佔回廠量＋佔總上線量
    const bucketBullets = [
      `車機回廠 ${rInt(car.kpi.期間回廠量)} 件中，仍在線（良品）佔 ${rPct(car.kpi.再使用率)}，過保 ${rPct(car.kpi.期間過保率)}，不良 ${rPct(car.kpi.期間不良率)}，人為 ${rPct(car.kpi.期間人為率)}，其他(未過) ${rPct(car.kpi.期間其他未過率)}。`,
      `鏡頭回廠 ${rInt(lens.kpi.期間回廠量)} 件中，仍在線（良品）佔 ${rPct(lens.kpi.再使用率)}，過保 ${rPct(lens.kpi.期間過保率)}，不良 ${rPct(lens.kpi.期間不良率)}，人為 ${rPct(lens.kpi.期間人為率)}，其他(未過) ${rPct(lens.kpi.期間其他未過率)}。`,
    ];
    if (ctx.hasCmp) {
      bucketBullets.push(`與去年同期相比，車機不良率變化 ${((car.kpi.期間不良率 - car.cmpKpi.期間不良率) * 100).toFixed(1)}pp，鏡頭不良率變化 ${((lens.kpi.期間不良率 - lens.cmpKpi.期間不良率) * 100).toFixed(1)}pp。`);
    }

    return {
      html: `<section class="page on" id="page-overview">
        <div class="ph"><div><span class="ph-l">📌 整體總覽</span><span class="ph-s">車機＋鏡頭　｜　期間：${esc(periodText(ctx.state))}</span></div></div>
        <div class="sech">整體數值</div>
        <div class="krow">
          ${kcard('車機總在線量', rInt(car.kpi.總線上量), ctx.hasCmp ? kpiDeltaHTML(car.kpi.總線上量, car.cmpKpi.總線上量, 'int', null) : '')}
          ${kcard('鏡頭總在線量', rInt(lens.kpi.總線上量), ctx.hasCmp ? kpiDeltaHTML(lens.kpi.總線上量, lens.cmpKpi.總線上量, 'int', null) : '')}
          ${kcard('車機期間回廠量', rInt(car.kpi.期間回廠量), ctx.hasCmp ? kpiDeltaHTML(car.kpi.期間回廠量, car.cmpKpi.期間回廠量, 'int', null) : '')}
          ${kcard('鏡頭期間回廠量', rInt(lens.kpi.期間回廠量), ctx.hasCmp ? kpiDeltaHTML(lens.kpi.期間回廠量, lens.cmpKpi.期間回廠量, 'int', null) : '')}
          ${kcard('整體不良率', rPct(combined.整體不良率), combinedCmp ? kpiDeltaHTML(combined.整體不良率, combinedCmp.整體不良率, 'pct', false) : '', 'good')}
          ${kcard('整體過保率', rPct(combined.整體過保率), combinedCmp ? kpiDeltaHTML(combined.整體過保率, combinedCmp.整體過保率, 'pct', false) : '', 'good')}
        </div>
        <div class="sech">回廠結果分類佔比（過保／不良／人為／仍在線／其他未過）</div>
        <div class="g2">
          ${bucketBreakdownHTML('車機', car.kpi, ctx.hasCmp ? car.cmpKpi : null)}
          ${bucketBreakdownHTML('鏡頭', lens.kpi, ctx.hasCmp ? lens.cmpKpi : null)}
        </div>
        <div class="callout good"><p class="big-quote">整體建議說明</p><ul>${bucketBullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
        <div class="card">
          <div class="chead"><div class="ct">車機／鏡頭 數量與回廠量對比</div><div class="cs">${esc(periodText(ctx.state))}</div></div>
          <div class="g2"><div class="chartbox"><canvas id="ov-c1"></canvas></div><div class="chartbox"><canvas id="ov-c2"></canvas></div></div>
        </div>
        ${carSec.html}
        ${lensSec.html}
        ${vendorHighlightHTML('車機', car, carSelection)}
        ${vendorHighlightHTML('鏡頭', lens, lensSelection)}
        ${findings.length ? `<div class="callout ${tone}"><p class="big-quote">分析與說明</p><ul>${findings.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>` : ''}
      </section>`,
      chartScript: `
        new Chart(document.getElementById('ov-c1'),{type:'bar',data:{labels:['車機','鏡頭'],datasets:[{label:'總在線量',data:[${car.kpi.總線上量 || 0},${lens.kpi.總線上量 || 0}],backgroundColor:[TEAL,BLUE]}]},
          options:{maintainAspectRatio:false,plugins:{legend:{display:false},title:{display:true,text:'總在線量對比'}},scales:{y:{beginAtZero:true}}}});
        new Chart(document.getElementById('ov-c2'),{type:'bar',data:{labels:['車機','鏡頭'],datasets:[{label:'期間回廠量',data:[${car.kpi.期間回廠量 || 0},${lens.kpi.期間回廠量 || 0}],backgroundColor:[TEAL,BLUE]}]},
          options:{maintainAspectRatio:false,plugins:{legend:{display:false},title:{display:true,text:'期間回廠量對比'}},scales:{y:{beginAtZero:true}}}});
        ${carSec.chartScript}
        ${lensSec.chartScript}`,
    };
  }

  function editableAdviceHTML(deviceKeySafe, label, kind, text) {
    return `<h3>${esc(label)}</h3>
      <textarea class="advice-edit" data-key="${deviceKeySafe}-${kind}">${esc(text)}</textarea>`;
  }

  // ════════════════════════════════════════════════════════════
  // 2. 車機分析
  // ════════════════════════════════════════════════════════════
  function carAnalysisPageHTML(ctx) {
    const { car, carSelection: selection } = ctx;
    const d = car, k = d.kpi, c = d.cmpKpi, hasCmp = ctx.hasCmp;
    const aggAll = App.metrics.aggregate(d.rows, d.online, selection, {});
    const gt = aggAll.grandTotal;
    const 人為佔比 = gt.回廠量 ? (gt.回廠人為數 || 0) / gt.回廠量 : 0;
    const series = buildQuarterSeries(ctx.state, '車機');
    const vendorAgg = aggByVendor(d, selection);
    const vRows = vendorAgg.groups.map((g) => {
      const s = g.subtotal;
      return `<tr><td class="l">${esc(g.key)}</td><td class="num">${rInt(s.上線量)}</td><td class="num">${rInt(s.回廠量)}</td>
        <td class="num">${rInt(s.過保數)}</td><td class="num">${rInt(s.不良品數)}</td>
        <td class="num">${rPct(s.過保率)}</td><td class="num">${rPct(s.不良率)}</td></tr>`;
    }).join('');
    // 明確用車機自己的 selection 蓋掉 ctx.state.selection（那只代表目前畫面停留的分頁，
    // 產報告時使用者可能正停在鏡頭分頁，不能拿鏡頭的篩選當車機建議文字的依據）
    const advState = { ...ctx.state, rows: d.rows, kpi: k, cmpKpi: c, selection };
    const advice = (App.advice && App.advice.getTexts) ? App.advice.getTexts(advState) : { 品管: '', 採購: '' };
    const findings = (App.advice && App.advice.genFindings) ? App.advice.genFindings({ kpi: k, cmpKpi: hasCmp ? c : null }) : [];
    const tone = k.整體不良率 >= 0.03 ? 'bad' : k.整體不良率 >= 0.01 ? 'warn' : 'good';
    return {
      html: `<section class="page" id="page-car">
        <div class="ph"><div><span class="ph-l">🚗 車機分析</span><span class="ph-s">期間：${esc(periodText(ctx.state))}</span></div></div>
        <div class="krow">
          ${kcard('過保總佔比', rPct(k.期間過保率), hasCmp ? kpiDeltaHTML(k.期間過保率, c.期間過保率, 'pct', false) : '', 'good')}
          ${kcard('不良品佔比', rPct(k.期間不良率), hasCmp ? kpiDeltaHTML(k.期間不良率, c.期間不良率, 'pct', false) : '', 'good')}
          ${kcard('人為佔比', rPct(人為佔比), '')}
          ${kcard('仍在線數', rInt(k.總線上量), hasCmp ? kpiDeltaHTML(k.總線上量, c.總線上量, 'int', null) : '')}
        </div>
        <div class="card">
          <div class="chead"><div class="ct">車機回廠原因結構</div><div class="cs">${esc(periodText(ctx.state))}　｜　右圖為近 ${series.labels.length} 季真實趨勢</div></div>
          <div class="g2"><div class="chartbox"><canvas id="car-c1"></canvas></div><div class="chartbox"><canvas id="car-c2"></canvas></div></div>
        </div>
        <div class="card">
          <div class="chead"><div class="ct">車機_彙整總覽（依廠商）</div><div class="cs">${esc(periodText(ctx.state))}</div></div>
          <div class="twrap"><div class="scroll"><table class="agg">
            <thead><tr><th class="l">廠商</th><th class="num">在線量</th><th class="num">回廠量</th><th class="num">過保數</th><th class="num">不良品數</th><th class="num">過保率</th><th class="num">不良率</th></tr></thead>
            <tbody>${vRows}
              <tr class="grand"><td class="l">總計</td><td class="num">${rInt(vendorAgg.grandTotal.上線量)}</td><td class="num">${rInt(vendorAgg.grandTotal.回廠量)}</td>
                <td class="num">${rInt(vendorAgg.grandTotal.過保數)}</td><td class="num">${rInt(vendorAgg.grandTotal.不良品數)}</td>
                <td class="num">${rPct(vendorAgg.grandTotal.過保率)}</td><td class="num">${rPct(vendorAgg.grandTotal.不良率)}</td></tr>
            </tbody>
          </table></div></div>
        </div>
        ${findings.length ? `<div class="callout ${tone}"><p class="big-quote">分析與說明</p><ul>${findings.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>` : ''}
        <div class="card">
          <div class="chead"><div class="ct">品管／採購建議（可編輯）</div><div class="cs">系統依指標自動生成初稿，可直接於框內修改</div></div>
          ${editableAdviceHTML('車機', '品管建議（可編輯）', '品管', advice.品管)}
          ${editableAdviceHTML('車機', '採購建議（可編輯）', '採購', advice.採購)}
          <div class="save-bar"><button class="save-btn" id="save-edited">${App.icons.save()} 儲存目前版本（含已編輯的建議文字）</button></div>
        </div>
      </section>`,
      chartScript: `
        new Chart(document.getElementById('car-c1'),{type:'doughnut',
          data:{labels:['過保','不良品','人為','良品'],datasets:[{data:[${gt.過保數 || 0},${gt.不良品數 || 0},${gt.回廠人為數 || 0},${gt.良品數 || 0}],backgroundColor:[AMBER,RED,'#9AA0A6',GOOD]}]},
          options:{maintainAspectRatio:false,plugins:{legend:{position:'right'},title:{display:true,text:'回廠原因結構'}}}});
        new Chart(document.getElementById('car-c2'),{type:'line',
          data:{labels:${JSON.stringify(series.labels)},datasets:[
            {label:'過保率%',data:${JSON.stringify(series.過保率)},borderColor:AMBER,backgroundColor:'rgba(224,142,0,.1)',fill:true,tension:.3,pointRadius:3},
            {label:'不良率%',data:${JSON.stringify(series.不良率)},borderColor:RED,fill:false,tension:.3,pointRadius:3}
          ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'top'},title:{display:true,text:'過保率／不良率 近${series.labels.length}季真實趨勢'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}}});`,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 3. 使用率（內部檢測數量／省下的成本／送修運費）
  // ════════════════════════════════════════════════════════════
  const SHIP_COST_PER_TRIP = 300, SHIP_TRIPS_PER_WEEK = 2, SHIP_WEEKS_PER_MONTH = 4;
  function periodMonths(quarter) { return quarter * 3; }
  function shippingCost(months) { return SHIP_COST_PER_TRIP * SHIP_TRIPS_PER_WEEK * SHIP_WEEKS_PER_MONTH * months; }

  function reuseUsagePageHTML(ctx) {
    const { car, lens, state } = ctx, hasCmp = ctx.hasCmp;
    const months = periodMonths(state.quarter);
    const cmpMonths = hasCmp ? periodMonths(state.cmp.quarter) : null;
    const freight = shippingCost(months);
    const cmpFreight = hasCmp ? shippingCost(cmpMonths) : null;

    // 呈岳科技（鏡頭）：大陸廠商，無法送修回大陸，回廠品項僅能內部自行整新（QC=回廠QC）
    const chengyueKpi = App.metrics.computeKPI(lens.rows, lens.online, { 廠商: ['呈岳科技'] });
    const chengyueCmpKpi = (hasCmp && lens.cmpRows) ? App.metrics.computeKPI(lens.cmpRows, lens.cmpOnline, { 廠商: ['呈岳科技'] }) : null;

    const bullets1 = [
      `車機內部檢測（回廠QC）${rInt(car.kpi.內部檢測數)} 件，鏡頭 ${rInt(lens.kpi.內部檢測數)} 件；這些機台因內部檢測判定良品，不需送外部維修。`,
      `送修運費為固定物流排班成本（每次300元、一週2次、一個月4週 × ${months}個月），與送修件數無關，本期共 ${rInt(freight)} 元。`,
    ];
    const bullets2 = hasCmp ? [
      `車機內部檢測數量 ${rInt(car.kpi.內部檢測數)} 件，較去年同期 ${rInt(car.cmpKpi.內部檢測數)} 件，變化 ${rDiff(car.kpi.內部檢測數 - car.cmpKpi.內部檢測數)} 件。`,
      `鏡頭內部檢測數量 ${rInt(lens.kpi.內部檢測數)} 件，較去年同期 ${rInt(lens.cmpKpi.內部檢測數)} 件，變化 ${rDiff(lens.kpi.內部檢測數 - lens.cmpKpi.內部檢測數)} 件。`,
    ] : [];
    const bullets3 = [
      `呈岳科技（鏡頭）為大陸廠商，無法送修回大陸，回廠品項僅能內部自行整新處理，本期自行整新（QC=回廠QC）${rInt(chengyueKpi.內部檢測數)} 件${chengyueCmpKpi ? `，較去年同期 ${rInt(chengyueCmpKpi.內部檢測數)} 件，變化 ${rDiff(chengyueKpi.內部檢測數 - chengyueCmpKpi.內部檢測數)} 件` : ''}。`,
    ];

    return {
      html: `<section class="page" id="page-usage">
        <div class="ph"><div><span class="ph-l">🔄 使用率</span><span class="ph-s">內部檢測與送修成本｜期間：${esc(periodText(state))}</span></div></div>
        <div class="krow">
          ${kcard('車機內部檢測數量', rInt(car.kpi.內部檢測數), hasCmp ? kpiDeltaHTML(car.kpi.內部檢測數, car.cmpKpi.內部檢測數, 'int', true) : '', 'good')}
          ${kcard('鏡頭內部檢測數量', rInt(lens.kpi.內部檢測數), hasCmp ? kpiDeltaHTML(lens.kpi.內部檢測數, lens.cmpKpi.內部檢測數, 'int', true) : '', 'good')}
          <div class="kcard"><div class="l">預估省下的成本</div><div class="v" id="kpi-saved-cost-total">0 元</div><div class="p">內部檢測數量 × 單位成本</div></div>
          <div class="kcard" style="border-top-color:var(--warn)"><div class="l">送修運費（固定物流成本）</div><div class="v">${rInt(freight)} 元</div><div class="p">300元/次 × 2次/週 × 4週/月 × ${months}個月，與件數無關</div></div>
        </div>
        <div class="card">
          <div class="chead"><div class="ct">省下的成本試算（可編輯）</div><div class="cs">內部檢測數量（QC=回廠QC）× 單位成本；車機／鏡頭單位成本可各自調整，預設車機8,000元、鏡頭2,000元</div></div>
          <div class="twrap"><div class="scroll">
            <table class="agg" id="usage-cost-table">
              <thead><tr><th class="l">設備</th><th class="num">內部檢測數量（件）</th><th class="num">單位成本（元）</th><th class="num">省下的成本（元）</th></tr></thead>
              <tbody>
                <tr data-device="車機" data-qty="${car.kpi.內部檢測數}">
                  <td class="l">車機（影像主機）</td><td class="num">${rInt(car.kpi.內部檢測數)}</td>
                  <td class="num"><input type="number" class="cost-input in-unitcost" id="uc-car-cost" value="8000" step="100" style="width:100px;text-align:right"></td>
                  <td class="num saved-out">0</td>
                </tr>
                <tr data-device="鏡頭" data-qty="${lens.kpi.內部檢測數}">
                  <td class="l">鏡頭</td><td class="num">${rInt(lens.kpi.內部檢測數)}</td>
                  <td class="num"><input type="number" class="cost-input in-unitcost" id="uc-lens-cost" value="2000" step="100" style="width:100px;text-align:right"></td>
                  <td class="num saved-out">0</td>
                </tr>
              </tbody>
              <tfoot><tr class="grand"><td class="l" colspan="3">總計</td><td class="num" id="usage-saved-total">0</td></tr></tfoot>
            </table>
          </div></div>
        </div>
        <div class="callout good"><p class="big-quote">整體建議說明</p><ul>${bullets1.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
        ${hasCmp ? `<div class="card">
          <div class="chead"><div class="ct">與去年同期比較</div><div class="cs">${esc(periodText(state))}</div></div>
          <div class="twrap"><table class="agg">
            <thead><tr><th class="l">指標</th><th class="num">對比期間</th><th class="num">目前期間</th><th class="num">差異</th></tr></thead>
            <tbody>
              <tr><td class="l">車機內部檢測數量（件）</td><td class="num">${rInt(car.cmpKpi.內部檢測數)}</td><td class="num">${rInt(car.kpi.內部檢測數)}</td><td class="num">${rDiff(car.kpi.內部檢測數 - car.cmpKpi.內部檢測數)}</td></tr>
              <tr><td class="l">鏡頭內部檢測數量（件）</td><td class="num">${rInt(lens.cmpKpi.內部檢測數)}</td><td class="num">${rInt(lens.kpi.內部檢測數)}</td><td class="num">${rDiff(lens.kpi.內部檢測數 - lens.cmpKpi.內部檢測數)}</td></tr>
              <tr><td class="l">送修運費（固定物流成本，元）</td><td class="num">${rInt(cmpFreight)}</td><td class="num">${rInt(freight)}</td><td class="num">${rDiff(freight - cmpFreight)}</td></tr>
            </tbody>
          </table></div>
        </div>
        <div class="callout good"><p class="big-quote">同期比較說明</p><ul>${bullets2.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>` : ''}
        <div class="card">
          <div class="chead"><div class="ct">呈岳科技（鏡頭）自行整新數量</div><div class="cs">大陸廠商，無法送修回大陸，回廠品項僅能內部自行整新（QC=回廠QC）</div></div>
          <div class="krow">
            ${kcard('呈岳科技自行整新數量', rInt(chengyueKpi.內部檢測數), chengyueCmpKpi ? kpiDeltaHTML(chengyueKpi.內部檢測數, chengyueCmpKpi.內部檢測數, 'int', true) : '', 'good')}
          </div>
        </div>
        <div class="callout good"><p class="big-quote">整體建議說明</p><ul>${bullets3.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
      </section>`,
      chartScript: `
        window.__recomputeUsageSaving=function(){
          var carCostEl=document.getElementById('uc-car-cost');
          if(!carCostEl)return;
          var total=0;
          document.querySelectorAll('#usage-cost-table tbody tr').forEach(function(tr){
            var qty=parseFloat(tr.dataset.qty)||0;
            var unitCost=parseFloat(tr.querySelector('.in-unitcost').value)||0;
            var saved=qty*unitCost;
            tr.querySelector('.saved-out').textContent=Math.round(saved).toLocaleString('en-US');
            total+=saved;
          });
          var totalEl=document.getElementById('usage-saved-total'); if(totalEl)totalEl.textContent=Math.round(total).toLocaleString('en-US');
          var kpiEl=document.getElementById('kpi-saved-cost-total'); if(kpiEl)kpiEl.textContent=Math.round(total).toLocaleString('en-US')+' 元';
        };
        document.querySelectorAll('#page-usage .cost-input').forEach(function(el){el.addEventListener('input',window.__recomputeUsageSaving);});
        window.__recomputeUsageSaving();`,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 4. 重點廠商比較（同期）
  // ════════════════════════════════════════════════════════════
  const CAR_SPOTLIGHT_VENDORS = ['馥鴻科技', '深圳市銳明技術'];
  const LENS_SPOTLIGHT_VENDORS = ['新眾', '呈岳科技'];

  function vendorSpotlightCardHTML(vendorName, kpi, cmpKpi) {
    const rows = bucketRows(kpi);
    const cmpRows = cmpKpi ? bucketRows(cmpKpi) : null;
    const bucketTr = rows.map((r, i) => {
      const cmpCells = cmpRows ? `<td class="num">${rInt(cmpRows[i].count)}</td><td class="num">${rDiff(r.count - cmpRows[i].count)}</td>` : '';
      return `<tr><td class="l"><span class="pill ${r.cls}">${esc(r.label)}</span></td><td class="num">${rInt(r.count)}</td>${cmpCells}</tr>`;
    }).join('');
    return `<div class="card">
      <div class="chead"><div class="ct">${esc(vendorName)}</div><div class="cs">回廠量 ${rInt(kpi.期間回廠量)}${cmpKpi ? `　｜　去年同期 ${rInt(cmpKpi.期間回廠量)}　｜　差異 ${rDiff(kpi.期間回廠量 - cmpKpi.期間回廠量)}` : ''}</div></div>
      <div class="twrap"><table class="agg">
        <thead><tr><th class="l">分類</th><th class="num">數量</th>${cmpKpi ? '<th class="num">去年同期</th><th class="num">差異</th>' : ''}</tr></thead>
        <tbody>${bucketTr}</tbody>
      </table></div>
    </div>`;
  }

  function vendorSpotlightPageHTML(ctx) {
    const { car, lens, state } = ctx, hasCmp = ctx.hasCmp;
    const carCards = CAR_SPOTLIGHT_VENDORS.map((v) => {
      const kpi = App.metrics.computeKPI(car.rows, car.online, { 廠商: [v] });
      const cmpKpi = (hasCmp && car.cmpRows) ? App.metrics.computeKPI(car.cmpRows, car.cmpOnline, { 廠商: [v] }) : null;
      return { v, kpi, cmpKpi };
    });
    const lensCards = LENS_SPOTLIGHT_VENDORS.map((v) => {
      const kpi = App.metrics.computeKPI(lens.rows, lens.online, { 廠商: [v] });
      const cmpKpi = (hasCmp && lens.cmpRows) ? App.metrics.computeKPI(lens.cmpRows, lens.cmpOnline, { 廠商: [v] }) : null;
      return { v, kpi, cmpKpi };
    });

    const bullets = [];
    carCards.forEach(({ v, kpi, cmpKpi }) => {
      bullets.push(`${v}（車機）回廠量 ${rInt(kpi.期間回廠量)} 件${cmpKpi ? `，較去年同期 ${rInt(cmpKpi.期間回廠量)} 件，變化 ${rDiff(kpi.期間回廠量 - cmpKpi.期間回廠量)} 件` : ''}。`);
    });
    lensCards.forEach(({ v, kpi, cmpKpi }) => {
      bullets.push(`${v}（鏡頭）回廠量 ${rInt(kpi.期間回廠量)} 件${cmpKpi ? `，較去年同期 ${rInt(cmpKpi.期間回廠量)} 件，變化 ${rDiff(kpi.期間回廠量 - cmpKpi.期間回廠量)} 件` : ''}。`);
    });
    if (!hasCmp) bullets.push('目前未開啟對比期間，僅顯示當期數字；開啟對比期間後可看到同期差異。');

    return {
      html: `<section class="page" id="page-vendor">
        <div class="ph"><div><span class="ph-l">🏭 重點廠商比較</span><span class="ph-s">車機：馥鴻科技／深圳市銳明技術　｜　鏡頭：新眾／呈岳科技　｜　期間：${esc(periodText(state))}</span></div></div>
        <div class="sech">車機重點廠商</div>
        <div class="g2">${carCards.map(({ v, kpi, cmpKpi }) => vendorSpotlightCardHTML(v, kpi, cmpKpi)).join('')}</div>
        <div class="sech">鏡頭重點廠商</div>
        <div class="g2">${lensCards.map(({ v, kpi, cmpKpi }) => vendorSpotlightCardHTML(v, kpi, cmpKpi)).join('')}</div>
        <div class="callout good"><p class="big-quote">整體建議說明</p><ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
      </section>`,
      chartScript: '',
    };
  }

  // ════════════════════════════════════════════════════════════
  // 5. 資料來源與邏輯說明（規則性說明文字，沿用草稿內容；期間動態帶入）
  // ════════════════════════════════════════════════════════════
  function logicPageHTML(ctx) {
    return {
      html: `<section class="page" id="page-logic">
        <div class="ph"><div><span class="ph-l">📖 資料來源與邏輯說明</span><span class="ph-s">品質分析範圍與邏輯｜${esc(periodText(ctx.state))}</span></div></div>
        <div class="sech">分析流程</div>
        <div class="card">
          <div class="flow">
            <div class="flow-step">📋 派工</div><div class="flow-arrow">→</div>
            <div class="flow-step">🏭 回廠</div><div class="flow-arrow">→</div>
            <div class="flow-step">🔧 維修</div><div class="flow-arrow">→</div>
            <div class="flow-step">🗑️ 報廢</div>
          </div>
          <p class="note" style="text-align:center;margin-top:10px">全部分析皆以「期間內」的派工→回廠→維修→報廢 完整處理鏈為基礎。</p>
        </div>
        <div class="sech">品質分析範圍</div>
        <div class="card"><div class="twrap"><table class="agg">
          <thead><tr><th class="l">項目</th><th class="l">🚗 車機</th><th class="l">📷 鏡頭</th></tr></thead>
          <tbody>
            <tr><td class="l">產品類別</td><td class="l" colspan="2">車機、鏡頭</td></tr>
            <tr><td class="l">維護原因</td><td class="l">訊號異常</td><td class="l">影像異常(鏡頭)</td></tr>
          </tbody>
        </table></div></div>
        <div class="sech">良品／不良品／過保 判斷（依現行分類規則）</div>
        <div class="card"><div class="twrap"><table class="agg">
          <thead><tr><th class="l">分類</th><th class="l">說明</th></tr></thead>
          <tbody>
            <tr><td class="l"><span class="pill good">良品</span></td><td class="cond">測試正常／回廠QC／其他(良品) — 可直接再使用</td></tr>
            <tr><td class="l"><span class="pill bad">不良品</span></td><td class="cond">評估後退修／已完修／維修換貨＋換貨條碼 — 確認故障</td></tr>
            <tr><td class="l"><span class="pill warn">過保</span></td><td class="cond">停產報廢／過保報廢／回廠報廢 — 過保或停產無法檢修</td></tr>
            <tr><td class="l">人為</td><td class="cond">人為報廢</td></tr>
          </tbody>
        </table></div></div>
        <div class="sech">各項比率（KPI）計算邏輯</div>
        <div class="card"><div class="formula-grid">
          <div class="formula-card"><div class="fn">🔄 再使用率 (%)</div><div class="fx">良品數 ÷ 回廠量</div><div class="fd">回廠設備中，可直接再使用（整新／測試正常）的比例。</div></div>
          <div class="formula-card"><div class="fn">⚠️ 不良率 (%)</div><div class="fx">不良品數 ÷ 回廠量</div><div class="fd">回廠設備中，確認故障需維修換貨的比例。</div></div>
          <div class="formula-card"><div class="fn">📦 過保率 (%)</div><div class="fx">過保數 ÷ 回廠量</div><div class="fd">回廠設備中，因過保／停產／報廢無法檢修的比例。</div></div>
          <div class="formula-card"><div class="fn">📊 整體不良率／過保率</div><div class="fx">不良品數(或過保數) ÷ 總上線量</div><div class="fd">以在線設備總量為分母，反映對整體機隊的影響程度。</div></div>
        </div></div>
        <div class="sech">資料來源與已知限制</div>
        <div class="card">
          <div class="twrap"><table class="agg">
            <thead><tr><th class="l">頁面</th><th class="l">資料來源</th></tr></thead>
            <tbody>
              <tr><td class="l">整體總覽／車機分析（KPI、機型、廠商）</td><td class="l">雲端 Google Sheet「設備品質分析_來源」，逐 ERP品號、依季彙整（App.metrics.aggregate）</td></tr>
              <tr><td class="l">使用率與節省金額</td><td class="l">再使用率＝上述彙整資料（真實）；節省金額試算為可編輯試算工具（時薪／運費／工時／整新單價／新購參考單價皆可手動輸入），數字為使用者輸入值，非正式資料源</td></tr>
              <tr><td class="l">同期比較</td><td class="l">逐季重算（App.transform.buildDetail 逐季呼叫），非預先彙整快照，故任何歷史季度都可即時算出；節省金額 YoY 比較尚未實作（需雙期間各自試算）</td></tr>
            </tbody>
          </table></div>
          <div class="callout warn" style="margin-top:14px">
            <p class="big-quote">已知限制</p>
            <ul>
              <li>「新購參考單價」「整新單價」在公司內部成本資料中從未系統性填寫，「使用率與節省金額」頁改為可編輯試算工具，預設 0、可手動輸入比較，尚未接上正式資料源，數字僅供試算參考。</li>
              <li>本報告「不良率／過保率」等 KPI 僅涵蓋定義範圍內的維護原因（車機＝訊號異常、鏡頭＝影像異常），與其他統計口徑不同，數字不直接可比。</li>
              <li>BI 資料庫為前一日備份，非即時資料。</li>
            </ul>
          </div>
        </div>
      </section>`,
      chartScript: '',
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

    const pages = [
      overviewPageHTML(ctx),
      carAnalysisPageHTML(ctx),
      reuseUsagePageHTML(ctx),
      vendorSpotlightPageHTML(ctx),
      logicPageHTML(ctx),
    ];

    return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>設備品質分析報告 ${esc(periodText(state))}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
:root{--teal:#009688;--teal-d:#00695C;--ink:#1F2535;--muted:#6B7384;--line:#DDE1E9;--bg:#F5F7FA;--good:#1a9c53;--warn:#e08e00;--bad:#D32F2F}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif;color:var(--ink);background:var(--bg);line-height:1.6}
.icon{vertical-align:-0.15em;flex-shrink:0}
.topbar{position:sticky;top:0;z-index:20;background:var(--teal-d);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.15)}
.topbar-inner{max-width:1240px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.brand{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.brand .t{font-size:14.5px;font-weight:800;white-space:nowrap}
.brand .s{font-size:11px;opacity:.85;white-space:nowrap}
.tabs{display:flex;flex-wrap:wrap;gap:8px}
.tab-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .15s}
.tab-btn:hover{background:rgba(255,255,255,.24)}
.tab-btn.on{background:#fff;color:var(--teal-d);box-shadow:0 2px 6px rgba(0,0,0,.18)}
.main{max-width:1240px;margin:0 auto;padding:24px 24px 80px;min-width:0}
.page{display:none}.page.on{display:block}
.ph{border-bottom:2px solid var(--line);padding-bottom:12px;margin-bottom:20px;display:flex;align-items:baseline;flex-wrap:wrap;gap:4px}
.ph-l{font-size:19px;font-weight:800;color:var(--teal-d)}
.ph-s{font-size:12.5px;color:var(--muted);margin-left:10px;font-weight:400}
.sech{font-size:13.5px;font-weight:800;color:var(--teal-d);margin:26px 0 12px;display:flex;align-items:center;gap:8px}
.sech::before{content:'';width:4px;height:15px;border-radius:3px;background:var(--teal);display:inline-block}
.sech:first-child{margin-top:0}
.krow{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:18px}
.kcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:15px 17px;border-top:3px solid var(--teal);box-shadow:0 1px 3px rgba(0,0,0,.05)}
.kcard .l{font-size:12px;color:var(--muted)}
.kcard .v{font-size:24px;font-weight:800;margin-top:2px}
.kcard .d{font-size:12px;font-weight:700;margin-top:5px}
.kcard .p{font-size:11px;color:var(--muted)}
.kcard.good{border-top-color:var(--good)}
.d-good{color:var(--good)}.d-bad{color:var(--bad)}.d-flat{color:var(--muted)}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.chead{margin-bottom:12px}
.ct{font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px}
.ct::before{content:'';width:4px;height:15px;border-radius:3px;background:var(--teal);display:inline-block;flex-shrink:0}
.cs{font-size:11.5px;color:var(--muted);margin-top:2px;margin-left:12px}
.g2{display:grid;grid-template-columns:1.35fr 1fr;gap:16px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.chartbox{position:relative;height:280px}
.chartbox.sm{height:220px}
.twrap{border:1px solid var(--line);border-radius:10px;overflow:hidden}
.scroll{overflow:auto;max-height:420px}
table.agg{border-collapse:collapse;width:100%;font-size:12.5px}
table.agg th{background:var(--teal);color:#fff;padding:8px 10px;text-align:left;white-space:nowrap;position:sticky;top:0}
table.agg th.num,table.agg td.num{text-align:right}
table.agg td.l{text-align:left}
table.agg td{padding:7px 10px;border-bottom:1px solid #eef0f4;white-space:nowrap}
tr.grand td{background:#1F2535;color:#fff;font-weight:700}
.vendorgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.vcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.vcard .vh{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid #eef2f7;padding-bottom:8px;margin-bottom:10px}
.vcard .vh .nm{font-size:14px;font-weight:800;color:var(--ink)}
.vrow{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dashed #eee;font-size:12.5px}
.vrow:last-child{border-bottom:none}
.vrow .k{color:var(--muted)}.vrow .v{font-weight:700}
.rlayout{display:grid;grid-template-columns:230px 1fr;gap:22px;align-items:center}
.donutbox{position:relative;height:220px}
.donutlegend{margin-top:6px;font-size:11.5px;color:var(--muted);text-align:center}
table.rtable{width:100%;border-collapse:collapse;font-size:12px}
table.rtable th{background:#f4f4f5;color:#333;padding:7px 8px;text-align:center;border:1px solid var(--line);font-weight:700}
table.rtable td{padding:6px 8px;text-align:center;border:1px solid var(--line)}
table.rtable td.l{text-align:left}
table.rtable td.hl{background:#fff59d;font-weight:800;color:#7a5b00}
table.rtable tr.grand td{background:#1F2535;color:#fff;font-weight:700}
table.rtable tr.grand td.hl{background:var(--warn);color:#fff}
.pill{display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700}
.pill.good{background:#e6f4ec;color:var(--good)}.pill.warn{background:#fdf1dd;color:#a86a00}.pill.bad{background:#fde7ea;color:var(--bad)}
.cmp-note{font-size:11.5px;color:var(--muted);margin-top:8px}
.cmp-wrap{border-radius:10px;overflow:hidden;border:1px solid var(--line);overflow-x:auto}
table.cmp{width:100%;border-collapse:collapse;font-size:13px}
table.cmp th{background:var(--teal-d);color:#fff;padding:10px 12px;text-align:center;font-weight:700;white-space:nowrap}
table.cmp th:first-child{text-align:left}
table.cmp td{padding:9px 12px;text-align:center;border-bottom:1px solid var(--line)}
table.cmp td.l{text-align:left;color:var(--muted);font-weight:600;white-space:nowrap}
table.cmp tbody tr:nth-child(even) td{background:#fafafa}
table.cmp tr.hl td{background:#e6f4f2;font-weight:700}
.cost-input{border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-family:inherit;font-size:12.5px}
.draftbar{background:#e6f4ec;color:#0f5132;text-align:center;font-size:12.5px;font-weight:700;padding:6px 10px;border-bottom:1px solid #b7dfc7}
.flow{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:0;padding:6px 0 4px}
.flow-step{background:var(--teal);color:#fff;padding:12px 26px;border-radius:10px;font-weight:800;font-size:14.5px;box-shadow:0 2px 6px rgba(0,0,0,.15);white-space:nowrap}
.flow-arrow{font-size:20px;color:var(--muted);padding:0 14px;font-weight:700}
@media(max-width:640px){.flow-arrow{transform:rotate(90deg);padding:4px 0}}
td.cond{text-align:left;font-size:12px;color:var(--ink)}
.formula-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.formula-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.formula-card .fn{font-size:13px;font-weight:800;color:var(--teal-d);margin-bottom:8px;display:flex;align-items:center;gap:6px}
.formula-card .fx{font-family:"DM Mono",Consolas,monospace;font-size:13.5px;background:#f7f9fa;border:1px dashed var(--line);border-radius:8px;padding:10px 12px;text-align:center;line-height:1.7;color:var(--ink)}
.formula-card .fd{font-size:11.5px;color:var(--muted);margin-top:8px;line-height:1.7}
.callout{background:#fff;border-left:5px solid var(--teal);border-radius:8px;padding:14px 18px;margin:0 0 16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.callout.bad{border-left-color:var(--bad);background:#fff8f9}
.callout.warn{border-left-color:var(--warn);background:#fffcf5}
.callout.good{border-left-color:var(--good);background:#f6fbf8}
.callout ul{margin:8px 0 0 20px}.callout li{margin:5px 0;font-size:13.5px}
.big-quote{font-size:14.5px;font-weight:700;color:var(--teal-d)}
.note{font-size:12px;color:var(--muted);margin:4px 0 10px}
.advice-edit{white-space:pre-wrap;font-size:13.5px;background:#fafbfc;border:1px solid var(--line);border-radius:8px;padding:14px 16px;width:100%;min-height:150px;font-family:inherit;resize:vertical;margin-bottom:10px}
.save-bar{text-align:center;margin-top:10px}
.save-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 22px;border:none;border-radius:8px;font-size:13.5px;font-weight:600;cursor:pointer;background:linear-gradient(135deg,#4DB6AC 0%,#26A69A 38%,#1E88E5 100%);color:#fff;box-shadow:0 2px 8px rgba(0,150,136,.35)}
.foot{color:var(--muted);font-size:12px;margin-top:14px;text-align:center}
@media(max-width:900px){.topbar-inner{padding:10px 16px}.main{padding:16px}.g2,.g3,.vendorgrid{grid-template-columns:1fr}}
@media(max-width:820px){.two{grid-template-columns:1fr}}
</style></head><body>
<div class="draftbar">✅ 已帶入真實資料庫數值（期間：${esc(periodText(state))}）｜ 省下的成本／送修運費為可編輯試算值，詳見「使用率」頁備註</div>
<header class="topbar"><div class="topbar-inner">
  <div class="brand"><span class="t">📊 設備品質分析報告</span><span class="s">${esc(periodText(state))}　｜　製表：${esc(genAt)}</span></div>
  <nav class="tabs">
    <button class="tab-btn on" data-tab="overview">📌 整體總覽</button>
    <button class="tab-btn" data-tab="car">🚗 車機分析</button>
    <button class="tab-btn" data-tab="usage">🔄 使用率</button>
    <button class="tab-btn" data-tab="vendor">🏭 重點廠商比較</button>
    <button class="tab-btn" data-tab="logic">📖 資料來源與邏輯說明</button>
  </nav>
</div></header>
<main class="main">
${pages.map((p) => p.html).join('\n')}
<div class="foot">本報告由「設備品質分析工具」自動生成，核心發現／建議文字可於框內直接編輯後按頁內按鈕另存。EUP 弋揚科技</div>
</main>
<script>
const PAL=${JSON.stringify(PAL)};
const TEAL='#009688',BLUE='#1E88E5',AMBER='#e08e00',RED='#D32F2F',GOOD='#1a9c53';
window.addEventListener('load',function(){
  document.querySelectorAll('.tab-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('on');});
      document.querySelectorAll('.page').forEach(function(p){p.classList.remove('on');});
      btn.classList.add('on');
      document.getElementById('page-'+btn.dataset.tab).classList.add('on');
      window.scrollTo(0,0);
    });
  });
  if(typeof Chart!=='undefined'){${pages.map((p) => p.chartScript).join('\n')}}
  var btn=document.getElementById('save-edited');
  if(btn)btn.addEventListener('click',function(){
    document.querySelectorAll('textarea.advice-edit').forEach(function(t){t.textContent=t.value;});
    document.querySelectorAll('input.cost-input').forEach(function(i){i.setAttribute('value',i.value);});
    var html='<!DOCTYPE html>'+document.documentElement.outerHTML;
    var blob=new Blob([html],{type:'text/html;charset=utf-8'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='設備品質分析報告_已編輯_'+new Date().toISOString().slice(0,10)+'.html';
    a.click();
  });
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
