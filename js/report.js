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

  // ── 近 N 季序列（車機分析／使用率頁／同期比較頁 共用）─────────────────
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
      const kpi = App.metrics.computeKPI(rows, online, state.selection);
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
    const { car, lens, selection } = ctx;
    const combined = combineKPI(car.kpi, lens.kpi);
    const combinedCmp = (ctx.hasCmp && car.cmpKpi && lens.cmpKpi) ? combineKPI(car.cmpKpi, lens.cmpKpi) : null;
    const carSec = deviceTypeSectionHTML('車機', App.icons.car(), car, selection, 'ov-donut-car');
    const lensSec = deviceTypeSectionHTML('鏡頭', App.icons.camera(), lens, selection, 'ov-donut-lens');
    const findings = (App.advice && App.advice.genFindings) ? App.advice.genFindings({ kpi: combined, cmpKpi: combinedCmp }) : [];
    const tone = combined.整體不良率 >= 0.03 ? 'bad' : combined.整體不良率 >= 0.01 ? 'warn' : 'good';
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
        <div class="card">
          <div class="chead"><div class="ct">車機／鏡頭 數量與回廠量對比</div><div class="cs">${esc(periodText(ctx.state))}</div></div>
          <div class="g2"><div class="chartbox"><canvas id="ov-c1"></canvas></div><div class="chartbox"><canvas id="ov-c2"></canvas></div></div>
        </div>
        ${carSec.html}
        ${lensSec.html}
        ${vendorHighlightHTML('車機', car, selection)}
        ${vendorHighlightHTML('鏡頭', lens, selection)}
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

  // ════════════════════════════════════════════════════════════
  // 2. 車機分析
  // ════════════════════════════════════════════════════════════
  function carAnalysisPageHTML(ctx) {
    const { car, selection } = ctx;
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
    const advState = { ...ctx.state, rows: d.rows, kpi: k, cmpKpi: c };
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
  // 3. 使用率與節省金額
  // ════════════════════════════════════════════════════════════
  // 節省金額試算表列（每個機型一列，可編輯「整新單價」「新購參考單價」，其餘成本參數共用）
  function costRowsHTML(deviceKey, d, selection) {
    const agg = aggByType(d, selection);
    const groups = [...agg.groups].sort((a, b) => b.subtotal.回廠量 - a.subtotal.回廠量).filter((g) => g.subtotal.回廠量 > 0);
    return groups.map((g) => {
      const s = g.subtotal;
      const idx = ++__cpSeq;
      return `<tr data-device="${esc(deviceKey)}" data-qty="${s.良品數 || 0}" data-returned="${s.回廠量 || 0}">
        <td class="l">${esc(deviceKey)}</td><td class="l">${esc(g.key)}</td><td class="num">${rInt(s.良品數)}</td>
        <td class="num"><input type="number" class="cost-input in-unit" id="cp-unit-${idx}" value="0" step="1" style="width:90px;text-align:right"></td>
        <td class="num"><input type="number" class="cost-input in-ref" id="cp-ref-${idx}" value="0" step="1" style="width:90px;text-align:right"></td>
        <td class="num cost-out">0</td>
      </tr>`;
    }).join('');
  }

  function reuseSavingsPageHTML(ctx) {
    const { car, lens } = ctx, hasCmp = ctx.hasCmp;
    const carSeries = buildQuarterSeries(ctx.state, '車機');
    const lensSeries = buildQuarterSeries(ctx.state, '鏡頭');
    const bullets = [];
    bullets.push(`車機再使用率 ${rPct(car.kpi.再使用率)}${hasCmp ? `（對比去年同期 ${rPct(car.cmpKpi.再使用率)}）` : ''}。`);
    bullets.push(`鏡頭再使用率 ${rPct(lens.kpi.再使用率)}${hasCmp ? `（對比去年同期 ${rPct(lens.cmpKpi.再使用率)}）` : ''}。`);
    bullets.push('下方節省金額試算的成本參數（整新單價／新購參考單價／時薪／運費／工時）目前都沒有正式資料源，先預設為 0，可直接輸入試算數字，KPI 卡與拆解圖會即時跟著變。');
    const carRows = costRowsHTML('車機', car, ctx.selection);
    const lensRows = costRowsHTML('鏡頭', lens, ctx.selection);
    return {
      html: `<section class="page" id="page-reuse">
        <div class="ph"><div><span class="ph-l">🔄 使用率與節省金額</span><span class="ph-s">循環再使用（良品＝測試正常／整新後可用）｜期間：${esc(periodText(ctx.state))}</span></div></div>
        <div class="krow">
          ${kcard('車機再使用率', rPct(car.kpi.再使用率), hasCmp ? kpiDeltaHTML(car.kpi.再使用率, car.cmpKpi.再使用率, 'pct', true) : '', 'good')}
          ${kcard('鏡頭再使用率', rPct(lens.kpi.再使用率), hasCmp ? kpiDeltaHTML(lens.kpi.再使用率, lens.cmpKpi.再使用率, 'pct', true) : '', 'good')}
          <div class="kcard"><div class="l">預估本期節省金額</div><div class="v" id="kpi-savings-total">0 元</div><div class="p">試算值，成本參數尚未串接正式資料源</div></div>
        </div>
        <div class="card">
          <div class="chead"><div class="ct">再使用率趨勢（近 ${carSeries.labels.length} 季，真實資料）</div><div class="cs">${carSeries.labels[0] || ''} ～ ${carSeries.labels[carSeries.labels.length - 1] || ''}</div></div>
          <div class="chartbox"><canvas id="reuse-c1"></canvas></div>
        </div>
        <div class="card">
          <div class="chead"><div class="ct">節省金額拆解</div><div class="cs">車機 vs 鏡頭，元（試算值）</div></div>
          <div class="chartbox sm"><canvas id="reuse-c2"></canvas></div>
        </div>
        <div class="card">
          <div class="chead"><div class="ct">節省金額試算（可編輯）</div><div class="cs">「整新單價」「新購參考單價」尚無正式資料源，預設 0，直接輸入即可試算；儲存版本會保留你輸入的數字</div></div>
          <div class="krow" style="margin-bottom:14px">
            <div class="kcard"><div class="l">時薪（元/小時）</div><input type="number" class="cost-input" id="cp-wage" value="196" step="1" style="width:100%;font-size:20px;font-weight:800;border:none;padding:0"></div>
            <div class="kcard"><div class="l">每件運費（元）</div><input type="number" class="cost-input" id="cp-freight" value="130" step="1" style="width:100%;font-size:20px;font-weight:800;border:none;padding:0"></div>
            <div class="kcard"><div class="l">每件整新工時（分鐘）</div><input type="number" class="cost-input" id="cp-labormin" value="3" step="0.5" style="width:100%;font-size:20px;font-weight:800;border:none;padding:0"></div>
          </div>
          <div class="twrap"><div class="scroll">
            <table class="agg" id="cost-table">
              <thead><tr><th class="l">設備</th><th class="l">機型</th><th class="num">整新件數</th><th class="num">整新單價（元）</th><th class="num">新購參考單價（元）</th><th class="num">預估節省金額（元）</th></tr></thead>
              <tbody>${carRows}${lensRows}</tbody>
              <tfoot><tr class="grand"><td class="l" colspan="5">總計</td><td class="num" id="cost-total">0</td></tr></tfoot>
            </table>
          </div></div>
        </div>
        <div class="callout good"><p class="big-quote">分析與說明</p><ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
      </section>`,
      chartScript: `
        new Chart(document.getElementById('reuse-c1'),{type:'line',
          data:{labels:${JSON.stringify(carSeries.labels)},datasets:[
            {label:'車機再使用率%',data:${JSON.stringify(carSeries.再使用率)},borderColor:TEAL,backgroundColor:'rgba(0,150,136,.1)',fill:true,tension:.3,pointRadius:3},
            {label:'鏡頭再使用率%',data:${JSON.stringify(lensSeries.再使用率)},borderColor:BLUE,fill:false,tension:.3,pointRadius:3}
          ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}}});
        window.__savingsChart=new Chart(document.getElementById('reuse-c2'),{type:'bar',
          data:{labels:['車機','鏡頭'],datasets:[{label:'預估節省金額（元）',data:[0,0],backgroundColor:[TEAL,BLUE]}]},
          options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true}}}});
        window.__recomputeSavings=function(){
          var wageEl=document.getElementById('cp-wage'),freightEl=document.getElementById('cp-freight'),laborEl=document.getElementById('cp-labormin');
          if(!wageEl)return;
          var wage=parseFloat(wageEl.value)||0, freight=parseFloat(freightEl.value)||0, labormin=parseFloat(laborEl.value)||0;
          var carSum=0, lensSum=0;
          document.querySelectorAll('#cost-table tbody tr').forEach(function(tr){
            var qty=parseFloat(tr.dataset.qty)||0, returned=parseFloat(tr.dataset.returned)||0, device=tr.dataset.device;
            var unitCost=parseFloat(tr.querySelector('.in-unit').value)||0, refPrice=parseFloat(tr.querySelector('.in-ref').value)||0;
            var out=tr.querySelector('.cost-out');
            if(qty>0 && refPrice>0){
              var totalUnit=qty*unitCost, labor=returned*(labormin/60)*wage, ship=returned*freight;
              var perUnit=(totalUnit+labor+ship)/qty;
              var saving=qty*(refPrice-perUnit);
              out.textContent=Math.round(saving).toLocaleString('en-US');
              if(device==='車機')carSum+=saving; else lensSum+=saving;
            } else {
              out.textContent='—（未輸入新購參考單價）';
            }
          });
          var total=carSum+lensSum;
          var totalEl=document.getElementById('cost-total'); if(totalEl)totalEl.textContent=Math.round(total).toLocaleString('en-US');
          var kpiEl=document.getElementById('kpi-savings-total'); if(kpiEl)kpiEl.textContent=Math.round(total).toLocaleString('en-US')+' 元';
          if(window.__savingsChart){window.__savingsChart.data.datasets[0].data=[Math.round(carSum),Math.round(lensSum)];window.__savingsChart.update();}
        };
        document.querySelectorAll('#page-reuse .cost-input').forEach(function(el){el.addEventListener('input',window.__recomputeSavings);});
        window.__recomputeSavings();`,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 4. 同期比較
  // ════════════════════════════════════════════════════════════
  function yoyPageHTML(ctx) {
    const { car, lens, state } = ctx;
    if (!ctx.hasCmp) {
      return {
        html: `<section class="page" id="page-yoy">
          <div class="ph"><div><span class="ph-l">📊 同期比較</span><span class="ph-s">目前未開啟對比期間</span></div></div>
          <div class="placeholder"><h3>尚未開啟同期比較</h3><p>請在工具的期間設定中開啟「對比期間」後重新產出報告，即可看到本頁的同期對比內容。</p></div>
        </section>`,
        chartScript: '',
      };
    }
    const combined = combineKPI(car.kpi, lens.kpi);
    const combinedCmp = combineKPI(car.cmpKpi, lens.cmpKpi);
    const series = buildQuarterSeries(state, '車機');
    const bullets = [
      `車機回廠量 ${rInt(car.kpi.期間回廠量)}件（${car.kpi.期間回廠量 >= car.cmpKpi.期間回廠量 ? '較' : '較'}去年同期 ${rInt(car.cmpKpi.期間回廠量)}件 ${car.kpi.期間回廠量 - car.cmpKpi.期間回廠量 >= 0 ? '+' : ''}${rInt(car.kpi.期間回廠量 - car.cmpKpi.期間回廠量)}）。`,
      `整體不良率 ${rPct(combined.整體不良率)}，較去年同期 ${rPct(combinedCmp.整體不良率)} 變化 ${((combined.整體不良率 - combinedCmp.整體不良率) * 100).toFixed(1)}pp。`,
      '節省金額同期比較待「新購參考單價」資料源就緒後才會有數字，目前先以再使用率提升作為間接佐證。',
    ];
    return {
      html: `<section class="page" id="page-yoy">
        <div class="ph"><div><span class="ph-l">📊 同期比較</span><span class="ph-s">${esc(periodText(state))}</span></div></div>
        <div class="krow">
          ${kcard('車機回廠量 YoY', rInt(car.kpi.期間回廠量), kpiDeltaHTML(car.kpi.期間回廠量, car.cmpKpi.期間回廠量, 'int', false), 'good')}
          ${kcard('鏡頭回廠量 YoY', rInt(lens.kpi.期間回廠量), kpiDeltaHTML(lens.kpi.期間回廠量, lens.cmpKpi.期間回廠量, 'int', false), 'good')}
          ${kcard('整體不良率 YoY', rPct(combined.整體不良率), kpiDeltaHTML(combined.整體不良率, combinedCmp.整體不良率, 'pct', false), 'good')}
          ${kcard('整體過保率 YoY', rPct(combined.整體過保率), kpiDeltaHTML(combined.整體過保率, combinedCmp.整體過保率, 'pct', false), 'good')}
          <div class="kcard"><div class="l">預估節省金額 YoY</div><div class="v">—</div><div class="p">資料尚未提供</div></div>
        </div>
        <div class="card">
          <div class="chead"><div class="ct">主要指標同期對比</div><div class="cs">${esc(periodText(state))}</div></div>
          <div class="twrap"><table class="agg">
            <thead><tr><th class="l">指標</th><th class="num">對比期間</th><th class="num">目前期間</th><th class="num">差異</th></tr></thead>
            <tbody>
              <tr><td class="l">車機回廠量（件）</td><td class="num">${rInt(car.cmpKpi.期間回廠量)}</td><td class="num">${rInt(car.kpi.期間回廠量)}</td><td class="num">${rInt(car.kpi.期間回廠量 - car.cmpKpi.期間回廠量)}</td></tr>
              <tr><td class="l">鏡頭回廠量（件）</td><td class="num">${rInt(lens.cmpKpi.期間回廠量)}</td><td class="num">${rInt(lens.kpi.期間回廠量)}</td><td class="num">${rInt(lens.kpi.期間回廠量 - lens.cmpKpi.期間回廠量)}</td></tr>
              <tr><td class="l">整體不良率</td><td class="num">${rPct(combinedCmp.整體不良率)}</td><td class="num">${rPct(combined.整體不良率)}</td><td class="num">${((combined.整體不良率 - combinedCmp.整體不良率) * 100).toFixed(1)}pp</td></tr>
              <tr><td class="l">整體過保率</td><td class="num">${rPct(combinedCmp.整體過保率)}</td><td class="num">${rPct(combined.整體過保率)}</td><td class="num">${((combined.整體過保率 - combinedCmp.整體過保率) * 100).toFixed(1)}pp</td></tr>
              <tr><td class="l">車機再使用率</td><td class="num">${rPct(car.cmpKpi.再使用率)}</td><td class="num">${rPct(car.kpi.再使用率)}</td><td class="num">${((car.kpi.再使用率 - car.cmpKpi.再使用率) * 100).toFixed(1)}pp</td></tr>
              <tr><td class="l">預估節省金額（萬元）</td><td class="num">尚未提供</td><td class="num">尚未提供</td><td class="num">—</td></tr>
            </tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="chead"><div class="ct">主要指標季別趨勢</div><div class="cs">近 ${series.labels.length} 季　｜　車機</div></div>
          <div class="g3">
            <div class="chartbox sm"><canvas id="yoy-trend1"></canvas></div>
            <div class="chartbox sm"><canvas id="yoy-trend2"></canvas></div>
            <div class="chartbox sm"><canvas id="yoy-trend3"></canvas></div>
          </div>
        </div>
        <div class="g2">
          <div class="card"><div class="chead"><div class="ct">回廠量 同期對比</div></div><div class="chartbox sm"><canvas id="yoy-c1"></canvas></div></div>
          <div class="card"><div class="chead"><div class="ct">不良率／過保率 同期對比</div></div><div class="chartbox sm"><canvas id="yoy-c2"></canvas></div></div>
        </div>
        <div class="card"><div class="chead"><div class="ct">車機再使用率 同期對比</div></div><div class="chartbox sm"><canvas id="yoy-c3"></canvas></div></div>
        <div class="callout good"><p class="big-quote">分析與說明</p><ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
      </section>`,
      chartScript: `
        new Chart(document.getElementById('yoy-trend1'),{type:'line',data:{labels:${JSON.stringify(series.labels)},datasets:[{label:'不良率%',data:${JSON.stringify(series.不良率)},borderColor:RED,backgroundColor:'rgba(211,47,47,.08)',fill:true,pointRadius:3,borderWidth:2,tension:.3}]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'},title:{display:true,text:'整體不良率（車機）'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}}});
        new Chart(document.getElementById('yoy-trend2'),{type:'line',data:{labels:${JSON.stringify(series.labels)},datasets:[{label:'過保率%',data:${JSON.stringify(series.過保率)},borderColor:AMBER,backgroundColor:'rgba(224,142,0,.1)',fill:true,pointRadius:3,borderWidth:2,tension:.3}]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'},title:{display:true,text:'整體過保率（車機）'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}}});
        new Chart(document.getElementById('yoy-trend3'),{type:'line',data:{labels:${JSON.stringify(series.labels)},datasets:[{label:'再使用率%',data:${JSON.stringify(series.再使用率)},borderColor:GOOD,backgroundColor:'rgba(26,156,83,.1)',fill:true,pointRadius:3,borderWidth:2,tension:.3}]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'},title:{display:true,text:'車機再使用率'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}}});
        new Chart(document.getElementById('yoy-c1'),{type:'bar',data:{labels:['車機','鏡頭'],datasets:[
          {label:'對比期間',data:[${car.cmpKpi.期間回廠量 || 0},${lens.cmpKpi.期間回廠量 || 0}],backgroundColor:'#c9d7e8'},
          {label:'目前期間',data:[${car.kpi.期間回廠量 || 0},${lens.kpi.期間回廠量 || 0}],backgroundColor:TEAL}
        ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true}}}});
        new Chart(document.getElementById('yoy-c2'),{type:'bar',data:{labels:['整體不良率','整體過保率'],datasets:[
          {label:'對比期間',data:[${(combinedCmp.整體不良率 * 100).toFixed(1)},${(combinedCmp.整體過保率 * 100).toFixed(1)}],backgroundColor:'#c9d7e8'},
          {label:'目前期間',data:[${(combined.整體不良率 * 100).toFixed(1)},${(combined.整體過保率 * 100).toFixed(1)}],backgroundColor:TEAL}
        ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}}});
        new Chart(document.getElementById('yoy-c3'),{type:'bar',data:{labels:['車機再使用率'],datasets:[
          {label:'對比期間',data:[${(car.cmpKpi.再使用率 * 100).toFixed(1)}],backgroundColor:'#c9d7e8'},
          {label:'目前期間',data:[${(car.kpi.再使用率 * 100).toFixed(1)}],backgroundColor:GOOD}
        ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}}});`,
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

  function editableAdviceHTML(deviceKeySafe, label, kind, text) {
    return `<h3>${esc(label)}</h3>
      <textarea class="advice-edit" data-key="${deviceKeySafe}-${kind}">${esc(text)}</textarea>`;
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
    const ctx = { state, car, lens, selection: state.selection, hasCmp };
    const genAt = new Date().toLocaleString('zh-TW');

    const pages = [
      overviewPageHTML(ctx),
      carAnalysisPageHTML(ctx),
      reuseSavingsPageHTML(ctx),
      yoyPageHTML(ctx),
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
.placeholder{border:2px dashed var(--line);border-radius:12px;padding:40px 24px;text-align:center;color:var(--muted);background:#fafbfc}
.placeholder h3{color:var(--ink);font-size:15px;margin-bottom:8px}
.advice-edit{white-space:pre-wrap;font-size:13.5px;background:#fafbfc;border:1px solid var(--line);border-radius:8px;padding:14px 16px;width:100%;min-height:150px;font-family:inherit;resize:vertical;margin-bottom:10px}
.save-bar{text-align:center;margin-top:10px}
.save-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 22px;border:none;border-radius:8px;font-size:13.5px;font-weight:600;cursor:pointer;background:linear-gradient(135deg,#4DB6AC 0%,#26A69A 38%,#1E88E5 100%);color:#fff;box-shadow:0 2px 8px rgba(0,150,136,.35)}
.foot{color:var(--muted);font-size:12px;margin-top:14px;text-align:center}
@media(max-width:900px){.topbar-inner{padding:10px 16px}.main{padding:16px}.g2,.g3,.vendorgrid{grid-template-columns:1fr}}
@media(max-width:820px){.two{grid-template-columns:1fr}}
</style></head><body>
<div class="draftbar">✅ 已帶入真實資料庫數值（期間：${esc(periodText(state))}）｜ 節省金額試算為可編輯試算值，成本參數尚未串接正式資料源，詳見「使用率與節省金額」頁備註</div>
<header class="topbar"><div class="topbar-inner">
  <div class="brand"><span class="t">📊 設備品質分析報告</span><span class="s">${esc(periodText(state))}　｜　製表：${esc(genAt)}</span></div>
  <nav class="tabs">
    <button class="tab-btn on" data-tab="overview">📌 整體總覽</button>
    <button class="tab-btn" data-tab="car">🚗 車機分析</button>
    <button class="tab-btn" data-tab="reuse">🔄 使用率與節省金額</button>
    <button class="tab-btn" data-tab="yoy">📊 同期比較</button>
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
