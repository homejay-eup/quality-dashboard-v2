# AI OS 架構範本 — 使用說明書

> **本文件為人類操作手冊**（環境安裝、腳本指令、新建/重構流程）。
> AI 行為規則、工作流程邏輯、Context 預算規則 → 見根目錄 `CLAUDE.md`。

> 本文件是這個範本的完整操作手冊。開新專案或進行重構前必讀。

---

## 這個範本是什麼

AI OS 架構是一個**主 Agent + 多子 Agent 的 Claude Code 協作範本**，核心是四條防「改壞東西 / 謊報完成」的原則，加上讓 AI 有地圖、不失智、少雜訊的三項支撐工具。

**適合**：需要多次迭代、有資料層＋介面層、你想放手讓 AI 執行但保留關鍵決策權的專案。
**不適合**：一次性腳本、純靜態頁、200 行內的小工具——這套流程的 overhead 不划算。

### 概念層：四條核心原則（實際執行規則見 `CLAUDE.md`）

| 原則 | 防什麼 |
|---|---|
| 一、改 A 不壞 B | 改到共用的程式碼、把別處默默弄壞 → 先用 CodeGraph 查「這一改會波及哪些地方」|
| 二、不改需求外的 C | 「順手優化」了沒討論過的東西 → 動工前先講好「這次只能改哪些檔」，收工時逐一比對 |
| 三、改 A 不忘同步 B | 同一條規則寫在很多處，改一處、其他變矛盾 → 判準集中在單一來源，改完全庫搜舊字串 |
| 四、驗證過才能說完成 | 沒跑測試就說「好了」→ 系統在 `git commit` 前擋下來（只擋「沒跑過」的；「跑了沒過」另有規則管）|

### 支撐工具

| 工具 | 作用 |
|---|---|
| CLAUDE.md + CodeGraph | AI 的地圖：專案長什麼樣、哪裡不能動、誰依賴誰 |
| Context 預算規則 | 避免 context 快滿時失智，用可查證的代理指標強制拆任務 |
| RTK | 過濾 CLI 雜訊，節省 60-90% context 用量 |

---

## 🖥️ 新環境前置安裝（換新電腦 / 新人必讀）

> 以下工具分為「所有技術棧必裝」與「依技術棧追加安裝」兩類。全部安裝完畢再開始使用範本。

> ⚠️ **目前僅支援 Windows**：原則四閘門（擋未驗證的 commit、擋 `git push`）是 PowerShell 腳本，在 Mac／Linux／WSL 不會執行且不會報錯。非 Windows 環境要自己在每次 commit 前確認驗證跑過、push 前確認已獲授權。

### 必裝工具清單（所有技術棧）

