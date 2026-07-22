/**
 * js/transform.js — 清洗、條碼 join、分類（規則 A–F v5）
 *
 * 掛載 App.transform 到全域命名空間。
 * 依賴（需先以 <script> 載入）：
 *   1. js/config.js → App.config（YEAR_THRESHOLD_DEFAULTS）
 *
 * 核心入口：App.transform.buildDetail(raw, { year, quarter })
 * 回傳：{ rows: Object[], stats: Object }
 *   rows  — 明細列陣列（欄位見 buildDetail JSDoc）
 *   stats — join 多筆比例統計（供驗證與 debug 用）
 */
window.App = window.App || {};

App.transform = (() => {

  // ─────────────────────────────────────────────────
  // 期間工具
  // ─────────────────────────────────────────────────

  /**
   * 依 year + quarter 算出累積制月份起訖（1-indexed）。
   * Q1=1–3, Q2=1–6, Q3=1–9, Q4=1–12
   * @param {number} year
   * @param {number} quarter - 1–4
   * @returns {{ year: number, startMonth: number, endMonth: number }}
   */
  function getPeriodMonths(year, quarter) {
    return { year, startMonth: 1, endMonth: quarter * 3 };
  }

  /**
   * 建立該季度所有 YYYY-MM 字串的 Set（供 維修.輸入年月 快速比對）。
   * @param {number} year
   * @param {number} startMonth
   * @param {number} endMonth
   * @returns {Set<string>}
   */
  function buildPeriodYMSet(year, startMonth, endMonth) {
    const set = new Set();
    for (let m = startMonth; m <= endMonth; m++) {
      set.add(`${year}-${String(m).padStart(2, '0')}`);
    }
    return set;
  }

  /**
   * 解析日期字串為 Date 物件（只取年月日，不依賴時區）。
   * 支援格式：
   *   'YYYY-MM-DD'、'YYYY/MM/DD'（ISO）
   *   'YYYY-MM-DD HH:mm:ss'（datetime，取日期部分）
   *   'M/D/YYYY'、'MM/DD/YYYY'（美式）
   * 格式不符 → null（拒絕 native Date.parse 以避免歧義）。
   * @param {string} str
   * @returns {Date|null}
   */
  function parseDate(str) {
    if (!str || typeof str !== 'string') return null;
    const s = str.trim();
    if (!s) return null;

    // YYYY-MM-DD 或 YYYY/MM/DD（可能後接空白/時間）
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      return isNaN(d.getTime()) ? null : d;
    }

    // M/D/YYYY 或 MM/DD/YYYY
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      const d = new Date(+m[3], +m[1] - 1, +m[2]);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  }

  /**
   * Date → 'YYYY-MM' 字串
   * @param {Date} date
   * @returns {string}
   */
  function toYearMonth(date) {
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * 判斷 Date 是否在 [startMonth, endMonth] 範圍內（同年、含兩端，1-indexed）。
   * @param {Date|null} date
   * @param {number} year
   * @param {number} startMonth
   * @param {number} endMonth
   * @returns {boolean}
   */
  function isInPeriod(date, year, startMonth, endMonth) {
    if (!date) return false;
    const y  = date.getFullYear();
    const mo = date.getMonth() + 1;
    return y === year && mo >= startMonth && mo <= endMonth;
  }

  // ─────────────────────────────────────────────────
  // 規則 A：維護類型（完全依對照表，不寫死）
  // ─────────────────────────────────────────────────

  /**
   * 將 關鍵字對照表 依優先序升冪排序，建立供 classify維護類型 使用的規則陣列。
   * @param {Object[]} 關鍵字對照表Rows
   * @returns {Array<{ keyword: string, type: string }>}
   */
  function buildKeywordRules(關鍵字對照表Rows) {
    return [...關鍵字對照表Rows]
      .sort((a, b) => Number(a['優先序'] || 9999) - Number(b['優先序'] || 9999))
      .filter(r => r['關鍵字'] && r['維護類型'])
      .map(r => ({
        keyword: String(r['關鍵字']).trim(),
        type:    String(r['維護類型']).trim(),
      }));
  }

  /**
   * 規則 A：依 維護細節 與關鍵字規則判斷維護類型。
   * 優先序小者先比對；全無命中或維護細節空白 → '其他'。
   * @param {string} 維護細節
   * @param {Array<{ keyword: string, type: string }>} keywordRules
   * @returns {string}
   */
  function classify維護類型(維護細節, keywordRules) {
    if (!維護細節 || !String(維護細節).trim()) return '其他';
    const val = String(維護細節).trim();
    for (const { keyword, type } of keywordRules) {
      if (val.includes(keyword)) return type;
    }
    return '其他';
  }

  // ─────────────────────────────────────────────────
  // 規則 B：維修分類（依 完成原因 關鍵字）
  // ─────────────────────────────────────────────────

  /**
   * 比對順序按特異性排列：
   *   - 'V /已完修 人為'（"已完修 人為"）必須在 'X /已完修'（"已完修"）前，
   *     否則含「已完修 人為」的完成原因會被 X 搶先命中。
   *   - 其餘關鍵字彼此不重疊，順序依規格表。
   */
  const REPAIR_RULES = [
    { code: 'V /已完修 人為',      keyword: '已完修 人為' },  // 必須先於 X
    { code: 'X /已完修',            keyword: '已完修' },
    { code: 'O /測試正常',          keyword: '測試正常' },
    { code: 'E /過保報廢',          keyword: '過保報廢' },
    { code: 'G /評估後退修',        keyword: '評估後退修' },
    { code: 'D /停產報廢',          keyword: '停產報廢' },
    { code: 'H /人為報廢',          keyword: '人為報廢' },
    { code: '不送修',               keyword: '不送修' },
    { code: '維修換貨＋換貨條碼',   keyword: '維修換貨' },
  ];

  /**
   * 規則 B：依 完成原因 判斷維修分類。
   * 完成原因空白（含無維修記錄）→ '無維修資訊'。
   * @param {string} 完成原因
   * @returns {string}
   */
  function classify維修分類(完成原因) {
    if (!完成原因 || !String(完成原因).trim()) return '無維修資訊';
    const val = String(完成原因).trim();
    for (const { code, keyword } of REPAIR_RULES) {
      if (val.includes(keyword)) return code;
    }
    return '無維修資訊';
  }

  // ─────────────────────────────────────────────────
  // 年限門檻
  // ─────────────────────────────────────────────────

  /**
   * 建立 { 設備類型 → 年限(number|null) } 對照物件。
   * 年限門檻分頁為空陣列時，以 App.config.YEAR_THRESHOLD_DEFAULTS 為底。
   * @param {Object[]} 年限門檻Rows
   * @returns {Object}
   */
  function buildThresholdMap(年限門檻Rows) {
    const defaults = App.config.YEAR_THRESHOLD_DEFAULTS;
    if (!年限門檻Rows || 年限門檻Rows.length === 0) return { ...defaults };

    const map = { ...defaults };
    for (const r of 年限門檻Rows) {
      const type = String(r['設備類型'] || '').trim();
      if (!type) continue;
      const raw = r['年限門檻'];
      map[type] = (raw === '' || raw == null) ? null : Number(raw);
    }
    return map;
  }

  /**
   * 取特定設備類型的年限門檻；未明確列出時用 _default。
   * @param {string} 設備類型
   * @param {Object} thresholdMap
   * @returns {number|null} null = 耗材，不做過保判定
   */
  function getThreshold(設備類型, thresholdMap) {
    const type = String(設備類型 || '').trim();
    if (Object.prototype.hasOwnProperty.call(thresholdMap, type)) {
      return thresholdMap[type];
    }
    return thresholdMap['_default'] ?? 1;
  }

  // ─────────────────────────────────────────────────
  // 規則 C（v5）：QC
  // ─────────────────────────────────────────────────

  /**
   * 規則 C（v5）：依優先序判斷 QC 欄位值。
   *
   * 處置說明（2026-07-17 主 Agent 裁決）：
   *   '不送修 且 有報廢原因' = 直接報廢（通常因過保），
   *   套用與「無維修資訊＋有報廢原因」完全相同的報廢分支
   *   （依年限門檻分「其他(未過)」／「回廠報廢」）。
   *   '不送修 且 無報廢原因' → 回廠QC（良品），不變。
   *
   * @param {string}      維修分類Code
   * @param {string}      報廢原因
   * @param {number|null} 已使用年限  — null 表示無法計算
   * @param {number|null} threshold   — null = 耗材，不判定「其他(未過)」
   * @returns {string}
   */
  function classifyQC(維修分類Code, 報廢原因, 已使用年限, threshold) {
    // 優先序 1
    if (維修分類Code === 'O /測試正常') return '廠商檢測正常';

    // 優先序 2
    if (['X /已完修', 'V /已完修 人為', '維修換貨＋換貨條碼'].includes(維修分類Code)) {
      return '廠商完修';
    }

    // 優先序 3
    if (['E /過保報廢', 'G /評估後退修', 'D /停產報廢', 'H /人為報廢'].includes(維修分類Code)) {
      return '廠商報廢';
    }

    const has報廢 = Boolean(報廢原因 && String(報廢原因).trim());

    // 優先序 6：不送修 + 無報廢原因 → 回廠QC（良品）
    if (維修分類Code === '不送修' && !has報廢) return '回廠QC';

    // 優先序 4 & 5：(無維修資訊 或 不送修+有報廢原因) + 有報廢原因 → 報廢分支
    // 不送修+有報廢 = 直接報廢（通常因過保），套用與無維修資訊+有報廢相同的規則
    if ((維修分類Code === '無維修資訊' || 維修分類Code === '不送修') && has報廢) {
      // 優先序 4：其他(未過) — 有年限門檻且年限未到
      if (threshold !== null && 已使用年限 !== null && 已使用年限 < threshold) {
        return '其他(未過)';
      }
      // 優先序 5
      return '回廠報廢';
    }

    // 優先序 7：無維修資訊 + 無報廢原因
    return '其他';
  }

  // ─────────────────────────────────────────────────
  // 三桶
  // ─────────────────────────────────────────────────

  /**
   * 依 QC + 維修分類 計算三桶布林標記。
   *
   * 注意：
   *   良品 與 不良品 互斥；過保是不良品的子集（過保數 ⊆ 不良品數）。
   *   QC 為以上 7 種之外的意外值時，三桶均 false。
   *
   * @param {string} QC
   * @param {string} 維修分類Code
   * @returns {{ 良品: boolean, 不良品: boolean, 過保: boolean }}
   */
  function calcBuckets(QC, 維修分類Code) {
    const 良品  = ['廠商檢測正常', '回廠QC', '其他'].includes(QC);
    const 不良品 = ['廠商報廢', '廠商完修', '回廠報廢', '其他(未過)'].includes(QC);

    // 過保 = 維修分類以 D 或 E 開頭，或 QC ∈ {回廠報廢, 其他(未過)}
    const 過保 =
      (typeof 維修分類Code === 'string' &&
        (維修分類Code.startsWith('D') || 維修分類Code.startsWith('E'))) ||
      QC === '回廠報廢' ||
      QC === '其他(未過)';

    return { 良品, 不良品, 過保 };
  }

  // ─────────────────────────────────────────────────
  // 規則 E：已使用年限
  // ─────────────────────────────────────────────────

  /**
   * 規則 E：(品項完工日期 − 替換前進貨日) / 365，取 1 位小數。
   * 任一日期缺失，或差值為負（進貨日晚於完工日，資料異常）→ null。
   * @param {Date|null} 完工日
   * @param {Date|null} 進貨日
   * @returns {number|null}
   */
  function calc已使用年限(完工日, 進貨日) {
    if (!完工日 || !進貨日) return null;
    const diffMs = 完工日.getTime() - 進貨日.getTime();
    if (diffMs < 0) return null;
    return Math.round((diffMs / (365 * 24 * 60 * 60 * 1000)) * 10) / 10;
  }

  // ─────────────────────────────────────────────────
  // 最近日期選取（DS-5 多筆取最接近 品項完工日期）
  // ─────────────────────────────────────────────────

  /**
   * 從多筆記錄中選出 dateField 最接近 targetDate 的一筆。
   * 所有記錄日期均無法解析時回傳第一筆（安全 fallback）。
   * @param {Object[]} records
   * @param {string}   dateField
   * @param {Date|null} targetDate
   * @returns {Object|null}
   */
  function pickClosest(records, dateField, targetDate) {
    if (!records || records.length === 0) return null;
    if (records.length === 1) return records[0];

    const targetMs = targetDate ? targetDate.getTime() : 0;
    let best     = null;
    let bestDiff = Infinity;

    for (const rec of records) {
      const d = parseDate(rec[dateField]);
      if (!d) continue;
      const diff = Math.abs(d.getTime() - targetMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best     = rec;
      }
    }

    return best ?? records[0];
  }

  // ─────────────────────────────────────────────────
  // 主函式：buildDetail
  // ─────────────────────────────────────────────────

  /**
   * 把 loadAll() 原始資料轉成明細列陣列（清洗、join、分類、三桶）。
   *
   * ──────── 輸入 ────────────────────────────────────
   * raw      App.sheets.loadAll() 回傳值
   * year     西元年（如 2026）
   * quarter  1–4（季度累積制；Q2=1–6月）
   *
   * ──────── 回傳 { rows, stats } ───────────────────
   *
   * rows：明細列陣列，每列含以下欄位：
   *   條碼(string)           替換前品項(string)    ERP品號(string)
   *   設備類型(string)       廠牌型號(string)       廠商(string)
   *   品項完工日期(string)   年月(string YYYY-MM)
   *   維護類型(string)       回廠狀態(string)       完成原因(string)
   *   維修分類(string)       QC(string)             已使用年限(number|null)
   *   報廢單狀態(string)     報廢原因(string)
   *   良品(boolean)          不良品(boolean)        過保(boolean)
   *
   * stats：join 多筆統計（供驗證報告與 debug 用）：
   *   cohortCount(number)
   *   dupBarcodeInCohortCount(number)  — cohort 內出現 >1 次的不同條碼數量
   *   dupBarcodeInCohortPct(string)    — 佔不重複條碼數的百分比
   *   multiRepairCount(number)         — join 後有 >1 筆維修記錄的 cohort 列數
   *   multiRepairPct(string)
   *   multiReturnCount(number)         — join 後有 >1 筆回廠記錄的 cohort 列數
   *   multiReturnPct(string)
   *
   * S1c（metrics.js）使用方式：
   *   const { rows } = App.transform.buildDetail(raw, { year, quarter });
   *   const 回廠Rows = rows.filter(r => r.回廠狀態 === '已回廠');
   *
   * @param {Object}  raw
   * @param {{ year: number, quarter: number }} options
   * @returns {{ rows: Object[], stats: Object }}
   */
  function buildDetail(raw, { year, quarter }) {
    const {
      派工, 回廠, 維修, 報廢,
      類型清單, 品號對照表, 關鍵字對照表, 年限門檻,
    } = raw;

    const { startMonth, endMonth } = getPeriodMonths(year, quarter);
    const periodYMSet = buildPeriodYMSet(year, startMonth, endMonth);

    // ── 預建輔助 Map ──────────────────────────────

    // 關鍵字規則（規則 A）
    const keywordRules = buildKeywordRules(關鍵字對照表);

    // 年限門檻
    const thresholdMap = buildThresholdMap(年限門檻);

    // 類型清單：Map<替換前品項(品名), row>
    // 注意：同品名多列時取第一筆（實際資料如有多筆需確認）
    const typeMap = new Map();
    for (const r of 類型清單) {
      const key = String(r['替換前品項'] || '').trim();
      if (key && !typeMap.has(key)) typeMap.set(key, r);
    }

    // 品號對照表：Map<品號, row>（品號 = ERP品號）
    const erpMap = new Map();
    for (const r of 品號對照表) {
      const key = String(r['品號'] || '').trim();
      if (key && !erpMap.has(key)) erpMap.set(key, r);
    }

    // 維修 Map：先期間限縮（DS-5），再 Map<條碼, records[]>
    // 優先用 輸入年月（已是 YYYY-MM）；若空則 fallback 到 輸入時間 日期解析
    const 維修Map = new Map();
    for (const r of 維修) {
      const ym = String(r['輸入年月'] || '').trim();
      if (ym) {
        if (!periodYMSet.has(ym)) continue;
      } else {
        const d = parseDate(r['輸入時間']);
        if (!isInPeriod(d, year, startMonth, endMonth)) continue;
      }
      const barcode = String(r['條碼'] || '').trim();
      if (!barcode) continue;
      if (!維修Map.has(barcode)) 維修Map.set(barcode, []);
      維修Map.get(barcode).push(r);
    }

    // 回廠 Map：先期間限縮（依 回廠時間，DS-5），再 Map<回廠條碼, records[]>
    const 回廠Map = new Map();
    for (const r of 回廠) {
      const d = parseDate(r['回廠時間']);
      if (!isInPeriod(d, year, startMonth, endMonth)) continue;
      const barcode = String(r['回廠條碼'] || '').trim();
      if (!barcode) continue;
      if (!回廠Map.has(barcode)) 回廠Map.set(barcode, []);
      回廠Map.get(barcode).push(r);
    }

    // 報廢 Map：全量（DS-4：無日期，靠條碼繼承 cohort 期間）
    const 報廢Map = new Map();
    for (const r of 報廢) {
      const barcode = String(r['條碼'] || '').trim();
      if (!barcode) continue;
      if (!報廢Map.has(barcode)) 報廢Map.set(barcode, []);
      報廢Map.get(barcode).push(r);
    }

    // ── Cohort 篩選（品項完工日期在期間內的派工列）────
    const cohort = 派工.filter(r => {
      const d = parseDate(r['品項完工日期']);
      return isInPeriod(d, year, startMonth, endMonth);
    });

    // ── 統計計數器 ────────────────────────────────
    const barcodesInCohort = new Map();  // barcode → 出現次數
    let multiRepairCount   = 0;
    let multiReturnCount   = 0;

    // ── 逐列 transform ────────────────────────────
    const rows = cohort.map(row => {
      const barcode   = String(row['替換前品項條碼'] || '').trim();
      const 品名      = String(row['替換前品項']     || '').trim();
      const 完工日    = parseDate(row['品項完工日期']);
      const 維護細節  = String(row['維護細節']        || '').trim();

      // cohort 重複條碼統計
      barcodesInCohort.set(barcode, (barcodesInCohort.get(barcode) || 0) + 1);

      // ── 規則 F：類型 / 廠商 join（類型清單 → 品號對照表 備援）
      const typeRow  = typeMap.get(品名) || null;
      const 設備類型 = String(typeRow?.['設備類型']                || '').trim();
      const 廠牌型號 = String(typeRow?.['廠牌型號(設備類型分類)']  || '').trim();
      const ERP品號  = String(typeRow?.['ERP品號']                 || '').trim();
      let   廠商     = String(typeRow?.['廠商']                    || '').trim();

      if (!廠商 && ERP品號) {
        const erpRow = erpMap.get(ERP品號);
        廠商 = String(erpRow?.['主供應商名稱'] || '').trim();
      }
      if (!廠商) 廠商 = '未分類';

      // ── 維修 join（DS-5：期間過濾後，多筆取最接近 品項完工日期）
      const 維修Records = barcode ? (維修Map.get(barcode) || []) : [];
      if (維修Records.length > 1) multiRepairCount++;
      const 維修Row = pickClosest(維修Records, '輸入時間', 完工日);

      // ── 回廠 join（DS-5：期間過濾後，多筆取最接近 品項完工日期）
      const 回廠Records = barcode ? (回廠Map.get(barcode) || []) : [];
      if (回廠Records.length > 1) multiReturnCount++;
      const 回廠Row = pickClosest(回廠Records, '回廠時間', 完工日);

      // ── 報廢 join（全量，取第一筆；無日期無法比較）
      const 報廢Records = barcode ? (報廢Map.get(barcode) || []) : [];
      const 報廢Row     = 報廢Records.length > 0 ? 報廢Records[0] : null;

      // ── 回廠狀態（保留於明細列；'無記錄' 表示期間內無對應回廠記錄）
      const 回廠狀態 = 回廠Row
        ? String(回廠Row['回廠狀態'] || '無記錄').trim()
        : '無記錄';

      // ── 完成原因（來自維修 join）
      const 完成原因 = String(維修Row?.['完成原因'] || '').trim();

      // ── 規則 B：維修分類
      const 維修分類Code = classify維修分類(完成原因);

      // ── 報廢欄位
      const 報廢單狀態 = String(報廢Row?.['報廢單狀態'] || '').trim();
      const 報廢原因   = String(報廢Row?.['報廢原因']   || '').trim();

      // ── 規則 E：已使用年限
      // 優先 派工.替換前進貨日；缺則依序查 回廠/維修/報廢 的進貨日
      let 進貨日Date = parseDate(row['替換前進貨日']);
      if (!進貨日Date) {
        for (const src of [回廠Row, 維修Row, 報廢Row]) {
          const d = parseDate(src?.['進貨日']);
          if (d) { 進貨日Date = d; break; }
        }
      }
      const 已使用年限 = calc已使用年限(完工日, 進貨日Date);

      // ── 年限門檻
      const threshold = getThreshold(設備類型, thresholdMap);

      // ── 規則 C：QC
      const QC = classifyQC(維修分類Code, 報廢原因, 已使用年限, threshold);

      // ── 三桶
      let { 良品, 不良品, 過保 } = calcBuckets(QC, 維修分類Code);
      // 邊界決議（2026-07-17）：已遺失 計入回廠量（見 metrics），但不列入任何品質桶
      //（遺失≠可沿用），避免虛增再使用率；歸為「其他/未歸類」。已升級維持依 QC 判定。
      if (回廠狀態 === '已遺失') {
        良品 = false;
        不良品 = false;
        過保 = false;
      }

      // ── 規則 A：維護類型
      const 維護類型 = classify維護類型(維護細節, keywordRules);

      // ── 年月（優先用 派工.品項完工年月，備援從完工日期推算）
      const 年月 = String(row['品項完工年月'] || '').trim() || toYearMonth(完工日);

      return {
        條碼:         barcode,
        替換前品項:   品名,
        ERP品號,
        設備類型,
        廠牌型號,
        廠商,
        品項完工日期: String(row['品項完工日期'] || '').trim(),
        年月,
        維護類型,
        回廠狀態,
        完成原因,
        維修分類:     維修分類Code,
        QC,
        已使用年限,
        報廢單狀態,
        報廢原因,
        良品,
        不良品,
        過保,
      };
    });

    // ── 統計彙整 ──────────────────────────────────
    let dupBarcodeInCohortCount = 0;
    for (const [, count] of barcodesInCohort) {
      if (count > 1) dupBarcodeInCohortCount++;
    }
    const n    = Math.max(cohort.length, 1);
    const nBC  = Math.max(barcodesInCohort.size, 1);

    const stats = {
      cohortCount:              cohort.length,
      dupBarcodeInCohortCount,
      dupBarcodeInCohortPct:    ((dupBarcodeInCohortCount / nBC) * 100).toFixed(1) + '%',
      multiRepairCount,
      multiRepairPct:           (multiRepairCount / n * 100).toFixed(1) + '%',
      multiReturnCount,
      multiReturnPct:           (multiReturnCount / n * 100).toFixed(1) + '%',
    };

    return { rows, stats };
  }

  // ─────────────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────────────

  return {
    /**
     * 核心 transform 函式。
     * @see buildDetail 函式 JSDoc（上方）
     */
    buildDetail,

    // ── 內部工具（加底線前綴，供測試腳本直接呼叫）
    _getPeriodMonths:    getPeriodMonths,
    _parseDate:          parseDate,
    _classify維護類型:   classify維護類型,
    _classify維修分類:   classify維修分類,
    _classifyQC:         classifyQC,
    _calcBuckets:        calcBuckets,
    _buildKeywordRules:  buildKeywordRules,
    _buildThresholdMap:  buildThresholdMap,
    _calc已使用年限:     calc已使用年限,
  };
})();
