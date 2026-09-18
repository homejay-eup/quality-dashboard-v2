# -*- coding: utf-8 -*-
"""
驗證用腳本：直接從 設備品質分析_資料庫_{YY}_{Qn}.xlsm 出發，
完全依照 設備品質分析_分冊文件 冊01(Step1-8) + 冊03(v4) 的文字規格重建 車機/鏡頭_彙整總覽，
與現行 設備品質分析_分析總表.xlsx 逐欄逐列對帳。

目的：把「分冊文件規則本身對不對」跟「Google Sheet 資料是否與 xlsm 有差異」這兩件事分開驗證。
本腳本刻意不用 Google Sheet 的 關鍵字對照表，改用 00_規則定義.md 規則A 原始 hardcode 關鍵字，
且用 xlsm 的 進貨日(PQ) 明細 lookup（而非 Google Sheet SQL_派工 內建的 替換前進貨日）。
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import pandas as pd

ROOT = r'C:\Users\EupUser\Desktop\品質分析'
CUR = ROOT + r'\設備品質分析_分析總表.xlsx'


def s(x):
    return '' if pd.isna(x) else str(x).strip()


# 規則A：維護類型（00_規則定義.md 原文，依優先順序）
MAINT_RULES = [
    ('失聯', ['失聯', '無法連線', '無法開機', '無法開啟']),
    ('訊號異常', ['訊號異常', '訊號', '補傳', '大量補傳', '延遲', '熄火在跑', '車機異常', '車機NG',
               '車機故障', '觸發異常', '開關機', '重複開關機', '重開關機', '重開機']),
    ('定位不良', ['定位不良', '定位', '定位V', 'AB點']),
    ('酒測異常', ['酒測異常', '酒測器異常', '酒測故障', '酒測器故障', '酒測數值異常', '酒測值異常',
               '酒測值不準', '酒測不準', '酒測連不到', '酒測無法連線']),
    ('進水/模糊', ['進水', '模糊', '浸水']),
    ('水波紋', ['水波紋']),
    ('時有時無', ['時有時無']),
    ('AB對調', ['AB對調', 'AB拆換']),
    ('黑畫面', ['黑畫面', '黑藍畫面', '黑白畫面', '藍畫面', '白畫面', '黑屏', '黑頻', '白屏', '白頻']),
    ('硬碟發報異常', ['無法錄影', '硬碟發報異常']),
]


def maint_type(detail):
    t = s(detail)
    if t == '':
        return '其他'
    for label, kws in MAINT_RULES:
        for k in kws:
            if k in t:
                return label
    return '其他'


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


def qc(row):
    mc, dev, age = row['維修分類'], row['設備類型'], row['已使用年限']
    has_scrap = s(row['報廢原因']) != ''
    if mc == 'O /測試正常':
        return '廠商檢測正常'
    if mc in ('X /已完修', 'V /已完修 人為', '維修換貨＋換貨條碼'):
        return '廠商完修'
    if mc in ('E /過保報廢', 'G /評估後退修', 'D /停產報廢', 'H /人為報廢'):
        return '廠商報廢'
    if mc == '無維修資訊' and has_scrap:
        if (dev == '鏡頭' and pd.notna(age) and age < 1) or (dev == '車機' and pd.notna(age) and age < 3):
            return '回廠其他'
        return '回廠報廢'
    if mc == '不送修' and not has_scrap:
        return '回廠QC'
    if mc == '無維修資訊' and not has_scrap:
        return '其他'
    return '其他'


def build_detail_from_xlsm(xlsm_path):
    派工 = pd.read_excel(xlsm_path, '派工量(PQ)')
    維修 = pd.read_excel(xlsm_path, '維修量(PQ)')
    報廢 = pd.read_excel(xlsm_path, '報廢量(PQ)')
    上線 = pd.read_excel(xlsm_path, '上線量(PQ)')
    進貨 = pd.read_excel(xlsm_path, '進貨日(PQ)')
    類型清單 = pd.read_excel(xlsm_path, '類型清單')
    品號對照 = pd.read_excel(xlsm_path, '品號對照表')

    df = 派工.copy()

    # Step2: merge 維修/報廢（依替換前品項條碼）
    def sb(x):
        v = s(x)
        return v if v else None

    維修u = 維修.drop_duplicates('條碼', keep='last')
    報廢u = 報廢.drop_duplicates('條碼', keep='last')
    df['bc'] = df['替換前品項條碼'].map(sb)
    df = df.merge(維修u.assign(bc=維修u['條碼'].map(sb)).dropna(subset=['bc'])[['bc', '完成原因']], on='bc', how='left')
    df = df.merge(報廢u.assign(bc=報廢u['條碼'].map(sb)).dropna(subset=['bc'])[['bc', '報廢單狀態', '報廢原因']], on='bc', how='left')

    # Step2: merge 類型清單（依替換前品項），Step2.7 廠商備援
    tl = 類型清單.rename(columns={'廠牌型號(設備類型分類)': '廠牌型號'}).copy()
    tl['替換前品項'] = tl['替換前品項'].map(s)
    tl = tl.drop_duplicates('替換前品項')
    df['替換前品項'] = df['替換前品項'].map(s)
    df = df.merge(tl[['替換前品項', 'ERP品號', '設備類型', '廠牌型號', '廠商']], on='替換前品項', how='left')

    品號對照 = 品號對照.rename(columns={'品號\n開頭': '品號開頭'}).copy()
    品號對照['品號_str'] = 品號對照['品號'].map(s)
    vmap = 品號對照.drop_duplicates('品號_str').set_index('品號_str')['主供應商名稱']
    df['ERP_str'] = df['ERP品號'].map(lambda x: s(x).replace('.0', ''))
    mask = df['廠商'].isna() & df['ERP品號'].notna()
    df.loc[mask, '廠商'] = df.loc[mask, 'ERP_str'].map(vmap)

    # Step4: 上線量（原始明細 groupby QP_Code）
    on_cnt = 上線.groupby('QP_Code').size()
    df['上線量'] = df['ERP_str'].map(on_cnt)

    # Step5/6: 維護類型 / 維修分類
    df['維護類型'] = df['維護細節'].map(maint_type)
    df['維修分類'] = df['完成原因'].map(repair_class)

    # Step7: 進貨日 / 已使用年限
    lookup = 進貨.set_index(進貨['條碼'].map(s))['首次出現時間']
    df['進貨日'] = df['替換前品項條碼'].map(lambda x: lookup.get(s(x)) if s(x) else None)
    df['完工_dt'] = pd.to_datetime(df['品項完工日期'], errors='coerce')
    df['進貨_dt'] = pd.to_datetime(df['進貨日'], errors='coerce')
    df['已使用年限'] = ((df['完工_dt'] - df['進貨_dt']).dt.days / 365).round(1)

    # Step8: QC
    df['QC'] = df.apply(qc, axis=1)
    return df


def cnt(g, col, val):
    return int((g[col] == val).sum())


def build_overview(detail, dev_type, maint_reason, fault_types):
    sub = detail[(detail['設備類型'] == dev_type) & (detail['維護原因'] == maint_reason)].copy()
    rows = []
    for erp, g in sub.groupby('ERP_str'):
        if erp == '' or pd.isna(erp):
            continue
        vend = g['廠商'].dropna()
        d = cnt(g, '維修分類', 'D /停產報廢'); e = cnt(g, '維修分類', 'E /過保報廢')
        gg = cnt(g, '維修分類', 'G /評估後退修'); h = cnt(g, '維修分類', 'H /人為報廢')
        o = cnt(g, '維修分類', 'O /測試正常'); x = cnt(g, '維修分類', 'X /已完修')
        ex = cnt(g, '維修分類', '維修換貨＋換貨條碼')
        qc_qc = cnt(g, 'QC', '回廠QC'); qc_scrap = cnt(g, 'QC', '回廠報廢'); qc_oth = cnt(g, 'QC', '其他')
        bad_all = d + e + gg + h + x + ex + qc_scrap
        good = o + qc_qc + qc_oth
        bad = gg + x + ex
        overwarranty = d + e + qc_scrap
        age_mask = g['維修分類'].isin(['D /停產報廢', 'E /過保報廢']) | (g['QC'] == '回廠報廢')
        ages = g.loc[age_mask, '已使用年限'].dropna()
        age = round(ages.mean(), 1) if len(ages) else ''
        main4 = fault_types[:-1]
        row = {'類型': s(g['廠牌型號'].dropna().iloc[0]) if g['廠牌型號'].notna().any() else '',
               '廠商': s(vend.iloc[0]) if len(vend) else '', 'ERP品號': erp,
               '品名': s(g['替換前品項'].iloc[0]),
               '上線量': int(g['上線量'].dropna().iloc[0]) if g['上線量'].notna().any() else 0}
        for ft in main4:
            row[ft] = cnt(g, '維護類型', ft)
        row['其他'] = len(g) - sum(row[ft] for ft in main4)
        row['回廠量'] = len(g)
        row.update({'回廠不良品數(全)': bad_all, '回廠良品數': good, '回廠不良品數': bad,
                     '回廠過保數': overwarranty, '回廠人為數': h, '已使用年限': age})
        rows.append(row)
    return pd.DataFrame(rows)


def verify(period_code, xlsm_path):
    print(f'\n{"="*60}\n驗證期間：{period_code}（來源：{xlsm_path.split(chr(92))[-1]}）\n{"="*60}')
    detail = build_detail_from_xlsm(xlsm_path)
    print(f'派工明細列數：{len(detail)}')

    for dev, reason, faults, sheet in [
        ('車機', '訊號異常', ['AB點', '失聯', '定位不良', '訊號異常', '其他'], '車機_彙整總覽'),
        ('鏡頭', '影像異常(鏡頭)', ['黑畫面', '進水/模糊', '水波紋', '時有時無', '其他'], '鏡頭_彙整總覽'),
    ]:
        mine = build_overview(detail, dev, reason, faults)
        cur = pd.read_excel(CUR, sheet)
        cur = cur[cur['期間'].astype(str) == period_code].copy()
        cur['ERP_str'] = cur['ERP品號'].map(lambda x: s(x).replace('.0', ''))
        mine2 = mine.rename(columns={'ERP品號': 'ERP_str'})
        m = cur.merge(mine2, on='ERP_str', suffixes=('_現', '_驗'), how='outer', indicator=True)
        n_only = int((m['_merge'] != 'both').sum())
        print(f'\n[{dev}] 現行 {len(cur)} 列 / 驗證重建 {len(mine)} 列　只在一邊的品號數：{n_only}')
        CMP = faults + ['回廠量', '回廠不良品數(全)', '回廠良品數', '回廠過保數', '上線量']
        both = m[m['_merge'] == 'both']
        all_ok = n_only == 0
        for c in CMP:
            a, b = c + '_現', c + '_驗'
            if a in m.columns and b in m.columns:
                d = (both[a].fillna(0).astype(float) - both[b].fillna(0).astype(float)).abs()
                bad = int((d > 0.05).sum())
                if bad:
                    all_ok = False
                print(f'  {c:16s} 不符列數={bad:3d}  總差異={d.sum():.1f}')
        print(f'  >>> {dev} {period_code}：{"完全一致 ✅" if all_ok else "有差異 ⚠️"}')


if __name__ == '__main__':
    verify('2025-Q1', ROOT + r'\設備品質分析_資料庫_25_Q1.xlsm')
    verify('2026-Q1', ROOT + r'\設備品質分析_資料庫_26_Q1.xlsm')
