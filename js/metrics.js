/**
 * js/metrics.js — 指標計算、季度/YoY、篩選
 *
 * 掛載 App.metrics 到全域命名空間。
 * 依賴（需先以 <script> 載入）：
 *   1. js/config.js    → App.config
 *   2. js/transform.js → App.transform（buildDetail）
 *
 * 主要 API：
 *   App.metrics.buildOnlineList(raw)
 *   App.metrics.deriveFilterOptions(rows)
 *   App.metrics.applyFilter(rows, selection)
 *   App.metrics.computeKPI(rows, onlineList, selection)
 *   App.metrics.computeYoY(raw, { year, quarter, selection })
 *   App.metrics.trendByMonth(rows, selection)
 *   App.metrics.faultDistribution(rows, selection)
 *
 * selection 型別：{ 廠商?: string[], 類型?: string[], ERP品號?: string[] }
 *   各陣列為空 → 對應維度不限制。
 *   「類型」對應 rows/上線量 的 廠牌型號 欄位。
 */
window.App = window.App || {};

App.metrics = (() => {

  // ─────────────────────────────────────────────────
  // 工具
  // ─────────────────────────────────────────────────

  /**
   * 安全除法：分母為 0 或 falsy 時回傳 0。
   * （沿用舊版 safeDiv 慣例）
   * @param {number} numerator
   * @param {number} denominator
   * @returns {number}
   */
  function safeDiv(numerator, denominator) {
    if (!denominator || denominator === 0) return 0;
    return numerator / denominator;
  }

  // ─────────────────────────────────────────────────
  // 上線量 enrich（3. buildOnlineList）
  // ─────────────────────────────────────────────────

  /**
   * 對每個 `SQL_上線量` 列，以 ERP品號 join `類型清單`（設備類型/廠牌型號/廠商）；
   * 廠商空則 join `品號對照表.主供應商名稱`；仍空 → 標「未分類」。
   * 以 ERP品號 去重（避免重複計入同一品號的上線量）。
   *
   * 注意：類型清單同一 ERP品號 可能多列，取第一筆即可（設備類型/廠商在同品號下一致）。
   *
   * @param {Object} raw - App.sheets.loadAll() 回傳值
   * @returns {Array<{
   *   ERP品號: string,
   *   品名: string,
   *   設備類型: string,
   *   廠牌型號: string,
   *   廠商: string,
   *   上線量: number,
   * }>}
   */
  function buildOnlineList(raw) {
    const { 上線量: 上線量Rows = [], 類型清單 = [], 品號對照表 = [] } = raw;

    // 類型清單 Map<ERP品號, row>（多列取第一筆）
    const typeByERP = new Map();
    for (const r of 類型清單) {
      const erp = String(r['ERP品號'] || '').trim();
      if (erp && !typeByERP.has(erp)) typeByERP.set(erp, r);
    }

    // 品號對照表 Map<品號, row>
    const supplierByERP = new Map();
    for (const r of 品號對照表) {
      const 品號 = String(r['品號'] || '').trim();
      if (品號 && !supplierByERP.has(品號)) supplierByERP.set(品號, r);
    }

    // 逐列 enrich，以 ERP品號 去重
    const seen   = new Set();
    const result = [];

    for (const r of 上線量Rows) {
      const erp = String(r['ERP品號'] || '').trim();
      if (!erp || seen.has(erp)) continue;
      seen.add(erp);

      const typeRow  = typeByERP.get(erp) || null;
      const 設備類型 = String(typeRow?.['設備類型']                   || '').trim();
      const 廠牌型號 = String(typeRow?.['廠牌型號(設備類型分類)'] || '').trim();
      let   廠商     = String(typeRow?.['廠商']                        || '').trim();

      if (!廠商) {
        const erpRow = supplierByERP.get(erp);
        廠商 = String(erpRow?.['主供應商名稱'] || '').trim();
      }
      if (!廠商) 廠商 = '未分類';

      result.push({
        ERP品號: erp,
        品名:    String(r['品名'] || '').trim(),
        設備類型,
        廠牌型號,
        廠商,
        上線量:  Number(r['上線量']) || 0,
      });
    }

    return result;
  }

  // ─────────────────────────────────────────────────
  // 篩選（1. deriveFilterOptions + applyFilter）
  // ─────────────────────────────────────────────────

  /**
   * 從 rows 萃取三層串接篩選選項。
   * - 廠商：distinct（已排序）
   * - 類型By廠商：每個廠商下的 distinct 廠牌型號（已排序）
   * - ERP品號By廠商類型：每個 (廠商, 廠牌型號) 下的 distinct ERP品號（含品名，已排序）
   *
   * 使用方式（串接）：
   *   1. 選廠商後 → 取 類型By廠商[廠商] 作為類型選項
   *   2. 選類型後 → 取 ERP品號By廠商類型[`${廠商}|${類型}`] 作為品號選項
   *
   * @param {Object[]} rows - App.transform.buildDetail 回傳的 rows
   * @returns {{
   *   廠商: string[],
   *   類型By廠商: { [廠商: string]: string[] },
   *   ERP品號By廠商類型: { [key: string]: Array<{ ERP品號: string, 品名: string }> },
   * }}
   */
  function deriveFilterOptions(rows) {
    const 廠商Set          = new Set();
    const 類型By廠商        = new Map();          // Map<廠商, Set<廠牌型號>>
    const ERP品號By廠商類型 = new Map();          // Map<`${廠商}|${廠牌型號}`, Map<ERP品號, 品名>>

    for (const r of rows) {
      const v = String(r.廠商     || '未分類').trim();
      const t = String(r.廠牌型號 || '').trim();
      const e = String(r.ERP品號  || '').trim();
      const n = String(r.替換前品項 || '').trim();

      廠商Set.add(v);

      if (!類型By廠商.has(v)) 類型By廠商.set(v, new Set());
      if (t) 類型By廠商.get(v).add(t);

      const key = `${v}|${t}`;
      if (!ERP品號By廠商類型.has(key)) ERP品號By廠商類型.set(key, new Map());
      if (e) ERP品號By廠商類型.get(key).set(e, n);
    }

    const 廠商 = [...廠商Set].sort();

    const 類型By廠商Out = {};
    for (const [v, typeSet] of 類型By廠商) {
      類型By廠商Out[v] = [...typeSet].sort();
    }

    const ERP品號By廠商類型Out = {};
    for (const [key, erpMap] of ERP品號By廠商類型) {
      ERP品號By廠商類型Out[key] = [...erpMap.entries()]
        .map(([ERP品號, 品名]) => ({ ERP品號, 品名 }))
        .sort((a, b) => a.ERP品號.localeCompare(b.ERP品號));
    }

    return {
      廠商,
      類型By廠商:        類型By廠商Out,
      ERP品號By廠商類型: ERP品號By廠商類型Out,
    };
  }

  /**
   * 依 selection 過濾 rows（也可傳入 上線量Enriched 陣列）。
   * selection 各陣列為空 → 對應維度不限制。
   *
   * 欄位對應：
   *   selection.廠商   → row.廠商
   *   selection.類型   → row.廠牌型號
   *   selection.ERP品號 → row.ERP品號
   *
   * @param {Object[]} rows
   * @param {{ 廠商?: string[], 類型?: string[], ERP品號?: string[] }} [selection]
   * @returns {Object[]}
   */
  function applyFilter(rows, selection) {
    const { 廠商 = [], 類型 = [], ERP品號 = [] } = selection || {};

    // 空陣列不限制 → 短路返回全量
    if (廠商.length === 0 && 類型.length === 0 && ERP品號.length === 0) return rows;

    return rows.filter(r => {
      if (廠商.length    > 0 && !廠商.includes(r.廠商))      return false;
      if (類型.length    > 0 && !類型.includes(r.廠牌型號))  return false;
      if (ERP品號.length > 0 && !ERP品號.includes(r.ERP品號)) return false;
      return true;
    });
  }

  // ─────────────────────────────────────────────────
  // KPI 計算（2. computeKPI）
  // ─────────────────────────────────────────────────

  /**
   * 依 selection 過濾後計算 KPI（含派工量供參考）。
   *
   * ── 分母慣例（2026-07-17 決議；2026-07-23 補：期間率／整體率 欄位正式分開命名）──
   * 期間回廠量：過濾後 rows 中「有回廠記錄且 回廠狀態 ≠ '不回廠' 且 ≠ '無記錄'」的計數。
   *   已回廠／已遺失／已升級 皆計入；無回廠記錄（'無記錄'）不計。
   * 良品數/不良品數/過保數：在上述回廠子集上分別計數。
   * 總線上量：對過濾後 上線量Enriched 的 上線量 欄位加總。
   *
   * 期間率（分母＝期間回廠量）：再使用率、期間不良率、期間過保率、期間未歸類率。
   * 整體率（分母＝總線上量）：整體不良率、整體過保率。
   * 舊欄位名 不良率／過保率（分母其實是總線上量）已移除，改用 整體不良率／整體過保率，
   * 避免欄位名稱與分母語意不符被誤用。
   *
   * 2026-07-24 新增「未歸類數」／「期間未歸類率」（第四桶，見 transform.js calcBuckets()）：
   * 良品／不良品／過保／未歸類 四桶互斥且加總＝期間回廠量，四個期間率加總恆等於 100%。
   *
   * @param {Object[]} rows           - buildDetail 回傳的 rows
   * @param {Object[]} 上線量Enriched - buildOnlineList 回傳值
   * @param {{ 廠商?: string[], 類型?: string[], ERP品號?: string[] }} [selection]
   * @returns {{
   *   派工量: number,
   *   期間回廠量: number,
   *   良品數: number,
   *   不良品數: number,
   *   過保數: number,
   *   未歸類數: number,
   *   總線上量: number,
   *   再使用率: number,
   *   期間不良率: number,
   *   期間過保率: number,
   *   期間未歸類率: number,
   *   整體不良率: number,
   *   整體過保率: number,
   * }}
   */
  function computeKPI(rows, 上線量Enriched, selection) {
    const filteredRows   = applyFilter(rows, selection);
    const filtered上線量 = applyFilter(上線量Enriched, selection);

    // 回廠子集：有回廠記錄且非「不回廠」
    const 回廠Subset = filteredRows.filter(r =>
      r.回廠狀態 && r.回廠狀態 !== '無記錄' && r.回廠狀態 !== '不回廠'
    );

    const 期間回廠量 = 回廠Subset.length;
    const 良品數     = 回廠Subset.filter(r => r.良品).length;
    const 不良品數   = 回廠Subset.filter(r => r.不良品).length;
    const 過保數     = 回廠Subset.filter(r => r.過保).length;
    const 未歸類數   = 回廠Subset.filter(r => r.未歸類).length;
    // 未歸類桶的兩個子分類（供「整體總覽」拆分顯示；人為+其他未過＝未歸類，不影響既有四桶互斥關係）
    const 人為數     = 回廠Subset.filter(r => r.維修分類 === 'H /人為報廢' || r.維修分類 === 'V /已完修 人為').length;
    const 其他未過數 = 回廠Subset.filter(r => r.QC === '其他(未過)').length;
    // 內部檢測（QC=回廠QC）：良品桶的子集，供「使用率」頁面的內部檢測數量／省下的成本使用
    const 內部檢測數 = 回廠Subset.filter(r => r.QC === '回廠QC').length;
    const 總線上量   = filtered上線量.reduce((sum, r) => sum + (Number(r.上線量) || 0), 0);
    const 派工量     = filteredRows.length;

    return {
      派工量,
      期間回廠量,
      良品數,
      不良品數,
      過保數,
      未歸類數,
      人為數,
      其他未過數,
      內部檢測數,
      總線上量,
      再使用率:       safeDiv(良品數,   期間回廠量),
      期間不良率:     safeDiv(不良品數, 期間回廠量),
      期間過保率:     safeDiv(過保數,   期間回廠量),
      期間未歸類率:   safeDiv(未歸類數, 期間回廠量),
      期間人為率:     safeDiv(人為數,   期間回廠量),
      期間其他未過率: safeDiv(其他未過數, 期間回廠量),
      整體不良率:     safeDiv(不良品數, 總線上量),
      整體過保率:     safeDiv(過保數,   總線上量),
      整體人為率:     safeDiv(人為數,   總線上量),
      整體其他未過率: safeDiv(其他未過數, 總線上量),
      整體再使用率:   safeDiv(良品數,   總線上量),
    };
  }

  // ─────────────────────────────────────────────────
  // YoY 同期比較（4. computeYoY）
  // ─────────────────────────────────────────────────

  /**
   * 對 year 與 year-1 各跑 buildDetail + computeKPI（同一累積季度），
   * 回傳兩期 KPI 與 delta（差值與百分比變化）。
   *
   * 上線量 Enriched 兩期共用同一份（上線量為快照值，不分期間）。
   * delta.pct = (diff / |prevKPI|) × 100；prevKPI 為 0 時 pct = 0。
   *
   * @param {Object} raw                - App.sheets.loadAll() 回傳值
   * @param {number} year
   * @param {number} quarter            - 1–4
   * @param {{ 廠商?: string[], 類型?: string[], ERP品號?: string[] }} [selection]
   * @returns {{
   *   current:  { year: number, quarter: number, kpi: Object },
   *   previous: { year: number, quarter: number, kpi: Object },
   *   delta:    { [key: string]: { diff: number, pct: number } },
   * }}
   */
  function computeYoY(raw, { year, quarter, selection = {} }) {
    const onlineList = buildOnlineList(raw);

    const curDetail  = App.transform.buildDetail(raw, { year,          quarter });
    const prevDetail = App.transform.buildDetail(raw, { year: year - 1, quarter });

    const curKPI  = computeKPI(curDetail.rows,  onlineList, selection);
    const prevKPI = computeKPI(prevDetail.rows, onlineList, selection);

    const delta = {};
    for (const key of Object.keys(curKPI)) {
      const cur  = curKPI[key];
      const prev = prevKPI[key];
      const diff = cur - prev;
      delta[key] = {
        diff,
        pct: safeDiv(diff, Math.abs(prev)) * 100,
      };
    }

    return {
      current:  { year,          quarter, kpi: curKPI  },
      previous: { year: year - 1, quarter, kpi: prevKPI },
      delta,
    };
  }

  // ─────────────────────────────────────────────────
  // 趨勢與分佈（5. 供 S2 圖表用，只出資料不畫圖）
  // ─────────────────────────────────────────────────

  /**
   * 依 年月 分組，回傳每月的回廠量與不良品數（供趨勢折線圖）。
   *
   * 「回廠量」定義與 computeKPI 一致（回廠狀態 ≠ '無記錄' 且 ≠ '不回廠'）。
   * 「不良品數」在該月的回廠子集上計數。
   *
   * @param {Object[]} rows
   * @param {{ 廠商?: string[], 類型?: string[], ERP品號?: string[] }} [selection]
   * @returns {Array<{ 年月: string, 回廠量: number, 不良品數: number }>}
   */
  function trendByMonth(rows, selection) {
    const filtered = applyFilter(rows, selection);
    const monthMap = new Map();  // Map<YYYY-MM, { 回廠量, 不良品數 }>

    for (const r of filtered) {
      const ym = r.年月 || '';
      if (!ym) continue;

      if (!monthMap.has(ym)) monthMap.set(ym, { 回廠量: 0, 不良品數: 0 });
      const bucket = monthMap.get(ym);

      const isReturned = r.回廠狀態 && r.回廠狀態 !== '無記錄' && r.回廠狀態 !== '不回廠';
      if (isReturned) {
        bucket.回廠量++;
        if (r.不良品) bucket.不良品數++;
      }
    }

    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([年月, v]) => ({ 年月, ...v }));
  }

  /**
   * 依 維護類型 計數（供圓餅／長條分佈圖）。
   * 結果依數量降冪排列。
   *
   * @param {Object[]} rows
   * @param {{ 廠商?: string[], 類型?: string[], ERP品號?: string[] }} [selection]
   * @returns {Array<{ 維護類型: string, 數量: number }>}
   */
  function faultDistribution(rows, selection) {
    const filtered = applyFilter(rows, selection);
    const countMap = new Map();

    for (const r of filtered) {
      const t = r.維護類型 || '其他';
      countMap.set(t, (countMap.get(t) || 0) + 1);
    }

    return [...countMap.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([維護類型, 數量]) => ({ 維護類型, 數量 }));
  }

  // ─────────────────────────────────────────────────
  // 彙整表（依 ERP品號，供折疊明細表；groupBy 類型/廠商 + 小計）
  // ─────────────────────────────────────────────────

  // 維修分類／QC 細項計數欄位（對齊 build_分析總表.py 的 build_overview，冊03 v6 規格）
  const REPAIR_COUNT_KEYS = ['D /停產報廢', 'E /過保報廢', 'G /評估後退修', 'H /人為報廢', 'O /測試正常', 'X /已完修', 'V /已完修 人為', '維修換貨＋換貨條碼'];
  const QC_COUNT_KEYS = ['回廠QC', '回廠報廢', '其他(良品)', '其他(回廠)'];
  const EXTRA_COUNT_KEYS = [...REPAIR_COUNT_KEYS, ...QC_COUNT_KEYS, '回廠不良品數(全)', '回廠良品數', '回廠不良品數', '回廠過保數', '回廠人為數'];

  /**
   * 依 selection 過濾後，將 cohort 依 ERP品號 彙整成一列，並依 groupBy（類型/廠商）分組，
   * 附各組小計與總計。列指標對齊舊工具彙整總覽：
   *   期間率（÷回廠量）：再使用率、不良率、過保率、未歸類率（四者加總＝100%，見 calcBuckets 第四桶）
   *   整體率（÷上線量）：整體不良率、整體過保率
   *   已使用年限：非良品（不良品＋過保＋未歸類）明細之平均，無則 null；與其他三桶一致，僅計「已回廠」明細
   *     （2026-07-29 改版，取代原本僅「過保＋其他(未過)」口徑；改納入完整不良品與未歸類桶，
   *     且不再排除 isReturned 檢查，避免「不回廠」明細混入年限平均卻不算進未歸類數的落差）
   *   維修分類／QC 細項計數（回廠不良品數(全)/回廠良品數/…/其他(回廠)）：對齊 build_分析總表.py
   *     build_overview()（僅在 opts.faultCols 有給故障原因分類時才附加該 5 欄，計數母體與
   *     回廠量/良品數/不良品數/過保數 一致，皆為「已回廠」子集，故 回廠不良品數(全)+回廠良品數＝回廠量）
   *
   * @param {Object[]} rows
   * @param {Object[]} 上線量Enriched
   * @param {Object} selection
   * @param {{ groupBy?: '類型'|'廠商', faultCols?: string[] }} [opts] - faultCols：5 個故障原因分類
   *   （車機＝['AB點','失聯','定位不良','訊號異常','其他']；鏡頭＝['黑畫面','進水/模糊','水波紋','時有時無','其他']），
   *   最後一項為餘數「其他」。提供時，回傳列會附加這 5 欄的計數。
   * @returns {{ groups: Array<{key, rows, subtotal}>, grandTotal: Object, groupBy: '類型'|'廠商' }}
   */
  function aggregate(rows, 上線量Enriched, selection, opts) {
    const groupBy = (opts && opts.groupBy === '廠商') ? '廠商' : '類型';
    const faultCols = (opts && opts.faultCols) || null;
    const filtered   = applyFilter(rows, selection);
    const filtered上線 = applyFilter(上線量Enriched, selection);

    const onlineByERP = new Map();
    for (const o of filtered上線) {
      const e = String(o.ERP品號 || '');
      onlineByERP.set(e, (onlineByERP.get(e) || 0) + (Number(o.上線量) || 0));
    }

    const isReturned = (r) => r.回廠狀態 && r.回廠狀態 !== '無記錄' && r.回廠狀態 !== '不回廠';
    const QC_LABEL = { '回廠QC': '回廠QC', '回廠報廢': '回廠報廢', '其他': '其他(良品)', '其他(未過)': '其他(回廠)' };

    // 依 ERP品號 累加
    const acc = new Map();
    for (const r of filtered) {
      const erp = String(r.ERP品號 || '');
      const key = erp || `型:${r.廠牌型號 || ''}|${r.替換前品項 || ''}`;
      if (!acc.has(key)) {
        acc.set(key, {
          ERP品號: erp, 廠商: r.廠商 || '未分類', 類型: r.廠牌型號 || '', 品名: r.替換前品項 || '',
          回廠量: 0, 良品數: 0, 不良品數: 0, 過保數: 0, 未歸類數: 0, 年限Sum: 0, 年限N: 0,
          維修分類count: {}, QCcount: {}, 維護類型count: {},
        });
      }
      const a = acc.get(key);
      if (isReturned(r)) {
        a.回廠量++;
        if (r.良品) a.良品數++;
        if (r.不良品) a.不良品數++;
        if (r.過保) a.過保數++;
        if (r.未歸類) a.未歸類數++;
        const mc = r.維修分類 || '';
        a.維修分類count[mc] = (a.維修分類count[mc] || 0) + 1;
        const qcLabel = QC_LABEL[r.QC] || null;
        if (qcLabel) a.QCcount[qcLabel] = (a.QCcount[qcLabel] || 0) + 1;
        if (faultCols) {
          const ft = r.維護類型 || '其他';
          a.維護類型count[ft] = (a.維護類型count[ft] || 0) + 1;
        }
        // 已使用年限：不良品＋過保＋未歸類（＝非良品），且與其他三桶一致要求 isReturned
        // （2026-07-29 改版，取代原本僅「過保＋其他(未過)」口徑，且不再納入未回廠明細，跟未歸類數口徑對齊）
        if ((r.不良品 || r.過保 || r.未歸類) && r.已使用年限 != null) { a.年限Sum += Number(r.已使用年限); a.年限N++; }
      }
    }

    const mkRow = (a, 上線量) => {
      const mc = a.維修分類count, qc = a.QCcount;
      const d = mc['D /停產報廢'] || 0, e = mc['E /過保報廢'] || 0, gg = mc['G /評估後退修'] || 0,
        h = mc['H /人為報廢'] || 0, o = mc['O /測試正常'] || 0, x = mc['X /已完修'] || 0,
        v = mc['V /已完修 人為'] || 0, ex = mc['維修換貨＋換貨條碼'] || 0;
      const qcQc = qc['回廠QC'] || 0, qcScrap = qc['回廠報廢'] || 0, qcOth = qc['其他(良品)'] || 0, qcOth2 = qc['其他(回廠)'] || 0;
      const row = {
        廠商: a.廠商, 類型: a.類型, ERP品號: a.ERP品號, 品名: a.品名,
        上線量, 回廠量: a.回廠量, 良品數: a.良品數, 不良品數: a.不良品數, 過保數: a.過保數, 未歸類數: a.未歸類數,
        再使用率: safeDiv(a.良品數, a.回廠量), 不良率: safeDiv(a.不良品數, a.回廠量), 過保率: safeDiv(a.過保數, a.回廠量),
        未歸類率: safeDiv(a.未歸類數, a.回廠量),
        已使用年限: a.年限N ? Math.round(a.年限Sum / a.年限N * 10) / 10 : null,
        整體不良率: safeDiv(a.不良品數, 上線量), 整體過保率: safeDiv(a.過保數, 上線量),
        'D /停產報廢': d, 'E /過保報廢': e, 'G /評估後退修': gg, 'H /人為報廢': h,
        'O /測試正常': o, 'X /已完修': x, 'V /已完修 人為': v, '維修換貨＋換貨條碼': ex,
        '回廠QC': qcQc, '回廠報廢': qcScrap, '其他(良品)': qcOth, '其他(回廠)': qcOth2,
        '回廠不良品數(全)': d + e + gg + h + x + v + ex + qcScrap + qcOth2,
        '回廠良品數': o + qcQc + qcOth,
        '回廠不良品數': gg + x + ex,
        '回廠過保數': d + e + qcScrap,
        '回廠人為數': h,
        _年限Sum: a.年限Sum, _年限N: a.年限N,
      };
      if (faultCols) {
        const main4 = faultCols.slice(0, -1);
        let sum4 = 0;
        for (const ft of main4) { row[ft] = a.維護類型count[ft] || 0; sum4 += row[ft]; }
        row[faultCols[faultCols.length - 1]] = a.回廠量 - sum4;
      }
      return row;
    };

    const erpRows = [...acc.values()].map((a) => mkRow(a, onlineByERP.get(a.ERP品號) || 0));

    const groupMap = new Map();
    for (const row of erpRows) {
      const g = row[groupBy] || '(未分類)';
      if (!groupMap.has(g)) groupMap.set(g, []);
      groupMap.get(g).push(row);
    }
    const groups = [...groupMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, arr]) => ({
      key,
      rows: arr.sort((a, b) => String(a.ERP品號).localeCompare(String(b.ERP品號))),
      subtotal: { label: `${key} 小計`, ...summarizeRows(arr, faultCols) },
    }));

    return { groups, grandTotal: { label: '總計', ...summarizeRows(erpRows, faultCols) }, groupBy };
  }

  /**
   * 依 aggregate() 產生的 ERP 列（mkRow 輸出）重新加總，供畫面端欄位篩選後即時重算小計/總計。
   * 與 aggregate() 內部 subtotal 邏輯一致：期間率÷回廠量、整體率÷上線量、已使用年限取平均。
   * @param {Object[]} rows - aggregate() 回傳的 group.rows（或篩選後的子集）
   * @param {string[]} [faultCols] - 需與產生這批 rows 時的 faultCols 一致，才能正確加總故障原因 5 欄
   * @returns {Object} 同 aggregate() 的 subtotal/grandTotal 形狀（不含 label）
   */
  function summarizeRows(rows, faultCols) {
    const sumKeys = ['上線量', '回廠量', '良品數', '不良品數', '過保數', '未歸類數', ...EXTRA_COUNT_KEYS, ...(faultCols || [])];
    const s = { 年限Sum: 0, 年限N: 0 };
    for (const k of sumKeys) s[k] = 0;
    for (const r of rows) {
      for (const k of sumKeys) s[k] += (r[k] || 0);
      s.年限Sum += r._年限Sum || 0; s.年限N += r._年限N || 0;
    }
    return {
      ...s,
      再使用率: safeDiv(s.良品數, s.回廠量), 不良率: safeDiv(s.不良品數, s.回廠量), 過保率: safeDiv(s.過保數, s.回廠量),
      未歸類率: safeDiv(s.未歸類數, s.回廠量),
      已使用年限: s.年限N ? Math.round(s.年限Sum / s.年限N * 10) / 10 : null,
      整體不良率: safeDiv(s.不良品數, s.上線量), 整體過保率: safeDiv(s.過保數, s.上線量),
    };
  }

  // ─────────────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────────────

  return {
    /**
     * 上線量清單 enrich（join 廠商/設備類型/廠牌型號）。
     * 建議資料載入後執行一次並快取，供 computeKPI 重用。
     */
    buildOnlineList,

    /**
     * 從 buildDetail rows 萃取三層串接篩選選項。
     * 回傳：{ 廠商[], 類型By廠商{}, ERP品號By廠商類型{} }
     */
    deriveFilterOptions,

    /**
     * 依 selection 過濾 rows 或 上線量Enriched。
     * selection = { 廠商:[], 類型:[], ERP品號:[] }（空陣列=不限）。
     */
    applyFilter,

    /**
     * 計算五大 KPI（+ 派工量供參考）。
     * @param rows          buildDetail 回傳的 rows
     * @param 上線量Enriched buildOnlineList 回傳值
     * @param selection     { 廠商:[], 類型:[], ERP品號:[] }
     */
    computeKPI,

    /**
     * YoY 同期比較（year vs year-1，同一累積季度）。
     * 回傳：{ current, previous, delta }
     * delta 每個 key = { diff, pct }。
     */
    computeYoY,

    /**
     * 月度趨勢（供折線圖）。
     * 回傳：[{ 年月, 回廠量, 不良品數 }]
     */
    trendByMonth,

    /**
     * 維護類型分佈（供圓餅/長條圖，依數量降冪）。
     * 回傳：[{ 維護類型, 數量 }]
     */
    faultDistribution,

    /**
     * 依 ERP品號 彙整＋分組（類型/廠商）＋小計/總計，供折疊明細表與落地頁。
     * 回傳：{ groups:[{key,rows,subtotal}], grandTotal, groupBy }
     */
    aggregate,

    /**
     * 依 aggregate() 產生的 ERP 列重新加總（不含 label），供畫面端欄位篩選後即時重算小計/總計。
     * faultCols 需與產生這批 rows 時一致。
     */
    summarizeRows,

    // 內部工具（底線前綴，供測試直接呼叫）
    _safeDiv: safeDiv,
  };
})();
