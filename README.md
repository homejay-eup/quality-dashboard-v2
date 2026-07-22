# 設備品質分析儀表板

## 🔗 網址（直接打開即可用）

**https://homejay-eup.github.io/quality-dashboard-v2/**

## 說明

純前端即時讀取 Google Sheet 原始資料，不需手動上傳 Excel。開啟網址後：

- 選擇「目前期間」查看該季 KPI、詳細資料、逐筆明細
- 選擇「對比期間」與去年同期比較
- 篩選廠商／類型／ERP品號
- 「📥 匯出本期快照」：把當下資料備份到共用雲端硬碟，供未來跨期比較
- 「🖨 生成落地頁報告」：產出含圖表與建議的單檔 HTML 報告

## 架構

- `index.html` / `css/` / `js/`：純前端，無框架、無打包器
- `apps-script/`：雲端快照備份用的 Google Apps Script（Drive 對 Drive 複製來源 Sheet）

彙整邏輯依 `設備品質分析_分冊文件` 規則 A–F（v5）實作，細節見 `js/transform.js`。
