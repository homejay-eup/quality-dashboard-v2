# PreToolUse hook：git commit 前檢查「程式碼變更是否已驗證」
#
# 「原則四（Evidence over claims）」的技術層閘門。
# 附帶：攔截 git push（須人類授權，見 CLAUDE.md 工作範圍）。
#
# ── 設計原則（動手改前務必先讀）──────────────────────────────
# 1. 只擋「沒跑過驗證」，不擋「跑了但沒過」
# 2. 依 staged 內容判斷，不用單純時間比對 → 純文件/設定 commit 天然放行
# 3. fail-open：任何無法判斷的情況一律放行（教訓：v3.1 修復項 A）
# 4. 逃生門 [skip-verify] 留痕；⚠️ 僅使用者可指示，AI 不得自行加
#
# ── v3.13 補洞（第三輪稽核實測發現，改動前先看這段）──────────
# B-1 `git commit -am` 繞過：暫存發生在 commit 當下，PreToolUse 時 index 是空的
#      → 偵測 -a/-am 旗標，改用工作區 diff 判斷
# B-2 cwd 非專案根 → 相對路徑解析失敗 → 靜默 fail-open
#      → 開頭 Set-Location 到 repo 根
# B-3 `npm run build && git commit` 必被誤擋（PreToolUse 在整串執行前判斷）
#      → 同一指令串已含驗證指令則放行
# B-5 `git -C <path> commit` / `git -c k=v commit` 繞過 → 放寬 regex
# B-6 驗證→stage→又動工作區：commit 的是已驗證的 staged 版本卻被擋
#      → 檔案已 dirty 時改用 index mtime（＝該快照的建立時間）
# B-7 純刪除的程式碼檔完全不受檢查 → 刪除檔改用 index mtime 納入判斷
#
# ── v3.14 補洞（首次真實專案實戰測試發現，2026-07-30）──────────
# C-1 任何在 git 前面加前綴指令的 wrapper（如 Windows 版 RTK 對含非 ASCII
#     分支名會崩潰，使用者被迫改用 `rtk proxy git commit ...`）會讓 git
#     不再是指令開頭或緊跟 ;/&/| 之後 → 舊 regex 要求的位置錨點完全不匹配
#     → 整個 hook 靜默失效一整個 session，且沒有任何錯誤訊息可查
#     → 拿掉「git 必須在開頭或分隔符之後」的錨點，只要求 git 與 commit
#        在同一指令段（中間無 ;/&/|）即可，不管前面加了什麼包裝指令
#
# ── 嚴格模式 ────────────────────────────────────────────────
# 標記必須比「staged 內容的建立時間」更新。摩擦為使用者明確選擇接受。

