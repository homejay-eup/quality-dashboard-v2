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
    const labels = [], 不良率 = [], 過保率 = [], 再使用率 = [], 整體不良率 = [], 整體過保率 = [], 整體再使用率 = [];
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
    }
    return { labels, 不良率, 過保率, 再使用率, 整體不良率, 整體過保率, 整體再使用率 };
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

  // 過保／不良品依機型排名表：前三名加名次徽章＋特殊底色
  const RANK_BADGE = ['🥇', '🥈', '🥉'];
  function rankTableHTML(groups, countKey) {
    const total = groups.reduce((sum, g) => sum + g.subtotal[countKey], 0);
    const rows = groups.map((g, i) => {
      const count = g.subtotal[countKey];
      const pct = total ? count / total : 0;
      const top3 = i < 3;
      return `<tr class="${top3 ? 'rank-top3' : ''}">
        <td class="l">${top3 ? `<span class="rank-badge">${RANK_BADGE[i]}</span>` : ''}${esc(g.key)}</td>
        <td class="num">${rInt(count)}</td><td class="num">${rPct(pct)}</td></tr>`;
    }).join('');
    return `<div class="twrap"><div class="scroll" style="max-height:220px">
      <table class="agg ranktable">
        <thead><tr><th class="l">機型</th><th class="num">數量</th><th class="num">占比</th></tr></thead>
        <tbody>${rows || `<tr><td class="l" colspan="3">本期無資料</td></tr>`}</tbody>
      </table>
    </div></div>`;
  }

  function deviceTypeSectionHTML(deviceKey, icon, d, selection, chartId) {
    const agg = aggByType(d, selection);
    agg.groups = [...agg.groups].sort((a, b) => b.subtotal.回廠量 - a.subtotal.回廠量); // 比照 draft：依回廠量由大到小
    const rows = agg.groups.map((g) => {
      const s = g.subtotal;
      return `<tr><td class="l">${esc(g.key)}</td><td>${rInt(s.上線量)}</td><td>${rInt(s.回廠量)}</td>
        <td>${rInt(s.良品數)}<span class="colRate">（${rPct(s.再使用率)}）</span></td><td>${rInt(s.不良品數)}<span class="colRate">（${rPct(s.不良率)}）</span></td>
        <td>${rInt(s.過保數)}<span class="colRate">（${rPct(s.過保率)}）</span></td>
        <td class="hl">${rPct(s.整體不良率)}</td><td class="hl2">${rPct(s.整體過保率)}</td><td>${rYear(s.已使用年限)}</td>
        <td class="colUncat">${rInt(s.未歸類數)}<span class="colRate">（${rPct(s.未歸類率)}）</span></td></tr>`;
    }).join('');
    const gt = agg.grandTotal;
    const donutLabels = agg.groups.map((g) => g.key);
    const donutData = agg.groups.map((g) => g.subtotal.回廠量);

    // 當季過保／不良品依機型占比（供兩張圓餅圖用，各自依該指標由大到小排序、濾掉 0）
    const scrGroups = [...agg.groups].filter((g) => g.subtotal.過保數 > 0).sort((a, b) => b.subtotal.過保數 - a.subtotal.過保數);
    const badGroups = [...agg.groups].filter((g) => g.subtotal.不良品數 > 0).sort((a, b) => b.subtotal.不良品數 - a.subtotal.不良品數);
    const scrChartId = `${chartId}-scr`, badChartId = `${chartId}-bad`;

    return {
      html: `<div class="sech">${icon} 回廠量分析（${esc(deviceKey)}）</div>
      <div class="card">
        <div class="chead"><div class="chead-top"><div class="ct">${esc(deviceKey)}</div>
          <div class="toggle-group">
            <label class="uncat-toggle" title="顯示良品/不良品/過保比率"><input type="checkbox" onchange="this.closest('.card').classList.toggle('show-rate',this.checked)"><span class="uncat-icon">%</span></label>
            <label class="uncat-toggle" title="顯示未歸類數"><input type="checkbox" onchange="this.closest('.card').classList.toggle('show-uncat',this.checked)"><span class="uncat-icon">▦</span></label>
          </div>
        </div></div>
        <div class="rlayout3">
          <div class="legendgrid">${agg.groups.map((g, i) => `<div class="litem"><span class="dot" style="background:${PAL[i % PAL.length]}"></span>${esc(g.key)}</div>`).join('')}</div>
          <div><div class="donutbox"><canvas id="${chartId}"></canvas></div>
            <div class="donutlegend">${esc(deviceKey)}　｜　總上線量 ${rInt(gt.上線量)}</div></div>
          <div class="twrap"><div class="scroll">
            <table class="rtable">
              <thead><tr><th rowspan="2">機型</th><th rowspan="2">上線量</th><th colspan="4">回廠量</th><th rowspan="2">整體不良率</th><th rowspan="2">整體過保率</th><th rowspan="2">平均已使用年限</th><th rowspan="2" class="colUncat">未歸類數</th></tr>
              <tr><th>回廠量</th><th>良品數(再使用)</th><th>不良品數</th><th>過保數</th></tr></thead>
              <tbody>${rows}
                <tr class="grand"><td class="l">總計</td><td>${rInt(gt.上線量)}</td><td>${rInt(gt.回廠量)}</td>
                  <td>${rInt(gt.良品數)}<span class="colRate">（${rPct(gt.再使用率)}）</span></td><td>${rInt(gt.不良品數)}<span class="colRate">（${rPct(gt.不良率)}）</span></td>
                  <td>${rInt(gt.過保數)}<span class="colRate">（${rPct(gt.過保率)}）</span></td>
                  <td class="hl">${rPct(gt.整體不良率)}</td><td class="hl2">${rPct(gt.整體過保率)}</td><td>${rYear(gt.已使用年限)}</td>
                  <td class="colUncat">${rInt(gt.未歸類數)}<span class="colRate">（${rPct(gt.未歸類率)}）</span></td></tr>
              </tbody>
            </table>
          </div></div>
        </div>
      </div>
      <div class="card">
        <div class="chead"><div class="ct">${esc(deviceKey)}過保／不良品依機型占比</div><div class="cs">當季，各自依數量由大到小排序，前三名特別標示</div></div>
        <div class="rlayout3">
          <div class="legendgrid">${scrGroups.map((g, i) => `<div class="litem"><span class="dot" style="background:${PAL[i % PAL.length]}"></span>${esc(g.key)}</div>`).join('')}</div>
          <div class="chartbox pie"><canvas id="${scrChartId}"></canvas></div>
          ${rankTableHTML(scrGroups, '過保數')}
        </div>
        <div class="rlayout3" style="margin-top:20px">
          <div class="legendgrid">${badGroups.map((g, i) => `<div class="litem"><span class="dot" style="background:${PAL[i % PAL.length]}"></span>${esc(g.key)}</div>`).join('')}</div>
          <div class="chartbox pie"><canvas id="${badChartId}"></canvas></div>
          ${rankTableHTML(badGroups, '不良品數')}
        </div>
      </div>`,
      chartScript: `new Chart(document.getElementById('${chartId}'),{type:'doughnut',
        data:{labels:${JSON.stringify(donutLabels)},datasets:[{data:${JSON.stringify(donutData)},backgroundColor:PAL,borderColor:'#fff',borderWidth:1}]},
        options:{maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false}}}});
      new Chart(document.getElementById('${scrChartId}'),{type:'pie',
        data:{labels:${JSON.stringify(scrGroups.map((g) => g.key))},datasets:[{data:${JSON.stringify(scrGroups.map((g) => g.subtotal.過保數))},backgroundColor:PAL,borderColor:'#fff',borderWidth:1}]},
        options:{maintainAspectRatio:false,plugins:{legend:{display:false},title:{display:true,text:'過保設備占比'}}}});
      new Chart(document.getElementById('${badChartId}'),{type:'pie',
        data:{labels:${JSON.stringify(badGroups.map((g) => g.key))},datasets:[{data:${JSON.stringify(badGroups.map((g) => g.subtotal.不良品數))},backgroundColor:PAL,borderColor:'#fff',borderWidth:1}]},
        options:{maintainAspectRatio:false,plugins:{legend:{display:false},title:{display:true,text:'不良品設備占比'}}}});`,
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
          }}});`,
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
      const 過保率 = [], 不良率 = [], 再使用率 = [];
      for (let m = 1; m <= monthCount; m++) {
        const rowsM = rowsScoped.filter((r) => monthOf(r.年月) === m);
        const kpi = App.metrics.computeKPI(rowsM, online, sel);
        過保率.push(+(kpi.整體過保率 * 100).toFixed(1));
        不良率.push(+(kpi.整體不良率 * 100).toFixed(1));
        再使用率.push(+(kpi.再使用率 * 100).toFixed(1));
      }
      return { monthCount, 過保率, 不良率, 再使用率 };
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
      { key: '再使用率', color: 'TREND', id: `${chartId}-reuse` },
    ];
    const panels = metrics.map((m) => `<div><div class="mini-title">${esc(m.key)}</div><div class="chartbox sm"><canvas id="${m.id}"></canvas></div></div>`).join('');
    const chartCalls = metrics.map((m) => {
      const curData = JSON.stringify(pad(qseries.cur[m.key], n));
      const cmpDs = qseries.cmp ? `,{label:'${cmpLabel}',data:${JSON.stringify(pad(qseries.cmp[m.key], n))},borderColor:${m.color},borderDash:[5,4],fill:false,tension:.3,pointRadius:3}` : '';
      return `new Chart(document.getElementById('${m.id}'),{type:'line',
        data:{labels:${JSON.stringify(monthLabels)},datasets:[
          {label:'${curLabel}',data:${curData},borderColor:${m.color},fill:false,tension:.3,pointRadius:3}${cmpDs}
        ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{boxWidth:10,font:{size:10}}}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}}});`;
    }).join('\n      ');
    return {
      html: `<div class="card">
        <div class="chead"><div class="ct">過保率／不良率／再使用率（月度同期比較）</div><div class="cs"><span class="trend-device">${esc(deviceKey)}</span>　｜　1～${n}月，${curLabel}${cmpLabel ? `　vs　${cmpLabel}` : ''}</div></div>
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
    const findings = (App.advice && App.advice.genFindings) ? App.advice.genFindings({ kpi: combined, cmpKpi: combinedCmp }) : [];
    const tone = combined.整體不良率 >= 0.03 ? 'bad' : combined.整體不良率 >= 0.01 ? 'warn' : 'good';

    return {
      html: `<section class="page on" id="page-overview">
        <div class="ph"><div><span class="ph-l">📌 整體總覽</span><span class="ph-s">車機＋鏡頭　｜　期間：${esc(periodText(ctx.state))}</span></div></div>
        <div class="sech">整體數值</div>
        <div class="krow">
          ${kcard('車機線上量', rInt(car.kpi.總線上量), '')}
          ${kcard('鏡頭線上量', rInt(lens.kpi.總線上量), '')}
          ${kcard('車機期間回廠量', rInt(car.kpi.期間回廠量), ctx.hasCmp ? kpiDeltaHTML(car.kpi.期間回廠量, car.cmpKpi.期間回廠量, 'int', null) : '')}
          ${kcard('鏡頭期間回廠量', rInt(lens.kpi.期間回廠量), ctx.hasCmp ? kpiDeltaHTML(lens.kpi.期間回廠量, lens.cmpKpi.期間回廠量, 'int', null) : '')}
          ${kcard('整體不良率', rPct(combined.整體不良率), combinedCmp ? kpiDeltaHTML(combined.整體不良率, combinedCmp.整體不良率, 'pct', false) : '', 'good')}
          ${kcard('整體過保率', rPct(combined.整體過保率), combinedCmp ? kpiDeltaHTML(combined.整體過保率, combinedCmp.整體過保率, 'pct', false) : '', 'good')}
        </div>
        ${carSec.html}
        ${lensSec.html}
        <div class="sech">回廠結果分類佔比（過保／不良／人為／仍在線／其他未過）</div>
        <div class="g2">
          ${bucketBreakdownHTML('車機', car.kpi, ctx.hasCmp ? car.cmpKpi : null)}
          ${bucketBreakdownHTML('鏡頭', lens.kpi, ctx.hasCmp ? lens.cmpKpi : null)}
        </div>
        <div class="chart-toggle-row">
          <label class="chart-toggle-label"><input type="checkbox" id="toggle-ov-trend"> 顯示過保率／不良率／再使用率趨勢圖（車機＋鏡頭）</label>
        </div>
        <div class="g2-eq" id="ov-trend-wrap">
          ${carTrendSec.html}
          ${lensTrendSec.html}
        </div>
        <div class="g2-eq">
          ${carQoYSec.html}
          ${lensQoYSec.html}
        </div>
        ${findings.length ? `<div class="callout ${tone}"><p class="big-quote">分析與說明</p><ul>${findings.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>` : ''}
      </section>`,
      chartScript: `
        ${carTrendSec.chartScript}
        ${lensTrendSec.chartScript}
        (function(){
          var wrap=document.getElementById('ov-trend-wrap');
          var chk=document.getElementById('toggle-ov-trend');
          if(wrap&&chk){
            wrap.style.display=chk.checked?'':'none';
            chk.addEventListener('change',function(){ wrap.style.display=this.checked?'':'none'; });
          }
        })();
        ${carQoYSec.chartScript}
        ${lensQoYSec.chartScript}
        ${carSec.chartScript}
        ${lensSec.chartScript}`,
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
    const cmpMonths = hasCmp ? periodMonths(state.cmp.quarter) : null;
    const freight = shippingCost(months);
    const cmpFreight = hasCmp ? shippingCost(cmpMonths) : null;

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
        <div class="ph"><div><span class="ph-l">🔄 再使用率</span><span class="ph-s">內部檢測與送修成本｜期間：${esc(periodText(state))}</span></div></div>
        <div class="krow">
          ${kcard('車機內部檢測數量', rInt(car.kpi.內部檢測數), hasCmp ? kpiDeltaHTML(car.kpi.內部檢測數, car.cmpKpi.內部檢測數, 'int', true) : '', 'good')}
          ${kcard('鏡頭內部檢測數量', rInt(lens.kpi.內部檢測數), hasCmp ? kpiDeltaHTML(lens.kpi.內部檢測數, lens.cmpKpi.內部檢測數, 'int', true) : '', 'good')}
          <div class="kcard"><div class="l">預估省下的成本</div><div class="v" id="kpi-saved-cost-total">0 元</div><div class="p">內部檢測數量 × 單位成本</div></div>
          <div class="kcard" style="border-top-color:var(--warn)"><div class="l">送修運費（固定物流成本）</div><div class="v">${rInt(freight)} 元</div><div class="p">300元/次 × 2次/週 × 4週/月 × ${months}個月，與件數無關</div></div>
        </div>
        <div class="card">
          <details class="collapsible">
            <summary class="chead"><div class="ct">車機機型分類設定</div><div class="cs">勾選「一般定位」或「影像」，決定下方成本試算與趨勢圖如何加總；同一機型只能勾一邊，都不勾視為未分類（不計入試算）</div></summary>
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
          </details>
        </div>
        <div class="card">
          <details class="collapsible">
            <summary class="chead"><div class="ct">省下的成本試算（可編輯）</div><div class="cs">內部檢測數量（QC=回廠QC）× 單位成本；車機依上方分類設定分兩類，鏡頭單位成本可另外調整，預設一般定位2,000元、影像7,000元、鏡頭2,000元</div></summary>
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
          </details>
        </div>
        <div class="card">
          <div class="chead"><div class="ct">省下的成本走勢</div><div class="cs">${esc(usageTrend.curLabel)} 1～${usageTrend.months.length}月${usageTrend.cmpLabel ? `　vs　${esc(usageTrend.cmpLabel)}` : ''}，隨上方分類／單位成本即時變化</div></div>
          <div class="chartbox"><canvas id="usage-trend-chart"></canvas></div>
          <div class="twrap" style="margin-top:14px"><table class="agg">
            <thead><tr><th class="l">期間</th><th class="num">省下的成本合計（元）</th></tr></thead>
            <tbody id="usage-yearly-tbody"></tbody>
          </table></div>
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
      期間回廠量: kpi.期間回廠量, 過保數: kpi.過保數, 不良品數: kpi.不良品數, 人為數: kpi.人為數,
      良品數: kpi.良品數, 其他未過數: kpi.其他未過數,
      期間不良率: kpi.期間不良率, 期間過保率: kpi.期間過保率, 再使用率: kpi.再使用率,
    };
  }

  function vendorSpotlightPageHTML(ctx) {
    const { car, lens, state } = ctx, hasCmp = ctx.hasCmp;

    // 所有出現過的廠商（不篩選），依回廠量由大到小，供 checkbox 清單使用
    const allCarVendors = [...aggByVendor(car, {}).groups].sort((a, b) => b.subtotal.回廠量 - a.subtotal.回廠量).map((g) => g.key);
    const allLensVendors = [...aggByVendor(lens, {}).groups].sort((a, b) => b.subtotal.回廠量 - a.subtotal.回廠量).map((g) => g.key);

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

    const pickerHTML = (device, vendors, defaults) => vendors.map((v) =>
      `<label class="vp-item"><input type="checkbox" class="vp-${device}" value="${esc(v)}" ${defaults.includes(v) ? 'checked' : ''}> ${esc(v)}</label>`
    ).join('');

    return {
      html: `<section class="page" id="page-vendor">
        <div class="ph"><div><span class="ph-l">🏭 重點廠商比較</span><span class="ph-s">期間：${esc(periodText(state))}</span></div></div>
        <div class="sech">車機重點廠商</div>
        <div class="card">
          <details class="collapsible">
            <summary class="chead"><div class="ct">選擇要比較的廠商</div><div class="cs">可複選，預設：${esc(CAR_SPOTLIGHT_VENDORS_DEFAULT.join('、'))}</div></summary>
            <div class="vendor-picker">${pickerHTML('car', allCarVendors, CAR_SPOTLIGHT_VENDORS_DEFAULT)}</div>
          </details>
        </div>
        <div class="card">
          <div class="chead"><div class="ct">車機廠商品質比較</div><div class="cs">不良率／過保率／再使用率，數字越高不代表越好（過保率／不良率越低越好）</div></div>
          <div class="chartbox"><canvas id="vendor-chart-car"></canvas></div>
        </div>
        <div class="g2" id="vendor-cards-car"></div>

        <div class="sech" style="margin-top:26px">鏡頭重點廠商</div>
        <div class="card">
          <details class="collapsible">
            <summary class="chead"><div class="ct">選擇要比較的廠商</div><div class="cs">可複選，預設：${esc(LENS_SPOTLIGHT_VENDORS_DEFAULT.join('、'))}</div></summary>
            <div class="vendor-picker">${pickerHTML('lens', allLensVendors, LENS_SPOTLIGHT_VENDORS_DEFAULT)}</div>
          </details>
        </div>
        <div class="card">
          <div class="chead"><div class="ct">鏡頭廠商品質比較</div><div class="cs">不良率／過保率／再使用率，數字越高不代表越好（過保率／不良率越低越好）</div></div>
          <div class="chartbox"><canvas id="vendor-chart-lens"></canvas></div>
        </div>
        <div class="g2" id="vendor-cards-lens"></div>
      </section>`,
      chartScript: `
        window.__vendorAllData={car:${JSON.stringify(carVendorData)},lens:${JSON.stringify(lensVendorData)}};
        function __vendorBucketRows(kpi){
          return [
            {label:'過保',cls:'warn',count:kpi.過保數},
            {label:'不良',cls:'bad',count:kpi.不良品數},
            {label:'人為',cls:'',count:kpi.人為數},
            {label:'仍在線（良品）',cls:'good',count:kpi.良品數},
            {label:'其他(未過)',cls:'',count:kpi.其他未過數},
          ];
        }
        function __rd(v){ return (v>=0?'+':'')+Math.round(v).toLocaleString('en-US'); }
        function __vendorCardHTML(name,kpi,cmpKpi){
          var rows=__vendorBucketRows(kpi);
          var cmpRows=cmpKpi?__vendorBucketRows(cmpKpi):null;
          var trs=rows.map(function(r,i){
            var cmpCells=cmpRows?('<td class="num">'+Math.round(cmpRows[i].count).toLocaleString('en-US')+'</td><td class="num">'+__rd(r.count-cmpRows[i].count)+'</td>'):'';
            return '<tr><td class="l"><span class="pill '+r.cls+'">'+r.label+'</span></td><td class="num">'+Math.round(r.count).toLocaleString('en-US')+'</td>'+cmpCells+'</tr>';
          }).join('');
          var head=cmpKpi?'　｜　去年同期 '+Math.round(cmpKpi.期間回廠量).toLocaleString('en-US')+'　｜　差異 '+__rd(kpi.期間回廠量-cmpKpi.期間回廠量):'';
          return '<div class="card"><div class="chead"><div class="ct">'+name+'</div><div class="cs">回廠量 '+Math.round(kpi.期間回廠量).toLocaleString('en-US')+head+'</div></div>'+
            '<div class="twrap"><table class="agg"><thead><tr><th class="l">分類</th><th class="num">數量</th>'+(cmpKpi?'<th class="num">去年同期</th><th class="num">差異</th>':'')+'</tr></thead>'+
            '<tbody>'+trs+'</tbody></table></div></div>';
        }
        window.__renderVendorSection=function(device){
          var checked=[].slice.call(document.querySelectorAll('.vp-'+device+':checked')).map(function(cb){return cb.value;});
          var all=window.__vendorAllData[device];
          var cardsEl=document.getElementById('vendor-cards-'+device);
          cardsEl.innerHTML=checked.map(function(v){ var rec=all[v]; return rec?__vendorCardHTML(v,rec.kpi,rec.cmpKpi):''; }).join('');
          var canvas=document.getElementById('vendor-chart-'+device);
          var existing=Chart.getChart(canvas); if(existing)existing.destroy();
          var datasets=checked.map(function(v,i){
            var rec=all[v]; if(!rec)return null;
            return {label:v,data:[+(rec.kpi.期間不良率*100).toFixed(1),+(rec.kpi.期間過保率*100).toFixed(1),+(rec.kpi.再使用率*100).toFixed(1)],backgroundColor:PAL[i%PAL.length]};
          }).filter(Boolean);
          new Chart(canvas,{type:'bar',data:{labels:['不良率%','過保率%','再使用率%'],datasets:datasets},
            options:{maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{beginAtZero:true,ticks:{callback:function(v){return v+'%';}}}}}});
        };
        document.querySelectorAll('.vp-car').forEach(function(cb){cb.addEventListener('change',function(){window.__renderVendorSection('car');});});
        document.querySelectorAll('.vp-lens').forEach(function(cb){cb.addEventListener('change',function(){window.__renderVendorSection('lens');});});
        window.__renderVendorSection('car');
        window.__renderVendorSection('lens');`,
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
              <tr><td class="l">再使用率</td><td class="l">再使用率＝上述彙整資料（真實）；節省金額試算為可編輯試算工具（時薪／運費／工時／整新單價／新購參考單價皆可手動輸入），數字為使用者輸入值，非正式資料源</td></tr>
              <tr><td class="l">同期比較</td><td class="l">逐季重算（App.transform.buildDetail 逐季呼叫），非預先彙整快照，故任何歷史季度都可即時算出；節省金額 YoY 比較尚未實作（需雙期間各自試算）</td></tr>
            </tbody>
          </table></div>
          <div class="callout warn" style="margin-top:14px">
            <p class="big-quote">已知限制</p>
            <ul>
              <li>「新購參考單價」「整新單價」在公司內部成本資料中從未系統性填寫，「再使用率」頁改為可編輯試算工具，預設 0、可手動輸入比較，尚未接上正式資料源，數字僅供試算參考。</li>
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
      vendorSpotlightPageHTML(ctx),
      reuseUsagePageHTML(ctx),
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
.trend-device{font-size:14px;font-weight:800;color:var(--ink)}
.mini-title{font-size:12px;font-weight:700;color:var(--ink);text-align:center;margin-bottom:6px}
.collapsible summary{cursor:pointer;list-style:none}
.collapsible summary::-webkit-details-marker{display:none}
.collapsible summary .ct::after{content:'▾';margin-left:8px;font-size:11px;color:var(--muted);transition:transform .15s}
.collapsible:not([open]) summary .ct::after{content:'▸'}
.collapsible:not([open]) summary{margin-bottom:0}
.g2{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;min-width:0}
.g2>*{min-width:0}
.g2-eq{display:grid;grid-template-columns:1fr 1fr;gap:16px;min-width:0}
.g2-eq>*{min-width:0}
.rlayout3{display:grid;grid-template-columns:140px 220px 1fr;gap:18px;align-items:center;min-width:0}
.rlayout3>*{min-width:0}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;min-width:0}
.g3>*{min-width:0}
.chartbox{position:relative;height:280px}
.chartbox.sm{height:220px}
.chartbox.pie{height:260px}
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
.donutbox{position:relative;height:220px}
.legendgrid{display:flex;flex-direction:column;gap:5px;margin-top:10px;padding:0 4px}
.legendgrid .litem{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--ink);white-space:nowrap}
.legendgrid .dot{width:9px;height:9px;border-radius:2px;flex:0 0 auto}
.donutlegend{margin-top:6px;font-size:11.5px;color:var(--muted);text-align:center}
table.rtable{width:100%;border-collapse:collapse;font-size:12px}
table.rtable th{background:#f4f4f5;color:#333;padding:7px 8px;text-align:center;border:1px solid var(--line);font-weight:700}
table.rtable td{padding:6px 8px;text-align:center;border:1px solid var(--line)}
table.rtable td.l{text-align:left}
table.rtable td.hl{background:#fff59d;font-weight:800;color:#7a5b00}
table.rtable td.hl2{background:#ffe6b3;font-weight:800;color:#7a4d00}
table.rtable tr.grand td{background:#1F2535;color:#fff;font-weight:700}
table.rtable tr.grand td.hl{background:var(--warn);color:#fff}
table.rtable tr.grand td.hl2{background:#c77400;color:#fff}
table.rtable .colUncat{display:none}
.card.show-uncat table.rtable .colUncat{display:table-cell}
table.rtable .colRate{display:none}
.card.show-rate table.rtable .colRate{display:inline}
.chead-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.toggle-group{display:flex;align-items:center;gap:6px}
.uncat-toggle{position:relative;cursor:pointer;user-select:none;display:inline-flex}
.uncat-toggle input{position:absolute;opacity:0;width:16px;height:16px;margin:0;cursor:pointer}
.uncat-toggle .uncat-icon{font-size:13px;color:#c7cbd1;line-height:1;padding:2px;border-radius:4px;transition:color .15s,background .15s}
.uncat-toggle:hover .uncat-icon{color:var(--muted);background:#f0f2f4}
.uncat-toggle input:checked ~ .uncat-icon{color:var(--teal);background:#e6f4f2}
.uncat-toggle input:focus-visible ~ .uncat-icon{outline:2px solid var(--teal);outline-offset:1px}
table.ranktable tr.rank-top3 td{background:#fff8e6;font-weight:700}
.rank-badge{margin-right:4px}
.chart-toggle-row{display:flex;justify-content:flex-end;margin:-6px 0 12px}
.chart-toggle-label{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);cursor:pointer;user-select:none}
.chart-toggle-label input{cursor:pointer}
.vendor-picker{display:flex;flex-wrap:wrap;gap:8px 16px}
.vp-item{display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;user-select:none}
.vp-item input{cursor:pointer}
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
@media(max-width:900px){.topbar-inner{padding:10px 16px}.main{padding:16px}.g2,.g2-eq,.g3,.vendorgrid,.rlayout3{grid-template-columns:1fr}}
@media(max-width:820px){.two{grid-template-columns:1fr}}
</style></head><body>
<div class="draftbar">✅ 已帶入真實資料庫數值（期間：${esc(periodText(state))}）｜ 省下的成本／送修運費為可編輯試算值，詳見「再使用率」頁備註</div>
<header class="topbar"><div class="topbar-inner">
  <div class="brand"><span class="t">📊 設備品質分析報告</span><span class="s">${esc(periodText(state))}　｜　製表：${esc(genAt)}</span></div>
  <nav class="tabs">
    <button class="tab-btn on" data-tab="overview">📌 整體總覽</button>
    <button class="tab-btn" data-tab="vendor">🏭 重點廠商比較</button>
    <button class="tab-btn" data-tab="usage">🔄 再使用率</button>
    <button class="tab-btn" data-tab="logic">📖 資料來源與邏輯說明</button>
  </nav>
</div></header>
<main class="main">
${pages.map((p) => p.html).join('\n')}
<div class="foot">本報告由「設備品質分析工具」自動生成，核心發現／建議文字可於框內直接編輯後按頁內按鈕另存。EUP 弋揚科技</div>
</main>
<script>
const PAL=${JSON.stringify(PAL)};
const AMBER='#e08e00',RED='#D32F2F',GOOD='#1a9c53',TREND='#1E88E5';
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
