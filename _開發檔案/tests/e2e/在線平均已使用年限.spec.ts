/**
 * 在線平均已使用年限（規則H）— App.metrics.computeOnlineAge() 純函式單元測試
 *
 * ⚠️ 專案為純前端（無 build 步驟、無 npm/Playwright 依賴，見 _管理/常駐/專案規格.md
 * STACK_RULES），沒有 package.json 也沒有安裝 Playwright，因此本檔案雖沿用規格檔指定的
 * 檔名／路徑（`_開發檔案/tests/e2e/在線平均已使用年限.spec.ts`），但改寫成可直接以
 * `node` 執行的手動驗證腳本，不是真正的 Playwright test（.ts 副檔名僅為與規格檔對齊
 * 命名，內容為純 JS，Node 可直接執行，不需 ts-node/tsc）。
 *
 * 只測 computeOnlineAge() 這個純函式（缺值 fallback／負值排除／分母為0／篩選），
 * 不牽涉登入、Google API、DOM——全部用假資料，不需要真的 OAuth 授權即可驗證邏輯正確。
 *
 * 執行方式：node "_開發檔案/tests/e2e/在線平均已使用年限.spec.ts"
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── 載入 js/metrics.js（純瀏覽器全域寫法，用 vm context 模擬 window）──────────
function loadAppMetrics() {
  const sandbox = {};
  sandbox.window = sandbox; // metrics.js 內 `window.App = window.App || {}` → window === sandbox
  sandbox.console = console;
  vm.createContext(sandbox);
  const filePath = path.join(__dirname, '..', '..', '..', 'js', 'metrics.js');
  const code = fs.readFileSync(filePath, 'utf8');
  vm.runInContext(code, sandbox, { filename: filePath });
  if (!sandbox.App || !sandbox.App.metrics) {
    throw new Error('js/metrics.js 未正確掛載 App.metrics，測試無法繼續');
  }
  return sandbox.App.metrics;
}

const metrics = loadAppMetrics();

// ── 極簡測試工具（無外部依賴）──────────────────────────────────────────────
let passed = 0, failed = 0;

function isCloseOrEqual(actual, expected) {
  if (actual === expected) return true; // 含 null === null
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Math.abs(actual - expected) < 0.05; // 容忍極小的日期/毫秒換算誤差
  }
  return false;
}

function assertEqual(actual, expected, msg) {
  if (isCloseOrEqual(actual, expected)) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg} —— 預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ── 測試資料工具：以「今天」為基準往前/往後推算天數，避免寫死絕對日期 ────────
function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// ============================================================
// 案例一：正常流程（含優先採用「日期」欄、以及「日期依據」欄的 fallback）
// ============================================================
section('案例一：正常流程 — 車機/鏡頭分別取平均，優先採用「日期」欄');
{
  const rows = [
    // 車機 A：直接用「日期」欄，約 1.0 年
    { 條碼: 'A1', 設備類型: '車機', ERP品號: 'E1', 廠商: '廠商甲', 廠牌型號: '型號A', 日期: isoDaysAgo(365), 日期依據: '', 進貨日: '', 安裝日: '' },
    // 車機 B：「日期」欄空 → 依「日期依據」＝安裝日 取值，約 2.0 年
    { 條碼: 'A2', 設備類型: '車機', ERP品號: 'E1', 廠商: '廠商甲', 廠牌型號: '型號A', 日期: '', 日期依據: '安裝日', 進貨日: '', 安裝日: isoDaysAgo(730) },
    // 鏡頭 C：直接用「日期」欄，約 3.0 年
    { 條碼: 'B1', 設備類型: '鏡頭', ERP品號: 'E2', 廠商: '廠商乙', 廠牌型號: '型號B', 日期: isoDaysAgo(365 * 3), 日期依據: '', 進貨日: '', 安裝日: '' },
  ];
  const result = metrics.computeOnlineAge(rows, { 廠商: [], 類型: [], ERP品號: [] });
  assertEqual(result.在線平均已使用年限_車機, 1.5, '車機平均 = (1.0 + 2.0) / 2 = 1.5');
  assertEqual(result.在線平均已使用年限_鏡頭, 3.0, '鏡頭平均 = 3.0（只有一筆）');
}

// ============================================================
// 案例二：邊界條件 — 「日期依據」指向欄位缺值，改試另一欄
// ============================================================
section('案例二：邊界條件 — 「日期依據」指向欄位缺值時改試另一欄');
{
  const rows = [
    // 日期依據=進貨日，但進貨日空 → 改用安裝日（約 1.0 年）
    { 條碼: 'C1', 設備類型: '車機', ERP品號: 'E1', 廠商: '廠商甲', 廠牌型號: '型號A', 日期: '', 日期依據: '進貨日', 進貨日: '', 安裝日: isoDaysAgo(365) },
  ];
  const result = metrics.computeOnlineAge(rows, {});
  assertEqual(result.在線平均已使用年限_車機, 1.0, '日期依據指向的欄位缺值時，改用另一個日期欄位（fallback 成功）');
}

// ============================================================
// 案例三：邊界條件 — 兩個日期欄位都沒有值 → 該筆不計入平均
// ============================================================
section('案例三：邊界條件 — 兩個日期欄位都沒有值');
{
  const rows = [
    { 條碼: 'D1', 設備類型: '車機', ERP品號: 'E1', 廠商: '廠商甲', 廠牌型號: '型號A', 日期: '', 日期依據: '進貨日', 進貨日: '', 安裝日: '' },
    // 混一筆正常值，確認壞資料不會拖垛整體平均值計算出錯（也不會被誤算進分母）
    { 條碼: 'D2', 設備類型: '車機', ERP品號: 'E1', 廠商: '廠商甲', 廠牌型號: '型號A', 日期: isoDaysAgo(365), 日期依據: '', 進貨日: '', 安裝日: '' },
  ];
  const result = metrics.computeOnlineAge(rows, {});
  assertEqual(result.在線平均已使用年限_車機, 1.0, '兩欄皆缺值的那筆不計入分母，平均值只看有效的那一筆');
}

// ============================================================
// 案例四：邊界條件 — 算出負值年限（資料異常，日期在未來）→ 不計入
// ============================================================
section('案例四：邊界條件 — 負值年限（資料異常）不計入平均，也不讓整體算錯');
{
  const rows = [
    // 未來日期 → diff 為負值，應被排除
    { 條碼: 'E1', 設備類型: '車機', ERP品號: 'E1', 廠商: '廠商甲', 廠牌型號: '型號A', 日期: isoDaysAgo(-30), 日期依據: '', 進貨日: '', 安裝日: '' },
    { 條碼: 'E2', 設備類型: '車機', ERP品號: 'E1', 廠商: '廠商甲', 廠牌型號: '型號A', 日期: isoDaysAgo(365 * 2), 日期依據: '', 進貨日: '', 安裝日: '' },
  ];
  const result = metrics.computeOnlineAge(rows, {});
  assertEqual(result.在線平均已使用年限_車機, 2.0, '未來日期（負值年限）被排除，只計入合理的那一筆（2.0 年）');
}

// ============================================================
// 案例五：邊界條件 — 分母為 0（無資料 / 篩選後沒有符合設備 / 全部不可用）→ null，不是 0
// ============================================================
section('案例五：邊界條件 — 分母為 0 時回傳 null，不回傳 0');
{
  // 5a：完全沒有資料
  const emptyResult = metrics.computeOnlineAge([], {});
  assertEqual(emptyResult.在線平均已使用年限_車機, null, '無資料時車機回傳 null（不是 0）');
  assertEqual(emptyResult.在線平均已使用年限_鏡頭, null, '無資料時鏡頭回傳 null（不是 0）');

  // 5b：有車機資料，但日期全部不可用
  const allInvalidResult = metrics.computeOnlineAge([
    { 條碼: 'F1', 設備類型: '車機', ERP品號: 'E1', 廠商: '廠商甲', 廠牌型號: '型號A', 日期: '', 日期依據: '', 進貨日: '', 安裝日: '' },
  ], {});
  assertEqual(allInvalidResult.在線平均已使用年限_車機, null, '設備都有但日期全部不可用時回傳 null（不是 0）');

  // 5c：篩選後沒有符合的設備（篩掉唯一那筆車機）
  const filteredOutResult = metrics.computeOnlineAge([
    { 條碼: 'G1', 設備類型: '車機', ERP品號: 'E1', 廠商: '廠商甲', 廠牌型號: '型號A', 日期: isoDaysAgo(365), 日期依據: '', 進貨日: '', 安裝日: '' },
  ], { 廠商: ['廠商乙'] }); // 篩選條件不符合任何一筆
  assertEqual(filteredOutResult.在線平均已使用年限_車機, null, '篩選後沒有符合的設備時回傳 null（不是 0）');
}

// ============================================================
// 案例六：依廠商/類型/ERP品號篩選 — 只計入符合條件的列
// ============================================================
section('案例六：依廠商/類型/ERP品號篩選後重新計算');
{
  const rows = [
    { 條碼: 'H1', 設備類型: '車機', ERP品號: 'E1', 廠商: '廠商甲', 廠牌型號: '型號A', 日期: isoDaysAgo(365), 日期依據: '', 進貨日: '', 安裝日: '' },
    { 條碼: 'H2', 設備類型: '車機', ERP品號: 'E9', 廠商: '廠商乙', 廠牌型號: '型號Z', 日期: isoDaysAgo(365 * 5), 日期依據: '', 進貨日: '', 安裝日: '' },
  ];
  const byVendor = metrics.computeOnlineAge(rows, { 廠商: ['廠商甲'] });
  assertEqual(byVendor.在線平均已使用年限_車機, 1.0, '依廠商篩選後只計入該廠商的列（1.0 年，排除廠商乙的 5.0 年）');

  const byErp = metrics.computeOnlineAge(rows, { ERP品號: ['E9'] });
  assertEqual(byErp.在線平均已使用年限_車機, 5.0, '依 ERP品號 篩選後只計入該品號的列（5.0 年）');
}

// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`總計：${passed} passed, ${failed} failed`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
