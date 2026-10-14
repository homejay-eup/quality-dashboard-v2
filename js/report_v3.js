/**
 * js/report_v3.js — 落地頁報告 v3（正式版，掛 App.reportV3；「生成落地頁報告」按鈕產生的就是這份）
 *
 * 2026-10-12 改版：整份報告聚焦三件事——
 *   01 良率狀況：整體良率（以線上量為母數）＋回廠不良分析（以回廠量為母數）＋曲線圖
 *   02 使用年限：廠商／機型的已使用年限比較（本期 vs 去年同期）
 *   03 廠商細項：廠商 × 不良率 × 使用年限，可展開到機型
 * 版面沿用舊版落地報告（頂部分頁列＋圓角卡片），主色為藍色；頂部「車機｜鏡頭」切換設備範圍。
 * 所有主要曲線圖皆為「本期 vs 去年同期」（有選對比期間時用對比期間）。
 *
 * 計算一律沿用 App.transform.buildDetail／App.metrics（computeKPI、aggregate、applyFilter），
 * 只重做呈現；舊版 App.report.generateReportHTML 仍保留於 report.js（快照匯出等共用），但按鈕已改接本檔。
 *
 * 口徑：
 *   - 不良數＝不良品數＋未歸類數（比照舊版報告「未歸類併入不良品」預設開啟）
 *   - 整體良率＝1 − 不良數 ÷ 線上量；回廠不良率＝不良數 ÷ 回廠量
 *   - 平均已使用年限（回廠）＝規則 E／v9：不良品＋過保＋未歸類的 已使用年限（完工日 − 進貨日）平均
 *   - 在線平均已使用年限＝規則 H：「車機鏡頭上線明細」逐台（今天 − 參考日期）平均，
 *     一律由 App.metrics.aggregate（opts.onlineAgeRows／deviceType）算出，與舊版報告同一來源、同一數字；
 *     該明細尚未載入（state.onlineAgeStatus !== 'ok'）時顯示「—」，不再用估算值
 */
window.App = window.App || {};

