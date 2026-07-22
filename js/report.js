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
  // 落地頁 HTML 報告（自帶資料的單檔，供老闆檢視／離線分享）
  // ────────────────────────────────────────────────────────────
  const rInt = (v) => (Number(v) || 0).toLocaleString('en-US');
  const rPct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
  const rYear = (v) => (v == null || v === '' ? '' : Number(v).toFixed(1));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const PAL = ['#009688', '#26A69A', '#4DB6AC', '#1E88E5', '#1565C0', '#80CBC4', '#B2DFDB', '#E08E00', '#9AA0A6', '#EF5350'];

  const RKPI = [
    { label: '總線上量', get: (k) => k.總線上量, fmt: 'int' },
    { label: '期間回廠量', get: (k) => k.期間回廠量, fmt: 'int' },
    { label: '期間再使用率', get: (k) => k.再使用率, fmt: 'pct', better: true },
    { label: '期間不良率', get: (k) => (k.期間回廠量 ? k.不良品數 / k.期間回廠量 : 0), fmt: 'pct', better: false },
    { label: '整體不良率', get: (k) => k.不良率, fmt: 'pct', better: false },
    { label: '整體過保率', get: (k) => k.過保率, fmt: 'pct', better: false },
  ];

  // 故障原因分類（彙整總覽第 7-11 欄），對齊 build_分析總表.py 的 CAR_FAULT_SUM / LENS_FAULT
  const FAULT_COLS_BY_DEVICE = {
    車機: ['AB點', '失聯', '定位不良', '訊號異常', '其他'],
    鏡頭: ['黑畫面', '進水/模糊', '水波紋', '時有時無', '其他'],
  };

  // 車機_彙整總覽／鏡頭_彙整總覽：30欄，對齊 設備品質分析_分析總表_新版.xlsx（見 build_分析總表.py build_overview）
  function rcolsFor(faultCols) {
    return [
      ['期間', '期間', 'text'], ['類型', '類型', 'text'], ['廠商', '廠商', 'text'],
      ['ERP品號', 'ERP品號', 'text'], ['品名', '品名', 'text'], ['上線量', '上線量', 'int'],
      ...faultCols.map((f) => [f, f, 'int']),
      ['回廠量', '回廠量', 'int'], ['回廠不良品數(全)', '回廠不良品數(全)', 'int'],
      ['回廠良品數', '回廠良品數', 'int'], ['回廠不良品數', '回廠不良品數', 'int'],
      ['回廠過保數', '回廠過保數', 'int'], ['回廠人為數', '回廠人為數', 'int'],
      ['D /停產報廢', 'D /停產報廢', 'int'], ['E /過保報廢', 'E /過保報廢', 'int'],
      ['G /評估後退修', 'G /評估後退修', 'int'], ['H /人為報廢', 'H /人為報廢', 'int'],
      ['O /測試正常', 'O /測試正常', 'int'], ['X /已完修', 'X /已完修', 'int'],
      ['V /已完修 人為', 'V /已完修 人為', 'int'], ['維修換貨＋換貨條碼', '維修換貨＋換貨條碼', 'int'],
      ['回廠QC', '回廠QC', 'int'], ['回廠報廢', '回廠報廢', 'int'],
      ['其他(良品)', '其他(良品)', 'int'], ['其他(回廠)', '其他(回廠)', 'int'],
      ['已使用年限', '已使用年限', 'year'],
    ];
  }
  const RCOLS_NONSUM = ['期間', '類型', '廠商', 'ERP品號', '品名'];
  const fmtC = (fmt, v) => fmt === 'pct' ? rPct(v) : fmt === 'int' ? rInt(v) : fmt === 'year' ? rYear(v) : esc(v);

  function scopeText(state) {
    const s = state.selection, p = [];
    if (s.廠商.length) p.push(`廠商：${s.廠商.join('、')}`);
    if (s.類型.length) p.push(`類型：${s.類型.join('、')}`);
    if (s.ERP品號.length) p.push(`品號：${s.ERP品號.length} 項`);
    return p.length ? p.join('；') : '全部設備';
  }
  function periodText(state) {
    const cur = state.currentSnap ? `${state.year}-Q${state.quarter}（快照）` : `${state.year}-Q${state.quarter}`;
    if (!state.cmp.on) return cur;
    const cmp = state.cmpSnap ? `${state.cmp.year}-Q${state.cmp.quarter}（快照）` : `${state.cmp.year}-Q${state.cmp.quarter}`;
    return `${cur}　vs　${cmp}`;
  }

  function aggTableHTML(agg, titlePrefix, rcols, periodLabel) {
    const head = `<tr>${rcols.map(([h, , f]) => `<th class="${f !== 'text' ? 'num' : ''}">${h}</th>`).join('')}</tr>`;
    const labelIdx = Math.max(0, rcols.findIndex(([, key]) => key === agg.groupBy));
    const cellFor = (r, key, f) => key === '期間' ? esc(periodLabel) : fmtC(f, r[key]);
    let body = '';
    for (const g of agg.groups) {
      for (const r of g.rows) body += `<tr>${rcols.map(([, key, f]) => `<td class="${f !== 'text' ? 'num' : ''}">${cellFor(r, key, f)}</td>`).join('')}</tr>`;
      body += `<tr class="sub">${rcols.map(([, key, f], i) => {
        if (i === labelIdx) return `<td>${esc(g.key)} 小計</td>`;
        if (RCOLS_NONSUM.includes(key)) return '<td></td>';
        return `<td class="num">${fmtC(f, g.subtotal[key])}</td>`;
      }).join('')}</tr>`;
    }
    body += `<tr class="grand">${rcols.map(([, key, f], i) => {
      if (i === labelIdx) return `<td>總計</td>`;
      if (RCOLS_NONSUM.includes(key)) return '<td></td>';
      return `<td class="num">${fmtC(f, agg.grandTotal[key])}</td>`;
    }).join('')}</tr>`;
    return `<h3>${esc(titlePrefix)}_彙整總覽</h3><div class="scroll"><table class="agg"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  // 設備品質分析_彙整總表：21欄（含期間），對齊 設備品質分析_分析總表_新版.xlsx 明細分頁
  const RAWCOLS = [
    ['期間', '_period'], ['品項完工日期', '品項完工日期'], ['設備類型', '設備類型'], ['廠牌型號', '廠牌型號'],
    ['廠商', '廠商'], ['ERP品號', 'ERP品號'], ['替換前品項', '替換前品項'], ['替換前品項條碼', '條碼'],
    ['維護原因', '維護原因'], ['維護細節', '維護細節'], ['輸入年月', '輸入年月'], ['輸入時間', '輸入時間'],
    ['完成原因', '完成原因'], ['報廢單狀態', '報廢單狀態'], ['報廢原因', '報廢原因'], ['上線量', '_上線量'],
    ['維護類型', '維護類型'], ['維修分類', '維修分類'], ['進貨日', '進貨日'], ['已使用年限', '已使用年限'],
    ['QC', 'QC'],
  ];
  const RAW_MAX_PER_DEVICE = 300;

  function rawTableHTML(deviceSections, periodLabel) {
    let allRows = [];
    let totalAll = 0;
    for (const sec of deviceSections) {
      const onlineByERP = new Map();
      for (const o of (sec.data.online || [])) {
        const e = String(o.ERP品號 || '');
        onlineByERP.set(e, (onlineByERP.get(e) || 0) + (Number(o.上線量) || 0));
      }
      const tagged = sec.data.rows.map((r) => ({
        ...r, _period: periodLabel, _上線量: onlineByERP.get(String(r.ERP品號 || '')) || 0,
      }));
      totalAll += tagged.length;
      allRows = allRows.concat(tagged.slice(0, RAW_MAX_PER_DEVICE));
    }
    const head = `<tr>${RAWCOLS.map(([h]) => `<th>${h}</th>`).join('')}</tr>`;
    const body = allRows.map((r) => `<tr>${RAWCOLS.map(([, k]) => `<td>${esc(r[k] ?? '')}</td>`).join('')}</tr>`).join('');
    const note = totalAll > allRows.length
      ? `<p class="note">車機／鏡頭各顯示前 ${RAW_MAX_PER_DEVICE} 筆，共 ${totalAll.toLocaleString()} 筆（完整明細請至工具內「明細（逐筆）」查看或匯出快照）。</p>` : '';
    return `<div class="sec"><h2>設備品質分析_彙整總表</h2>${note}<div class="scroll" style="max-height:460px">
      <table class="agg"><thead>${head}</thead><tbody>${body}</tbody></table></div></div>`;
  }

  // ── 核心發現 callout（仿 CR-804 報告的「核心發現」重點框）──────────────
  function findingsCalloutHTML(d) {
    const bullets = (App.advice && App.advice.genFindings) ? App.advice.genFindings(d) : [];
    if (!bullets.length) return '';
    const tone = d.kpi.不良率 >= 0.03 ? 'bad' : d.kpi.不良率 >= 0.01 ? 'warn' : 'good';
    return `<div class="callout ${tone}"><p class="big-quote">核心發現</p><ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`;
  }

  function editableAdviceHTML(deviceKeySafe, label, kind, text) {
    return `<h3>${esc(label)}</h3>
      <textarea class="advice-edit" data-key="${deviceKeySafe}-${kind}">${esc(text)}</textarea>`;
  }

  // ── 單一設備區塊（車機分析／鏡頭分析）────────────────────────────────
  function deviceSectionHTML(sec, idx, hasCmp) {
    const d = sec.data;
    const devState = { ...sec.state, rows: d.rows, kpi: d.kpi, cmpKpi: d.cmpKpi };
    const advice = (App.advice && App.advice.getTexts) ? App.advice.getTexts(devState) : { 品管: '', 採購: '' };
    const faultCols = FAULT_COLS_BY_DEVICE[sec.key] || FAULT_COLS_BY_DEVICE.車機;
    const periodLabel = `${sec.state.year}-Q${sec.state.quarter}`;
    const agg = App.metrics.aggregate(d.rows, d.online, sec.state.selection, { groupBy: '類型', faultCols });
    const trend = App.metrics.trendByMonth(d.rows, sec.state.selection);
    const fault = App.metrics.faultDistribution(d.rows, sec.state.selection);
    const ftop = fault.slice(0, 8); const frest = fault.slice(8).reduce((s, f) => s + f.數量, 0);
    const fLabels = ftop.map((f) => f.維護類型); const fData = ftop.map((f) => f.數量);
    if (frest > 0) { fLabels.push('其他項'); fData.push(frest); }
    const chartVarSuffix = idx;
    return {
      html: `<div class="sec">
        <h2>${sec.icon} ${esc(sec.label)}分析</h2>
        ${findingsCalloutHTML(d)}
        <div class="cards">${kpiCardsHTMLFor(d, hasCmp)}</div>
        <div class="two">
          <div><div class="chart"><canvas id="tc-${chartVarSuffix}"></canvas></div></div>
          <div><div class="chart"><canvas id="fc-${chartVarSuffix}"></canvas></div></div>
        </div>
        ${aggTableHTML(agg, sec.label, rcolsFor(faultCols), periodLabel)}
        ${editableAdviceHTML(sec.key, '品管建議（可編輯）', '品管', advice.品管)}
        ${editableAdviceHTML(sec.key, '採購建議（可編輯）', '採購', advice.採購)}
      </div>`,
      chartScript: `
 new Chart(document.getElementById('tc-${chartVarSuffix}'),{type:'line',data:{labels:${JSON.stringify(trend.map((t) => t.年月))},datasets:[
  {label:'回廠量',data:${JSON.stringify(trend.map((t) => t.回廠量))},borderColor:'#009688',backgroundColor:'rgba(0,150,136,.12)',fill:true,tension:.3,pointRadius:2,borderWidth:2},
  {label:'不良品數',data:${JSON.stringify(trend.map((t) => t.不良品數))},borderColor:'#EF5350',fill:false,tension:.3,pointRadius:2,borderWidth:1.5}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},title:{display:true,text:'${esc(sec.label)}｜每月回廠量／不良品數趨勢'}},scales:{y:{beginAtZero:true,title:{display:true,text:'顆'}}}}});
 new Chart(document.getElementById('fc-${chartVarSuffix}'),{type:'doughnut',data:{labels:${JSON.stringify(fLabels)},datasets:[{data:${JSON.stringify(fData)},backgroundColor:PAL,borderColor:'#fff',borderWidth:1}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{boxWidth:12,font:{size:11}}},title:{display:true,text:'${esc(sec.label)}｜故障分佈（維護類型）'}}}});`,
    };
  }

  function kpiCardsHTMLFor(d, hasCmp) {
    const k = d.kpi, c = d.cmpKpi;
    return RKPI.map((m) => {
      const val = fmtC(m.fmt, m.get(k));
      let delta = '';
      if (hasCmp && c) {
        const cur = m.get(k), prev = m.get(c);
        if (m.fmt === 'pct') {
          const pp = (cur - prev) * 100;
          const cls = Math.abs(pp) < 0.05 ? 'flat' : (m.better == null ? 'flat' : (((pp > 0) === m.better) ? 'good' : 'bad'));
          delta = `<div class="d d-${cls}">${pp >= 0 ? '▲ +' : '▼ '}${pp.toFixed(1)}pp</div><div class="p">對比 ${rPct(prev)}</div>`;
        } else {
          const diff = cur - prev;
          const cls = diff === 0 ? 'flat' : (m.better == null ? 'flat' : (((diff > 0) === m.better) ? 'good' : 'bad'));
          delta = `<div class="d d-${cls}">${diff >= 0 ? '▲ +' : '▼ '}${rInt(diff)}</div><div class="p">對比 ${rInt(prev)}</div>`;
        }
      }
      return `<div class="kpi"><div class="l">${m.label}</div><div class="v">${val}</div>${delta}</div>`;
    }).join('');
  }

  // ── 整體概覽：車機／鏡頭並列比較（仿 PPTX 封面「車機、鏡頭」整合頁）───
  function overviewHTML(sections) {
    const rows = sections.map((sec) => {
      const k = sec.data.kpi;
      return `<tr><td class="l">${sec.icon} ${esc(sec.label)}</td>
        <td class="num">${rInt(k.總線上量)}</td><td class="num">${rInt(k.期間回廠量)}</td>
        <td class="num">${rPct(k.再使用率)}</td><td class="num">${rPct(k.不良率)}</td><td class="num">${rPct(k.過保率)}</td></tr>`;
    }).join('');
    return `<div class="sec"><h2>整體概覽（車機＋鏡頭）</h2>
      <table class="agg"><thead><tr><th class="l">設備</th><th class="num">總線上量</th><th class="num">期間回廠量</th>
      <th class="num">期間再使用率</th><th class="num">整體不良率</th><th class="num">整體過保率</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function generateReportHTML(state) {
    if (!App.app || !App.app.dataForDevice || !App.app.DEVICE_TABS) {
      throw new Error('報告產生需要 App.app.dataForDevice／DEVICE_TABS（app.js 尚未載入或版本過舊）');
    }
    const icons = { 車機: '🚗', 鏡頭: '📷' };
    const sections = App.app.DEVICE_TABS.map((t) => ({
      key: t.key, label: t.key, icon: icons[t.key] || '📦',
      state, data: App.app.dataForDevice(t.key),
    }));
    const genAt = new Date().toLocaleString('zh-TW');
    const built = sections.map((sec, idx) => deviceSectionHTML(sec, idx, state.cmp.on));

    return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>設備品質分析報告 ${esc(periodText(state))}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
:root{--teal:#009688;--teal-d:#00796B;--grad:linear-gradient(135deg,#4DB6AC 0%,#26A69A 38%,#1E88E5 100%);--ink:#1F2535;--muted:#6B7384;--line:#DDE1E9;--bg:#F5F7FA;--good:#1a9c53;--warn:#e08e00;--bad:#D32F2F}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif;color:var(--ink);background:var(--bg);line-height:1.6}
.hero{background:var(--grad);color:#fff;padding:32px 32px 40px}.hero h1{margin:0 0 6px;font-size:24px}.hero .meta{font-size:13px;opacity:.95}
.wrap{max-width:1160px;margin:0 auto;padding:24px 32px 60px}
.sec{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-top:18px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.sec h2{font-size:18px;margin:0 0 14px;color:var(--teal-d);border-bottom:2px solid var(--teal);padding-bottom:6px}
.sec h3{font-size:14px;margin:20px 0 8px;color:#333}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.kpi{border:1px solid var(--line);border-radius:12px;padding:14px 16px;border-top:3px solid var(--teal)}
.kpi .l{font-size:12px;color:var(--muted)}.kpi .v{font-size:24px;font-weight:800}
.kpi .d{font-size:12px;font-weight:600;margin-top:4px}.kpi .p{font-size:11px;color:var(--muted)}
.d-good{color:var(--good)}.d-bad{color:var(--bad)}.d-flat{color:var(--muted)}
.two{display:grid;grid-template-columns:1.4fr 1fr;gap:16px}
.chart{position:relative;height:280px}
table.agg{border-collapse:collapse;width:100%;font-size:12px}
table.agg th{background:var(--teal);color:#fff;padding:7px 9px;text-align:left;white-space:nowrap;position:sticky;top:0}
table.agg th.num,table.agg td.num{text-align:right}
table.agg td.l{text-align:left}
table.agg td{padding:5px 9px;border-bottom:1px solid #eef0f4;white-space:nowrap}
tr.grp td{background:#E0F2F1;font-weight:700;color:var(--teal-d)}
tr.sub td{background:#f3f6f9;font-weight:600}tr.grand td{background:#1F2535;color:#fff;font-weight:700}
.scroll{overflow-x:auto;max-height:460px;overflow-y:auto;border:1px solid var(--line);border-radius:8px}
.advice-edit{white-space:pre-wrap;font-size:13.5px;background:#fafbfc;border:1px solid var(--line);border-radius:8px;padding:14px 16px;width:100%;min-height:150px;font-family:inherit;resize:vertical}
.callout{background:#fff;border-left:5px solid var(--teal);border-radius:8px;padding:14px 18px;margin:0 0 16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.callout.bad{border-left-color:var(--bad);background:#fff8f9}
.callout.warn{border-left-color:var(--warn);background:#fffcf5}
.callout.good{border-left-color:var(--good);background:#f6fbf8}
.callout ul{margin:8px 0 0 20px}.callout li{margin:5px 0;font-size:13.5px}
.big-quote{font-size:14.5px;font-weight:700;color:var(--teal-d)}
.note{font-size:12px;color:var(--muted);margin:4px 0 10px}
.save-bar{text-align:center;margin-top:20px}
.save-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 22px;border:none;border-radius:8px;font-size:13.5px;font-weight:600;cursor:pointer;background:var(--grad);color:#fff;box-shadow:0 2px 8px rgba(0,150,136,.35)}
.foot{color:var(--muted);font-size:12px;margin-top:14px;text-align:center}
@media(max-width:820px){.two{grid-template-columns:1fr}}
</style></head><body>
<div class="hero"><h1>設備品質分析報告</h1>
<div class="meta">期間：${esc(periodText(state))}　｜　範圍：車機＋鏡頭　｜　製表：${esc(genAt)}　｜　資料來源：CRM（Google Sheets）</div></div>
<div class="wrap">
${overviewHTML(sections)}
${built.map((b) => b.html).join('\n')}
${rawTableHTML(sections, `${state.year}-Q${state.quarter}`)}
<div class="save-bar"><button class="save-btn" id="save-edited">💾 儲存目前版本（含已編輯的建議文字）</button></div>
<div class="foot">本報告由「設備品質分析工具」自動生成，核心發現／建議文字可於框內直接編輯後按上方按鈕另存。EUP 弋揚科技</div>
</div>
<script>
const PAL=${JSON.stringify(PAL)};
window.addEventListener('load',function(){
 if(typeof Chart!=='undefined'){${built.map((b) => b.chartScript).join('\n')}}
 var btn=document.getElementById('save-edited');
 if(btn)btn.addEventListener('click',function(){
   document.querySelectorAll('textarea.advice-edit').forEach(function(t){t.textContent=t.value;});
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
