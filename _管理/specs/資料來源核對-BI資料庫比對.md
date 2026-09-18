# 資料來源核對——Google Sheet vs EUPCRM BI 鏡像庫

> **這份文件不是本專案的功能規格**，是把另一個專案（EUPCRM 資料工作站，本機路徑
> `Web App for Develop - AI OS_DB_範本\`）2026-09-18 做的一次交叉核對結果，摘錄搬過來當參考。
> 原始出處：該專案 commit `5b50dff`（回廠時間）與 `e139c1e`（派工/維修/報廢），
> 完整反編譯細節見該專案的 `_管理/db_mapping/回廠時間.md`／`派工一覽表.md`／`維修總表.md`／`報廢作業.md`。
>
> **背景**：本專案（quality-dashboard-v2）讀取的公開 Google Sheet「設備品質分析來源」
> （`SQL上線量`／`SQL派工`／`SQL維修`／`SQL_報廢`／`SQL回廠時間` 等分頁），其數字最終來源是
> EUPCRM 的正式資料庫。這份核對記錄回答「Sheet 上的數字，對應資料庫的哪張表、哪些條件，
> 可信度如何」，供之後要解釋數字落差、或評估「能不能改成直接查資料庫取代 Sheet」時參考。

---

## 各分頁核對結果

| Sheet 分頁 | 對應資料表 | 核對結果 | 信心等級 |
|---|---|---|---|
| `SQL回廠時間` | `tb_BackFactory`（`BF_` 前綴，非已棄用的 `tb_StockupBackFactory`／`SBF_`）| 篩 `BF_BackTime` 同期間：DB 139,290 筆 vs Sheet 139,294 筆，差 4 筆（0.003%）；18 個月中 17 個月完全相同 | 🟢 高（大量真實資料核對，抽樣單日完全一致）|
| `SQL_派工` | `tb_WorkOrder` JOIN `tb_WorkOrderCar` JOIN `tb_WorkOrderCarItem`，條件見下方 SQL | 重現 36,921 筆 vs Sheet 36,979 筆，差 58 筆（0.16%）；殘差主因是 CSV 條碼被誤判科學記號的比對假陰性,非查詢邏輯錯誤 | 🟡 中高 |
| `SQL_維修` | `tb_StockupRepaired`，條件見下方 SQL | 重現 50,905 筆 vs Sheet 49,665 筆，差 1,240 筆（2.5%），58% 集中在最新月份 | 🟡 中高（差異已定性為報表快照時間落差,非邏輯錯誤）|
| `SQL_報廢` | `tb_StockScrappedRecord` + `tb_StockScrappedDetail` | 全表 `SSD_ProductKind IN ('車機','鏡頭')` 有 117,213 筆，遠超 Sheet 的 30,429 筆；發現「整張報廢單被整批收錄或整批排除」的現象，但用現有欄位（狀態/部門/新增人/入庫日）查不出規律 | 🔴 未解——懷疑報表伺服器端有本機資料庫查不到的排除清單/業務標記,建議直接問報表開發端拿真實 SQL |
| `SQL上線量` | `tb_QuoteProduct` + `tb_EupMachine`（推測）| 無進展；且發現 Sheet 快照最新日比 BI 鏡像庫晚 26 天，超出其他表驗證過的「隔一天」延遲；`EM_Deleted=0` 與 `EM_CustUsed IS NULL` 兩個候選條件恰好都是 26,218 筆，兩者對照關係尚未查證 | 🔴 未解 |

---

## `SQL_派工` 精確篩選條件（重現度 99.84%）

```sql
FROM tb_WorkOrder wo
JOIN tb_WorkOrderCar woc ON woc.WO_ID = wo.WO_ID
JOIN tb_WorkOrderCarItem woci ON woci.WOC_ID = woc.WOC_ID
WHERE wo.WO_Reason = N'維護'
  AND wo.WO_Status = N'已核款'
  AND woci.WOCI_Type = 2
  AND woci.New_CIL_BarCodeRecord IS NOT NULL          -- 必須有「替換後」條碼
  AND woci.CIL_ItemClass IS NOT NULL AND woci.CIL_ItemClass <> ''   -- 必須有「替換前」品項類別（純新增不算）
  AND (woci.CIL_BarCodeRecord IS NULL OR woci.CIL_BarCodeRecord <> woci.New_CIL_BarCodeRecord)  -- 前後條碼視為 NULL 也算「不同」
  AND woci.WOCI_FinishDate >= @start AND woci.WOCI_FinishDate < @end
```

## `SQL_維修` 精確篩選條件（重現度 97.5%，殘差集中在最新月份）

```sql
FROM tb_StockupRepaired
WHERE SR_FinishFunction IS NOT NULL        -- 「算不算完成、要不要收錄」看這個欄位有沒有值，不是看某個時間欄位
  AND SR_InsertTime >= @start AND SR_InsertTime < @end   -- 分月統計依據是「輸入時間」（提交日），不是完工時間
```

> ⚠️ 「分月依據」（`SR_InsertTime`）跟「算不算計入」（`SR_FinishFunction IS NOT NULL`）是**兩個獨立欄位**，不要混用同一個時間戳判斷兩件事。

---

## 核對方法論（之後要繼續核對其他分頁時適用）

1. **先做「抽樣個別記錄的欄位內容比對」，再做「總量比對」**——總量對不齊不代表資料錯誤或表找錯，可能是還原的篩選條件不夠精確；抽樣完全吻合就已經是高信心的證據。
2. **不要假設所有表的 BI 鏡像複寫延遲都是固定「隔一天」**——`SQL上線量` 對應表的延遲觀察到 26 天，跟其他表驗證過的 1 天落差差很多，遇到異常大落差先懷疑複寫頻率不同,不要急著否定欄位對應。
3. **CSV/Sheet 匯出的條碼字串比對要考慮 Excel/Sheets 自動格式化的假陰性**——以 `00E1`／`0032`／`0800` 等開頭的條碼容易被誤判成科學記號或去掉前導零，逐筆比對時建議寬鬆比對（去前導零）或改用其他非數字欄位鎖定同一筆記錄。
4. **「業務完成判斷」跟「時間分組依據」可能是兩個獨立欄位**——遇到「有輸入時間也有完成時間」的表，先假設兩者是分開的規則，不要預設用同一個時間戳就能兼顧。
5. **報表產生時間點 vs 現在查詢時間點的自然落差**——「已完成才收錄」類的報表，最近 1-2 個時間單位的差異常常只是快照時效問題，不代表查詢邏輯錯誤。

---

## 尚未解決、可能需要之後繼續查的缺口

- `SQL_報廢` 的整批收錄/排除規則（建議：直接問報表開發端拿真實 SQL，純猜測已投入兩輪查詢預算未解出）
- `SQL上線量` 完全無進展，且複寫延遲異常（26 天）需先查清楚才能繼續核對
- `tb_BackFactory` 目前只確認資料庫層級，尚未反查是哪個 EUPCRM.exe 畫面在寫入/讀取
