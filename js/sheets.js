/**
 * js/sheets.js — gviz CSV 抓取與解析層
 *
 * 掛載 App.sheets 到全域命名空間。
 * 依賴（需先以 <script> 載入）：
 *   1. js/config.js  → App.config
 *   2. PapaParse CDN → 全域 Papa
 *
 * 所有 key 保留 Sheet 中文欄名（如 row['替換前品項條碼']），避免翻譯造成對照困難。
 */
window.App = window.App || {};

App.sheets = (() => {
  /** 抓取失敗或 Sheet 未公開時的統一錯誤訊息 */
  const ERR_PRIVATE =
    '請先將來源 Google Sheet 設為「知道連結的人可檢視」後重試';

  // ─────────────────────────────────────────────────
  // 內部工具
  // ─────────────────────────────────────────────────

  /**
   * 依 SHEETS 設定物件建立 URL
   * @param {string} key - App.config.SHEETS 的 key（如 '派工'）
   * @param {string} [sheetIdOverride] - 改讀其他 Sheet（雲端快照複製出的副本）
   * @returns {string}
   */
  function urlFor(key, sheetIdOverride) {
    const s = App.config.SHEETS[key];
    return App.config.buildUrl(s.sheet ?? null, s.gid ?? null, s.tq, sheetIdOverride);
  }

  /**
   * 以 fetch + PapaParse 抓取 gviz CSV 並解析成「陣列 of 列物件」。
   * key 為 Sheet 標題列欄名（中文），值為字串。
   *
   * @param {string} url
   * @param {{ optional?: boolean }} [opts]
   *   optional=true：失敗（網路錯誤/401/403/HTML 登入頁）時靜默回空陣列，不丟錯
   * @returns {Promise<Array<Object>>}
   */
  async function fetchSheet(url, { optional = false } = {}) {
    let response;

    try {
      response = await fetch(url);
    } catch (networkErr) {
      // 網路錯誤（CORS、離線等）
      if (optional) return [];
      throw new Error(ERR_PRIVATE);
    }

    // DS-2：私有 Sheet → 401 / 403
    if (response.status === 401 || response.status === 403) {
      if (optional) return [];
      throw new Error(ERR_PRIVATE);
    }

    if (!response.ok) {
      if (optional) return [];
      throw new Error(`資料抓取失敗（HTTP ${response.status}）。${ERR_PRIVATE}`);
    }

    const text = await response.text();

    // DS-2：gviz 對私有 Sheet 有時回 HTML 登入頁而非 401
    if (text.trimStart().startsWith('<')) {
      if (optional) return [];
      throw new Error(ERR_PRIVATE);
    }

    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => resolve(data),
        error: (err) => {
          if (optional) {
            resolve([]);
          } else {
            reject(new Error(`CSV 解析失敗：${err.message}`));
          }
        },
      });
    });
  }

  // ─────────────────────────────────────────────────
  // 年限門檻表（特殊處理：分頁尚未建立）
  // ─────────────────────────────────────────────────

  /**
   * 抓「年限門檻表」分頁。
   *
   * 該分頁尚未建立時，gviz 的 &sheet= 存取會 fallback 到第一個分頁（類型清單），
   * 導致回傳錯誤資料。偵測方式：正確的年限門檻表第一列應有 '年限門檻' key；
   * 若沒有，判定為 fallback，回空陣列，讓上層使用 App.config.YEAR_THRESHOLD_DEFAULTS。
   *
   * @returns {Promise<Array<Object>>}
   */
  async function load年限門檻(sheetIdOverride) {
    const url = urlFor('年限門檻', sheetIdOverride);
    const rows = await fetchSheet(url, { optional: true });

    if (
      rows.length === 0 ||
      !Object.prototype.hasOwnProperty.call(rows[0], '年限門檻')
    ) {
      return [];   // 分頁不存在，上層 fallback 到預設值
    }

    return rows;
  }

  // ─────────────────────────────────────────────────
  // 進貨表（本機靜態資料：js/data/purchase_dates.json）
  // ─────────────────────────────────────────────────

  /**
   * 讀取預先轉換好的「條碼 → 最舊進貨日」對照表（Map<條碼, 'YYYY-MM-DD'>）。
   * 來源：桌面「2026進貨0728_所有條碼.XLSX」（單據名稱＝產品進貨單，去重取最舊單據日期），
   * 經 scripts/build_purchase_dates.py 一次性轉換而成。此為進貨日的主要來源，
   * 找不到時由 transform.js 退回舊有 Google Sheets 進貨日欄位（派工/回廠/維修/報廢）。
   * 讀取失敗（檔案不存在等）時靜默回空物件，不影響其餘功能。
   * @returns {Promise<Object<string,string>>}
   */
  async function load進貨表() {
    try {
      const res = await fetch('js/data/purchase_dates.json');
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  }

  // ─────────────────────────────────────────────────
  // 車機鏡頭上線明細（私有 Sheet，OAuth + Sheets API v4，非 gviz CSV）
  // ─────────────────────────────────────────────────

  /** 私有 Sheet「車機鏡頭上線明細」的範圍（只取 A:I，不含 J:M 車代/客代/客戶名稱/機種）。
   *  試算表 ID 集中在 App.config.ONLINE_DETAIL_SHEET_ID（js/report.js 匯出快照也共用同一個常數）。*/
  const ONLINE_DETAIL_RANGE = "'車機鏡頭上線明細'!A:I";

  /**
   * 把 Sheets API v4 values.get 回傳的二維陣列（第一列為標題）轉成
   * 跟 fetchSheet() 一致的「陣列 of 列物件」格式。
   * 各列長度不一（Sheets API 尾端空白 cell 會被省略）時，缺的欄位補為 ''。
   * @param {Array<Array<string>>} values
   * @returns {Array<Object>}
   */
  function valuesToRows(values) {
    if (!values || values.length === 0) return [];
    const headers = values[0].map((h) => String(h || '').trim());
    return values.slice(1).map((row) => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i] !== undefined ? row[i] : ''; });
      return obj;
    });
  }

  /**
   * 呼叫 Sheets API v4 spreadsheets.values.get，帶 OAuth Bearer token。
   * 授權失敗（401/403）與網路/HTTP 錯誤都會丟出附 code 的 Error，供呼叫端區分：
   *   code='SHEETS_AUTH_REQUIRED' → 授權問題（驅動 KPI 卡「無法載入，點選重試」）
   *   code='NETWORK_ERROR' / 'FETCH_ERROR' → 其他失敗
   * @param {string} spreadsheetId
   * @param {string} range
   * @param {string} token - App.auth.getSheetsToken() 取得的 access token
   * @returns {Promise<Array<Object>>}
   */
  async function fetchSheetsApiValues(spreadsheetId, range, token) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    let response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (networkErr) {
      const err = new Error('讀取「車機鏡頭上線明細」失敗（網路錯誤）');
      err.code = 'NETWORK_ERROR';
      throw err;
    }
    if (response.status === 401 || response.status === 403) {
      const err = new Error('讀取「車機鏡頭上線明細」授權失敗或已過期，請重試');
      err.code = 'SHEETS_AUTH_REQUIRED';
      throw err;
    }
    if (!response.ok) {
      const err = new Error(`讀取「車機鏡頭上線明細」失敗（HTTP ${response.status}）`);
      err.code = 'FETCH_ERROR';
      throw err;
    }
    const data = await response.json();
    return valuesToRows(data.values);
  }

  /**
   * 讀取私有 Sheet「車機鏡頭上線明細」（OAuth，非既有 gviz CSV 讀法）。
   * 只取 A:I 欄（條碼/設備類型/產品類別/ERP品號/品名/進貨日/安裝日/日期/日期依據），
   * 不含 J:M（車代/客代/客戶名稱/機種），減少回應大小、也避免不必要地經手客戶資訊。
   *
   * 授權問題（尚未取得 token／token 過期且背景換發失敗）會在 App.auth.getSheetsToken()
   * 這一步就 reject（err.code='SHEETS_AUTH_REQUIRED'），一併往上丟給呼叫端。
   * @returns {Promise<Array<Object>>} key：條碼/設備類型/產品類別/ERP品號/品名/進貨日/安裝日/日期/日期依據
   */
  async function loadOnlineDetail() {
    const token = await App.auth.getSheetsToken();
    return fetchSheetsApiValues(App.config.ONLINE_DETAIL_SHEET_ID, ONLINE_DETAIL_RANGE, token);
  }

  // ─────────────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────────────

  /**
   * 平行抓取所有分頁，回傳資料物件。
   *
   * 回傳結構：
   * ```
   * {
   *   派工:         Object[],  // key: 品項完工年月, 品項完工日期, 產品大類, 替換前品項, 替換前品項條碼, 替換前進貨日, 維護原因, 維護細節
   *   回廠:         Object[],  // key: BF_ID, 回廠條碼, 回廠原因, 回廠狀態, 回廠時間, 進貨日
   *   維修:         Object[],  // key: 輸入年月, 輸入時間, 產品名稱, 條碼, 完成原因, 進貨日
   *   報廢:         Object[],  // key: 條碼, 產品名稱, 報廢單狀態, 報廢原因, 進貨日, 產品類型
   *   上線量:       Object[],  // key: 產品類別, ERP品號, 品名, 上線量
   *   類型清單:     Object[],  // key: 設備類型, 廠牌型號(設備類型分類), ERP品號, 替換前品項, 廠商, 室內外鏡
   *   品號對照表:   Object[],  // key: 品號, 品名, 品號開頭, 主供應商名稱
   *   關鍵字對照表: Object[],  // key: 優先序, 關鍵字, 維護類型
   *   維修分類:     Object[],  // key: 維修分類
   *   年限門檻:     Object[],  // key: 設備類型, 年限門檻（分頁未建立時為空陣列）
   *   進貨表:       Object<string,string>,  // Map<條碼, 'YYYY-MM-DD'>，本機靜態檔（進貨日主要來源）
   * }
   * ```
   *
   * 注意：
   * - 年限門檻 為空陣列時，請使用 App.config.YEAR_THRESHOLD_DEFAULTS 作 fallback。
   * - 部分分頁（上線量、類型清單等）CSV 有尾端空白欄，PapaParse 會解析為 '' key，
   *   transform.js 只存取有名稱的欄位，不受影響。
   * - 抓取失敗（Sheet 未公開）時會丟出含提示文字的 Error，請在呼叫端 try/catch 顯示給使用者。
   *
   * @param {string} [sheetIdOverride] - 改讀其他 Sheet（如雲端快照複製出的副本），預設讀來源 Sheet
   * @returns {Promise<{
   *   派工: Object[],
   *   回廠: Object[],
   *   維修: Object[],
   *   報廢: Object[],
   *   上線量: Object[],
   *   類型清單: Object[],
   *   品號對照表: Object[],
   *   關鍵字對照表: Object[],
   *   維修分類: Object[],
   *   年限門檻: Object[],
   * }>}
   */
  async function loadAll(sheetIdOverride) {
    const [
      派工, 回廠, 維修, 報廢, 上線量,
      類型清單, 品號對照表, 關鍵字對照表, 維修分類, 年限門檻, 進貨表,
    ] = await Promise.all([
      fetchSheet(urlFor('派工', sheetIdOverride)),
      fetchSheet(urlFor('回廠', sheetIdOverride)),
      fetchSheet(urlFor('維修', sheetIdOverride)),
      fetchSheet(urlFor('報廢', sheetIdOverride)),
      fetchSheet(urlFor('上線量', sheetIdOverride)),
      fetchSheet(urlFor('類型清單', sheetIdOverride)),
      fetchSheet(urlFor('品號對照表', sheetIdOverride)),
      fetchSheet(urlFor('關鍵字對照表', sheetIdOverride)),
      fetchSheet(urlFor('維修分類', sheetIdOverride)),
      load年限門檻(sheetIdOverride),
      load進貨表(),
    ]);

    return {
      派工, 回廠, 維修, 報廢, 上線量,
      類型清單, 品號對照表, 關鍵字對照表, 維修分類, 年限門檻, 進貨表,
    };
  }

  /**
   * 抓取 SQL_派工 全欄（無 tq 投影，含全部 18 欄）。
   * 僅供快照匯出使用（完整原始分頁備份），平常瀏覽仍用 loadAll() 的投影版以維持效能。
   * @param {string} [sheetIdOverride]
   * @returns {Promise<Array<Object>>}
   */
  function fetchFullDispatch(sheetIdOverride) {
    return fetchSheet(urlFor('派工全欄', sheetIdOverride));
  }

  return {
    /** 抓取並解析單一 gviz CSV URL（可重用於臨時查詢）*/
    fetchSheet,
    /** 平行抓取所有分頁（主要入口）*/
    loadAll,
    /** 抓取 SQL_派工 全欄（供快照匯出）*/
    fetchFullDispatch,
    /** 讀取私有 Sheet「車機鏡頭上線明細」（OAuth + Sheets API v4，供「在線平均已使用年限」KPI 用）*/
    loadOnlineDetail,
  };
})();