App.reportV3 = (() => {
  const EXPECTED_LIFE = { 車機: 3, 鏡頭: 1 };
  const AGE_BUCKETS = [
    { label: '未滿1年', lo: 0, hi: 1 },
    { label: '1–2年', lo: 1, hi: 2 },
    { label: '2–3年', lo: 2, hi: 3 },
    { label: '3–4年', lo: 3, hi: 4 },
    { label: '4–5年', lo: 4, hi: 5 },
    { label: '5–7年', lo: 5, hi: 7 },
    { label: '7年以上', lo: 7, hi: Infinity },
  ];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fInt = (v) => (Number(v) || 0).toLocaleString('en-US');
  const fPct = (v, dp = 1) => (v == null ? '—' : `${(v * 100).toFixed(dp)}%`);
  const fYear = (v) => (v == null ? '—' : `${v.toFixed(1)} 年`);
  const safeDiv = (n, d) => (d ? n / d : null);
  const round = (v, dp) => (v == null ? null : +v.toFixed(dp));
  const isReturned = (r) => r.回廠狀態 && r.回廠狀態 !== '無記錄' && r.回廠狀態 !== '不回廠';
  const badOf = (s) => (s.不良品數 || 0) + (s.未歸類數 || 0);
  const groupKey = (v, fallback) => (v ? String(v) : fallback);

  function ymOf(v) {
    const m = String(v || '').match(/(\d{4})\D?(\d{1,2})/);
    return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
  }

  const bucketIndex = (age) => AGE_BUCKETS.findIndex((b) => age >= b.lo && age < b.hi);

  // 不良原因歸納（暫定規則，待確認）：
  //   1. 有報廢原因且未完修 → 依報廢原因關鍵字（外殼損壞／泡水、滯留過久不符成本…）
  //   2. 有完修記錄 → 拆「完成原因」的處理項目（更換外殼、更換線材、韌體重置…），排除共通的「維修測試」；
  //      有換零件時只算零件，沒換零件才算「韌體重置」
  //   3. 評估後退修／無紀錄另列
  const REASON_PARTS = [
    [/主板|主IC/i, '主板／主IC不良'], [/4G模組/i, '更換4G模組'], [/SD卡/i, 'SD卡IC不良'], [/電池/, '更換電池'],
    [/金電容/, '更換金電容'], [/電源座|寬壓/, '電源相關'], [/外殼/, '更換外殼'], [/線材/, '更換線材'],
    [/SIM/i, '更換SIM卡座'], [/鏡頭/, '更換鏡頭'], [/新品/, '更換新品'], [/零件|積板/, '更換零件'], [/整新/, '整新'],
  ];
  function defectReasons(r) {
    const done = String(r.完成原因 || '').trim();
    const scrap = String(r.報廢原因 || '').trim();
    const code = String(r.維修分類 || '');
    if (scrap && !/^X/.test(code)) {
      if (/外殼|泡水/.test(scrap)) return ['外殼損壞／泡水（報廢）'];
      if (/滯留|成本/.test(scrap)) return ['滯留過久／不符維修成本（報廢）'];
      return ['報廢'];
    }
    if (/^G/.test(code)) return ['評估後退修'];
    if (!done) return ['無維修紀錄'];
    const body = done.replace(/^[A-Z]\s*\/[^\s/]*/, '').replace(/\/V\w+\//g, ' ');
    const parts = [];
    for (const [re, label] of REASON_PARTS) if (re.test(body) && !parts.includes(label)) parts.push(label);
    if (parts.length) return parts;
    if (/韌體|程式更新|昇級|升級/.test(body)) return ['韌體／程式更新（未換零件）'];
    return ['維修（其他）'];
  }

  // ── 單一設備（車機／鏡頭）的全部報告資料 ──────────────────────────────
  function buildDeviceData(state, deviceKey) {
    const scope = App.app.DEVICE_TABS.find((t) => t.key === deviceKey);
    const sel = state.selectionByTab[deviceKey];
    const d = App.app.dataForDevice(deviceKey);
    const hasCmp = !!(state.cmp.on && d.cmpKpi);
    const rows = App.metrics.applyFilter(d.rows, sel);
    const online = App.metrics.applyFilter(d.online, sel);
    const ret = rows.filter(isReturned);
    const kpi = d.kpi, cmpKpi = hasCmp ? d.cmpKpi : null;

    const endMonth = state.quarter * 3;
    const cmpYear = state.cmp.on ? state.cmp.year : state.year - 1;
    // 規則 H：在線平均已使用年限（資料來源「車機鏡頭上線明細」，與回廠明細獨立）。
    // 與舊版報告相同：state.onlineAgeStatus 非 'ok' 時一律傳 null → aggregate 回傳的在線年限欄位全為 null（顯示「—」）。
    const onlineAgeRows = state.onlineAgeStatus === 'ok' ? state.onlineAgeRows : null;
    const ageOpts = (groupBy) => ({ groupBy, onlineAgeRows, deviceType: deviceKey });

    const summarize = (k) => (k ? {
      上線量: k.總線上量, 回廠量: k.期間回廠量, 良品: k.良品數, 不良: badOf(k), 過保: k.過保數,
      整體良率: k.總線上量 ? 1 - badOf(k) / k.總線上量 : null,
      回廠不良率: safeDiv(badOf(k), k.期間回廠量),
      再使用率: safeDiv(k.良品數, k.期間回廠量),
      過保率: safeDiv(k.過保數, k.期間回廠量),
    } : null);
    const cur = summarize(kpi), cmp = summarize(cmpKpi);
    const modelAggAll = App.metrics.aggregate(d.rows, d.online, sel, ageOpts('類型'));
    cur.非良品年限 = modelAggAll.grandTotal.已使用年限;
    if (cmp && d.cmpRows) cmp.非良品年限 = App.metrics.aggregate(d.cmpRows, d.cmpOnline, sel, { groupBy: '類型' }).grandTotal.已使用年限;
    const lifeYears = EXPECTED_LIFE[deviceKey];
    const overShare = (rowsAll) => {
      const xs = App.metrics.applyFilter(rowsAll, sel).filter((r) => isReturned(r) && (r.不良品 || r.過保 || r.未歸類) && r.已使用年限 != null);
      return xs.length ? xs.filter((r) => Number(r.已使用年限) > lifeYears).length / xs.length : null;
    };
    cur.超齡占比 = overShare(d.rows);
    if (cmp && d.cmpRows) cmp.超齡占比 = overShare(d.cmpRows);

    // ── 月度序列（資料涵蓋的每一年各跑一次全年 cohort，再依 年月 分組）──
    const years = [...new Set((state.currentPeriods || []).map((p) => p.year))].filter((y) => y === state.year || y === cmpYear);
    const timeline = [];
    for (const y of years) {
      const maxQ = Math.max(...state.currentPeriods.filter((p) => p.year === y).map((p) => p.quarter));
      const yRows = App.metrics.applyFilter(
        App.transform.buildDetail(state.raw, { year: y, quarter: maxQ }).rows
          .filter((r) => r.設備類型 === scope.設備類型 && r.維護原因 === scope.維護原因), sel);
      const byMonth = new Map();
      for (const r of yRows) {
        if (!isReturned(r)) continue;
        const ym = ymOf(r.年月);
        if (!ym || ym.y !== y) continue;
        if (!byMonth.has(ym.m)) byMonth.set(ym.m, { 回廠量: 0, 不良: 0 });
        const b = byMonth.get(ym.m);
        b.回廠量++;
        if (r.不良品 || r.未歸類) b.不良++;
      }
      for (let m = 1; m <= maxQ * 3; m++) {
        const b = byMonth.get(m) || { 回廠量: 0, 不良: 0 };
        timeline.push({
          y, m, label: `${y - 1911}/${m}`, 回廠量: b.回廠量, 不良: b.不良,
          整體良率: cur.上線量 ? round((1 - b.不良 / cur.上線量) * 100, 3) : null,
          回廠不良率: b.回廠量 ? round(b.不良 / b.回廠量 * 100, 1) : null,
        });
      }
    }
    const monthSeries = (y, key) => Array.from({ length: endMonth }, (_, i) => {
      const t = timeline.find((x) => x.y === y && x.m === i + 1);
      return t ? t[key] : null;
    });
    const monthly = {
      labels: Array.from({ length: endMonth }, (_, i) => `${i + 1}月`),
      curLabel: `${state.year - 1911}年`, prevLabel: `${cmpYear - 1911}年（同期）`,
      整體良率: { cur: monthSeries(state.year, '整體良率'), prev: monthSeries(cmpYear, '整體良率') },
      回廠不良率: { cur: monthSeries(state.year, '回廠不良率'), prev: monthSeries(cmpYear, '回廠不良率') },
      回廠量: { cur: monthSeries(state.year, '回廠量'), prev: monthSeries(cmpYear, '回廠量') },
    };

    // ── 回廠故障原因（維護類型）──
    const faultCols = App.config.FAULT_COLS_BY_DEVICE[deviceKey];
    const faultAgg = App.metrics.aggregate(d.rows, d.online, sel, { groupBy: '類型', faultCols });
    const faults = faultCols.map((f) => ({ label: f, qty: faultAgg.grandTotal[f] || 0 })).filter((f) => f.qty > 0)
      .sort((a, b) => (a.label === '其他') - (b.label === '其他') || b.qty - a.qty);

    // ── 使用年限：回廠設備（規則 E，已使用年限），並依 機型／廠商 累計；在線年限（規則 H）見下方 aggregate ──
    const ageAcc = () => ({ sum: 0, n: 0, badSum: 0, badN: 0, overN: 0 });
    const retByModel = new Map(), retByVendor = new Map();
    const retTotal = ageAcc();
    const retBuckets = AGE_BUCKETS.map(() => ({ 回廠量: 0, 不良: 0, 過保: 0 }));
    const life = EXPECTED_LIFE[deviceKey];
    for (const r of ret) {
      if (r.已使用年限 == null) continue;
      const age = Number(r.已使用年限), isBad = !!(r.不良品 || r.未歸類);
      const keys = [[retByModel, groupKey(r.廠牌型號, '(未分類)')], [retByVendor, groupKey(r.廠商, '未分類')]];
      for (const acc of [retTotal, ...keys.map(([m, k]) => { if (!m.has(k)) m.set(k, ageAcc()); return m.get(k); })]) {
        acc.sum += age; acc.n++;
        if (isBad) { acc.badSum += age; acc.badN++; }
        if (age > life) acc.overN++;
      }
      const bi = bucketIndex(age);
      if (bi >= 0) { retBuckets[bi].回廠量++; if (isBad) retBuckets[bi].不良++; if (r.過保) retBuckets[bi].過保++; }
    }
    const cmpRet = hasCmp && d.cmpRows ? App.metrics.applyFilter(d.cmpRows, sel).filter(isReturned) : [];
    const cmpBuckets = AGE_BUCKETS.map(() => ({ 回廠量: 0, 不良: 0 }));
    const cmpTotal = ageAcc();
    for (const r of cmpRet) {
      if (r.已使用年限 == null) continue;
      const age = Number(r.已使用年限), isBad = !!(r.不良品 || r.未歸類);
      cmpTotal.sum += age; cmpTotal.n++;
      if (isBad) { cmpTotal.badSum += age; cmpTotal.badN++; }
      if (age > life) cmpTotal.overN++;
      const bi = bucketIndex(age);
      if (bi >= 0) { cmpBuckets[bi].回廠量++; if (isBad) cmpBuckets[bi].不良++; }
    }
    const ageOf = (acc) => (acc && acc.n ? round(acc.sum / acc.n, 1) : null);
    const badAgeOf = (acc) => (acc && acc.badN ? round(acc.badSum / acc.badN, 1) : null);

    const retBucketTotal = retBuckets.reduce((s, b) => s + b.回廠量, 0);
    const cmpBucketTotal = cmpBuckets.reduce((s, b) => s + b.回廠量, 0);
    const age = {
      life,
      retAvg: ageOf(retTotal), retBadAvg: badAgeOf(retTotal), retN: retTotal.n,
      retOverShare: safeDiv(retTotal.overN, retTotal.n),
      cmpRetAvg: hasCmp ? ageOf(cmpTotal) : null, cmpRetBadAvg: hasCmp ? badAgeOf(cmpTotal) : null,
      cmpOverShare: hasCmp ? safeDiv(cmpTotal.overN, cmpTotal.n) : null,
      // 總計用規則 H 本體 computeOnlineAge（與儀表板 KPI 卡同一函式、同一數字）；
      // 機型／廠商列用 aggregate（與舊版報告各列同來源，只含本期有派工／回廠明細的 ERP品號）
      onAvg: onlineAgeRows ? App.metrics.computeOnlineAge(onlineAgeRows, sel)[`在線平均已使用年限_${deviceKey}`] : null,
      onlineAgeOk: !!onlineAgeRows,
      buckets: AGE_BUCKETS.map((b, i) => ({
        label: b.label,
        回廠占比: retBucketTotal ? round(retBuckets[i].回廠量 / retBucketTotal * 100, 1) : 0,
        回廠量: retBuckets[i].回廠量,
        回廠不良率: retBuckets[i].回廠量 ? round(retBuckets[i].不良 / retBuckets[i].回廠量 * 100, 1) : null,
        回廠過保率: retBuckets[i].回廠量 ? round(retBuckets[i].過保 / retBuckets[i].回廠量 * 100, 1) : null,
        去年回廠占比: hasCmp && cmpBucketTotal ? round(cmpBuckets[i].回廠量 / cmpBucketTotal * 100, 1) : null,
        去年回廠不良率: hasCmp && cmpBuckets[i].回廠量 ? round(cmpBuckets[i].不良 / cmpBuckets[i].回廠量 * 100, 1) : null,
      })),
    };

    // ── 機型彙整 ──
    const modelAgg = App.metrics.aggregate(d.rows, d.online, sel, ageOpts('類型'));
    const models = modelAgg.groups.map((g) => {
      const s = g.subtotal, ra = retByModel.get(g.key);
      return {
        key: g.key, 上線量: s.上線量, 回廠量: s.回廠量, 良品: s.良品數, 不良: badOf(s), 過保: s.過保數,
        回廠不良率: safeDiv(badOf(s), s.回廠量), 整體良率: s.上線量 ? 1 - badOf(s) / s.上線量 : null,
        回廠年限: ageOf(ra), 不良年限: badAgeOf(ra), 線上年限: s.在線平均已使用年限, 非良品年限: s.已使用年限,
        整體過保率: s.上線量 ? s.過保數 / s.上線量 : null,
      };
    });
    // 線上有設備但本期無派工／回廠明細的機型也要出現在年限表（在線年限直接用規則 H 的 computeOnlineAge 依機型篩選）
    const onQtyByModel = new Map();
    for (const o of online) {
      const k = groupKey(o.廠牌型號, '(未分類)');
      onQtyByModel.set(k, (onQtyByModel.get(k) || 0) + (Number(o.上線量) || 0));
    }
    for (const [k, qty] of onQtyByModel) {
      if (models.some((m) => m.key === k)) continue;
      const onAge = onlineAgeRows ? App.metrics.computeOnlineAge(onlineAgeRows, { ...sel, 類型: [k] })[`在線平均已使用年限_${deviceKey}`] : null;
      models.push({ key: k, 上線量: qty, 回廠量: 0, 良品: 0, 不良: 0, 過保: 0, 回廠不良率: null, 整體良率: qty ? 1 : null,
        回廠年限: null, 不良年限: null, 線上年限: onAge });
    }
    models.sort((a, b) => b.回廠量 - a.回廠量 || b.上線量 - a.上線量);
    const reasonByModel = new Map();
    for (const r of ret) {
      if (!(r.不良品 || r.未歸類)) continue;
      const k = groupKey(r.廠牌型號, '(未分類)');
      if (!reasonByModel.has(k)) reasonByModel.set(k, {});
      const acc = reasonByModel.get(k);
      for (const label of defectReasons(r)) acc[label] = (acc[label] || 0) + 1;
    }
    models.forEach((m) => {
      const acc = reasonByModel.get(m.key) || {};
      m.原因 = Object.entries(acc).map(([label, qty]) => ({ label, qty })).sort((a, b) => b.qty - a.qty).slice(0, 3);
    });

    // ── 廠商彙整（含展開用機型明細、同期比較）──
    const vendorAgg = App.metrics.aggregate(d.rows, d.online, sel, ageOpts('廠商'));
    const cmpVendorAgg = hasCmp && d.cmpRows ? App.metrics.aggregate(d.cmpRows, d.cmpOnline, sel, { groupBy: '廠商' }) : null;
    // 品項（ERP品號）層級的在線年限：取自 aggregate 的 ERP 列（規則 H 依 ERP品號 分組平均）
    const onAgeByErp = new Map();
    for (const g of modelAggAll.groups) for (const r of g.rows) if (r.在線平均已使用年限 != null) onAgeByErp.set(String(r.ERP品號), r.在線平均已使用年限);
    const vendors = vendorAgg.groups.map((g) => {
      const s = g.subtotal, ra = retByVendor.get(g.key);
      const cg = cmpVendorAgg && cmpVendorAgg.groups.find((x) => x.key === g.key);
      const cmpVM = hasCmp && d.cmpRows ? App.metrics.aggregate(d.cmpRows, d.cmpOnline, { ...sel, 廠商: [g.key] }, { groupBy: '類型' }) : null;
      const vModels = App.metrics.aggregate(d.rows, d.online, { ...sel, 廠商: [g.key] }, ageOpts('類型')).groups
        .map((mg) => {
          const ms = mg.subtotal, mr = ret.filter((r) => r.廠商 === g.key && groupKey(r.廠牌型號, '(未分類)') === mg.key && r.已使用年限 != null);
          const mrBad = mr.filter((r) => r.不良品 || r.未歸類);
          const cmg = cmpVM && cmpVM.groups.find((x) => x.key === mg.key);
          const mc = cmpRet.filter((r) => r.廠商 === g.key && groupKey(r.廠牌型號, '(未分類)') === mg.key && r.已使用年限 != null);
          const avgAge = (xs) => (xs.length ? round(xs.reduce((t, r) => t + Number(r.已使用年限), 0) / xs.length, 1) : null);
          return {
            key: mg.key, 上線量: ms.上線量, 回廠量: ms.回廠量, 良品: ms.良品數, 不良: badOf(ms), 過保: ms.過保數,
            回廠不良率: safeDiv(badOf(ms), ms.回廠量), 整體良率: ms.上線量 ? 1 - badOf(ms) / ms.上線量 : null,
            回廠年限: mr.length ? round(mr.reduce((t, r) => t + Number(r.已使用年限), 0) / mr.length, 1) : null,
            線上年限: ms.在線平均已使用年限,
            不良年限: avgAge(mrBad), cmp回廠年限: hasCmp ? avgAge(mc) : null, 年限樣本: mr.length,
            非良品年限: ms.已使用年限, cmp非良品年限: cmg ? cmg.subtotal.已使用年限 : null,
          };
        }).sort((a, b) => b.回廠量 - a.回廠量);
      return {
        key: g.key, 上線量: s.上線量, 回廠量: s.回廠量, 良品: s.良品數, 不良: badOf(s), 過保: s.過保數,
        回廠不良率: safeDiv(badOf(s), s.回廠量), 整體良率: s.上線量 ? 1 - badOf(s) / s.上線量 : null,
        再使用率: safeDiv(s.良品數, s.回廠量),
        回廠年限: ageOf(ra), 線上年限: s.在線平均已使用年限, 不良年限: badAgeOf(ra),
        cmp回廠不良率: cg ? safeDiv(badOf(cg.subtotal), cg.subtotal.回廠量) : null,
        非良品年限: s.已使用年限, cmp非良品年限: cg ? cg.subtotal.已使用年限 : null,
        品項數: new Set(ret.filter((r) => groupKey(r.廠商, '未分類') === g.key).map((r) => r.ERP品號 || r.替換前品項)).size,
        items: (() => {
          const ng = (r) => (r.不良品 || r.過保 || r.未歸類) && r.已使用年限 != null;
          const avg = (xs) => (xs.length ? round(xs.reduce((t, r) => t + Number(r.已使用年限), 0) / xs.length, 1) : null);
          const byErp = new Map();
          for (const r of ret) {
            if (groupKey(r.廠商, '未分類') !== g.key) continue;
            const k = r.ERP品號 || r.替換前品項;
            if (!byErp.has(k)) byErp.set(k, { erp: r.ERP品號, name: r.替換前品項, rows: [] });
            byErp.get(k).rows.push(r);
          }
          return [...byErp.values()].map((it) => {
            const cr = cmpRet.filter((r) => (r.ERP品號 || r.替換前品項) === (it.erp || it.name));
            return {
              name: it.name, 在線年限: onAgeByErp.has(String(it.erp)) ? onAgeByErp.get(String(it.erp)) : null, 回廠量: it.rows.length,
              不良: it.rows.filter((r) => r.不良品 || r.未歸類).length, 過保: it.rows.filter((r) => r.過保).length,
              非良品年限: avg(it.rows.filter(ng)), cmp非良品年限: hasCmp ? avg(cr.filter(ng)) : null,
            };
          }).sort((a, b) => b.回廠量 - a.回廠量);
        })(),
        cmp回廠年限: cg ? (() => { const xs = cmpRet.filter((r) => groupKey(r.廠商, '未分類') === g.key && r.已使用年限 != null); return xs.length ? round(xs.reduce((t, r) => t + Number(r.已使用年限), 0) / xs.length, 1) : null; })() : null,
        models: vModels,
      };
    }).filter((v) => v.回廠量 > 0 || v.上線量 > 0).sort((a, b) => b.回廠量 - a.回廠量 || b.上線量 - a.上線量);

    return { key: deviceKey, hasCmp, cmpYear, cur, cmp, monthly, faults, age, models, vendors };
  }

  // ── 分析與說明（自動產生，可在報告內編輯）──────────────────────────
  function yieldFindings(D) {
    const c = D.cur, p = D.cmp, out = [];
    const ppTxt = (a, b) => { const pp = (a - b) * 100; return Math.abs(pp) < 0.005 ? '與去年同期持平' : `較去年同期${pp > 0 ? '上升' : '下降'} ${Math.abs(pp).toFixed(2)}pp`; };
    out.push(`本期${D.key}線上量 ${fInt(c.上線量)} 台，回廠 ${fInt(c.回廠量)} 台，其中不良 ${fInt(c.不良)} 台，整體良率 ${fPct(c.整體良率, 2)}${p ? `，${ppTxt(c.整體良率, p.整體良率)}` : ''}。`);
    out.push(`回廠設備中，良品（可再使用）${fInt(c.良品)} 台（${fPct(c.再使用率)}）、不良 ${fInt(c.不良)} 台（回廠不良率 ${fPct(c.回廠不良率)}${p ? `，${ppTxt(c.回廠不良率, p.回廠不良率)}` : ''}）、過保 ${fInt(c.過保)} 台（${fPct(c.過保率)}）。`);
    const topModels = [...D.models].filter((m) => m.不良 > 0).sort((a, b) => b.不良 - a.不良).slice(0, 3);
    topModels.forEach((m, i) => {
      const why = (m.原因 || []).slice(0, 2).map((x) => `${x.label} ${fInt(x.qty)} 台`).join('、');
      out.push(`不良數第 ${i + 1} 名 ${m.key}：${fInt(m.不良)} 台（回廠不良率 ${fPct(m.回廠不良率)}）${why ? `，主要為${why}` : ''}。`);
    });
    return out;
  }
  function ageFindings(D) {
    const a = D.age, out = [];
    out.push(`${a.onAvg != null ? `在線${D.key}平均已使用 ${fYear(a.onAvg)}；` : ''}本期回廠${D.key}平均已使用 ${fYear(a.retAvg)}${a.cmpRetAvg != null ? `（去年同期 ${fYear(a.cmpRetAvg)}）` : ''}，預期使用年限 ${a.life} 年。`);
    if (a.retOverShare != null) out.push(`回廠${D.key}中有 ${fPct(a.retOverShare)} 已超過預期使用年限 ${a.life} 年${a.retBadAvg != null ? `；其中不良品平均已使用 ${fYear(a.retBadAvg)}` : ''}。`);
    const withRate = a.buckets.filter((b) => b.回廠量 >= 20 && b.回廠不良率 != null);
    if (withRate.length >= 2) {
      const hi = [...withRate].sort((x, y) => y.回廠不良率 - x.回廠不良率)[0];
      out.push(`依使用年限分組，「${hi.label}」的回廠不良率最高（${hi.回廠不良率.toFixed(1)}%）。`);
    }
    return out;
  }
  // 廠商比較：以「廠商・機型」為單位，年限口徑比照舊版（不良品＋過保＋未歸類的平均已使用年限）
  // 車機依舊版預設分成一般定位／影像兩組；未列在兩組的機型歸「其他」
  const VAGE_GENERAL = ['S168', 'EDR-168', 'GO-168', 'MT99'];
  const VAGE_IMAGING = ['FUHO 8CH', 'HS', 'FUHO 4CH', 'C43', 'F6N'];
  function vendorAgeGroups(D) {
    const items = [];
    D.vendors.forEach((v) => v.models.forEach((m) => {
      if (m.非良品年限 == null) return;
      items.push({ vendor: v.key, model: m.key, year: m.非良品年限, yearCmp: m.cmp非良品年限, 在線年限: m.線上年限, 回廠量: m.回廠量, 不良: m.不良, 過保: m.過保 });
    }));
    items.sort((a, b) => b.year - a.year);
    if (D.key !== '車機') return [{ key: 'lens', label: '鏡頭', items }];
    const groups = [
      { key: 'general', label: '一般定位', items: items.filter((x) => VAGE_GENERAL.includes(x.model)) },
      { key: 'imaging', label: '影像', items: items.filter((x) => VAGE_IMAGING.includes(x.model)) },
    ];
    const other = items.filter((x) => !VAGE_GENERAL.includes(x.model) && !VAGE_IMAGING.includes(x.model));
    if (other.length) groups.push({ key: 'other', label: '其他', items: other });
    return groups;
  }
  function vendorAgeFindings(D) {
    const life = D.age.life, out = [];
    vendorAgeGroups(D).forEach((g) => {
      if (!g.items.length) return;
      const top = g.items[0];
      let line = `${g.label}：已使用年限最長為 ${top.model}（${top.vendor}）${fYear(top.year)}`;
      const short = g.items.filter((x) => x.year < life && x.回廠量 >= 20);
      if (short.length) line += `；未達預期 ${life} 年的有 ${short.map((x) => `${x.model}（${fYear(x.year)}）`).join('、')}`;
      out.push(line + '。');
      const withCmp = g.items.filter((x) => x.yearCmp != null);
      if (withCmp.length) {
        const up = [...withCmp].sort((a, b) => (b.year - b.yearCmp) - (a.year - a.yearCmp))[0];
        if (up.year - up.yearCmp >= 0.1) out.push(`${g.label}：${up.model}（${up.vendor}）較去年同期多用 ${(up.year - up.yearCmp).toFixed(1)} 年。`);
      }
    });
    return out.length ? out : ['本期無可比較的廠商機型。'];
  }

  // 機型狀態判斷（暫定門檻，待確認）：回廠 ≥ 20 台才判斷，避免少量樣本誤判
  //   不良偏高：回廠不良率 ≥ 整體回廠不良率 × 1.5，或 ≥ 20%
  //   提早回廠：回廠平均使用年限 < 預期使用年限（車機 3 年／鏡頭 1 年）
  const MIN_JUDGE_QTY = 20;
  function modelStatus(m, D) {
    if (m.回廠量 < MIN_JUDGE_QTY) return { rank: 3, cls: 'na', txt: '樣本少' };
    const base = D.cur.回廠不良率 || 0;
    const highBad = m.回廠不良率 != null && (m.回廠不良率 >= base * 1.5 || m.回廠不良率 >= 0.2);
    const early = m.非良品年限 != null && m.非良品年限 < D.age.life;
    if (highBad && early) return { rank: 0, cls: 'bad', txt: '不良偏高・提早回廠', highBad, early };
    if (highBad) return { rank: 0, cls: 'bad', txt: '不良偏高', highBad };
    if (early) return { rank: 1, cls: 'warn', txt: `未滿 ${D.age.life} 年就回廠`, early };
    return { rank: 2, cls: 'ok', txt: '正常' };
  }
  // 車機列序比照舊版：一般定位、影像機型依指定順序在前，其餘依回廠量
  const GLANCE_CAR_ORDER = ['S168', 'MT99', 'GO-168', 'EDR-168', 'FUHO 4CH', 'FUHO 8CH', 'F6N', 'C43'];
  function modelGlanceHTML(D) {
    const order = (k) => { const i = D.key === '車機' ? GLANCE_CAR_ORDER.indexOf(k) : -1; return i < 0 ? 99 : i; };
    const list = D.models.filter((m) => m.回廠量 > 0).map((m) => ({ m, st: modelStatus(m, D) }))
      .sort((a, b) => order(a.m.key) - order(b.m.key) || b.m.回廠量 - a.m.回廠量);
    const bad = list.filter((x) => x.st.highBad).map((x) => x.m.key);
    const early = list.filter((x) => x.st.early).map((x) => x.m.key);
    const judged = list.filter((x) => x.st.cls !== 'na').length;
    const headline = (bad.length || early.length)
      ? `${judged} 個機型中，${bad.length ? `<b class="t-bad">回廠不良率較高：${bad.map(esc).join('、')}</b>` : ''}${bad.length && early.length ? '；' : ''}${early.length ? `<b class="t-warn">使用年限較短：${early.map(esc).join('、')}</b>` : ''}；其餘機型表現穩定。`
      : `${judged} 個機型表現穩定。`;
    const qp = (n, r, hl) => `<span class="${hl || ''}">${fInt(n)}</span><small>${fPct(r)}</small>`;
    const c = D.cur;
    const rows = list.map(({ m, st }) => `<tr class="st-${st.cls}">
      <td class="l">${esc(m.key)}</td><td class="n">${fInt(m.上線量)}</td><td class="n">${fYear(m.線上年限)}</td>
      <td class="n">${fInt(m.回廠量)}</td>
      <td class="n">${qp(m.良品, safeDiv(m.良品, m.回廠量))}</td>
      <td class="n">${qp(m.不良, m.回廠不良率, st.highBad ? 't-bad' : '')}</td>
      <td class="n">${qp(m.過保, safeDiv(m.過保, m.回廠量))}</td>
      <td class="n">${fPct(m.整體良率 == null ? null : 1 - m.整體良率)}</td><td class="n">${fPct(m.整體過保率)}</td>
      <td class="n"><b class="${st.early ? 't-warn' : ''}">${fYear(m.非良品年限)}</b></td></tr>`).join('');
    return `<div class="card glance">
      <p class="glance-h">${headline}</p>
      <div class="twrap"><table class="rtable glance-t">
        <thead>
          <tr><th rowspan="2" class="l">機型</th><th rowspan="2">線上量</th><th rowspan="2">在線平均<br>已使用年限</th><th colspan="4">回廠量</th><th rowspan="2">整體<br>不良率</th><th rowspan="2">整體<br>過保率</th><th rowspan="2">平均<br>已使用年限</th></tr>
          <tr><th>回廠量</th><th>良品數(再使用)</th><th>不良品數</th><th>過保數</th></tr>
        </thead>
        <tbody>${rows}
          <tr class="grand"><td class="l">總計</td><td class="n">${fInt(c.上線量)}</td><td class="n">${fYear(D.age.onAvg)}</td><td class="n">${fInt(c.回廠量)}</td>
            <td class="n">${qp(c.良品, c.再使用率)}</td><td class="n">${qp(c.不良, c.回廠不良率)}</td><td class="n">${qp(c.過保, c.過保率)}</td>
            <td class="n">${fPct(c.整體良率 == null ? null : 1 - c.整體良率)}</td><td class="n">${fPct(c.上線量 ? c.過保 / c.上線量 : null)}</td><td class="n">${fYear(c.非良品年限)}</td></tr>
        </tbody></table></div>
      <p class="note">紅底＝回廠不良率高於整體 1.5 倍或超過 20%；橘底＝平均已使用年限未達 ${D.age.life} 年；回廠少於 ${MIN_JUDGE_QTY} 台不判斷。括號％為占回廠量比例；整體不良率／過保率以線上量為分母；在線平均已使用年限為目前線上設備逐台計算（規則 H），不隨期間變動${D.age.onlineAgeOk ? '' : '。<b>目前尚未載入「車機鏡頭上線明細」（需授權 Google Sheets），在線年限暫顯示「—」</b>'}。</p>
    </div>`;
  }

  // ── HTML 片段（版面沿用舊版落地報告：頂部分頁列＋圓角卡片，主色改為深藍）────────
  function deltaHTML(cur, prev, betterUp, dp = 1, unit = 'pp') {
    if (cur == null || prev == null) return '';
    const diff = unit === 'pp' ? (cur - prev) * 100 : cur - prev;
    const flat = unit === 'int' ? diff === 0 : Math.abs(diff) < Math.pow(10, -dp) / 2;
    const good = flat || betterUp == null ? null : (diff > 0) === betterUp;
    const num = unit === 'int' ? `${fInt(Math.abs(diff))} 台` : `${Math.abs(diff).toFixed(dp)}${unit === 'pp' ? 'pp' : ' 年'}`;
    const txt = flat ? '－ 持平' : `${diff > 0 ? '▲ +' : '▼ '}${num}`;
    return `<div class="d ${flat ? 'd-flat' : good ? 'd-good' : 'd-bad'}">${txt}<span>vs 去年同期</span></div>`;
  }
  function kcard(label, value, sub, extra, tone) {
    return `<div class="kcard${tone ? ` ${tone}` : ''}"><div class="l">${label}</div><div class="v">${value}</div>${sub ? `<div class="p">${sub}</div>` : ''}${extra || ''}</div>`;
  }
  function advice(id, title, bullets) {
    return `<div class="callout"><p class="big-quote">${esc(title)}</p><textarea class="advice-edit" id="${id}">${esc(bullets.join('\n'))}</textarea></div>`;
  }
  function chartCard(title, sub, id, cls, stat) {
    return `<div class="card"><div class="chead"><div class="ct">${title}</div>${sub ? `<div class="cs">${sub}</div>` : ''}</div>${stat || ''}<div class="chartbox ${cls || ''}"><canvas id="${id}"></canvas></div></div>`;
  }
  // 圖表上方的總數據：本期合計 vs 去年同期（＋差異）
  function statBar(items, delta) {
    return `<div class="cstat">${items.map((it) => `<div class="cst${it.prev ? ' prev' : ''}"><span>${it.label}</span><b>${it.value}</b></div>`).join('')}${delta ? `<div class="cst-d">${delta}</div>` : ''}</div>`;
  }
  const rateCell = (v, dp = 1) => `<td class="n">${fPct(v, dp)}</td>`;

  function vageCardHTML(D, g, cid, noTable) {
    const life = D.age.life;
    const top3 = g.items.slice(0, 3).map((x, i) => `<div class="top3-row"><span class="top3-no">${i + 1}</span><div class="top3-who"><b>${esc(x.model)}</b><span>${esc(x.vendor)}</span></div><div class="top3-years">${fYear(x.year)}</div></div>`).join('');
    const dlt = (x) => {
      if (x.yearCmp == null) return '<td class="n">—</td>';
      const d = x.year - x.yearCmp, flat = Math.abs(d) < 0.05;
      return `<td class="n"><span class="dlt ${flat ? 'flat' : d > 0 ? 'good' : 'bad'}">${flat ? '－' : d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)} 年</span></td>`;
    };
    const rows = g.items.map((x) => `<tr class="${x.year < life ? 'st-warn' : ''}"><td class="l">${esc(x.model)}</td><td class="l">${esc(x.vendor)}</td>
      <td class="n">${fYear(x.在線年限)}</td><td class="n">${fInt(x.回廠量)}</td><td class="n">${fInt(x.不良)}</td><td class="n">${fInt(x.過保)}</td>
      <td class="n"><b class="${x.year < life ? 't-warn' : ''}">${fYear(x.year)}</b></td>${dlt(x)}</tr>`).join('');
    const h = Math.max(200, g.items.length * 40 + 70);
    return `<div class="card vage-card">
      <div class="chead"><div class="ct">已使用年限比較（${esc(g.label)}）</div><div class="cs">本期 vs 去年同期　｜　紅色虛線＝預期 ${life} 年</div></div>
      <div class="vage-top3"><div class="top3-cap">已使用年限最長的前 3 名</div>${top3}</div>
      <div class="chartbox" style="height:${h}px"><canvas id="${cid}"></canvas></div>
      ${noTable ? '' : `<div class="twrap" style="margin-top:14px"><table class="agg tight vage-t">
        <thead><tr><th class="l">機型</th><th class="l">廠商</th><th>在線年限</th><th>回廠</th><th>不良</th><th>過保</th><th>已使用年限</th><th>同期差</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`}
    </div>`;
  }
  // 使用年限分析卡（鏡頭）：整體摘要＋廠商彙總＋回廠年限分布（本期 vs 去年同期）
  function ageAnalysisCardHTML(D) {
    const c = D.cur, p = D.cmp, life = D.age.life;
    const yDelta = (a, b) => {
      if (a == null || b == null) return '';
      const x = a - b, flat = Math.abs(x) < 0.05;
      return `<span class="dlt ${flat ? 'flat' : x > 0 ? 'good' : 'bad'}">${flat ? '－ 持平' : `${x > 0 ? '▲ +' : '▼ '}${Math.abs(x).toFixed(1)} 年`}</span>`;
    };
    const vs = D.vendors.filter((v) => v.回廠量 > 0 && v.非良品年限 != null).sort((a, b) => b.回廠量 - a.回廠量);
    const totalRet = vs.reduce((t, v) => t + v.回廠量, 0);
    const pre = D.key === '車機' ? 'car' : 'lens';
    const rows = vs.map((v, vi) => `<tr class="vrow ${v.非良品年限 < life ? 'st-warn' : ''}" data-id="${pre}-ag${vi}">
      <td class="l"><span class="caret">▸</span>${esc(v.key)}</td><td class="n">${v.品項數}</td><td class="n">${fYear(v.線上年限)}</td>
      <td class="n">${fInt(v.回廠量)}<small>${fPct(safeDiv(v.回廠量, totalRet))}</small></td>
      <td class="n">${fInt(v.不良)}</td><td class="n">${fInt(v.過保)}</td>
      <td class="n"><b>${fYear(v.非良品年限)}</b></td><td class="n">${yDelta(v.非良品年限, v.cmp非良品年限) || '—'}</td></tr>` +
      (v.items || []).map((it) => `<tr class="sub" data-parent="${pre}-ag${vi}">
        <td class="l" colspan="2">└ ${esc(it.name)}</td><td class="n">${fYear(it.在線年限)}</td>
        <td class="n">${fInt(it.回廠量)}</td><td class="n">${fInt(it.不良)}</td><td class="n">${fInt(it.過保)}</td>
        <td class="n">${fYear(it.非良品年限)}</td><td class="n">${yDelta(it.非良品年限, it.cmp非良品年限) || '—'}</td></tr>`).join('')).join('');
    const longest = vs.length ? [...vs].sort((a, b) => b.非良品年限 - a.非良品年限)[0] : null;
    const card = `<div class="card">
      <div class="chead"><div class="ct">${esc(D.key)}使用年限分析</div><div class="cs">不良品／過保品的平均已使用年限　｜　預期 ${life} 年</div></div>
      <div class="cstat">
        <div class="cst"><span>本期平均已使用年限</span><b>${fYear(c.非良品年限)}</b></div>
        ${p ? `<div class="cst prev"><span>去年同期</span><b>${fYear(p.非良品年限)}</b></div>` : ''}
        <div class="cst"><span>超過預期 ${life} 年占比</span><b>${fPct(c.超齡占比)}</b></div>
        ${p ? `<div class="cst-d">${yDelta(c.非良品年限, p.非良品年限)}</div>` : ''}
      </div>
      <div class="mini-title" style="text-align:left;margin:14px 0 4px">回廠${esc(D.key)}使用年限分布（占比）</div>
      <div class="chartbox" style="height:360px"><canvas id="${D.key === '車機' ? 'car' : 'lens'}-age-dist2"></canvas></div>
    </div>`;
    const table = `<div class="card">
      <div class="chead"><div class="ct">${esc(D.key)}廠商使用年限明細</div><div class="cs">點廠商可展開品項${longest ? `　｜　最久：${esc(longest.key)} ${fYear(longest.非良品年限)}` : ''}　｜　淡橘色＝未達預期 ${life} 年</div></div>
      <div class="twrap"><table class="agg vage-t vt wide-t">
        <thead><tr><th class="l">廠商／品項</th><th>品項數</th><th>在線年限</th><th>回廠（占比）</th><th>不良</th><th>過保</th><th>已使用年限</th><th>同期差</th></tr></thead>
        <tbody>${rows || '<tr><td class="l" colspan="8">無資料</td></tr>'}</tbody></table></div>
    </div>`;
    return { card, table };
  }

  // ── 整新頁（比照舊版「KPI 分類彙總」）──
  // 來源：桌面 KPI_分類彙總.xlsx「114vs115比較」分頁（114 vs 115 年 1–9 月）。
  // 2026-10-13 已將該檔「115分類彙總」「114vs115比較」改為公式，直接由「115」明細「數量 × 金額」加總，
  // 1–6 月結果與原手填彙總表一致；換期時改 REFURB_PERIOD 與下列數字即可。
  const REFURB_PERIOD = '1–9月';
  // 整新數字對應的報告期間（115年＝西元 2026，Q3＝1–9月）；報告選其他期間時整新頁會標示「期間不符」，
  // 換期時 REFURB_PERIOD、REFURB_FOR 與下列數字要一起更新。
  const REFURB_FOR = { year: 2026, quarter: 3 };
  const REFURB_CATEGORIES = [
    { label: '整新品循環/主機', y114: 2471160, y115: 3632950 },
    { label: '整新品循環/配件', y114: 1685155, y115: 1236030 },
    { label: '內部QC', y114: 1874210, y115: 2075190 },
    { label: '整新循環/出口QC', y114: 161880, y115: 199360 },
  ];
  // 1–9 月台數（同一檔案明細）：鏡頭＝「整新品循環/配件」區塊品名含「鏡頭」的項目；
  // 影像主機＝「整新品循環/主機」區塊 FUHO 8路、FUHO 4路、C43、F6N、16-1數位行車器、HS 主機
  const REFURB_LENS_QTY = { y114: 1074, y115: 996 };
  const REFURB_MAIN_UNIT_QTY = { y114: 65, y115: 232 };
  // 內部QC 檢測台數（1–9 月，「內部QC」區塊各品項數量加總），標在分類金額對比圖的內部QC 長條旁
  const REFURB_QC_QTY = { y114: 9573, y115: 11746 };
  const growthTxt = (g) => `${g >= 0 ? '+' : ''}${(g * 100).toFixed(1)}%`;
  const diffTxt = (v) => `${v > 0 ? '+' : ''}${fInt(v)}`;
  function refurbPageHTML(state) {
    const periodMismatch = state.year !== REFURB_FOR.year || state.quarter !== REFURB_FOR.quarter;
    const rows = REFURB_CATEGORIES.map((r) => ({ ...r, diff: r.y115 - r.y114, growth: r.y114 ? (r.y115 - r.y114) / r.y114 : 0 }));
    const t114 = rows.reduce((t, r) => t + r.y114, 0), t115 = rows.reduce((t, r) => t + r.y115, 0);
    const tDiff = t115 - t114, tGrowth = t114 ? tDiff / t114 : 0;
    const best = [...rows].sort((a, b) => b.growth - a.growth)[0];
    const [mainUnit, accessory, , exportQc] = rows;
    const bullets = [
      `115年${REFURB_PERIOD}整新循環總價值 ${fInt(t115)} 元，較114年同期${tDiff >= 0 ? '增加' : '減少'} ${fInt(Math.abs(tDiff))} 元（${growthTxt(tGrowth)}），相當於為公司省下同等金額的外部採購／維修支出。`,
      `主機整新 115年 ${fInt(mainUnit.y115)} 元，較114年${mainUnit.diff >= 0 ? '成長' : '減少'} ${fInt(Math.abs(mainUnit.diff))} 元（${growthTxt(mainUnit.growth)}）；影像主機整新台數由 ${REFURB_MAIN_UNIT_QTY.y114} 台增加到 ${REFURB_MAIN_UNIT_QTY.y115} 台。`,
      `配件整新 115年 ${fInt(accessory.y115)} 元（${growthTxt(accessory.growth)}）：114年有 Mobileye ADAS(AM)、DMS控制盒(CM) 等大型整新專案，115年無同規模案件；鏡頭整新數量 ${REFURB_LENS_QTY.y114} → ${REFURB_LENS_QTY.y115} 顆。`,
      `出口QC ${growthTxt(exportQc.growth)}（${diffTxt(exportQc.diff)} 元）。`,
    ];
    const tr = rows.map((r) => `<tr><td class="l">${esc(r.label)}</td><td class="n">${fInt(r.y114)}</td><td class="n">${fInt(r.y115)}</td><td class="n">${diffTxt(r.diff)}</td><td class="n"><span class="dlt ${Math.abs(r.growth) < 0.02 ? 'flat' : r.growth > 0 ? 'good' : 'bad'}">${growthTxt(r.growth)}</span></td></tr>`).join('');
    return `<section class="page shared" data-sec="refurb">
      <div class="ph"><span class="ph-l">${App.icons.refresh()} 整新</span><span class="ph-s">整新循環 KPI　｜　114年 vs 115年 ${REFURB_PERIOD}　｜　來源：KPI_分類彙總.xlsx／114vs115比較</span></div>
      ${periodMismatch ? `<div class="period-warn">⚠ 本頁為人工整理的 114／115 年 ${REFURB_PERIOD} 整新資料，與本報告期間（${esc(periodLabel(state))}）不同，數字僅供參考；換期時請先更新 KPI 整新資料。</div>` : ''}
      <div class="krow">
        ${kcard(`114年${REFURB_PERIOD}總計`, `${fInt(t114)} 元`, bigNum(t114))}
        ${kcard(`115年${REFURB_PERIOD}總計`, `${fInt(t115)} 元`, bigNum(t115), '', 'main')}
        ${kcard('總計成長率', growthTxt(tGrowth), `${diffTxt(tDiff)} 元`)}
        ${kcard('成長最多分類', esc(best.label), growthTxt(best.growth), '', 'txt')}
      </div>
      <div class="g-refurb">
        <div class="card"><div class="chead"><div class="ct">整新循環分類明細</div><div class="cs">金額單位：元｜金額皆以車機成本計算</div></div>
          <div class="twrap"><table class="agg">
            <thead><tr><th class="l">分類</th><th>114年${REFURB_PERIOD}</th><th>115年${REFURB_PERIOD}</th><th>差異</th><th>成長率</th></tr></thead>
            <tbody>${tr}<tr class="grand"><td class="l">總計</td><td class="n">${fInt(t114)}</td><td class="n">${fInt(t115)}</td><td class="n">${diffTxt(tDiff)}</td><td class="n">${growthTxt(tGrowth)}</td></tr></tbody>
          </table></div>
          <div class="g2-eq" style="margin-top:14px">
            <div><div class="mini-title">影像主機整新台數（台）</div><div class="chartbox xs"><canvas id="refurb-main"></canvas></div></div>
            <div><div class="mini-title">配件類鏡頭整新數量（顆）</div><div class="chartbox xs"><canvas id="refurb-lens"></canvas></div></div>
          </div>
        </div>
        <div class="card"><div class="chead"><div class="ct">分類金額對比</div><div class="cs">114 vs 115 年 ${REFURB_PERIOD}（元）</div></div>
          <div class="chartbox fill"><canvas id="refurb-cat"></canvas></div></div>
      </div>
      ${advice('note-refurb', '分析與說明（整新）', bullets)}
    </section>`;
  }
  function bigNum(v) {
    const n = Math.abs(v || 0);
    if (n < 10000) return '';
    return n >= 1e8 ? `約 ${(v / 1e8).toFixed(1)} 億` : `約 ${(v / 1e4).toFixed(1)} 萬`;
  }

  function badModelCardHTML(D) {
    const list = D.models.filter((m) => m.不良 > 0).sort((a, b) => b.不良 - a.不良).slice(0, 8);
    const max = Math.max(...list.map((m) => m.不良), 1);
    const rows = list.map((m) => `<tr>
      <td class="l"><b>${esc(m.key)}</b></td>
      <td class="n"><div class="ratecell"><span class="mbar"><i style="width:${Math.round(m.不良 / max * 100)}%;background:var(--bad)"></i></span><b>${fInt(m.不良)}</b></div></td>
      <td class="n">${fPct(m.回廠不良率)}</td>
      <td class="l reasons">${(m.原因 || []).map((x) => `<span class="rsn">${esc(x.label)}<em>${fInt(x.qty)}</em></span>`).join('') || '—'}</td></tr>`).join('');
    return `<div class="card"><div class="chead"><div class="ct">不良數最多的機型與主要原因</div><div class="cs">前 8 名；原因依維修完成原因／報廢原因歸納，一台可能有多項處理</div></div>
      <div class="twrap"><table class="agg tight badm-t">
        <thead><tr><th class="l">機型</th><th>不良數</th><th>回廠不良率</th><th class="l">主要原因（台數）</th></tr></thead>
        <tbody>${rows || '<tr><td class="l" colspan="4">本期無不良品</td></tr>'}</tbody></table></div></div>`;
  }

  // 廠商比較：一頁同時呈現車機（上）與鏡頭（下），不分設備切換
  function vendorBlockHTML(D) {
    const id = (s) => `${D.key === '車機' ? 'car' : 'lens'}-${s}`;
    const cards = vendorAgeGroups(D).filter((g) => g.items.length).map((g) => vageCardHTML(D, g, id(`vage-${g.key}`), D.key === '鏡頭'));
    const icon = D.key === '車機' ? App.icons.car() : App.icons.camera();
    return `<div class="sech sech-lg">${icon} ${esc(D.key)}<span class="sech-note">預期使用年限 ${D.age.life} 年</span></div>
      ${(() => { const an = D.key === '鏡頭' ? ageAnalysisCardHTML(D) : null;
        return `<div class="g2-eq">${cards.join('')}${an ? an.card : ''}</div>${an ? an.table : ''}`; })()}
      ${advice(id('note-vendor'), `分析與說明（${D.key}・廠商比較）`, vendorAgeFindings(D))}`;
  }
  function vendorPageHTML(data, state) {
    return `<section class="page shared" data-sec="vendor">
      <div class="ph"><span class="ph-l">${App.icons.factory()} 廠商比較</span><span class="ph-s">已使用年限比較　｜　期間：${esc(periodLabel(state))}</span></div>
      ${vendorBlockHTML(data.車機)}
      ${vendorBlockHTML(data.鏡頭)}
    </section>`;
  }

  function devicePanelHTML(D, state) {
    const k = D.key, id = (s) => `${k === '車機' ? 'car' : 'lens'}-${s}`;
    const c = D.cur, p = D.cmp, a = D.age;
    const cy = `${D.cmpYear - 1911}年`;
    const vsTxt = `${esc(D.monthly.curLabel)} vs ${esc(D.monthly.prevLabel)}`;
    const curP = `${state.year - 1911}年 ${QUARTER_MONTH_RANGE[state.quarter]}`, prevP = `${cy}同期`;
    const sb = (cur, prev, delta) => statBar([{ label: curP, value: cur }, ...(p ? [{ label: prevP, value: prev, prev: true }] : [])], p ? delta : '');

    const modelRows = D.models.filter((m) => m.回廠量 > 0).map((m) => `<tr>
      <td class="l">${esc(m.key)}</td><td class="n">${fInt(m.上線量)}</td><td class="n">${fInt(m.回廠量)}</td>
      <td class="n">${fInt(m.良品)}</td><td class="n bad">${fInt(m.不良)}</td><td class="n">${fInt(m.過保)}</td>
      ${rateCell(m.回廠不良率)}${rateCell(m.整體良率, 2)}</tr>`).join('');

    const dltCell = (cur, prev, betterUp, unit) => {
      if (cur == null || prev == null) return '<td class="n">—</td>';
      const diff = unit === 'pp' ? (cur - prev) * 100 : cur - prev;
      const flat = Math.abs(diff) < 0.05;
      const cls = flat ? 'flat' : ((diff > 0) === betterUp ? 'good' : 'bad');
      return `<td class="n"><span class="dlt ${cls}">${flat ? '－' : diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}${unit === 'pp' ? 'pp' : ' 年'}</span></td>`;
    };
    return `<div class="dev-panel" data-dev="${k}">
    <section class="page" data-sec="yield">
      <div class="ph"><span class="ph-l">${App.icons.chart()} 整體總覽（${esc(k)}）</span><span class="ph-s">期間：${esc(periodLabel(state))}</span></div>
      <div class="sech">整體數值 · ${esc(k)}</div>
      <div class="krow">
        ${kcard(`${esc(k)}線上量`, fInt(c.上線量), '台')}
        ${kcard('期間回廠量', fInt(c.回廠量), `占線上量 ${fPct(safeDiv(c.回廠量, c.上線量), 2)}`, p ? `<div class="d d-flat">${cy}同期 ${fInt(p.回廠量)}</div>` : '')}
        ${kcard('整體良率', fPct(c.整體良率, 2), '1 − 不良數 ÷ 線上量', p ? deltaHTML(c.整體良率, p.整體良率, true, 2) : '', 'main')}
        ${kcard('回廠不良率', fPct(c.回廠不良率), '不良數 ÷ 回廠量', p ? deltaHTML(c.回廠不良率, p.回廠不良率, false) : '')}
        ${kcard('再使用率', fPct(c.再使用率), '良品數 ÷ 回廠量', p ? deltaHTML(c.再使用率, p.再使用率, true) : '')}
      </div>
      <div class="sech sech-lg">${App.icons.clipboard()} 各機型一覽（${esc(k)}）</div>
      ${modelGlanceHTML(D)}
      <div class="sech sech-lg">${App.icons.chart()} 良率曲線（與去年同期比較）</div>
      <div class="g2-eq">
        ${chartCard('整體良率（當月）', `${vsTxt}　｜　當月不良數 ÷ 線上量`, id('yield-m'), '', sb(fPct(c.整體良率, 2), p && fPct(p.整體良率, 2), p && deltaHTML(c.整體良率, p.整體良率, true, 2)))}
        ${chartCard('回廠不良率（當月）', `${vsTxt}　｜　當月不良數 ÷ 當月回廠量`, id('retbad-m'), '', sb(fPct(c.回廠不良率), p && fPct(p.回廠不良率), p && deltaHTML(c.回廠不良率, p.回廠不良率, false)))}
      </div>
      ${chartCard('每月回廠量', `${vsTxt}　｜　長條＝回廠量`, id('ret-m'), 'sm', sb(`${fInt(c.回廠量)} 台`, p && `${fInt(p.回廠量)} 台`, p && deltaHTML(c.回廠量, p.回廠量, null, 0, 'int')))}
      <div class="sech sech-lg">${App.icons.inbox()} 回廠不良分析</div>
      <div class="g-mix">
        <div class="card"><div class="chead"><div class="ct">回廠結果組成</div><div class="cs">回廠 ${fInt(c.回廠量)} 台</div></div>
          <div class="chartbox pie"><canvas id="${id('mix')}"></canvas></div>
          <div class="mix-legend">
            <div><span class="sw good"></span>良品（再使用）<b>${fInt(c.良品)}</b><em>${fPct(c.再使用率)}</em></div>
            <div><span class="sw bad"></span>不良<b>${fInt(c.不良)}</b><em>${fPct(c.回廠不良率)}</em></div>
            <div><span class="sw warn"></span>過保<b>${fInt(c.過保)}</b><em>${fPct(c.過保率)}</em></div>
          </div></div>
        ${badModelCardHTML(D)}
      </div>
      <details class="lowkey-toggle"><summary>${App.icons.clipboard()} 機型明細表</summary>
        <div class="lowkey-toggle-body"><div class="twrap"><table class="agg">
          <thead><tr><th class="l">機型</th><th>線上量</th><th>回廠量</th><th>良品</th><th>不良</th><th>過保</th><th>回廠不良率</th><th>整體良率</th></tr></thead>
          <tbody>${modelRows || '<tr><td class="l" colspan="8">本期無回廠資料</td></tr>'}
          <tr class="grand"><td class="l">總計</td><td class="n">${fInt(c.上線量)}</td><td class="n">${fInt(c.回廠量)}</td><td class="n">${fInt(c.良品)}</td><td class="n">${fInt(c.不良)}</td><td class="n">${fInt(c.過保)}</td>${rateCell(c.回廠不良率)}${rateCell(c.整體良率, 2)}</tr></tbody>
        </table></div></div>
      </details>
      ${advice(id('note-yield'), `分析與說明（${k}・整體總覽）`, yieldFindings(D))}
    </section>


    </div>`;
  }

  const QUARTER_MONTH_RANGE = { 1: '1–3月', 2: '1–6月', 3: '1–9月', 4: '1–12月' };
  function periodLabel(state) {
    const cur = `${state.year - 1911}年 ${QUARTER_MONTH_RANGE[state.quarter]}`;
    return state.cmp.on ? `${state.cmp.year - 1911}年 vs ${cur}` : cur;
  }

  // ── 報告內的前端程式（圖表繪製／切換／儲存）。以字串嵌入，不依賴本工具其他模組 ──
  const CLIENT_JS = `
(function(){
  var C={main:'#1E5AA8',mainBg:'rgba(30,90,168,.12)',prev:'#9AA0A6',bad:'#D32F2F',warn:'#E08E00',good:'#1a9c53',online:'#90CAF9',grid:'#EEF0F4',bar:'rgba(30,90,168,.55)',barPrev:'rgba(154,160,166,.45)'};
  var rendered={};
  function pctTick(dp){return function(v){return (+v).toFixed(dp)+'%';};}
  function line(id,labels,cur,prev,curLabel,prevLabel,dp){
    return new Chart(document.getElementById(id),{type:'line',data:{labels:labels,datasets:[
      {label:curLabel,data:cur,borderColor:C.main,backgroundColor:C.mainBg,fill:true,tension:.3,pointRadius:3,spanGaps:true},
      {label:prevLabel,data:prev,borderColor:C.prev,borderDash:[5,4],fill:false,tension:.3,pointRadius:3,spanGaps:true}]},
      options:{maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
        plugins:{legend:{position:'top',labels:{boxWidth:12}},tooltip:{callbacks:{label:function(c){return c.dataset.label+'：'+(c.raw==null?'—':(+c.raw).toFixed(dp)+'%');}}}},
        scales:{y:{ticks:{callback:pctTick(dp)},grid:{color:C.grid}},x:{grid:{display:false}}}}});
  }
  function hbar(id,labels,data,color,fmt){
    return new Chart(document.getElementById(id),{type:'bar',data:{labels:labels,datasets:[{data:data,backgroundColor:color,borderRadius:4,barThickness:16}]},
      options:{indexAxis:'y',maintainAspectRatio:false,layout:{padding:{right:90}},plugins:{legend:{display:false},tooltip:{callbacks:{label:fmt}}},
        scales:{x:{beginAtZero:true,grid:{color:C.grid}},y:{grid:{display:false}}}},
      plugins:[{id:'vlabel',afterDatasetsDraw:function(ch){var ctx=ch.ctx;ctx.save();ctx.font='bold 12px sans-serif';ctx.fillStyle='#1F2535';ctx.textBaseline='middle';
        ch.getDatasetMeta(0).data.forEach(function(b,i){ctx.fillText(fmt({raw:data[i],dataIndex:i}),b.x+6,b.y);});ctx.restore();}}]});
  }
  function render(dev){
    if(rendered[dev]||typeof Chart==='undefined')return; rendered[dev]=true;
    var D=window.__R3[dev], p=dev==='車機'?'car-':'lens-', M=D.monthly;
    line(p+'yield-m',M.labels,M['整體良率'].cur,M['整體良率'].prev,M.curLabel,M.prevLabel,2);
    line(p+'retbad-m',M.labels,M['回廠不良率'].cur,M['回廠不良率'].prev,M.curLabel,M.prevLabel,1);
    new Chart(document.getElementById(p+'ret-m'),{type:'bar',data:{labels:M.labels,datasets:[
      {label:M.curLabel,data:M['回廠量'].cur,backgroundColor:C.bar,borderRadius:3},
      {label:M.prevLabel,data:M['回廠量'].prev,backgroundColor:C.barPrev,borderRadius:3}]},
      options:{maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{boxWidth:12}}},scales:{y:{beginAtZero:true,grid:{color:C.grid}},x:{grid:{display:false}}}}});
    var c=D.cur;
    new Chart(document.getElementById(p+'mix'),{type:'doughnut',data:{labels:['良品','不良','過保'],datasets:[{data:[c['良品'],c['不良'],c['過保']],backgroundColor:[C.good,C.bad,C.warn],borderColor:'#fff',borderWidth:2}]},
      options:{maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false}}}});
    var B=D.age.buckets, hasCmp=D.hasCmp;
    var life=D.age.life;
    (D.vageGroups||[]).forEach(function(g){
      var el=document.getElementById(p+'vage-'+g.key); if(!el||!g.items.length)return;
      var ds=[{label:M.curLabel,data:g.items.map(function(x){return x.year;}),backgroundColor:C.main,borderRadius:3,barPercentage:.9,categoryPercentage:.72}];
      if(hasCmp)ds.push({label:M.prevLabel,data:g.items.map(function(x){return x.yearCmp;}),backgroundColor:C.barPrev,borderRadius:3,barPercentage:.9,categoryPercentage:.72});
      new Chart(el,{type:'bar',data:{labels:g.items.map(function(x){return [x.model,x.vendor];}),datasets:ds},
        options:{indexAxis:'y',maintainAspectRatio:false,layout:{padding:{right:52}},
          plugins:{legend:{position:'top',labels:{boxWidth:12}},tooltip:{callbacks:{label:function(x){return x.dataset.label+'：'+(x.raw==null?'—':(+x.raw).toFixed(1)+' 年');}}}},
          scales:{x:{beginAtZero:true,suggestedMax:life+1,grid:{color:C.grid}},y:{grid:{display:false},ticks:{font:{size:12}}}}},
        plugins:[{id:'lifeLine',afterDatasetsDraw:function(ch){var a=ch.chartArea,x=ch.scales.x.getPixelForValue(life),ctx=ch.ctx;ctx.save();
          ctx.strokeStyle=C.bad;ctx.setLineDash([6,4]);ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,a.top);ctx.lineTo(x,a.bottom);ctx.stroke();ctx.setLineDash([]);
          ctx.font='bold 12px sans-serif';ctx.fillStyle='#1F2535';ctx.textBaseline='middle';
          ch.getDatasetMeta(0).data.forEach(function(b,i){var v=g.items[i].year;if(v!=null)ctx.fillText(v.toFixed(1)+' 年',b.x+6,b.y);});ctx.restore();}}]});
    });
    var ad=document.getElementById(p+'age-dist2');
    if(ad){
      var AB=D.age.buckets, adDs=[{label:M.curLabel,data:AB.map(function(b){return b['回廠占比'];}),backgroundColor:C.main,borderRadius:3}];
      if(hasCmp)adDs.push({label:M.prevLabel,data:AB.map(function(b){return b['去年回廠占比'];}),backgroundColor:C.barPrev,borderRadius:3});
      new Chart(ad,{type:'bar',data:{labels:AB.map(function(b){return b.label;}),datasets:adDs},
        options:{maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{boxWidth:12}},tooltip:{callbacks:{label:function(x){return x.dataset.label+'：'+x.raw+'%';}}}},
          scales:{y:{beginAtZero:true,ticks:{callback:pctTick(0)},grid:{color:C.grid}},x:{grid:{display:false}}}}});
    }
  }
  var refurbDone=false;
  function renderRefurb(){
    if(refurbDone||typeof Chart==='undefined'||!window.__R3_REFURB)return; refurbDone=true;
    var R=window.__R3_REFURB, gray='rgba(154,160,166,.6)', blue='#1E5AA8';
    function vlabel(fmt,horiz){return {id:'v',afterDatasetsDraw:function(ch){var ctx=ch.ctx;ctx.save();ctx.font='bold 11px sans-serif';ctx.fillStyle='#1F2535';
      ctx.textAlign=horiz?'left':'center';ctx.textBaseline=horiz?'middle':'bottom';
      ch.data.datasets.forEach(function(ds,di){ch.getDatasetMeta(di).data.forEach(function(b,i){var v=ds.data[i];if(v==null)return;ctx.fillText(fmt(v),horiz?b.x+4:b.x,horiz?b.y:b.y-3);});});ctx.restore();}};}
    new Chart(document.getElementById('refurb-cat'),{type:'bar',data:{labels:R.cats.map(function(r){return r.label.split('/');}),datasets:[
      {label:'114年'+R.period,data:R.cats.map(function(r){return r.y114;}),backgroundColor:gray,borderRadius:3,categoryPercentage:.82,barPercentage:.9},
      {label:'115年'+R.period,data:R.cats.map(function(r){return r.y115;}),backgroundColor:blue,borderRadius:3,categoryPercentage:.82,barPercentage:.9}]},
      options:{indexAxis:'y',maintainAspectRatio:false,layout:{padding:{right:90}},plugins:{legend:{position:'top'}},scales:{x:{beginAtZero:true,ticks:{maxRotation:0,callback:function(v){return v?(v/10000).toLocaleString('en-US')+' 萬':'0';}}}}},
      plugins:[{id:'v',afterDatasetsDraw:function(ch){var ctx=ch.ctx;ctx.save();ctx.textAlign='left';ctx.textBaseline='middle';
        ch.data.datasets.forEach(function(ds,di){ch.getDatasetMeta(di).data.forEach(function(b,i){var v=ds.data[i];if(v==null)return;
          ctx.font='bold 11px sans-serif';ctx.fillStyle='#1F2535';var t=v.toLocaleString('en-US');ctx.fillText(t,b.x+4,b.y);
          if(R.cats[i].label==='內部QC'&&R.qcQty){var q=di===0?R.qcQty.y114:R.qcQty.y115;ctx.fillStyle='#1E5AA8';ctx.fillText('（'+q.toLocaleString('en-US')+' 台）',b.x+8+ctx.measureText(t).width,b.y);}
        });});ctx.restore();}}]});
    [['refurb-main',R.mainQty,' 台'],['refurb-lens',R.lensQty,' 顆']].forEach(function(x){
      new Chart(document.getElementById(x[0]),{type:'bar',data:{labels:['114年'+R.period,'115年'+R.period],datasets:[{data:[x[1].y114,x[1].y115],backgroundColor:[gray,blue],borderRadius:3}]},
        options:{maintainAspectRatio:false,layout:{padding:{top:16}},plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{maxTicksLimit:4}}}},
        plugins:[vlabel(function(v){return v+x[2];},false)]});
    });
  }
  function grow(ta){ta.style.height='auto';ta.style.height=(ta.scrollHeight+2)+'px';}
  var cur={dev:'車機',sec:'yield'};
  function apply(){
    document.querySelectorAll('.dev-panel').forEach(function(el){el.classList.toggle('on',el.dataset.dev===cur.dev);});
    document.querySelectorAll('.page').forEach(function(el){el.classList.toggle('on',el.dataset.sec===cur.sec);});
    var seg=document.querySelector('.seg'); if(seg)seg.classList.toggle('dim',cur.sec!=='yield');
    document.querySelectorAll('.seg button').forEach(function(b){b.classList.toggle('on',b.dataset.dev===cur.dev);});
    document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.toggle('on',b.dataset.sec===cur.sec);});
    render(cur.dev);
    if(cur.sec==='refurb')renderRefurb();
    if(cur.sec==='vendor'){render('車機');render('鏡頭');}
    document.querySelectorAll('.dev-panel.on .page.on .advice-edit, .page.shared.on .advice-edit').forEach(grow);
  }
  window.addEventListener('load',function(){
    if(typeof Chart!=='undefined'){Chart.defaults.font.size=13;Chart.defaults.font.weight=700;Chart.defaults.color='#4A5264';}
    document.querySelectorAll('.seg button').forEach(function(b){b.addEventListener('click',function(){if(cur.sec!=='yield')return;cur.dev=b.dataset.dev;apply();window.scrollTo(0,0);});});
    document.querySelectorAll('.tab-btn').forEach(function(b){b.addEventListener('click',function(){cur.sec=b.dataset.sec;apply();window.scrollTo(0,0);});});
    document.querySelectorAll('.advice-edit').forEach(function(ta){ta.addEventListener('input',function(){grow(ta);});});
    document.querySelectorAll('tr.vrow').forEach(function(tr){tr.addEventListener('click',function(){
      var open=tr.classList.toggle('open');
      document.querySelectorAll('tr.sub[data-parent="'+tr.dataset.id+'"]').forEach(function(s){s.classList.toggle('show',open);});
    });});
    apply();
    function regrow(){document.querySelectorAll('.dev-panel.on .page.on .advice-edit').forEach(grow);}
    setTimeout(regrow,300);window.addEventListener('resize',regrow);
    var gt=document.getElementById('btn-gentime');
    if(gt)gt.addEventListener('click',function(){document.getElementById('gen-time').classList.toggle('hidden');});
    var save=document.getElementById('btn-save');
    if(save)save.addEventListener('click',function(){
      document.querySelectorAll('textarea.advice-edit').forEach(function(ta){ta.textContent=ta.value;});
      var html='<!DOCTYPE html>\\n'+document.documentElement.outerHTML;
      var name=(location.protocol==='file:'&&decodeURIComponent(location.pathname.split('/').pop()||''))||window.__R3_FILENAME;
      var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));a.download=name;
      document.body.appendChild(a);a.click();a.remove();
      var t=document.getElementById('toast');t.textContent='已儲存編輯內容，新檔案已下載：'+name+'　請用這份新檔案覆蓋原本的檔案';t.classList.add('on');setTimeout(function(){t.classList.remove('on');},6000);
    });
  });
})();`;

  // 版面 CSS 比照舊版落地報告（report.js），主色由青綠 #009688 改為深藍 --main
  const CSS = `
:root{--main:#1E5AA8;--main-d:#163F78;--main-l:#E8F0FB;--main-2:#4F86C6;--ink:#1F2535;--muted:#6B7384;--line:#DDE1E9;--bg:#F5F7FA;--good:#1a9c53;--warn:#e08e00;--bad:#D32F2F}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;font-weight:700;font-size:16px}
.icon{vertical-align:-0.15em;flex-shrink:0}
.topbar{position:sticky;top:0;z-index:20;background:var(--main-d);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.15)}
.topbar-inner{max-width:1520px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.brand{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.brand .t{font-size:25px;font-weight:800;white-space:nowrap}
.brand .s{font-size:17px;font-weight:700;opacity:.9;white-space:nowrap}
.brand .s.hidden{display:none}
.navgrp{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.seg{display:inline-flex;background:rgba(255,255,255,.12);border-radius:10px;padding:3px}
.seg button{border:none;background:none;color:#fff;font:inherit;font-size:17px;padding:6px 16px;border-radius:8px;cursor:pointer}
.seg button.on{background:#FFD66B;color:var(--main-d)}
.tabs{align-items:center}
.seg.dim{opacity:.4;filter:grayscale(1)}
.seg.dim button{cursor:default}
.tabs{display:flex;flex-wrap:wrap;gap:8px}
.tab-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:17.5px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .15s}
.tab-btn:hover{background:rgba(255,255,255,.24)}
.tab-btn.on{background:#fff;color:var(--main-d);box-shadow:0 2px 6px rgba(0,0,0,.18)}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:39px;height:39px;border:none;border-radius:8px;cursor:pointer;background:rgba(255,255,255,.12);color:#fff}
.icon-btn:hover{background:rgba(255,255,255,.24)}
.main{max-width:1520px;margin:0 auto;padding:24px 24px 80px;min-width:0}
.dev-panel{display:none}.dev-panel.on{display:block}
.page{display:none}.page.on{display:block}
.ph{border-bottom:2px solid var(--line);padding-bottom:12px;margin-bottom:20px;display:flex;align-items:baseline;flex-wrap:wrap;gap:4px}
.ph-l{font-size:26.5px;font-weight:800;color:var(--main-d);display:inline-flex;align-items:center;gap:8px}
.ph-s{font-size:17.5px;color:var(--muted);margin-left:10px}
.sech{font-size:18.5px;font-weight:800;color:var(--main-d);margin:26px 0 12px;display:flex;align-items:center;gap:8px}
.sech::before{content:'';width:4px;height:15px;border-radius:3px;background:var(--main);display:inline-block}
.sech:first-of-type{margin-top:0}
.sech-lg{font-size:23.5px}.sech-lg::before{height:18px}
.krow{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:18px}
.kcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:15px 17px;border-top:3px solid var(--main-2);box-shadow:0 1px 3px rgba(0,0,0,.05)}
.kcard.main{border-top-color:var(--main);background:linear-gradient(180deg,var(--main-l),#fff 60%)}
.kcard .l{font-size:17px;color:var(--muted)}
.kcard .v{font-size:33.5px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}
.kcard.main .v{color:var(--main-d)}
.kcard.txt .v{font-size:23px;line-height:1.35}
.kcard .p{font-size:14.5px;color:var(--muted);font-weight:600}
.kcard .d{font-size:16px;font-weight:800;margin-top:5px}
.kcard .d span{font-size:13.5px;font-weight:600;color:var(--muted);margin-left:6px}
.d-good{color:var(--good)}.d-bad{color:var(--bad)}.d-flat{color:var(--muted)}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.05);min-width:0}
.chead{margin-bottom:12px}
.ct{font-size:19px;font-weight:700;display:flex;align-items:center;gap:8px}
.ct::before{content:'';width:4px;height:15px;border-radius:3px;background:var(--main);display:inline-block;flex-shrink:0}
.cs{font-size:15.5px;color:var(--muted);margin-top:2px;margin-left:12px}
.g2-eq{display:grid;grid-template-columns:1fr 1fr;gap:16px;min-width:0}
.g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;min-width:0}
.g2-eq>*,.g3>*{min-width:0}
.glance-h{font-size:19px;margin:0 0 12px;line-height:1.6}
.t-bad{color:var(--bad)}.t-warn{color:#C46A00}
table.rtable{width:100%;border-collapse:collapse;font-size:16.5px;font-variant-numeric:tabular-nums}
table.rtable th{background:#f4f4f5;color:#333;padding:7px 8px;text-align:center;border:1px solid var(--line);font-weight:700;line-height:1.3}
table.rtable td{padding:7px 10px;text-align:right;border:1px solid var(--line);white-space:nowrap}
table.rtable td.l{text-align:left}
table.rtable td small{font-size:13px;color:var(--muted);margin-left:5px;font-weight:600}
table.rtable tr.grand td{background:var(--ink);color:#fff}
table.rtable tr.grand td small{color:#C9CED8}
table.glance-t tr.st-bad td{background:#FDECEC}
table.glance-t tr.st-warn td{background:#FFF4E0}
.rtag{display:inline-block;font-size:12.5px;font-weight:800;padding:0 7px;border-radius:9px;margin-left:8px;vertical-align:1px}
.rtag.bad{background:var(--bad);color:#fff}.rtag.warn{background:#E08E00;color:#fff}
.page.shared{display:none}.page.shared.on{display:block}
.vage-top3{background:var(--main-l);border-radius:10px;padding:10px 16px 6px;margin-bottom:14px}
.top3-cap{font-size:14px;font-weight:700;color:var(--muted);margin-bottom:2px}
.top3-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:10px;padding:7px 0;border-top:1px solid rgba(30,90,168,.14)}
.top3-cap+.top3-row{border-top:0}
.top3-no{width:24px;height:24px;border-radius:50%;background:#fff;color:var(--main);border:1.5px solid var(--main-2);font-size:14px;font-weight:800;display:inline-flex;align-items:center;justify-content:center}
.top3-cap+.top3-row .top3-no{background:var(--main);color:#fff;border-color:var(--main)}
.top3-who{display:flex;align-items:baseline;gap:10px;min-width:0}
.top3-who b{font-size:17px;font-weight:800;white-space:nowrap}
.top3-who span{font-size:14px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top3-years{font-size:20px;font-weight:800;color:var(--main-d);font-variant-numeric:tabular-nums}
table.vage-t tr.st-warn td{background:#FFF4E0}
table.agg.vage-t{font-size:14.5px}
table.agg.tight.vage-t th{white-space:nowrap;font-size:13.5px;padding:6px 6px}
table.agg.tight.vage-t td{padding:5px 6px}
.t-good{color:var(--good)}
.mini-title{font-size:14.5px;color:var(--muted);text-align:center;margin-bottom:4px}
.chartbox.xs{height:150px}
.g-mix{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:16px;min-width:0}
.g-mix>.card{margin-bottom:16px}
table.badm-t td.reasons{white-space:normal}
.rsn{display:inline-flex;align-items:center;gap:5px;background:#F2F4F7;border-radius:12px;padding:1px 10px;margin:2px 6px 2px 0;font-size:14px;font-weight:700;color:#3A4252}
.rsn em{font-style:normal;color:var(--bad);font-weight:800}
@media(max-width:900px){.g-mix{grid-template-columns:1fr}}
.g-refurb{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px;min-width:0}
.g-refurb>.card{display:flex;flex-direction:column}
.period-warn{background:#FFF4E0;border:1px solid #E08E00;border-radius:10px;padding:10px 14px;margin:0 0 14px;font-size:15.5px;font-weight:700;color:#7A4B00}
@media(max-width:1000px){.g-refurb{grid-template-columns:1fr}}
.sech-note{font-size:15px;color:var(--muted);font-weight:700;margin-left:10px}
table.vage-t td small{font-size:12.5px;color:var(--muted);margin-left:4px;font-weight:600}
table.vt tr.sub td.l{font-size:14.5px;padding-left:28px}
table.agg.wide-t{font-size:16px}
table.agg.wide-t th{white-space:nowrap}
.cstat{display:flex;align-items:flex-end;flex-wrap:wrap;gap:6px 22px;margin:0 0 12px 12px;padding:10px 14px;background:var(--main-l);border-radius:10px}
.cst span{display:block;font-size:13.5px;color:var(--muted)}
.cst b{font-size:25px;font-weight:800;color:var(--main-d);font-variant-numeric:tabular-nums;line-height:1.2}
.cst.prev b{color:#7A818C;font-size:21px}
.cst-d .d{font-size:16px;font-weight:800;padding-bottom:3px}
.cst-d .d span{font-size:13px;font-weight:600;color:var(--muted);margin-left:6px}
.chartbox{position:relative;height:290px}.chartbox.sm{height:240px}.chartbox.pie{height:250px}.chartbox.fill{flex:1 1 0;min-height:340px;height:auto}
.mix-legend{display:grid;gap:6px;margin-top:10px;font-size:16px}
.mix-legend div{display:grid;grid-template-columns:14px 1fr auto 64px;align-items:center;gap:8px}
.mix-legend em{font-style:normal;color:var(--muted);text-align:right}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}.sw.good{background:var(--good)}.sw.bad{background:var(--bad)}.sw.warn{background:var(--warn)}
.twrap{border:1px solid var(--line);border-radius:10px;overflow-x:auto}
table.agg{border-collapse:collapse;width:100%;font-size:17px;font-variant-numeric:tabular-nums}
table.agg th{background:var(--main);color:#fff;padding:8px 10px;text-align:right;white-space:nowrap}
table.agg th.l,table.agg td.l{text-align:left}
table.agg td{padding:7px 10px;border-bottom:1px solid #eef0f4;white-space:nowrap}
table.agg td.n{text-align:right}
table.agg td.bad{color:var(--bad)}
table.agg td.strong{color:var(--main-d);font-weight:800}
table.agg td.muted{color:var(--muted);font-size:15px}
tr.grand td{background:var(--ink);color:#fff;font-weight:700}
table.agg.tight{font-size:15.5px;width:auto;min-width:100%}
table.agg.tight th{white-space:normal;line-height:1.25;padding:6px 8px;font-size:14.5px;vertical-align:bottom}
table.agg.tight td{padding:5px 8px}
table.agg.tight td.muted{font-size:13.5px}
table.agg.tight .pill{font-size:13.5px;padding:0 7px}
table.agg.tight .cnt{font-size:12px;padding:0 6px;margin-left:6px}
.vt tr.vrow{cursor:pointer}
.vt tr.vrow:hover td{background:var(--main-l)}
.vt .caret{display:inline-block;width:16px;color:var(--main);transition:transform .15s}
.vt tr.vrow.open .caret{transform:rotate(90deg)}
.vt .cnt{font-size:13px;color:var(--muted);background:#F0F3F6;border-radius:10px;padding:1px 8px;margin-left:8px}
.vt tr.sub{display:none}.vt tr.sub.show{display:table-row}
.vt tr.sub td{background:#FAFBFD;font-size:15.5px;color:#4A5264}
.dlt{font-weight:800}.dlt.good{color:var(--good)}.dlt.bad{color:var(--bad)}.dlt.flat{color:var(--muted)}
.pill{display:inline-block;padding:1px 10px;border-radius:10px;font-size:15px;font-weight:700}
.pill.good{background:#e6f4ec;color:var(--good)}.pill.warn{background:#fdf1dd;color:#a86a00}
.note{font-size:15.5px;color:var(--muted);margin:10px 2px 0}
.lowkey-toggle{margin:0 2px 16px}
.lowkey-toggle summary{display:inline-flex;align-items:center;gap:6px;font-size:17px;color:var(--muted);cursor:pointer;user-select:none;list-style:none}
.lowkey-toggle summary::-webkit-details-marker{display:none}
.lowkey-toggle summary:hover{color:var(--main-d)}
.lowkey-toggle-body{margin-top:10px}
.callout{background:#fff;border-left:5px solid var(--main);border-radius:8px;padding:14px 18px;margin:0 0 16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.big-quote{font-size:21px;font-weight:800;color:var(--main-d);margin:0 0 8px}
.advice-edit{white-space:pre-wrap;font-size:18px;font-weight:700;line-height:1.7;background:#fafbfc;border:1px solid var(--line);border-radius:8px;padding:14px 16px;width:100%;min-height:120px;font-family:inherit;resize:vertical;color:var(--ink)}
.defs{margin-top:28px;font-size:13px;color:var(--muted);font-weight:500}
.defs-h{color:#9AA0A6;font-size:13px}
.defs dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 14px;margin:8px 0 0;padding-top:8px;border-top:1px dashed var(--line)}
.defs dt{font-weight:700}.defs dd{margin:0}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#1F2535;color:#fff;padding:13px 20px;border-radius:10px;font-size:15.5px;opacity:0;pointer-events:none;transition:opacity .2s;z-index:50;max-width:90vw}
.toast.on{opacity:1}
@media(max-width:1100px){.g3{grid-template-columns:1fr 1fr}}
@media(max-width:900px){.topbar-inner{padding:10px 16px}.main{padding:16px}.g2-eq,.g3{grid-template-columns:1fr}}
@media print{.topbar{position:static}.card,.callout{break-inside:avoid}}
`;

  function generateReportHTML(state) {
    if (!App.app || !App.app.dataForDevice || !App.app.DEVICE_TABS) {
      throw new Error('報告產生需要 App.app.dataForDevice／DEVICE_TABS（app.js 尚未載入或版本過舊）');
    }
    const data = { 車機: buildDeviceData(state, '車機'), 鏡頭: buildDeviceData(state, '鏡頭') };
    Object.values(data).forEach((D) => { D.vageGroups = vendorAgeGroups(D); });
    const extra = { refurb: { period: REFURB_PERIOD, cats: REFURB_CATEGORIES, lensQty: REFURB_LENS_QTY, mainQty: REFURB_MAIN_UNIT_QTY, qcQty: REFURB_QC_QTY } };
    const genAt = new Date().toLocaleString('zh-TW');
    const filename = reportFilename(state);
    const json = JSON.stringify(data).replace(/</g, '\\u003c');

    return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>設備品質分析報告 ${esc(periodLabel(state))}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>${CSS}</style></head><body>
<header class="topbar"><div class="topbar-inner">
  <div class="brand"><span class="t">${App.icons.chart()} 設備品質分析報告</span><span class="s hidden" id="gen-time">製表：${esc(genAt)}</span></div>
  <div class="navgrp">
    <nav class="tabs">
      <button class="tab-btn on" data-sec="yield">${App.icons.pin()} 整體總覽</button>
      <div class="seg"><button data-dev="車機" class="on">${App.icons.car()} 車機</button><button data-dev="鏡頭">${App.icons.camera()} 鏡頭</button></div>
      <button class="tab-btn" data-sec="vendor">${App.icons.factory()} 廠商比較</button>
      <button class="tab-btn" data-sec="refurb">${App.icons.refresh()} 整新</button>
    </nav>
    <button class="icon-btn" id="btn-gentime" title="顯示／隱藏製表時間">${App.icons.clock()}</button>
    <button class="icon-btn" id="btn-save" title="儲存編輯內容">${App.icons.save()}</button>
  </div>
</div></header>
<main class="main">
${devicePanelHTML(data.車機, state)}
${devicePanelHTML(data.鏡頭, state)}
${vendorPageHTML(data, state)}
${refurbPageHTML(state)}
<div class="defs"><div class="defs-h">ⓘ 名詞與口徑</div><dl>
  <dt>不良數</dt><dd>不良品數＋未歸類數（比照舊版報告預設「未歸類併入不良品」）</dd>
  <dt>整體良率</dt><dd>1 − 不良數 ÷ 線上量</dd>
  <dt>回廠不良率</dt><dd>不良數 ÷ 期間回廠量；再使用率＝良品數 ÷ 期間回廠量；過保率＝過保數 ÷ 期間回廠量</dd>
  <dt>去年同期</dt><dd>儀表板有選「對比期間」時用該期間，否則用前一年同月份</dd>
  <dt>平均已使用年限</dt><dd>回廠的不良品、過保品、未歸類設備「派工完工日 − 進貨日」平均（比照舊版）；缺進貨日者不計</dd>
  <dt>在線平均已使用年限</dt><dd>規則 H：「車機鏡頭上線明細」中目前線上的設備，逐台（今天 − 參考日期）÷ 365 取平均（參考日期＝「日期」欄，缺值依「日期依據」取進貨日／安裝日），不限回廠或良品狀態；不隨本期／去年同期變動</dd>
  <dt>整新</dt><dd>KPI_分類彙總.xlsx 明細「數量 × 金額」加總（114 vs 115 年 1–9 月），非即時資料</dd>
  <dt>範圍</dt><dd>車機＝維護原因「訊號異常」；鏡頭＝維護原因「影像異常(鏡頭)」；套用儀表板目前的廠商／機型篩選</dd>
</dl></div>
</main>
<div class="toast" id="toast"></div>
<script>window.__R3=${json};window.__R3_REFURB=${JSON.stringify(extra.refurb)};window.__R3_FILENAME=${JSON.stringify(filename)};</script>
<script>${CLIENT_JS}</script>
</body></html>`;
  }

  function reportFilename(state) {
    return `品質分析報告_${state.year}-Q${state.quarter}_${new Date().toISOString().slice(0, 10)}.html`;
  }

  /**
   * 生成落地頁報告：本機下載一律執行；若 App.cloud 已設定 CLOUD_ENDPOINT，同時上傳到共用雲端
   * （行為與舊版 App.report.exportReport 相同，供「生成落地頁報告」按鈕使用）。
   * @returns {Promise<{cloud:{ok:boolean, error?:string, name?:string}|null}>}
   */
  async function exportReport(state) {
    const html = generateReportHTML(state);
    const filename = reportFilename(state);
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

  return { generateReportHTML, exportReport, _buildDeviceData: buildDeviceData };
})();
