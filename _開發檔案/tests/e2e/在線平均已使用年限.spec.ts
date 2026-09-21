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
// 【tester 補測】以下為 tester agent 獨立設計（不重跑 frontend 自己寫的案例），
// 針對 App.metrics.aggregate()/summarizeRows() 新增的「在線平均已使用年限」欄位
// ============================================================

function mkDetailRow(o) {
  return {
    廠商: o.廠商, 廠牌型號: o.類型, ERP品號: o.ERP品號, 替換前品項: o.品名 || 'X',
    回廠狀態: o.回廠狀態 || '已回廠',
    良品: !!o.良品, 不良品: !!o.不良品, 過保: !!o.過保, 未歸類: !!o.未歸類,
    維修分類: o.維修分類 || '', QC: o.QC || '',
    已使用年限: o.已使用年限 != null ? o.已使用年限 : null,
    維護類型: o.維護類型 || '其他',
  };
}
function mkOnlineEnriched(o) {
  return { ERP品號: o.ERP品號, 品名: o.品名 || 'X', 設備類型: o.設備類型, 廠牌型號: o.類型, 廠商: o.廠商, 上線量: o.上線量 };
}

// 案例七：report.js 既有 4 個呼叫點的呼叫方式（不傳 onlineAgeRows/deviceType）不受影響
section('案例七：aggregate() 不傳 onlineAgeRows/deviceType（比照 report.js 既有呼叫點）不拋錯、新欄位=null、舊欄位不變');
{
  const rows = [
    mkDetailRow({ 廠商: '廠商甲', 類型: '型號A', ERP品號: 'E1', 過保: true, 已使用年限: 1.2 }),
    mkDetailRow({ 廠商: '廠商甲', 類型: '型號A', ERP品號: 'E1', 良品: true, QC: '回廠QC' }),
  ];
  const online = [mkOnlineEnriched({ 廠商: '廠商甲', 類型: '型號A', ERP品號: 'E1', 設備類型: '車機', 上線量: 100 })];
  const agg = metrics.aggregate(rows, online, {}, { groupBy: '類型' });
  const e1 = agg.groups[0].rows.find((r) => r.ERP品號 === 'E1');
  assertEqual(e1.在線平均已使用年限, null, '未提供 onlineAgeRows/deviceType 時新欄位為 null（不拋錯）');
  assertEqual(e1.已使用年限, 1.2, '既有「已使用年限」欄位數值不受影響');
  assertEqual(e1.上線量, 100, '既有「上線量」欄位數值不受影響');
}

// 案例八：關鍵回歸 —— 小計/總計必須是個別 ERP品號列 sum/n 重新加總的加權平均，
// 不可簡化成「先算好每個 ERP品號列的平均、再對這些平均值做算術平均」
section('案例八（重點）：小計/總計＝加權平均（sum/n 重新加總），非簡單平均個別 ERP 列的年限值');
{
  const rows = [
    mkDetailRow({ 廠商: '甲', 類型: 'A', ERP品號: 'E1' }),
    mkDetailRow({ 廠商: '甲', 類型: 'A', ERP品號: 'E2' }),
  ];
  const online = [
    mkOnlineEnriched({ 廠商: '甲', 類型: 'A', ERP品號: 'E1', 設備類型: '車機', 上線量: 1 }),
    mkOnlineEnriched({ 廠商: '甲', 類型: 'A', ERP品號: 'E2', 設備類型: '車機', 上線量: 1 }),
  ];
  // E1：9 筆皆 1.0 年 → 平均 1.0；E2：1 筆 11.0 年 → 平均 11.0
  const onlineAgeRows = [
    ...Array.from({ length: 9 }, () => ({ ERP品號: 'E1', 設備類型: '車機', 廠商: '甲', 廠牌型號: 'A', 日期: isoDaysAgo(365), 日期依據: '', 進貨日: '', 安裝日: '' })),
    { ERP品號: 'E2', 設備類型: '車機', 廠商: '甲', 廠牌型號: 'A', 日期: isoDaysAgo(365 * 11), 日期依據: '', 進貨日: '', 安裝日: '' },
  ];
  const agg = metrics.aggregate(rows, online, {}, { groupBy: '類型', onlineAgeRows, deviceType: '車機' });
  const weighted = (9 * 1.0 + 1 * 11.0) / 10; // = 2.0
  const naive = (1.0 + 11.0) / 2; // = 6.0（誤解法，不應是這個值）
  assertEqual(agg.groups[0].subtotal.在線平均已使用年限, weighted, `小計＝加權平均 sum/n＝${weighted}（不是簡單平均 ${naive}）`);
  assertEqual(agg.grandTotal.在線平均已使用年限, weighted, `總計＝加權平均＝${weighted}`);
}

