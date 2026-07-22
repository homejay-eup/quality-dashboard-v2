/**
 * js/cloud.js — 共用雲端快照接收端串接（掛 App.cloud）
 *
 * 對接 apps-script/Code.gs 部署出的 Web App：
 *   POST ?action=upload&filename=..&mimeType=..  body=檔案內容（text/plain 避免預檢請求）
 *   GET  ?action=list                             → { ok, files:[{id,name,mimeType,size,createdAt}] }
 *   GET  ?action=get&id=..                         → 檔案原始內容（快照為 JSON 字串）
 *
 * App.config.CLOUD_ENDPOINT 未設定時，enabled() 為 false，各功能自動停用（工具其餘部分不受影響）。
 */
window.App = window.App || {};

App.cloud = (() => {
  function endpoint() { return String(App.config.CLOUD_ENDPOINT || '').trim(); }
  function enabled() { return !!endpoint(); }

  async function upload(content, filename, mimeType) {
    if (!enabled()) throw new Error('尚未設定共用雲端連結（App.config.CLOUD_ENDPOINT），請見 apps-script/README.md 部署後設定');
    const url = `${endpoint()}?action=upload&filename=${encodeURIComponent(filename)}&mimeType=${encodeURIComponent(mimeType)}`;
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: content });
    } catch { throw new Error('無法連線到共用雲端接收端（網路或部署網址錯誤）'); }
    if (!res.ok) throw new Error(`上傳失敗（HTTP ${res.status}）`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '上傳失敗');
    return json;
  }

  async function list() {
    if (!enabled()) return [];
    let res;
    try {
      res = await fetch(`${endpoint()}?action=list`);
    } catch { throw new Error('無法連線到共用雲端接收端（網路或部署網址錯誤）'); }
    if (!res.ok) throw new Error(`讀取雲端清單失敗（HTTP ${res.status}）`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '讀取清單失敗');
    return json.files || [];
  }

  /** 舊版相容：讀取以純文字（JSON）方式上傳的快照檔 */
  async function fetchSnapshotById(id) {
    const res = await fetch(`${endpoint()}?action=get&id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`讀取快照失敗（HTTP ${res.status}）`);
    const text = await res.text();
    return App.report.parseSnapshot(text);
  }

  /**
   * 快照本體：請 Apps Script 在 Google 內部直接複製來源 Sheet 到共用資料夾
   * （Drive 對 Drive，不經瀏覽器上傳，無檔案大小限制問題）。
   * @param {string} sheetId - 來源 Sheet ID（App.config.SHEET_ID）
   * @param {string} [label] - 檔名標示（如 2026-Q2_2026-07-21）
   * @returns {Promise<{ok:boolean, id:string, name:string, mimeType:string}>}
   */
  async function snapshotSheet(sheetId, label) {
    if (!enabled()) throw new Error('尚未設定共用雲端連結（App.config.CLOUD_ENDPOINT），請見 apps-script/README.md 部署後設定');
    let res;
    try {
      res = await fetch(`${endpoint()}?action=snapshotSheet&sheetId=${encodeURIComponent(sheetId)}&label=${encodeURIComponent(label || '')}`);
    } catch { throw new Error('無法連線到共用雲端接收端（網路或部署網址錯誤）'); }
    if (!res.ok) throw new Error(`快照失敗（HTTP ${res.status}）`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '快照失敗');
    return json;
  }

  /**
   * 載入某個雲端 Sheet 快照副本的資料（用它自己的檔案 ID 當 Sheet ID 讀取），
   * 包成與 App.sheets.loadAll() 相同結構，可直接餵給 App.transform.buildDetail。
   * @param {string} fileId
   * @param {string} [name]
   * @returns {Promise<Object>}
   */
  async function loadSheetCopyAsRaw(fileId, name) {
    const raw = await App.sheets.loadAll(fileId);
    return { ...raw, meta: { period: null, source: 'cloud-sheet', name: name || fileId } };
  }

  return { enabled, upload, list, fetchSnapshotById, snapshotSheet, loadSheetCopyAsRaw };
})();
