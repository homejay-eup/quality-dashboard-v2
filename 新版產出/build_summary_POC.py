# -*- coding: utf-8 -*-
"""POC: 從 Google Sheet 原始資料重建 彙整總表 + 車機/鏡頭_彙整總覽 (規則 v5)，並與現行總表對帳。"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import pandas as pd, numpy as np

SRC = 'gsheet_source.xlsx'
PERIOD = '2026-Q1'
PERIOD_MONTHS = ['2026-01', '2026-02', '2026-03']
MERGE_KEEP = 'last'   # 條碼重複時取哪筆（對帳時可切換 first/last）

xls = pd.ExcelFile(SRC)
def load(n):
    d = pd.read_excel(xls, n)
    return d.loc[:, ~d.columns.astype(str).str.startswith('Unnamed')].dropna(how='all')

派工 = load('SQL_派工'); 維修 = load('SQL_維修'); 報廢 = load('SQL_報廢')
上線 = load('SQL_上線量'); 類型清單 = load('類型清單'); 品號對照 = load('品號對照表')
關鍵字 = load('關鍵字對照表').sort_values('優先序')

def s(x): return '' if pd.isna(x) else str(x).strip()

# ── 期間篩選 ────────────────────────────────────────────────
派工['ym'] = 派工['品項完工年月'].astype(str).str[:7]
df = 派工[派工['ym'].isin(PERIOD_MONTHS)].copy()
print(f'[期間 {PERIOD}] 派工列數 = {len(df)}')

# ── Step2: merge 維修/報廢/類型清單（維修先篩當期，比照現行只用當期記錄）──
維修['ym'] = 維修['輸入年月'].astype(str).str[:7]
維修_p = 維修[維修['ym'].isin(PERIOD_MONTHS)]
維修u = 維修_p.drop_duplicates('條碼', keep=MERGE_KEEP)
報廢u = 報廢.drop_duplicates('條碼', keep=MERGE_KEEP)
print(f'[Step2] 維修當期 {len(維修_p)} 筆（全期 {len(維修)}）')
def sb(x):  # 空條碼回傳 None，讓 merge 不成立（避免空對空誤配）
    v = s(x); return v if v else None
df['bc'] = df['替換前品項條碼'].map(sb)
維修m = 維修u.assign(bc=維修u['條碼'].map(sb)).dropna(subset=['bc'])
報廢m = 報廢u.assign(bc=報廢u['條碼'].map(sb)).dropna(subset=['bc'])
df = df.merge(維修m[['bc','完成原因']], on='bc', how='left')
df = df.merge(報廢m[['bc','報廢單狀態','報廢原因']], on='bc', how='left')

類型清單 = 類型清單.rename(columns={'廠牌型號(設備類型分類)':'廠牌型號'})
類型清單['替換前品項'] = 類型清單['替換前品項'].map(s)
tl = 類型清單.drop_duplicates('替換前品項')
df['替換前品項'] = df['替換前品項'].map(s)
df = df.merge(tl[['替換前品項','ERP品號','設備類型','廠牌型號','廠商']], on='替換前品項', how='left')
print(f'[Step2] merge 後列數 = {len(df)}')

# ── Step2.5: 找不到 ERP品號 的品項 ────────────────────────
missing = sorted(df[df['ERP品號'].isna()]['替換前品項'].dropna().unique().tolist())
print(f'[Step2.5] 無法對應 ERP品號 的品項數 = {len(missing)}')
for m in missing[:30]:
    print('   ', m, '（', (df["替換前品項"]==m).sum(), '筆）')

# ── Step2.7: 廠商備援（品號對照表）─────────────────────────
品號對照['品號_str'] = 品號對照['品號'].map(s)
vmap = 品號對照.drop_duplicates('品號_str').set_index('品號_str')['主供應商名稱']
df['ERP_str'] = df['ERP品號'].map(lambda x: s(x).replace('.0',''))
mask = df['廠商'].isna() & df['ERP品號'].notna()
df.loc[mask, '廠商'] = df.loc[mask, 'ERP_str'].map(vmap)

# ── Step4: 上線量（Google Sheet 已彙整，ERP品號→上線量）────
上線['ERP_str'] = 上線['ERP品號'].map(lambda x: s(x).replace('.0',''))
onmap = 上線.groupby('ERP_str')['上線量'].sum()

# ── Step5: 維護類型（關鍵字對照表，優先序）─────────────────
kw_list = list(zip(關鍵字['關鍵字'].map(s), 關鍵字['維護類型'].map(s)))
def maint_type(detail):
    t = s(detail)
    if t == '': return '其他'
    for k, v in kw_list:
        if k and k in t: return v
    return '其他'
df['維護類型'] = df['維護細節'].map(maint_type)

# ── Step6: 維修分類（完成原因，specific-first 優先序）───────
def repair_class(reason):
    r = s(reason)
    if r == '': return '無維修資訊'
    if '不送修' in r: return '不送修'
    if '維修換貨' in r or '換貨條碼' in r: return '維修換貨＋換貨條碼'
    if '已完修 人為' in r: return 'V /已完修 人為'
    if '人為報廢' in r: return 'H /人為報廢'
    if '停產報廢' in r: return 'D /停產報廢'
    if '過保報廢' in r: return 'E /過保報廢'
    if '評估後退修' in r or '退修' in r: return 'G /評估後退修'
    if '已完修' in r: return 'X /已完修'
    if '測試正常' in r: return 'O /測試正常'
    return '無維修資訊'
df['維修分類'] = df['完成原因'].map(repair_class)

# ── Step7: 進貨日 / 已使用年限（用派工內建 替換前進貨日）────
df['進貨日_dt'] = pd.to_datetime(df['替換前進貨日'], errors='coerce')
df['完工_dt'] = pd.to_datetime(df['品項完工日期'], errors='coerce')
df['已使用年限'] = ((df['完工_dt'] - df['進貨日_dt']).dt.days / 365).round(1)

# ── Step8: QC（規則 C v5）──────────────────────────────────
def qc(row):
    mc = row['維修分類']; dev = row['設備類型']; age = row['已使用年限']
    has_scrap = s(row['報廢原因']) != ''
    if mc == 'O /測試正常': return '廠商檢測正常'
    if mc in ('X /已完修','V /已完修 人為','維修換貨＋換貨條碼'): return '廠商完修'
    if mc in ('E /過保報廢','G /評估後退修','D /停產報廢','H /人為報廢'): return '廠商報廢'
    if mc == '無維修資訊' and has_scrap:
        if (dev == '鏡頭' and pd.notna(age) and age < 1) or (dev == '車機' and pd.notna(age) and age < 3):
            return '其他(未過)'
        return '回廠報廢'
    if mc == '不送修' and not has_scrap: return '回廠QC'
    if mc == '無維修資訊' and not has_scrap: return '其他'
    return '其他'
df['QC'] = df.apply(qc, axis=1)

# ── 冊03: 彙整總覽 ────────────────────────────────────────
def cnt(g, col, val): return int((g[col] == val).sum())
def build_summary(dev_type, maint_reason, fault_types):
    sub = df[(df['設備類型'] == dev_type) & (df['維護原因'] == maint_reason)].copy()
    rows = []
    for erp, g in sub.groupby(df['ERP_str']):
        if erp == '' : continue
        vend = g['廠商'].dropna()
        d = cnt(g,'維修分類','D /停產報廢'); e = cnt(g,'維修分類','E /過保報廢')
        gg = cnt(g,'維修分類','G /評估後退修'); h = cnt(g,'維修分類','H /人為報廢')
        o = cnt(g,'維修分類','O /測試正常'); x = cnt(g,'維修分類','X /已完修')
        v = cnt(g,'維修分類','V /已完修 人為'); ex = cnt(g,'維修分類','維修換貨＋換貨條碼')
        qc_qc = cnt(g,'QC','回廠QC'); qc_scrap = cnt(g,'QC','回廠報廢')
        qc_oth = cnt(g,'QC','其他'); qc_oth2 = cnt(g,'QC','其他(未過)')
        bad_all = d+e+gg+h+x+v+ex+qc_scrap+qc_oth2
        good = o+qc_qc+qc_oth
        bad = gg+x+ex
        overwarranty = d+e+qc_scrap+qc_oth2
        # 已使用年限：回廠過保數明細排除 其他(未過)
        age_mask = g['QC'].isin(['回廠報廢']) | (g['維修分類'].isin(['D /停產報廢','E /過保報廢']))
        ages = g.loc[age_mask, '已使用年限'].dropna()
        age = round(ages.mean(),1) if len(ages) else ''
        row = {'期間':PERIOD, '類型':s(g['廠牌型號'].dropna().iloc[0]) if g['廠牌型號'].notna().any() else '',
               '廠商': s(vend.iloc[0]) if len(vend) else '', 'ERP品號': erp,
               '品名': s(g['替換前品項'].iloc[0]), '上線量': int(onmap.get(erp,0))}
        main4 = fault_types[:-1]  # 其他以外的前四類
        for ft in main4: row[ft] = cnt(g,'維護類型',ft)
        row['其他'] = len(g) - sum(row[ft] for ft in main4)  # 冊03：其他=不屬於上列維護類型
        row['回廠量'] = len(g)
        row.update({'回廠不良品數(全)':bad_all,'回廠良品數':good,'回廠不良品數':bad,
                    '回廠過保數':overwarranty,'回廠人為數':h,'D /停產報廢':d,'E /過保報廢':e,
                    'G /評估後退修':gg,'H /人為報廢':h,'O /測試正常':o,'X /已完修':x,
                    '維修換貨＋換貨條碼':ex,'回廠QC':qc_qc,'回廠報廢':qc_scrap,'已使用年限':age})
        rows.append(row)
    return pd.DataFrame(rows)

車機 = build_summary('車機','訊號異常',['AB點','失聯','定位不良','訊號異常','其他'])
鏡頭 = build_summary('鏡頭','影像異常(鏡頭)',['黑畫面','進水/模糊','水波紋','時有時無','其他'])
print(f'\n[彙整總覽] 車機 {len(車機)} 品號 / 鏡頭 {len(鏡頭)} 品號')
車機.to_pickle('poc_車機.pkl'); 鏡頭.to_pickle('poc_鏡頭.pkl'); df.to_pickle('poc_df.pkl')

# ── 對帳：與現行總表 26Q1 比較 ────────────────────────────
CUR = r'C:\Users\EupUser\Desktop\品質分析\設備品質分析_分析總表.xlsx'
cur = pd.read_excel(CUR, '車機_彙整總覽')
cur = cur[cur['期間'].astype(str) == PERIOD].copy()
cur['ERP_str'] = cur['ERP品號'].map(lambda x: s(x).replace('.0',''))
mine = 車機.copy(); mine['ERP_str'] = mine['ERP品號']
print(f'\n== 對帳 車機 26Q1 ==  現行 {len(cur)} 列 / 重建 {len(mine)} 列')
CMP = ['上線量','AB點','失聯','定位不良','訊號異常','其他','回廠量','回廠不良品數(全)','回廠良品數','回廠過保數']
m = cur.merge(mine, on='ERP_str', suffixes=('_現','_我'), how='outer', indicator=True)
print('  只在一邊的品號:', (m['_merge']!='both').sum())
for c in CMP:
    a=c+'_現'; b=c+'_我'
    if a in m and b in m:
        both=m[m['_merge']=='both']
        diff=(both[a].fillna(0).astype(float)-both[b].fillna(0).astype(float)).abs()
        print(f'  {c:16s} 不符列數={int((diff>0.05).sum()):3d}  總差異={diff.sum():.1f}')