try {
    # ⚠️ 必要：否則 deny 訊息的中文在 stdout 變亂碼
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    # ⚠️ 必要：Claude Code 以 UTF-8 送 stdin JSON；不設的話中文指令會被以
    #    console codepage 讀入 → verify-bypass.log 記到的指令變亂碼（v3.19）
    try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }
    $cmd = ($raw | ConvertFrom-Json).tool_input.command
    if (-not $cmd) { exit 0 }

    # 指令第一行（heredoc／commit message 內文不算——同 [skip-verify] 的處理）
    $firstLine = ($cmd -split "`r?`n", 2)[0]

    # git push 須人類授權（CLAUDE.md 工作範圍）——不可自動接在 commit 後
    # 遠端分支常接自動部署，push 等同把未經人看過的變更推上正式站
    # 只認第一行、push 是 git 的子指令（指令位置或 shell 分隔符之後，
    #   git 與 push 之間只能夾 flag token）：
    #   - 涵蓋 wrapper 前綴（`rtk git push`、`rtk proxy git push`）——同 C-1 教訓，
    #     不用行首錨點，改允許 git 前面有一串小寫指令詞
    #   - 不誤命中 commit message 內文的「... git push ...」（前面被非 flag token 阻斷）
    if ($firstLine -match '(?:^|&&|\|\||;|\||\$\()\s*(?:[a-z][\w./-]*\s+)*git\s+(?:-{1,2}[A-Za-z-]+(?:[= ]\S+)?\s+)*push\b') {
        @{
            hookSpecificOutput = @{
                hookEventName            = 'PreToolUse'
                permissionDecision       = 'deny'
                permissionDecisionReason = "🛡️ git push 須人類授權（見 CLAUDE.md 工作範圍）。" +
                    "先告知使用者「即將推送 N 個 commit 到 {分支}，此分支若已接自動部署等同推上正式站」並取得同意；" +
                    "確認後由**使用者自行執行** git push。"
            }
        } | ConvertTo-Json -Depth 5 -Compress
        exit 0
    }

    # 只管 git commit（放寬：涵蓋 git -C <path> commit、git -c k=v commit、
    # 指令串中的 commit，以及前面被任何 wrapper 包裝的 git，如 `rtk proxy git commit`）
    # C-1：故意不要求 git 在開頭或分隔符之後——只要求 git 與 commit
    #      同段（中間無 ;/&/|），不管前面加了什麼指令
    if ($cmd -notmatch '\bgit\b[^;&|]*\bcommit\b') { exit 0 }

    # 逃生門（留痕）
    # ⚠️ C-2（v3.19）：舊版 `$cmd -match '\[skip-verify\]'` 會誤命中——commit message
    #    的 heredoc 內文只要「提到」這個 token（例如 changelog 描述逃生門功能），
    #    整個 commit 就被當成使用逃生門而靜默放行。修法：只認**指令第一行**出現的
    #    token（真正要用時是 `git commit -m "... [skip-verify]"` 這種單行寫法；
    #    多行 heredoc 訊息的內文不算）。文件裡提到時請一律用反引號包起來。
    if ($firstLine -match '\[skip-verify\]') {
        try {
            $null = New-Item -ItemType Directory -Force -Path '_管理' -ErrorAction SilentlyContinue
            Add-Content -Path '_管理/verify-bypass.log' -Encoding utf8 -ErrorAction SilentlyContinue `
                -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $firstLine)
        } catch { }
        exit 0
    }

    # B-3：同一指令串內已含驗證指令（如 npm run build && git commit）→ 放行
    $verifyPattern = '(npm|yarn|pnpm)\s+(run\s+)?(build|test|lint|typecheck|check)' +
                     '|(^|\s|&&\s*)tsc(\s|$)|playwright\s+test|vitest|jest|mocha' +
                     '|pytest|py_compile|mypy|ruff|flake8' +
                     '|cargo\s+(build|test|check|clippy)|go\s+(build|test|vet)' +
                     '|dotnet\s+(build|test)|mvn\s+(compile|test)|gradle\s+(build|test)'
    if ($cmd -match $verifyPattern) { exit 0 }

    # B-2：切到 repo 根，否則相對路徑全部解析失敗 → 靜默失效
    $root = (git rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $root) { exit 0 }   # 非 git repo → 放行
    Set-Location -LiteralPath $root

    # merge／rebase 進行中不擋
    if ((Test-Path '.git/MERGE_HEAD') -or (Test-Path '.git/rebase-merge') -or (Test-Path '.git/rebase-apply')) {
        exit 0
    }

    # 取要被 commit 的檔案清單
    #   core.quotepath=false：否則含中文的路徑會被轉成八進位轉義
    $staged = @(git -c core.quotepath=false diff --cached --name-only 2>$null)
    if ($LASTEXITCODE -ne 0) { exit 0 }

    # B-1：git commit -a / -am 會在 commit 當下暫存已追蹤檔的修改
    #      （注意 --amend 是雙破折號，不會誤命中）
    $usesAllFlag = $cmd -match '(^|\s)-[a-zA-Z]*a[a-zA-Z]*($|\s)'
    if ($usesAllFlag) {
        $staged += @(git -c core.quotepath=false diff --name-only 2>$null)
        $staged = @($staged | Select-Object -Unique)
    }
    if ($staged.Count -eq 0) { exit 0 }

    # 豁免：純文件／設定／資源
    #   ⚠️ package.json／tsconfig.json 刻意不豁免（會影響建置）
    #   G1：即使位於豁免目錄下，可執行腳本仍視為程式碼
    $scriptExt = '\.(ps1|sh|bat|cmd|py|js|mjs|cjs|ts|tsx|jsx)$'
    $exempt    = '\.(md|txt|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp4|pdf)$' +
                 '|^\.gitignore$|^\.mcp\.json$|(^|/)\.gitkeep$' +
                 '|^\.claude/|^_管理/|^\.github/'

    $code = @($staged | Where-Object { ($_ -notmatch $exempt) -or ($_ -match $scriptExt) })
    if ($code.Count -eq 0) { exit 0 }

    # index 的 mtime ＝ 最後一次 staging 的時間（B-6／B-7 用）
    $indexTime = if (Test-Path '.git/index') { (Get-Item '.git/index').LastWriteTimeUtc } else { [DateTime]::MinValue }
    $dirty = @(git -c core.quotepath=false diff --name-only 2>$null)

    $newest   = [DateTime]::MinValue
    $anyKnown = $false
    foreach ($f in $code) {
        $t = $null
        if (Test-Path -LiteralPath $f) {
            # 工作區版本與 index 不同 → 要 commit 的是 staged 快照，用 staging 時間
            $t = if ($dirty -contains $f) { $indexTime } else { (Get-Item -LiteralPath $f).LastWriteTimeUtc }
        } elseif ($staged -contains $f) {
            $t = $indexTime          # B-7：刪除的檔也要納入判斷
        }
        if ($t) { $anyKnown = $true; if ($t -gt $newest) { $newest = $t } }
    }
    if (-not $anyKnown) { exit 0 }   # 全部無法判斷 → fail-open

    $markerPath = '_管理/.verify-marker'
    $markerTime = if (Test-Path $markerPath) { (Get-Item $markerPath).LastWriteTimeUtc } else { [DateTime]::MinValue }

    if ($markerTime -lt $newest) {
        $files = ($code | Select-Object -First 8) -join ', '
        if ($code.Count -gt 8) { $files += " …（共 $($code.Count) 檔）" }

        $reason = "🛡️ 原則四閘門（Evidence over claims）：本次要 commit 的內容含程式碼變更（$files），" +
                  "但自該內容產生後**未執行任何驗證指令**。`n" +
                  "請先實跑建置／型別檢查／測試（指令依 STACK_RULES，如 npm run build、npx tsc --noEmit、npx playwright test），" +
                  "確認輸出無誤後再 commit——並把實跑指令與輸出摘要填入回報格式的「驗證證據」欄。`n" +
                  "⚠️ 正解是**重跑驗證**，不是改用 git commit -am、也不是加 [skip-verify]。" +
                  "（[skip-verify] 須由**使用者**指示；AI 不得自行加，該操作會留痕於 _管理/verify-bypass.log）"

        @{
            hookSpecificOutput = @{
                hookEventName            = 'PreToolUse'
                permissionDecision       = 'deny'
                permissionDecisionReason = $reason
            }
        } | ConvertTo-Json -Depth 5 -Compress

        exit 0
    }
} catch {
    # fail-open：任何錯誤都不阻擋開發
}

exit 0
