/**
 * js/typelistcheck.js — 「類型清單待補提醒」（掛 App.typeListCheck）
 *
 * 只做提醒、不改任何計算結果：找出「上線量」分頁中，ERP品號沒被「類型清單」歸好類的品號
 * （這些品號會讓總線上量比 Google Sheet 少，見 App.metrics.buildOnlineList 的 join 邏輯）。
 *
 * 公開 API：
 *   App.typeListCheck.check(raw, deviceType)        — 純函式，回傳問題清單與影響量
 *   App.typeListCheck.render(el, state, deviceType) — 把提醒條渲染到 el（無問題＝清空不渲染）
 */
window.App = window.App || {};

App.typeListCheck = (() => {

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const fallbackEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ESC_MAP[m]);
  // 優先複用 tablefilter.js 既有的 esc
  const esc = (s) => ((App.tablefilter && App.tablefilter.esc) || fallbackEsc)(s);

  /**
   * 比對上線量分頁與類型清單。去重／去空白規則與 buildOnlineList 一致（同品號只算第一筆）。
   * 上線量為 0 的品號不列入問題。
   * @param {Object} raw - App.sheets.loadAll() 回傳值（讀 上線量、類型清單）
   * @param {string} deviceType - 只看上線量分頁「設備類型」等於此值的列（'車機'｜'鏡頭'）
   * @returns {{
   *   items: Array<{ERP品號:string, 品名:string, 上線量:number, 設備類型:string, kind:'miss'|'diff', 清單類型:string}>,
   *   impact: number,  // 問題品號上線量合計
   *   total: number,   // 該設備類型在 Sheet 上的上線量總和（去重後）
   * }}
   */
  function check(raw, deviceType) {
    const typeByERP = new Map();
    for (const r of (raw && raw.類型清單) || []) {
      const erp = String(r['ERP品號'] || '').trim();
      if (erp && !typeByERP.has(erp)) typeByERP.set(erp, r);
    }
    const seen = new Set();
    const items = [];
    let impact = 0, total = 0;
    for (const r of (raw && raw.上線量) || []) {
      const erp = String(r['ERP品號'] || '').trim();
      if (!erp || seen.has(erp)) continue;
      seen.add(erp);
      const sheetType = String(r['設備類型'] || '').trim();
      if (sheetType !== deviceType) continue;
      const qty = Number(r['上線量']) || 0;
      total += qty;
      if (qty <= 0) continue;
      const typeRow = typeByERP.get(erp);
      let kind = null, listType = '';
      if (!typeRow) kind = 'miss';
      else {
        listType = String(typeRow['設備類型'] || '').trim();
        if (listType !== sheetType) kind = 'diff';
      }
      if (!kind) continue;
      impact += qty;
      items.push({ ERP品號: erp, 品名: String(r['品名'] || '').trim(), 上線量: qty, 設備類型: sheetType, kind, 清單類型: listType });
    }
    items.sort((a, b) => b.上線量 - a.上線量);
    return { items, impact, total };
  }

  function fmtImpact(n) {
    if (n >= 10000) return `約 ${(Math.round(n / 1000) / 10).toLocaleString('en-US')} 萬`;
    return `約 ${Math.round(n).toLocaleString('en-US')}`;
  }
  function fmtPct(p) { return p >= 10 ? String(Math.round(p)) : String(Math.round(p * 10) / 10); }

  /**
   * 渲染提醒條。任何例外都吞掉（只 console.warn），不影響主畫面。
   * 載入快照時（state.currentSnap 有值）不顯示。
   */
  function render(el, state, deviceType) {
    if (!el) return;
    try {
      el.innerHTML = '';
      if (!state || state.currentSnap || !state.raw) return;
      const { items, impact, total } = check(state.raw, deviceType);
      if (!items.length) return;
      const pct = total > 0 ? (impact / total) * 100 : 0;
      const rows = items.map((it) => `<tr>
          <td>${esc(it.ERP品號)}</td><td>${esc(it.品名)}</td>
          <td class="num">${it.上線量.toLocaleString('en-US')}</td><td>${esc(it.設備類型)}</td>
          <td>${it.kind === 'miss'
            ? '<span class="type-notice__tag type-notice__tag--miss">類型清單找不到</span>'
            : `<span class="type-notice__tag type-notice__tag--diff">類型清單判為「${esc(it.清單類型 || '空白')}」</span>`}</td>
        </tr>`).join('');
      el.innerHTML = `<div class="type-notice">
        <div class="type-notice__head">
          <span class="type-notice__icon" aria-hidden="true">⚠</span>
          <span class="type-notice__text">「類型清單」有 <b>${items.length}</b> 個上線品號沒歸好類，影響總線上量${fmtImpact(impact)}（占 ${fmtPct(pct)}%）；數字會比 Google Sheet 少。</span>
          <button type="button" class="type-notice__btn" aria-expanded="false">查看清單 ▾</button>
        </div>
        <div class="type-notice__body" hidden>
          <div class="type-notice__scroll"><table class="type-notice__table">
            <thead><tr><th>ERP品號</th><th>品名</th><th class="num">上線量</th><th>Sheet 上標的類型</th><th>問題</th></tr></thead>
            <tbody>${rows}</tbody></table></div>
          <div class="type-notice__hint">到 Google Sheet 的「類型清單」分頁補上這些 ERP品號（設備類型、廠牌型號、廠商）後，重新整理就會消失。這裡只是提醒，不會改變任何計算結果。</div>
        </div>
      </div>`;
      const btn = el.querySelector('.type-notice__btn');
      const body = el.querySelector('.type-notice__body');
      btn.addEventListener('click', () => {
        const open = body.hidden;
        body.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = open ? '收合 ▴' : '查看清單 ▾';
      });
    } catch (err) {
      console.warn('類型清單提醒渲染失敗（已略過）', err);
      try { el.innerHTML = ''; } catch (_) { /* ignore */ }
    }
  }

  return { check, render };
})();
