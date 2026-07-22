/**
 * 設備品質分析工具 — 共用雲端快照接收端
 *
 * 兩種存檔方式：
 *   1. 快照（原始資料）：直接在 Google 內部把來源 Sheet 複製一份到共用資料夾
 *      （Drive 對 Drive，不經過瀏覽器上傳，速度快、無檔案大小限制問題）。
 *   2. 落地頁報告（HTML）：工具產生的自帶資料報告，檔案小，走一般上傳。
 *
 * 部署步驟見 apps-script/README.md（一次性設定，交給有 Google 帳號權限的人做）。
 */

// ===== 唯一要改的地方：填入共用 Drive 資料夾的 ID =====
// 資料夾網址類似 https://drive.google.com/drive/folders/1AbCdEfGhIjKlmNo... → 取最後那段
const FOLDER_ID = '1q8l41VrjJsNxYif02UcvpVr7vI_5S0yl';

/**
 * GET：
 *   ?action=list                          列出資料夾內快照/報告
 *   ?action=get&id=xxx                    讀取單一檔案內容（純文字，如 HTML 報告）
 *   ?action=snapshotSheet&sheetId=xxx&label=xxx   複製來源 Sheet 到共用資料夾（快照本體）
 */
function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'list') return jsonOut(listFiles());
    if (action === 'get') return rawOut(getFileContent(e.parameter.id));
    if (action === 'snapshotSheet') return jsonOut(snapshotSheet(e.parameter.sheetId, e.parameter.label));
    return jsonOut({ ok: false, error: '未知的 action：' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/** POST：?action=upload&filename=xxx&mimeType=xxx，內容（如落地頁報告 HTML）放在 request body */
function doPost(e) {
  try {
    const action = e.parameter.action;
    if (action === 'upload') return jsonOut(uploadFile(e));
    return jsonOut({ ok: false, error: '未知的 action：' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/**
 * Drive 對 Drive 直接複製來源 Sheet（不經過瀏覽器，無大小限制問題）。
 * 複本預設為私有（不會繼承來源的公開分享設定），這裡明確設為「知道連結的人可檢視」，
 * 否則工具之後用 gviz 讀不到複本內容。
 */
function snapshotSheet(sheetId, label) {
  if (!sheetId) throw new Error('缺少 sheetId 參數');
  const src = DriveApp.getFileById(sheetId);
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const name = '品質快照_' + (label || Utilities.formatDate(new Date(), 'GMT+8', 'yyyyMMdd_HHmmss'));
  const copy = src.makeCopy(name, folder);
  copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, id: copy.getId(), name: copy.getName(), mimeType: copy.getMimeType() };
}

function uploadFile(e) {
  const filename = e.parameter.filename || ('報告_' + new Date().toISOString());
  const mimeType = e.parameter.mimeType || 'text/plain';
  const content = e.postData && e.postData.contents;
  if (!content) throw new Error('沒有收到檔案內容');

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const file = folder.createFile(filename, content, mimeType);
  return { ok: true, id: file.getId(), name: file.getName(), size: file.getSize() };
}

function listFiles() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const it = folder.getFiles();
  const files = [];
  while (it.hasNext()) {
    const f = it.next();
    const name = f.getName();
    const mimeType = f.getMimeType();
    const isSheet = mimeType === MimeType.GOOGLE_SHEETS;
    const isReport = /\.html$/i.test(name);
    const isLegacyJson = /\.json$/i.test(name); // 舊版 JSON 快照，保留相容
    if (isSheet || isReport || isLegacyJson) {
      files.push({
        id: f.getId(),
        name: name,
        mimeType: mimeType,
        kind: isSheet ? 'sheet' : (isReport ? 'report' : 'json'),
        size: isSheet ? null : f.getSize(), // Google 原生文件無實體位元組大小
        createdAt: f.getDateCreated().toISOString(),
      });
    }
  }
  files.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
  return { ok: true, files: files };
}

function getFileContent(id) {
  if (!id) throw new Error('缺少 id 參數');
  const file = DriveApp.getFileById(id);
  return file.getBlob().getDataAsString('UTF-8');
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 直接輸出檔案原始內容（不包 JSON 外殼），供 cloud.js 用 parseSnapshot 直接解析（舊版 JSON 快照相容用）*/
function rawOut(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
