# -*- coding: utf-8 -*-
"""
正式產出腳本：從 Google Sheet 原始資料（gsheet_source.xlsx）產出多期合併版 設備品質分析_分析總表.xlsx
  - 車機_彙整總覽 / 鏡頭_彙整總覽（含期間欄，31 欄）
  - 車機_月趨勢 / 鏡頭_月趨勢（16欄）
  - 設備品質分析_彙整總表（20欄明細，各期合併保留，供備查與月趨勢計算）
成本節省總覽：本階段不做。

┌─────────────────────────────────────────────────────────────────────┐
│ 本腳本邏輯依據以下分冊文件（設備品質分析_分冊文件/），每次規則變更都應同步這裡： │
│   業務規則（維護類型/維修分類/QC/回廠過保數/已使用年限/廠商/四桶判斷）：      │
│     00_規則定義.md  現行 v9（規則E：已使用年限＝不良品∪過保∪未歸類）         │
│   彙整總覽輸出欄位規格（欄名、順序、計算方式）：                            │
│     03_分析總表_工作表規格  現行 v7（31 欄，含未歸類數；已使用年限口徑待補回寫）│
│   Step 1-8 明細建立流程：                                               │
│     01_資料庫彙整_操作步驟  現行 v2                                     │
│   跨冊整合對照（驗證上面三份是否互相一致、跟本腳本是否一致）：                │
│     07_整體架構與計算邏輯總覽  現行 v6（最可靠的「文件↔程式碼」核對依據）    │
│ 版本號不會自動同步，每次改規則記得回頭更新這裡 + 上面對應文件的版本號。       │
│ 執行時下方 main() 會印出這個版本標記，並跑等式驗證自我檢查邏輯有沒有漏改。   │
│ 最後核對日期：2026-07-24                                                │
└─────────────────────────────────────────────────────────────────────┘

用法：
  python build_分析總表.py
輸出：
  設備品質分析_分析總表_新版.xlsx
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

SRC = 'gsheet_source.xlsx'
OUT = '設備品質分析_分析總表_新版.xlsx'

# 本腳本邏輯依據文件版本（每次規則變更，記得同步這裡跟上方 docstring）
RULE_DOC_VERSION = '00_規則定義.md v9（規則E：已使用年限＝不良品∪過保∪未歸類）'
SHEET_SPEC_VERSION = '03_分析總表_工作表規格 v7（31欄，含未歸類數）'
LAST_VERIFIED = '2026-07-24'

# 期間定義：期間代碼 -> 該期涵蓋的年月清單（累積制：Qn = 該年 1 月至第 n 季末月，依冊05規格建議）
PERIODS = [
    ('2025-Q1', ['2025-01', '2025-02', '2025-03']),
    ('2025-Q2', ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06']),
    ('2025-Q3', ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
                 '2025-07', '2025-08', '2025-09']),
    ('2025-Q4', ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
                 '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']),
    ('2026-Q1', ['2026-01', '2026-02', '2026-03']),
    ('2026-Q2', ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']),
]

CAR_FAULT   = ['失聯', '定位不良', '訊號異常', 'AB點', '其他']   # 月趨勢欄序（依冊05規格12-16欄）
CAR_FAULT_SUM = ['AB點', '失聯', '定位不良', '訊號異常', '其他']  # 彙整總覽欄序（依冊03規格）
LENS_FAULT  = ['黑畫面', '進水/模糊', '水波紋', '時有時無', '其他']

MERGE_KEEP = 'last'


def s(x):
    return '' if pd.isna(x) else str(x).strip()


def load_source():
    xls = pd.ExcelFile(SRC)

    def load(n):
        d = pd.read_excel(xls, n)
        return d.loc[:, ~d.columns.astype(str).str.startswith('Unnamed')].dropna(how='all')

    return {
        '派工': load('SQL_派工'), '維修': load('SQL_維修'), '報廢': load('SQL_報廢'),
        '上線': load('SQL_上線量'), '類型清單': load('類型清單'), '品號對照': load('品號對照表'),
        '關鍵字': load('關鍵字對照表').sort_values('優先序'),
    }


def build_detail(src, months):
    """依冊01 Step1-8，產出指定年月範圍的 20欄明細（等同 設備品質分析_彙整總表 單期版）"""
    派工, 維修, 報廢 = src['派工'], src['維修'], src['報廢']
    上線, 類型清單, 品號對照 = src['上線'], src['類型清單'], src['品號對照']
    關鍵字 = src['關鍵字']

    派工 = 派工.copy()
    派工['ym'] = 派工['品項完工年月'].astype(str).str[:7]
    df = 派工[派工['ym'].isin(months)].copy()
    if df.empty:
        return df

    # Step2: merge 維修（限同期，避免跨期誤配）/ 報廢（全量，報廢表無期間欄）/ 類型清單
    def sb(x):
        v = s(x)
        return v if v else None

    維修 = 維修.copy()
    維修['ym'] = 維修['輸入年月'].astype(str).str[:7]
    維修_p = 維修[維修['ym'].isin(months)]
    維修u = 維修_p.drop_duplicates('條碼', keep=MERGE_KEEP)
    報廢u = 報廢.drop_duplicates('條碼', keep=MERGE_KEEP)

    df['bc'] = df['替換前品項條碼'].map(sb)
    維修m = 維修u.assign(bc=維修u['條碼'].map(sb)).dropna(subset=['bc'])
    報廢m = 報廢u.assign(bc=報廢u['條碼'].map(sb)).dropna(subset=['bc'])
    df = df.merge(維修m[['bc', '完成原因', '輸入年月', '輸入時間']], on='bc', how='left')
    df = df.merge(報廢m[['bc', '報廢單狀態', '報廢原因']], on='bc', how='left')

    tl = 類型清單.rename(columns={'廠牌型號(設備類型分類)': '廠牌型號'}).copy()
    tl['替換前品項'] = tl['替換前品項'].map(s)
    tl = tl.drop_duplicates('替換前品項')  # 修正現行總表的重複灌水瑕疵
    df['替換前品項'] = df['替換前品項'].map(s)
    df = df.merge(tl[['替換前品項', 'ERP品號', '設備類型', '廠牌型號', '廠商']], on='替換前品項', how='left')

    # Step2.7: 廠商備援
    品號對照 = 品號對照.copy()
    品號對照['品號_str'] = 品號對照['品號'].map(s)
    vmap = 品號對照.drop_duplicates('品號_str').set_index('品號_str')['主供應商名稱']
    df['ERP_str'] = df['ERP品號'].map(lambda x: s(x).replace('.0', ''))
    mask = df['廠商'].isna() & df['ERP品號'].notna()
    df.loc[mask, '廠商'] = df.loc[mask, 'ERP_str'].map(vmap)

    # Step4: 上線量（Google Sheet 已彙整為 ERP品號->上線量；為單一時點快照，各期沿用同一份）
    上線 = 上線.copy()
    上線['ERP_str'] = 上線['ERP品號'].map(lambda x: s(x).replace('.0', ''))
    onmap = 上線.groupby('ERP_str')['上線量'].sum()
    df['上線量'] = df['ERP_str'].map(onmap)

    # Step5: 維護類型（關鍵字對照表，依優先序）
    kw_list = list(zip(關鍵字['關鍵字'].map(s), 關鍵字['維護類型'].map(s)))

    def maint_type(detail):
        t = s(detail)
        if t == '':
            return '其他'
        for k, v in kw_list:
            if k and k in t:
                return v
        return '其他'

    df['維護類型'] = df['維護細節'].map(maint_type)

    # Step6: 維修分類（完成原因，specific-first）
    def repair_class(reason):
        r = s(reason)
        if r == '':
            return '無維修資訊'
        if '不送修' in r:
            return '不送修'
        if '維修換貨' in r or '換貨條碼' in r:
            return '維修換貨＋換貨條碼'
        if '已完修 人為' in r:
            return 'V /已完修 人為'
        if '人為報廢' in r:
            return 'H /人為報廢'
        if '停產報廢' in r:
            return 'D /停產報廢'
        if '過保報廢' in r:
            return 'E /過保報廢'
        if '評估後退修' in r or '退修' in r:
            return 'G /評估後退修'
        if '已完修' in r:
            return 'X /已完修'
        if '測試正常' in r:
            return 'O /測試正常'
        return '無維修資訊'

    df['維修分類'] = df['完成原因'].map(repair_class)

    # Step7: 進貨日 / 已使用年限（用派工內建 替換前進貨日）
    df['進貨日_dt'] = pd.to_datetime(df['替換前進貨日'], errors='coerce')
    df['完工_dt'] = pd.to_datetime(df['品項完工日期'], errors='coerce')
    df['已使用年限'] = ((df['完工_dt'] - df['進貨日_dt']).dt.days / 365).round(1)
    df['進貨日'] = df['進貨日_dt'].dt.strftime('%Y-%m-%d')

    # Step8: QC（規則C，v5 現行版：「其他(未過)」，計入不良/過保類，取代 v4「回廠其他」計入良品類的漏洞）
    def qc(row):
        mc = row['維修分類']
        dev = row['設備類型']
        age = row['已使用年限']
        has_scrap = s(row['報廢原因']) != ''
        if mc == 'O /測試正常':
            return '廠商檢測正常'
        if mc in ('X /已完修', 'V /已完修 人為', '維修換貨＋換貨條碼'):
            return '廠商完修'
        if mc in ('E /過保報廢', 'G /評估後退修', 'D /停產報廢', 'H /人為報廢'):
            return '廠商報廢'
        if mc == '無維修資訊' and has_scrap:
            if (dev == '鏡頭' and pd.notna(age) and age < 1) or (dev == '車機' and pd.notna(age) and age < 3):
                return '其他(未過)'
            return '回廠報廢'
        if mc == '不送修' and not has_scrap:
            return '回廠QC'
        if mc == '無維修資訊' and not has_scrap:
            return '其他'
        return '其他'

    df['QC'] = df.apply(qc, axis=1)

    keep = ['品項完工日期', '設備類型', '廠牌型號', '廠商', 'ERP品號', '替換前品項', '替換前品項條碼',
            '維護原因', '維護細節', '輸入年月', '輸入時間', '完成原因', '報廢單狀態', '報廢原因',
            '上線量', '維護類型', '維修分類', '進貨日', '已使用年限', 'QC']
    return df[keep].copy()


def cnt(g, col, val):
    return int((g[col] == val).sum())


def build_overview(detail, period, dev_type, maint_reason, fault_types):
    """冊03 v6 規格（對應規則 v5）：彙整總覽（依 ERP品號 分組）"""
    sub = detail[(detail['設備類型'] == dev_type) & (detail['維護原因'] == maint_reason)].copy()
    if sub.empty:
        return pd.DataFrame()
    sub['ERP_str'] = sub['ERP品號'].map(lambda x: s(x).replace('.0', ''))
    rows = []
    for erp, g in sub.groupby('ERP_str'):
        if erp == '':
            continue
        vend = g['廠商'].dropna()
        d = cnt(g, '維修分類', 'D /停產報廢'); e = cnt(g, '維修分類', 'E /過保報廢')
        gg = cnt(g, '維修分類', 'G /評估後退修'); h = cnt(g, '維修分類', 'H /人為報廢')
        o = cnt(g, '維修分類', 'O /測試正常'); x = cnt(g, '維修分類', 'X /已完修')
        v = cnt(g, '維修分類', 'V /已完修 人為'); ex = cnt(g, '維修分類', '維修換貨＋換貨條碼')
        qc_qc = cnt(g, 'QC', '回廠QC'); qc_scrap = cnt(g, 'QC', '回廠報廢')
        qc_oth = cnt(g, 'QC', '其他'); qc_oth2 = cnt(g, 'QC', '其他(未過)')
        # v5：回廠不良品數(全) 補入 V、其他(回廠)（此欄為等式驗證用的全口徑，v7 未變動）
        bad_all = d + e + gg + h + x + v + ex + qc_scrap + qc_oth2
        good = o + qc_qc + qc_oth
        # v7（規則G）：不良品／過保 改回窄口徑互斥定義，其他(未過) 不計入回廠過保數
        # （H /人為報廢、V /已完修 人為、QC=其他(未過) 三者皆不計入任何桶，比照回廠人為數獨立揭露）
        bad = gg + x + ex
        overwarranty = d + e + qc_scrap
        # v8（規則G第四桶）：未歸類 = H + V + 其他(未過)，讓 良品+不良品+過保+未歸類 = 回廠量
        unclassified = h + v + qc_oth2
        # 已使用年限計算對象（v9，00_規則定義.md）：不良品∪過保∪未歸類（＝非良品）
        # 良品＝QC∈{廠商檢測正常,回廠QC,其他}，其餘（QC=回廠報廢/其他(未過)，或維修分類∈{G,X,換貨,D,E,H,V}）皆計入
        age_mask = ~g['QC'].isin(['廠商檢測正常', '回廠QC', '其他'])
        ages = g.loc[age_mask, '已使用年限'].dropna()
        age = round(ages.mean(), 1) if len(ages) else ''

        main4 = fault_types[:-1]
        row = {'期間': period,
               '類型': s(g['廠牌型號'].dropna().iloc[0]) if g['廠牌型號'].notna().any() else '',
               '廠商': s(vend.iloc[0]) if len(vend) else '',
               'ERP品號': erp,
               '品名': s(g['替換前品項'].iloc[0]),
               '上線量': int(g['上線量'].dropna().iloc[0]) if g['上線量'].notna().any() else 0}
        for ft in main4:
            row[ft] = cnt(g, '維護類型', ft)
        row['其他'] = len(g) - sum(row[ft] for ft in main4)  # 故障原因分類「其他」
        row['回廠量'] = len(g)
        row.update({'回廠不良品數(全)': bad_all, '回廠良品數': good, '回廠不良品數': bad,
                     '回廠過保數': overwarranty, '回廠人為數': h,
                     'D /停產報廢': d, 'E /過保報廢': e,
                     'G /評估後退修': gg, 'H /人為報廢': h, 'O /測試正常': o, 'X /已完修': x,
                     'V /已完修 人為': v, '維修換貨＋換貨條碼': ex, '回廠QC': qc_qc, '回廠報廢': qc_scrap,
                     # 冊03 v6 文件將 QC良品「其他」與故障原因「其他」同名，會撞欄名；
                     # 此處暫標「其他(良品)」以區分，待使用者確認正式欄名。
                     '其他(良品)': qc_oth, '其他(回廠)': qc_oth2, '已使用年限': age,
                     # 冊03 v7 新增第31欄，放在已使用年限之後（規則G 第四桶，見 00_規則定義.md v8）
                     '未歸類數': unclassified})
        rows.append(row)
    df = pd.DataFrame(rows)
    if not df.empty:
        # 等式驗證（v5）：回廠不良品數(全) + 回廠良品數 應等於 回廠量
        bad_eq = (df['回廠不良品數(全)'] + df['回廠良品數'] - df['回廠量']).abs()
        n_bad = int((bad_eq > 0).sum())
        if n_bad:
            print(f'  ⚠️ 等式驗證失敗（回廠不良品數(全)+回廠良品數≠回廠量）：{n_bad} 列')
        # 等式驗證（v8，規則G第四桶）：回廠良品數+回廠不良品數+回廠過保數+未歸類數 應等於 回廠量
        four_eq = (df['回廠良品數'] + df['回廠不良品數'] + df['回廠過保數'] + df['未歸類數'] - df['回廠量']).abs()
        n_bad4 = int((four_eq > 0).sum())
        if n_bad4:
            print(f'  ⚠️ 等式驗證失敗（回廠良品數+回廠不良品數+回廠過保數+未歸類數≠回廠量）：{n_bad4} 列')
    return df


def build_trend(detail, period, dev_type, maint_reason, fault_cols_16):
    """冊05 v5 規格：月趨勢（依 ERP品號 x 年月 分組）"""
    sub = detail[(detail['設備類型'] == dev_type) & (detail['維護原因'] == maint_reason)].copy()
    if sub.empty:
        return pd.DataFrame()
    sub['ERP_str'] = sub['ERP品號'].map(lambda x: s(x).replace('.0', ''))
    sub['年月'] = pd.to_datetime(sub['品項完工日期'], errors='coerce').dt.strftime('%Y-%m')
    rows = []
    for (erp, ym), g in sub.groupby(['ERP_str', '年月']):
        if erp == '' or pd.isna(ym):
            continue
        vend = g['廠商'].dropna()
        bad = cnt(g, '維修分類', 'G /評估後退修') + cnt(g, '維修分類', 'X /已完修') + cnt(g, '維修分類', '維修換貨＋換貨條碼')
        good = cnt(g, 'QC', '廠商檢測正常') + cnt(g, 'QC', '回廠QC') + cnt(g, 'QC', '其他')
        # v7（規則G）：過保 = D/E + QC=回廠報廢，不含 QC=其他(未過)（跟冊05_v5字面公式一致）
        overwarranty = (cnt(g, '維修分類', 'D /停產報廢') + cnt(g, '維修分類', 'E /過保報廢')
                         + cnt(g, 'QC', '回廠報廢'))
        main4 = fault_cols_16[:-1]
        row = {'期間': period, '年月': ym,
               '類型': s(g['廠牌型號'].dropna().iloc[0]) if g['廠牌型號'].notna().any() else '',
               '廠商': s(vend.iloc[0]) if len(vend) else '',
               'ERP品號': erp, '品名': s(g['替換前品項'].iloc[0]),
               '上線量': int(g['上線量'].dropna().iloc[0]) if g['上線量'].notna().any() else 0,
               '回廠量': len(g), '不良品數': bad, '良品數': good, '過保數': overwarranty}
        for ft in main4:
            row[ft] = cnt(g, '維護類型', ft)
        row[fault_cols_16[-1]] = len(g) - sum(row[ft] for ft in main4)
        rows.append(row)
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values(['年月', '類型', 'ERP品號']).reset_index(drop=True)
    return df


def write_sheet(wb, name, df):
    ws = wb.create_sheet(name)
    header_fill = PatternFill('solid', fgColor='D9E1F2')
    header_font = Font(name='微軟正黑體', bold=True)
    header_align = Alignment(horizontal='center')
    data_font = Font(name='微軟正黑體')
    data_align = Alignment(horizontal='left')
    for col_idx, col_name in enumerate(df.columns, 1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.fill, cell.font, cell.alignment = header_fill, header_font, header_align
    for row_idx, row in enumerate(df.itertuples(index=False), start=2):
        for col_idx, value in enumerate(row, 1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.font, cell.alignment = data_font, data_align
    for col in ws.columns:
        max_len = max((len(str(c.value)) if c.value is not None else 0) for c in col)
        ws.column_dimensions[get_column_letter(col[0].column)].width = max_len + 4


def main():
    print(f'邏輯依據：{RULE_DOC_VERSION} ｜ 欄位規格：{SHEET_SPEC_VERSION} ｜ 最後核對：{LAST_VERIFIED}')
    print('讀取 Google Sheet 來源資料...')
    src = load_source()

    car_rows, lens_rows, detail_rows = [], [], []
    car_trend_rows, lens_trend_rows = [], []

    for period, months in PERIODS:
        detail = build_detail(src, months)
        if detail.empty:
            print(f'  {period}: 無資料，跳過')
            continue
        print(f'  {period}: 派工明細 {len(detail)} 筆')
        d2 = detail.copy(); d2.insert(0, '期間', period)
        detail_rows.append(d2)

        car = build_overview(detail, period, '車機', '訊號異常', CAR_FAULT_SUM)
        lens = build_overview(detail, period, '鏡頭', '影像異常(鏡頭)', LENS_FAULT)
        if not car.empty:
            car_rows.append(car)
        if not lens.empty:
            lens_rows.append(lens)
        print(f'    車機_彙整總覽 {len(car)} 品號 / 鏡頭_彙整總覽 {len(lens)} 品號')

        ct = build_trend(detail, period, '車機', '訊號異常', CAR_FAULT)
        lt = build_trend(detail, period, '鏡頭', '影像異常(鏡頭)', LENS_FAULT)
        if not ct.empty:
            car_trend_rows.append(ct)
        if not lt.empty:
            lens_trend_rows.append(lt)

    車機彙整 = pd.concat(car_rows, ignore_index=True) if car_rows else pd.DataFrame()
    鏡頭彙整 = pd.concat(lens_rows, ignore_index=True) if lens_rows else pd.DataFrame()
    車機月趨勢 = pd.concat(car_trend_rows, ignore_index=True) if car_trend_rows else pd.DataFrame()
    鏡頭月趨勢 = pd.concat(lens_trend_rows, ignore_index=True) if lens_trend_rows else pd.DataFrame()
    明細 = pd.concat(detail_rows, ignore_index=True) if detail_rows else pd.DataFrame()

    # 期間降冪排序（最新在前），符合冊05排序規則
    for df_ in (車機彙整, 鏡頭彙整):
        if not df_.empty:
            df_.sort_values(['期間', 'ERP品號'], ascending=[False, True], inplace=True, ignore_index=True)
    for df_ in (車機月趨勢, 鏡頭月趨勢):
        if not df_.empty:
            df_.sort_values(['期間', '年月', '類型', 'ERP品號'], ascending=[False, True, True, True],
                             inplace=True, ignore_index=True)

    print(f'\n總計：車機_彙整總覽 {len(車機彙整)} 列 / 鏡頭_彙整總覽 {len(鏡頭彙整)} 列')
    print(f'      車機_月趨勢 {len(車機月趨勢)} 列 / 鏡頭_月趨勢 {len(鏡頭月趨勢)} 列')

    wb = Workbook()
    wb.remove(wb.active)
    write_sheet(wb, '車機_彙整總覽', 車機彙整)
    write_sheet(wb, '鏡頭_彙整總覽', 鏡頭彙整)
    write_sheet(wb, '車機_月趨勢', 車機月趨勢)
    write_sheet(wb, '鏡頭_月趨勢', 鏡頭月趨勢)
    write_sheet(wb, '設備品質分析_彙整總表', 明細)
    wb.save(OUT)
    print(f'\n已產出：{OUT}')


if __name__ == '__main__':
    main()