| 工具 | 用途 | 安裝方式 |
|---|---|---|
| **Claude Code** | 主要 AI 開發環境 | 見下方 Step A |
| **Node.js（v18+）** | 執行 Claude Code、CodeGraph（技術棧無關，必裝）| [nodejs.org](https://nodejs.org) 下載 LTS 版 |
| **Git** | 版本控制 | [git-scm.com](https://git-scm.com) |
| **RTK** | CLI 雜訊過濾（省 60-90% Token）| 見下方 Step B |
| **CodeGraph** | 本地代碼知識圖譜 MCP | 見下方 Step C |

### 依技術棧追加安裝

| 技術棧 | 工具 | 用途 | 安裝方式 |
|---|---|---|---|
| `nextjs` | — | Node.js 已涵蓋所有需求 | — |
| `python` | **Python 3.10+** | 執行 Python 程式 | [python.org](https://www.python.org) 下載，安裝時勾選「Add to PATH」|
| `python` | **pip / venv** | 套件管理與虛擬環境 | Python 安裝包內建，無需額外安裝 |
| `nextjs` + Supabase | Supabase CLI | 本地 DB 開發 | `npm install -g supabase` |

---

### Step A：安裝 Claude Code

```powershell
# 需要先安裝 Node.js
npm install -g @anthropic-ai/claude-code

# 驗證
claude --version
```

首次執行 `claude` 會引導登入 Anthropic 帳號並完成授權。

---

### Step B：安裝 RTK（Rust Token Killer）

```powershell
# 1. 下載 Windows binary（v0.42.0）
$url = "https://github.com/rtk-ai/rtk/releases/download/v0.42.0/rtk-x86_64-pc-windows-msvc.zip"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\rtk.zip" -UseBasicParsing
Expand-Archive -Path "$env:TEMP\rtk.zip" -DestinationPath "$env:USERPROFILE\.local\bin" -Force

# 2. 確認 ~/.local/bin 在 PATH 中
# 若顯示 "PATH already contains"，跳過
$binPath = "$env:USERPROFILE\.local\bin"
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($currentPath -split ";" | Where-Object { $_ -eq $binPath })) {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$binPath", "User")
    Write-Host "已加入 PATH，請重新開啟終端機"
}

# 3. 驗證
rtk --version   # 有版本號輸出即可（範例 URL 是 v0.42.0，實際請用最新版）
```

> ⚠️ **版本注意**：請至 [github.com/rtk-ai/rtk/releases](https://github.com/rtk-ai/rtk/releases) 確認最新版號，將上方 URL 的 `v0.42.0` 替換為最新版。
> ⚠️ **名稱衝突**：若 `rtk --version` 顯示的不是這個工具（可能裝到同名的另一套套件），確認 `which rtk`／`Get-Command rtk` 指向的是上面下載的 binary，而不是其他來源。

RTK 的 Claude Code Hook 已寫入此範本的 `.claude/settings.json`，無需額外設定。

---

### Step C：安裝 CodeGraph

```bash
# 全域安裝（一次即可，所有專案共用）
npm install -g @colbymchenry/codegraph

# 驗證
codegraph --version
```

CodeGraph 的 MCP 設定已寫入此範本的 **`.mcp.json`（專案根目錄）**，無需額外設定。
> **驗證**：在專案內輸入 `/mcp`，codegraph 應出現在清單。

**每個新專案**在 `git init` 後需執行一次：
```bash
codegraph init -i   # 建立該專案的本地索引
```

---

### Step D：驗證整體環境

**所有技術棧（必驗）：**
```powershell
node --version      # v18.0.0 以上
git --version       # git version 2.x.x
claude --version    # 有版本號即可
rtk --version       # 有版本號即可
codegraph --version # 有版本號即可
```

**Python stack 額外驗證：**
```powershell
python --version    # Python 3.10.0 以上
pip --version       # pip 23.x 以上
```

全部有回應即可開始使用範本。

---

### 選配工具（按需安裝）

| 工具 | 用途 | 安裝指令 |
|---|---|---|
| Understand Anything | 重構亂專案時的視覺探索（一次性）| `npx understand-anything`（無需預先安裝）|

---

## 使用情境 A：開新專案

> **建議做法：手動複製**。直接複製範本資料夾比跑腳本更可靠——結構保證一致，沒有腳本 bug 的風險。

### Step 1：複製範本資料夾

在 Windows 檔案總管：
1. 複製整個「`Web App for Develop - AI OS`」資料夾
2. 貼到你想放的位置（例如 `C:\Users\jay10\Desktop`）
3. 改名為你的專案名稱（例如 `my-web-app`）

### Step 2：建立程式碼層（範例：Next.js web）

> 以下指令是 web 層的範例（Next.js）。實際技術棧在開案對話中決定，由 Claude 依 STACK_RULES 執行對應的初始化；Python 工具層則改用 venv 等對應流程。

> **通常不需要手動執行**：在範本資料夾討論完系統規格後，直接告訴 Claude「開始建專案，放在 `C:\xxx\專案名稱`」，Claude 會自己讀這份 README 並執行以下指令。

若需要手動執行，進入剛複製的專案資料夾，跑：

```powershell
# 在專案根目錄執行（不是在 _開發檔案/ 裡）
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-git
```

> `.` 代表在當前目錄初始化，不另建子資料夾。

這一步在你的專案資料夾內建立：`src/`、`public/`、`package.json`、`next.config.*`（新版為 `.ts`，舊版 `.js`）、`tsconfig.json`

### Step 3：建立 CodeGraph 索引

```bash
codegraph init -i
```

CodeGraph 掃描整個專案，建立代碼依賴索引。之後 Claude 查詢依賴時直接呼叫，不用盲搜。

### Step 4：git 初始化

> ⚠️ **先砍掉從範本帶過來的 `.git`**——Step 1 是整包複製資料夾，會一起複製範本自己的 commit 歷史（範本演進史）與分支。新專案不該繼承這些。

```bash
rm -rf .git            # 移除範本的歷史（PowerShell：Remove-Item -Recurse -Force .git）
git init               # 新專案的乾淨 repo（預設分支名可用 git init -b main）
# 應 commit 清單的單一來源是 _管理/SOP/環境與版控.md 第一節「應 commit」；下方為 Next.js 範例
git add CLAUDE.md README_範本使用說明.md .claude .mcp.json .gitignore _管理 _開發檔案 .github playwright.config.ts src package.json tsconfig.json
git commit -m "chore: init AI OS 架構範本"
```

> ⚠️ **三個容易漏、漏了會靜默失效的檔**：
> - `.mcp.json` — 沒進 repo 則 CodeGraph MCP 不會載入
> - `.github/` — 沒進 repo 則 CI 永遠不會跑（但文件宣稱它在保護 main）
> - `playwright.config.ts` — 沒進 repo 則 `npx playwright test` 找不到 testDir
>
> 框架設定檔依實際產出調整（新版 `create-next-app` 產出的是 `next.config.ts` 而非 `.js`）。`git add` 前先跑 `git status` 確認 `.env*` 與 `_secrets/` **沒有出現在待追蹤清單**。

### Step 5：填寫專案規格

產品與技術規格放在 `_管理/常駐/專案規格.md`（**不是** CLAUDE.md——CLAUDE.md 只放 AI 行為規則）。**通常不需要手動填**：在範本資料夾跟 Claude 討論完規格後，Claude 會把欄位寫進去，STACK_RULES 區塊由 **Claude 以自身知識填入**（若你有 CoreBrain 知識庫可選用參考，沒有也能正常運作）。需要時可自行補：

```
- 產品名稱：← 專案名稱
- 核心功能一句話描述：
- 目標使用者：
- 技術架構（前端 Web／行動 APP／資料庫後端／部署平台）：
- 規範與約定 → 不要動的東西：← 禁區（如：型別契約檔，不可隨意改）
- 技術棧規範（STACK_RULES）：← 由 Claude 以自身知識填入（若有 CoreBrain 可選用參考）
- CoreBrain 路徑（選填）：← 有跨專案知識庫才填，留空則啟動行為自動跳過
```

### Step 6：第一次對話啟動語

開啟新專案的 Claude Code，說：

> 「這是新專案，請讀取 CLAUDE.md 和 _管理/常駐/專案規格.md，我要開始討論 [功能名稱]。」

### Step 7：開案後，日常怎麼跟 Claude 互動

開案完成、進入實際開發功能後，你會遇到以下幾種情況，都是**系統在保護你，不是壞掉了**：

- **Claude 現在大多數時候會自主判斷、直接執行，只有遇到這些情況才會停下來問你**：技術選型（例如要換資料庫、加一個新的核心服務）、要推翻已經決定過的技術/架構決定、或任務本身涉及資料庫結構變更、破壞性 migration（刪欄位/刪表）、正式環境部署、金流、安全性設計、`git push` 這類高風險操作。
- **另有一個只有你能授權的開關 `[skip-verify]`**：它會讓 Claude 跳過「驗證過才能 commit」的品質閘門。Claude **不會自己加**——只有你明確指示時才用，每次都會留下紀錄。你平常不需要用到它。
- **其餘情況，Claude 動手前會先用一句話說明它理解的目標**（例如「我理解接下來要做的是讓使用者能上傳照片」），你沒有意見就會直接繼續做，不需要你明確回覆「可以」；如果方向理解錯了，隨時可以立刻糾正。
- **你有時會看到 Claude 說「被擋下來，需要先跑驗證」**——這是內建的品質檢查，代表它想在測試/檢查通過前直接送出變更，系統攔住了。不用緊張，Claude 會自己重新跑驗證再繼續。
- **每完成 10 個功能左右，Claude 會問你要不要開新對話**——這是為了避免對話太長讓它「變笨」，直接回答「繼續」或「開新對話」都可以。
- **`_管理/開案確認.md` 這類表單不需要你自己去開檔案填**——Claude 會在討論過程中幫你把答案寫進去，你只需要用一般文字回答它的問題。
- **預設情況下，從需求到 commit 你不會逐次看到程式碼 diff**——Claude 會自己委派、驗證、commit。想要每一步都先看過再放行，開案時說一聲。
- **每次跑指令（`git status`、`npm run build` 等）會跳確認**——開案後可跟 Claude 說「用 `/fewer-permission-prompts` 建 allowlist」，之後常見唯讀指令就不再逐次問。

簡單說：多數時候 Claude 會自主判斷、直接執行，並在動手前用一句話讓你知道方向；只在紅線情況或需要你決定產品方向、技術選型時才會明確停下來問你。你不需要自己去讀或改任何 `.md` 檔案。

---

## 使用情境 B：重構既有亂專案

重構是「疊加在既有 repo 上」的工作，已抽成獨立的**重構工具包（Refactor Kit）**，不放在主範本裡（綠地新案用不到，留著只是負重）。

**工具包位置（本專案所有檔案引用 Refactor Kit 時的單一來源，換電腦或搬移只改這裡）**：
`{本範本資料夾的同層}\Refactor Kit - 重構工具包`
（目前實際路徑：`C:\Users\jay10\Desktop\Refactor Kit - 重構工具包`；建議把本範本與工具包收進同一個上層夾，方便一起備份/同步。）

用法（詳見該資料夾的 `README.md`）：

1. 先照「使用情境 A」把本範本複製進要重構的亂專案根目錄（`.claude`、`_管理`、`CLAUDE.md`、`_開發檔案`）。
2. 把工具包的 `explorer.md` 放進該專案的 `.claude/agents/`，`refactor-playbook.md` 放進 `_管理/`。
3.（可選）跑 `npx understand-anything` 產出視覺地圖，先看整體架構。
4. 跑 `codegraph init -i` 建立依賴索引。
5. 對 Claude 說：「進入重構模式，先讀 `_管理/refactor-playbook.md`，委派 explorer 執行 Phase 0 探索，專案根目錄是 `[路徑]`。」

之後 Claude 走 Phase 0（探索）→ 1（規劃）→ 2（分階段遷移）→ 3（驗證）。實際遷移由本範本的通用 agent（frontend／data／tester／reviewer）執行，所以必須先複製主範本。

---

## 目錄結構說明

> 逐檔用途的完整清單在 `CLAUDE.md`「檔案地圖」（單一來源）。這裡只講**分層邏輯**，方便你建立心智模型。

```
AI OS 架構範本/
├── CLAUDE.md                  AI 行為規則（每次對話自動載入）
├── README_範本使用說明.md      ← 本文件（人類操作手冊）
├── .gitignore  .mcp.json      版控排除／專案層 MCP 定義（都必須進 repo）
├── playwright.config.ts       Playwright 設定
├── .claude/
│   ├── settings.json          Hooks（RTK／原則四閘門）＋ 自動核准專案 MCP
│   ├── agents/                子 Agent：frontend／data／tester／reviewer（英文檔名是 Claude Code 規定）
│   └── skills/brainstorming/  /brainstorming 設計對話流程
├── _管理/                     ← 所有管理文件；角色靠「所在資料夾」決定（見 CLAUDE.md 檔案命名規範）
│   ├── 常駐/                  每次對話啟動時全部讀：此次任務／專案規格／方案紀錄／領域詞彙／踩坑記錄
│   ├── SOP/                   觸發時才讀：大型任務／環境與版控／技術選型呈現／範本設計說明
│   ├── 範本/                  空白格式範本（永遠不直接填）：功能規格範本／任務分解範本／任務報告範本
│   ├── 開案確認.md            開案閘門（一次性填寫）
│   ├── specs/                 各功能的規格與設計文件（{功能名}.md／{功能名}-設計.md）
│   └── 任務報告/              大型任務每子任務一個進度報告檔
├── _開發檔案/
│   ├── scripts/hooks/         verify-gate.ps1／mark-verify.ps1（⚠️ 須存 UTF-8 with BOM）
│   └── tests/e2e/             Playwright 測試腳本存放處
└── .github/workflows/test.yml CI：push main 自動跑 Playwright
```

> **範本沒有 CHANGELOG。** 範本自身的演進歷史只看 `git log`。

---

## 常見問題

**Q：每次開新對話都要重新說明嗎？**
A：不用。CLAUDE.md 會在每次對話開始時自動載入。但要告知「目前要做什麼」（任務類型）。

**Q：CodeGraph 索引多久更新一次？**
A：自動監聽檔案變動，有修改就即時更新，不需手動執行。

**Q：Understand Anything 需要每次重跑嗎？**
A：不需要。只在「第一次進入陌生專案」時跑一次。後續改動用 CodeGraph 即時查詢即可。

**Q：Context 快滿了怎麼辦？**
A：看到 Context 指示器達到 **70%** 時開新對話（不是 50%——本範本啟動 overhead 約 30%，50% 切換會讓每個對話只能做很少的事）。在新對話第一句話貼：「繼續任務：[任務名稱]，目前進度：[上次結束的步驟]，相關檔案：[路徑列表]」

---

## 更新紀錄

範本本身的工程決策與缺陷修復歷史**只記在 git commit message**（`git log` 查看）——不另外維護 CHANGELOG 檔。v3.19 之前的歷史仍可從 git 取回（`git show <舊 commit>:CHANGELOG.md`）。

*建立日期：2026-06-01 | 支援模式：新建（重構改用獨立 Refactor Kit）*
