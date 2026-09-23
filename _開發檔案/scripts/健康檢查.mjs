// _開發檔案/scripts/健康檢查.mjs
//
// 依 kit 健康檢查慣例（C:/Users/EupUser/.claude/plugins/cache/my-kit/kit/0.11.0/assets/健康檢查範本.mjs）
// 調整而來——範本原型是「單檔 inline <script>」，本專案是多檔案架構（多個獨立 .js 依序 <script src>
// 載入，無框架無打包器），所以改成：
//   1. 對 js/ 底下每個 .js 檔各自跑 node --check（範本只驗證單一 inline script 區塊）
//   2. getElementById／`$(id)` 別名呼叫的 id 存在性檢查，掃描範圍是 index.html + 所有 .js 檔
//      （本專案大量表格 markup 是 JS 動態注入，宣告點本來就在 .js 檔而非 index.html）；
//      只驗證「字面字串」呼叫，模板字串／變數組出來的 id（如 `${ids.title}`、'x-'+device）
//      本來就無法靜態核對，直接排除，避免誤判成找不到
//   3. 已否決清單.md 裡標 🤖 的做法有沒有被「這次改動」（凍結欄）意外帶進來
//   4. 這三張表的核心物件/函式（App.detail／App.rawtable／App.tablefilter，含欄位開關、
//      拖曳排序、逐欄篩選、本次新增的 applyStickyCols）都還在
//
// 用法：node _開發檔案/scripts/健康檢查.mjs
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // _開發檔案/scripts → 專案根目錄

let fail = 0;
const bad = (m) => { console.log('❌ ' + m); fail++; };
const ok = (m) => console.log('✅ ' + m);

