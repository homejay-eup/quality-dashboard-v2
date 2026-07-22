/**
 * js/config.js — 資料源設定
 *
 * 掛載 App.config 到全域命名空間。
 * 需在 js/sheets.js 之前載入。
 */
window.App = window.App || {};

App.config = {
  /** Google Sheets ID（唯讀，勿修改） */
  SHEET_ID: '1DDvmuNley9safgUGMfolTZph6TkiLdC2h99nAiKG_j4',

  /**
   * 共用雲端快照接收端（Apps Script Web App exec URL）。
   * 部署步驟見 apps-script/README.md。留空＝雲端功能隱藏，退回本機下載/載入。
   * 例：'https://script.google.com/macros/s/AKfycb.../exec'
   */
  CLOUD_ENDPOINT: 'https://script.google.com/a/macros/eup.com.tw/s/AKfycbyCYK-3NgTZhxSwngNHg4E5U5IkJBlGzahVykufTjl2NgKyO_WLMH7oNC1NJrIOnxSO/exec',

  /**
   * 各分頁存取設定
   *
   * - sheet：分頁名稱（用 &sheet=）
   * - gid：分頁數字 ID（用 &gid=，優先於 sheet）
   * - tq：選用 gviz GQL 查詢（如 'select A,B,F'）
   *
   * 注意：
   *   DS-1 — SQL_回廠時間 不可用名稱存取（會 fallback 到錯誤分頁），只能用 gid=657845699。
   *   DS-3 — SQL_派工 是大表（>10MB），用 tq 只投影需要欄位以降低下載量。
   *   年限門檻表 — 尚未建立；抓取失敗時 sheets.js 會使用 YEAR_THRESHOLD_DEFAULTS。
   */
  SHEETS: {
    派工:         { sheet: 'SQL_派工',         tq: 'select A,B,F,H,I,J,O,P' },
    派工全欄:     { sheet: 'SQL_派工' },           // 無 tq 投影；供快照匯出用（含全部 18 欄）
    回廠:         { gid:   657845699 },           // DS-1: 名稱 fallback 到第一分頁
    維修:         { sheet: 'SQL_維修' },
    報廢:         { sheet: 'SQL_報廢' },
    上線量:       { gid:   1445413073 },
    類型清單:     { sheet: '類型清單' },
    品號對照表:   { sheet: '品號對照表' },
    關鍵字對照表: { sheet: '關鍵字對照表' },
    維修分類:     { sheet: '維修分類' },
    年限門檻:     { sheet: '年限門檻表' },        // 待建立；不存在時使用預設值
  },

  /**
   * 建立 gviz CSV URL
   *
   * @param {string|null} sheetName - 分頁名稱（&sheet=）；gid 存在時忽略
   * @param {number|null} gid       - 分頁數字 ID（&gid=）；非 null 時優先使用
   * @param {string} [tq]           - 選用 GQL 查詢字串（如 'select A,B,F,H,I,J,O,P'）
   * @param {string} [sheetIdOverride] - 改讀其他 Sheet（如雲端快照複製出的副本），預設 this.SHEET_ID
   * @returns {string}
   */
  buildUrl(sheetName, gid, tq, sheetIdOverride) {
    const base = `https://docs.google.com/spreadsheets/d/${sheetIdOverride || this.SHEET_ID}/gviz/tq?tqx=out:csv`;
    const sheetParam = (gid != null)
      ? `&gid=${gid}`
      : `&sheet=${encodeURIComponent(sheetName)}`;
    const tqParam = tq ? `&tq=${encodeURIComponent(tq)}` : '';
    return `${base}${sheetParam}${tqParam}`;
  },

  /**
   * SQL_派工 投影欄位（對應欄位字母）：
   *   A = 品項完工年月
   *   B = 品項完工日期
   *   F = 產品大類
   *   H = 替換前品項
   *   I = 替換前品項條碼
   *   J = 替換前進貨日
   *   O = 維護原因
   *   P = 維護細節
   * （實際 header 已用 gviz 驗證，2026-07-17）
   */

  /**
   * 年限門檻預設值：讀不到 年限門檻表 分頁時的 fallback
   * null = 無過保判定（耗材不做過保計算）
   * @type {{ 車機: number, 鏡頭: number, 耗材: null, _default: number }}
   */
  YEAR_THRESHOLD_DEFAULTS: {
    車機:     3,
    鏡頭:     1,
    耗材:     null,
    _default: 1,
  },

  /**
   * 故障原因分類（彙整總覽／詳細明細 故障原因 5 欄），對齊 build_分析總表.py 的 CAR_FAULT_SUM / LENS_FAULT。
   * 最後一項固定為餘數「其他」。
   * @type {{ 車機: string[], 鏡頭: string[] }}
   */
  FAULT_COLS_BY_DEVICE: {
    車機: ['AB點', '失聯', '定位不良', '訊號異常', '其他'],
    鏡頭: ['黑畫面', '進水/模糊', '水波紋', '時有時無', '其他'],
  },
};