// 案例九：summarizeRows() 對子集重算 = aggregate() 內部一致
section('案例九：summarizeRows() 重算子集結果 = aggregate() 內部 subtotal/grandTotal');
{
  const rows = [
    mkDetailRow({ 廠商: '甲', 類型: 'A', ERP品號: 'E1' }),
    mkDetailRow({ 廠商: '乙', 類型: 'B', ERP品號: 'E3' }),
  ];
  const online = [
    mkOnlineEnriched({ 廠商: '甲', 類型: 'A', ERP品號: 'E1', 設備類型: '車機', 上線量: 5 }),
    mkOnlineEnriched({ 廠商: '乙', 類型: 'B', ERP品號: 'E3', 設備類型: '車機', 上線量: 5 }),
  ];
  const onlineAgeRows = [
    { ERP品號: 'E1', 設備類型: '車機', 廠商: '甲', 廠牌型號: 'A', 日期: isoDaysAgo(365), 日期依據: '', 進貨日: '', 安裝日: '' },
    { ERP品號: 'E3', 設備類型: '車機', 廠商: '乙', 廠牌型號: 'B', 日期: isoDaysAgo(365 * 7), 日期依據: '', 進貨日: '', 安裝日: '' },
  ];
  const agg = metrics.aggregate(rows, online, {}, { groupBy: '類型', onlineAgeRows, deviceType: '車機' });
  const allRows = agg.groups.flatMap((g) => g.rows);
  const recomputed = metrics.summarizeRows(allRows, null);
  assertEqual(recomputed.在線平均已使用年限, agg.grandTotal.在線平均已使用年限, 'summarizeRows(全部ERP列) 重算結果 = grandTotal');
}

// 案例十：deviceType 篩選正確（同 ERP品號下車機/鏡頭列不互相混入）
section('案例十：deviceType 篩選——車機明細不混進鏡頭平均，反之亦然');
{
  const rows = [mkDetailRow({ 廠商: '甲', 類型: 'A', ERP品號: 'E1' })];
  const online = [mkOnlineEnriched({ 廠商: '甲', 類型: 'A', ERP品號: 'E1', 設備類型: '車機', 上線量: 1 })];
  const onlineAgeRows = [
    { ERP品號: 'E1', 設備類型: '車機', 廠商: '甲', 廠牌型號: 'A', 日期: isoDaysAgo(365), 日期依據: '', 進貨日: '', 安裝日: '' },
    { ERP品號: 'E1', 設備類型: '鏡頭', 廠商: '甲', 廠牌型號: 'A', 日期: isoDaysAgo(365 * 10), 日期依據: '', 進貨日: '', 安裝日: '' },
  ];
  const aggCar = metrics.aggregate(rows, online, {}, { groupBy: '類型', onlineAgeRows, deviceType: '車機' });
  assertEqual(aggCar.groups[0].rows[0].在線平均已使用年限, 1.0, 'deviceType=車機 時鏡頭列(10.0年)不混入 → 1.0');
}

// 案例十一：分組完全無符合資料 → null（不是 0）
section('案例十一：ERP品號完全無對應上線明細資料 → null（不是 0）');
{
  const rows = [mkDetailRow({ 廠商: '甲', 類型: 'A', ERP品號: 'E1' })];
  const online = [mkOnlineEnriched({ 廠商: '甲', 類型: 'A', ERP品號: 'E1', 設備類型: '車機', 上線量: 1 })];
  const onlineAgeRows = [{ ERP品號: 'E999', 設備類型: '車機', 廠商: '甲', 廠牌型號: 'A', 日期: isoDaysAgo(365), 日期依據: '', 進貨日: '', 安裝日: '' }];
  const agg = metrics.aggregate(rows, online, {}, { groupBy: '類型', onlineAgeRows, deviceType: '車機' });
  assertEqual(agg.groups[0].rows[0].在線平均已使用年限, null, 'E1 無對應資料 → null（不是 0）');
  assertEqual(agg.grandTotal.在線平均已使用年限, null, '總計也是 null（不是 0）');
}

// 案例十二：既有「已使用年限」(規則E) 欄位邏輯未被改動 —— 獨立交叉核對
section('案例十二：既有「已使用年限」(規則E) 邏輯未受影響（良品/未歸類無值/不回廠皆不計入）');
{
  const rows = [
    mkDetailRow({ 廠商: '甲', 類型: 'A', ERP品號: 'E1', 良品: true, 已使用年限: 99 }),
    mkDetailRow({ 廠商: '甲', 類型: 'A', ERP品號: 'E1', 不良品: true, 已使用年限: 2.5 }),
    mkDetailRow({ 廠商: '甲', 類型: 'A', ERP品號: 'E1', 過保: true, 已使用年限: 3.5 }),
    mkDetailRow({ 廠商: '甲', 類型: 'A', ERP品號: 'E1', 未歸類: true, 已使用年限: null }),
    mkDetailRow({ 廠商: '甲', 類型: 'A', ERP品號: 'E1', 不良品: true, 已使用年限: 999, 回廠狀態: '不回廠' }),
  ];
  const online = [mkOnlineEnriched({ 廠商: '甲', 類型: 'A', ERP品號: 'E1', 設備類型: '車機', 上線量: 10 })];
  const agg = metrics.aggregate(rows, online, {}, { groupBy: '類型' });
  assertEqual(agg.groups[0].rows[0].已使用年限, 3.0, '已使用年限=(2.5+3.5)/2=3.0（良品/未歸類無值/不回廠皆不計入分母）');
}

// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`總計：${passed} passed, ${failed} failed`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