const jsDir = path.join(ROOT, 'js');
const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
const htmlPath = path.join(ROOT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const jsTextByFile = Object.fromEntries(jsFiles.map((f) => [f, fs.readFileSync(path.join(jsDir, f), 'utf8')]));

// ── 1) node --check：js/ 底下每個檔案都跑（本次實際改動的是 tablefilter.js／detail.js／
//    rawtable.js，其餘一併順跑成本很低，防止漏了「改 A 壞 B」）──────────────────────
console.log('== 1) node --check 語法檢查 ==');
for (const f of jsFiles) {
  try {
    execSync(`node --check "${path.join(jsDir, f)}"`, { stdio: 'pipe' });
    ok(`${f} 語法正確`);
  } catch (e) {
    bad(`${f} 語法錯誤：${(e.stderr || e.stdout || e.message).toString().trim()}`);
  }
}

// ── 2) getElementById／$(id) 別名字面呼叫的 id 都要找得到宣告 ──────────────────────
console.log('\n== 2) getElementById／$(id) 目標 id 存在性檢查 ==');
const allText = html + '\n' + Object.values(jsTextByFile).join('\n');

// 宣告來源有兩種寫法，都要涵蓋：
//   a) HTML/樣板字面屬性 id="..."（index.html + 各 .js 檔自己組的 innerHTML 樣板）
//   b) JS 屬性賦值 el.id = '...'（本專案 app.js/auth.js 建立浮動 toast/overlay 慣用寫法）
// 兩種都可能是「靜態字面值」或「樣板變數組出來的動態值」（如 id="cnt-${id}"、
// `list-${id}`）。動態的那種取 `${` 前面那段固定前綴，用「開頭比對」而非完全比對
// 來核對呼叫端——這才是本專案「動態產生大量表格/篩選區塊 id」該用的合理排除方式，
// 而不是整組跳過不查。
const declaredIds = new Set();
const dynamicPrefixes = [];
const collectDeclared = (raw) => {
  const dollarIdx = raw.indexOf('${');
  if (dollarIdx === -1) declaredIds.add(raw);
  else if (dollarIdx > 0) dynamicPrefixes.push(raw.slice(0, dollarIdx));
};
[...allText.matchAll(/id="([^"]*)"/g)].forEach((m) => collectDeclared(m[1]));
[...allText.matchAll(/\.id\s*=\s*(['"`])([^'"`]*)\1/g)].forEach((m) => collectDeclared(m[2]));
const isDeclared = (id) => declaredIds.has(id) || dynamicPrefixes.some((p) => id.startsWith(p));

// 使用：只認字面字串呼叫（document.getElementById('x') 或本專案慣用的 $('x') 別名）；
// 呼叫括號內若不是「單引號字串 + 立刻收尾」，代表是變數／樣板組出來的動態 id（例如
// `$(ids.wrap)`、`document.getElementById('vendor-summary-'+device)`），此規則天生排除，
// 不用另外列清單。
const idCalls = [...allText.matchAll(/(?:document\.getElementById|\$)\(\s*'([^'$]+)'\s*\)/g)].map((m) => m[1]);
const usedIds = [...new Set(idCalls)];
const missingIds = usedIds.filter((id) => !isDeclared(id));
if (missingIds.length) bad('取用但找不到宣告的 id：' + missingIds.join(', '));
else ok(`getElementById／$() 字面 id 呼叫都找得到宣告（共檢查 ${usedIds.length} 個）`);

// ── 3) 已否決清單（見 patterns/已否決清單.md，只比對標 🤖 的幾條）──────────────────
// 這裡只掃「這次改動」牽涉到的三個檔，對應使用者要求「沒有被這次改動意外引入」，
// 不是對整個舊專案做地毯式稽核（report.js 等既有頁面本來就有自己的存檔/編輯功能，
// 混進來比對只會製造跟本次任務無關的雜訊）。
console.log('\n== 3) 已否決做法沒有被這次改動意外引入 ==');
const touchedFiles = ['tablefilter.js', 'detail.js', 'rawtable.js'];
const touchedText = touchedFiles.map((f) => jsTextByFile[f] || '').join('\n') + '\n' + html;
const banned = [
  [/<[^>]+contenteditable="true"/, '行內編輯（contenteditable）'],
  [/on(?:blur|focusout)="[^"]*(?:save|Save|儲存)/, '失焦自動儲存（inline onblur）'],
  [/addEventListener\(\s*['"](?:blur|focusout)['"][^)]*(?:save|Save|儲存)/, '失焦自動儲存（addEventListener）'],
  [/(?:swipe|slide)-(?:row|item|action)/, '清單列左滑（swipe-/slide- class）'],
  [/kanban[^>]*>[\s\S]{0,400}?(?:完成|done-btn|markDone)/, '看板的完成按鈕'],
];
const revived = banned.filter(([re]) => re.test(touchedText));
if (revived.length) bad('出現已否決的做法：' + revived.map(([, w]) => w).join('；'));
else ok('已否決清單（🤖 標記項目）沒有出現在本次改動的檔案裡');

// ── 4) 核心功能沒有被凍結欄改動波及 ────────────────────────────────────────────
console.log('\n== 4) 三張表核心物件／既有功能都還在 ==');
const detailJs = jsTextByFile['detail.js'] || '';
const rawtableJs = jsTextByFile['rawtable.js'] || '';
const tablefilterJs = jsTextByFile['tablefilter.js'] || '';
const coreChecks = [
  [/App\.detail\s*=/, 'App.detail 物件', detailJs],
  [/function makeTable/, 'detail.js 表格控制器 makeTable()', detailJs],
  [/function focusColumns/, 'detail.js focusColumns()（比率表指標 → 分析表欄位聚焦）', detailJs],
  [/renderChips/, 'detail.js 欄位開關/拖曳排序（renderChips）', detailJs],
  [/dragstart.*chip\.classList\.add\('dragging'\)/s, 'detail.js 欄位拖曳排序（dragstart）', detailJs],
  [/col-filter-btn/, 'detail.js 逐欄下拉篩選按鈕', detailJs],
  [/App\.rawtable\s*=/, 'App.rawtable 物件', rawtableJs],
  [/function focusERPAndLogic/, 'rawtable.js focusERPAndLogic()（逆查鎖定）', rawtableJs],
  [/function focusLogic/, 'rawtable.js focusLogic()（逆查鎖定）', rawtableJs],
  [/renderChips/, 'rawtable.js 欄位開關/拖曳排序（renderChips）', rawtableJs],
  [/col-filter-btn/, 'rawtable.js 逐欄下拉篩選按鈕', rawtableJs],
  [/App\.tablefilter\s*=/, 'App.tablefilter 物件', tablefilterJs],
  [/function headerCellHTML/, 'tablefilter.js headerCellHTML()（表頭渲染）', tablefilterJs],
  [/function matches/, 'tablefilter.js matches()（逐欄篩選比對）', tablefilterJs],
  [/function uniqueOptions/, 'tablefilter.js uniqueOptions()（篩選選項）', tablefilterJs],
  [/function downloadCsv/, 'tablefilter.js downloadCsv()（CSV 匯出）', tablefilterJs],
  [/function applyStickyCols/, 'tablefilter.js applyStickyCols()（本次新增：凍結欄）', tablefilterJs],
];
for (const [re, label, src] of coreChecks) {
  if (re.test(src)) ok(`${label} 還在`);
  else bad(`${label} 不見了`);
}

console.log(fail ? `\n🔴 ${fail} 項不通過` : '\n🟢 全部通過');
process.exit(fail ? 1 : 0);
