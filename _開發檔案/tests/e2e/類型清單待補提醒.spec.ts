/**
 * 類型清單待補提醒 — App.typeListCheck.check()/render() 單元測試
 *
 * 專案無 npm/Playwright 依賴（見 在線平均已使用年限.spec.ts 的說明），沿用同樣做法：
 * 內容為純 JS、可直接 `node` 執行（.ts 副檔名僅為對齊規格命名）。
 * 只測純函式與渲染輸出字串（用最小假 DOM），不牽涉登入、Google API。
 * 瀏覽器端（展開/收合、分頁切換、手機版）另以 Playwright(Python) 手動驗證，見任務回報。
 *
 * 執行方式：node "_開發檔案/tests/e2e/類型清單待補提醒.spec.ts"
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadTypeListCheck() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const filePath = path.join(__dirname, '..', '..', '..', 'js', 'typelistcheck.js');
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath });
  if (!sandbox.App || !sandbox.App.typeListCheck) throw new Error('js/typelistcheck.js 未掛載 App.typeListCheck');
  return sandbox.App.typeListCheck;
}
const tlc = loadTypeListCheck();

let passed = 0, failed = 0;
function assertEqual(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  OK  ${msg}`); }
  else { failed++; console.log(`  FAIL ${msg} —— 預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`); }
}
const section = (t) => console.log(`\n${t}`);

const on = (type, erp, name, qty) => ({ 設備類型: type, ERP品號: erp, 品名: name, 上線量: String(qty) });
const tl = (erp, type) => ({ ERP品號: erp, 設備類型: type, '廠牌型號(設備類型分類)': 'X', 廠商: 'V' });

section('案例一：找不到／判為其他類型／零量／重複品號／空白');
{
  const raw = {
    上線量: [
      on('車機', 'E1', '正常', 1000),
      on('車機', ' E1 ', '重複不重算', 777),
      on('車機', 'E2', '找不到', 300),
      on('車機', 'E3', '判配件', 100),
      on('車機', 'E4', '零量', 0),
      on('鏡頭', 'C1', '鏡頭找不到', 50),
    ],
    類型清單: [tl('E1', '車機'), tl('E3', '配件'), tl('E3', '車機')],
  };
  const r = tlc.check(raw, '車機');
  assertEqual(r.items.map((i) => i.ERP品號), ['E2', 'E3'], '車機：E2(找不到)、E3(判配件)，降冪，零量 E4 與鏡頭 C1 不列入');
  assertEqual(r.items.map((i) => i.kind), ['miss', 'diff'], '問題種類');
  assertEqual(r.items[1].清單類型, '配件', '判為類型記錄（同品號取類型清單第一筆）');
  assertEqual(r.impact, 400, '影響量=300+100');
  assertEqual(r.total, 1400, '分母=1000+300+100+0（去重後，同品號第二筆不重算）');
  assertEqual(tlc.check(raw, '鏡頭').items.map((i) => i.ERP品號), ['C1'], '鏡頭只看自己');
}

section('案例二：無問題 / 缺資料不拋錯');
{
  const ok = { 上線量: [on('車機', 'E1', 'a', 5)], 類型清單: [tl('E1', '車機')] };
  assertEqual(tlc.check(ok, '車機').items.length, 0, '全部歸好類 → 無問題');
  assertEqual(tlc.check({}, '車機').items.length, 0, 'raw 缺欄位 → 空結果、不拋錯');
}

section('案例三：render 輸出');
{
  const mkEl = () => ({ innerHTML: '', querySelector: () => ({ addEventListener() {}, setAttribute() {} }) });
  const raw = {
    上線量: [on('車機', 'E2', '<script>x</script>', 12000), on('車機', 'E9', 'b', 1)],
    類型清單: [],
  };
  const el = mkEl();
  tlc.render(el, { raw, currentSnap: null }, '車機');
  assertEqual(el.innerHTML.includes('有 <b>2</b> 個'), true, '顯示個數');
  assertEqual(el.innerHTML.includes('約 1.2 萬'), true, '>=1 萬用「約 1.2 萬」');
  assertEqual(el.innerHTML.includes('<script>'), false, '品名已 escape');
  const el2 = mkEl();
  tlc.render(el2, { raw, currentSnap: {} }, '車機');
  assertEqual(el2.innerHTML, '', '載入快照時不顯示');
  const el3 = mkEl();
  tlc.render(el3, { raw: { 上線量: [on('車機', 'E1', 'a', 5)], 類型清單: [tl('E1', '車機')] }, currentSnap: null }, '車機');
  assertEqual(el3.innerHTML, '', '無問題時完全不渲染');
  const el4 = mkEl();
  tlc.render(el4, { raw: { 上線量: [on('車機', 'E1', 'a', 5)], 類型清單: { bad: 1 } }, currentSnap: null }, '車機');
  assertEqual(el4.innerHTML, '', '比對例外時吞掉、不顯示');
}

console.log(`\n${'='.repeat(50)}\n總計：${passed} passed, ${failed} failed\n${'='.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
