/**
 * js/auth.js — Google 登入介面閘（掛 App.auth）
 *
 * 純前端靜態網站（GitHub Pages，無後端），僅作為「介面層」門檔：
 * 擋不知道網址／不想登入的人看到儀表板畫面，不是真正的資料存取控制
 * （來源 Google Sheet 仍設為「知道連結的人可檢視」，見 js/sheets.js 的 ERR_PRIVATE）。
 * 只信任 Google ID Token 的 email／email_verified／hd claim（前端解析、未驗證簽章），
 * 足以擋住隨手瀏覽，但技術能力足夠的人仍可繞過——之後若要做到「連資料也真的鎖住」，
 * 需改為限制 Sheet 分享對象＋改用 OAuth token 呼叫 Sheets API。
 *
 * 依賴：https://accounts.google.com/gsi/client（需先於本檔載入）
 * 由 index.html 於 DOMContentLoaded 呼叫 App.auth.init()；登入成功才會呼叫 App.app.init()。
 */
window.App = window.App || {};

App.auth = (() => {
  const CLIENT_ID = '49182385706-96bcusg30519r5q8tioleovdqmoti4d7.apps.googleusercontent.com';
  const ALLOWED_DOMAIN = 'eup.com.tw';
  const SESSION_KEY = 'eup_auth_session_v1';

  // ── OAuth2 Token Client（供 js/sheets.js 讀取私有 Sheet「車機鏡頭上線明細」用）──
  // 與上方 ID Token 登入流程是兩套獨立機制：ID Token 只證明身份，這裡才是能呼叫
  // Google API 的 access token。SHEETS_SCOPE 唯讀即可，不需要寫入權限。
  const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
  const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 到期前 5 分鐘背景換發，避免使用者中途撞到 401

  const $ = (id) => document.getElementById(id);
  let onAuthed = null; // 登入成功（含既有有效 session）後呼叫一次

  let tokenClient = null;              // google.accounts.oauth2 的 token client（延遲建立）
  let sheetsToken = null;              // { accessToken, expiresAt(ms epoch) }
  let refreshTimer = null;
  let pendingResolve = null;           // 目前這一次 requestAccessToken() 呼叫對應的 Promise resolve/reject
  let pendingReject = null;
  let tokenPromise = null;             // 進行中（尚未回應）的授權請求，getSheetsToken() 可等待同一個結果

  function decodeJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    );
    return JSON.parse(json);
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.exp || Date.now() / 1000 >= s.exp) { localStorage.removeItem(SESSION_KEY); return null; }
      return s;
    } catch { return null; }
  }

  function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  function buildOverlay() {
    const el = document.createElement('div');
    el.id = 'auth-overlay';
    el.className = 'auth-overlay';
    el.innerHTML = `
      <div class="auth-card">
        <div class="auth-card__icon">${App.icons.lock()}</div>
        <div class="auth-card__title">設備品質分析</div>
        <div class="auth-card__sub">EUP 弋揚科技　內部工具，請使用公司 Google 帳號登入</div>
        <div class="auth-card__btn" id="auth-gsi-btn"></div>
        <div class="auth-card__err" id="auth-err" hidden></div>
      </div>`;
    document.body.appendChild(el);
    return el;
  }

  function showOverlay() {
    let el = $('auth-overlay');
    if (!el) el = buildOverlay();
    el.hidden = false;
  }
  function hideOverlay() { const el = $('auth-overlay'); if (el) el.hidden = true; }

  function showErr(msg) {
    const el = $('auth-err');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function renderUserSlot(session) {
    const slot = $('auth-user-slot');
    if (!slot) return;
    slot.innerHTML = `
      <span class="auth-user__email">${session.name || session.email}</span>
      <button type="button" class="auth-user__logout" id="auth-logout-btn" title="登出">${App.icons.logout()}</button>`;
    $('auth-logout-btn').addEventListener('click', logout);
  }

  function logout() {
    clearSession();
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    location.reload();
  }

  function proceed(session) {
    hideOverlay();
    renderUserSlot(session);
    if (onAuthed) { const cb = onAuthed; onAuthed = null; cb(); }
  }

  // ── OAuth2 Token Client 內部工具 ──────────────────────

  /** Sheets 授權失敗時統一包成可識別的 Error（code='SHEETS_AUTH_REQUIRED'），供呼叫端判斷是否要顯示重試 UI。*/
  function buildSheetsAuthError(reason) {
    const err = new Error(`Sheets 讀取授權失敗：${reason || '未知原因'}`);
    err.code = 'SHEETS_AUTH_REQUIRED';
    return err;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!sheetsToken) return;
    const delay = Math.max(sheetsToken.expiresAt - Date.now() - TOKEN_REFRESH_MARGIN_MS, 10000);
    // 已授權過的背景換發：prompt: '' 只在已同意過的情況下才會靜默完成，不需使用者手勢。
    refreshTimer = setTimeout(() => { fireTokenRequest({ prompt: '' }); }, delay);
  }

  function handleTokenResponse(resp) {
    if (!resp || resp.error) {
      sheetsToken = null;
      if (pendingReject) pendingReject(buildSheetsAuthError(resp && resp.error));
      pendingResolve = null; pendingReject = null; tokenPromise = null;
      return;
    }
    const expiresInSec = Number(resp.expires_in) || 3600;
    sheetsToken = { accessToken: resp.access_token, expiresAt: Date.now() + expiresInSec * 1000 };
    scheduleRefresh();
    if (pendingResolve) pendingResolve(sheetsToken.accessToken);
    pendingResolve = null; pendingReject = null; tokenPromise = null;
  }

  function ensureTokenClient() {
    if (tokenClient) return tokenClient;
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      throw buildSheetsAuthError('Google OAuth 元件載入失敗');
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SHEETS_SCOPE,
      callback: handleTokenResponse,
    });
    return tokenClient;
  }

  /**
   * 送出一次 access token 請求。⚠️ 只有在「使用者點擊事件的同一個呼叫堆疊」內同步呼叫，
   * 才不會被瀏覽器彈出視窗封鎖擋掉（見檔案開頭說明）；背景換發（scheduleRefresh 的計時器）
   * 因為帶 prompt:''、且先前已同意過，屬例外、不需要使用者手勢。
   * @param {Object} [opts] - 傳給 google.accounts.oauth2 的 requestAccessToken()，例如 { prompt: '' }
   * @returns {Promise<string>} resolve 為 access token；被拒絕/失敗則 reject（Error.code='SHEETS_AUTH_REQUIRED'）
   */
  function fireTokenRequest(opts) {
    let client;
    try { client = ensureTokenClient(); } catch (err) { return Promise.reject(err); }
    tokenPromise = new Promise((resolve, reject) => { pendingResolve = resolve; pendingReject = reject; });
    client.requestAccessToken(opts);
    return tokenPromise;
  }

  /**
   * 供「Sign In With Google」按鈕的登入回呼（handleCredentialResponse）與 KPI 卡「重試」按鈕呼叫。
   * 兩者都是使用者點擊的同步回呼，符合觸發條件。
   */
  function requestSheetsAccess() { return fireTokenRequest(); }

  /**
   * 供 js/sheets.js 取用目前的 access token。
   * - 快取仍有效 → 立即 resolve
   * - 有進行中的授權請求（例如剛剛登入時觸發的那一次還沒回應）→ 等同一個 Promise
   * - 兩者皆無（例如舊 session 快速通過、未曾觸發過 OAuth）→ 直接 reject，交由呼叫端顯示重試 UI
   * @returns {Promise<string>}
   */
  function getSheetsToken() {
    if (sheetsToken && sheetsToken.expiresAt > Date.now() + 10000) {
      return Promise.resolve(sheetsToken.accessToken);
    }
    if (tokenPromise) return tokenPromise;
    return Promise.reject(buildSheetsAuthError('尚未取得 Sheets 讀取授權，請點選重試'));
  }

  function handleCredentialResponse(resp) {
    let payload;
    try { payload = decodeJwt(resp.credential); } catch { showErr('登入資料解析失敗，請重試。'); return; }
    const email = payload.email || '';
    const verified = payload.email_verified === true || payload.email_verified === 'true';
    if (!verified || !email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
      showErr(`僅限 @${ALLOWED_DOMAIN} 網域的公司 Google 帳號登入，請改用公司帳號重試。`);
      if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
      return;
    }
    const session = { email, name: payload.name || email, picture: payload.picture || '', exp: payload.exp };
    saveSession(session);
    // ⚠️ 緊接著同步呼叫（不 await、不包 setTimeout），沿用這次使用者點擊登入按鈕的合法使用者手勢，
    // 才能讓 requestAccessToken() 跳出的同意畫面不被瀏覽器彈出視窗封鎖擋掉。
    // 失敗不擋登入流程，交由 KPI 卡片的「無法載入，點選重試」機制處理（見 js/app.js）。
    requestSheetsAccess().catch(() => {});
    proceed(session);
  }

  function initGsi() {
    if (!window.google || !google.accounts || !google.accounts.id) {
      showErr('Google 登入元件載入失敗，請確認網路連線（或防火牆是否封鎖 accounts.google.com）後重新整理。');
      return;
    }
    if (CLIENT_ID.startsWith('YOUR_')) {
      showErr('尚未設定 Google OAuth Client ID，請洽系統管理員完成登入設定。');
      return;
    }
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: handleCredentialResponse,
      hd: ALLOWED_DOMAIN,
      auto_select: true,
    });
    google.accounts.id.renderButton($('auth-gsi-btn'), {
      type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'zh_TW',
    });
    google.accounts.id.prompt(); // One Tap：已登入 Google 且曾授權過可直接免點擊完成
  }

  /**
   * @param {() => void} onSuccess - 驗證通過（含既有有效 session）時呼叫一次
   */
  function init(onSuccess) {
    onAuthed = onSuccess;
    const session = loadSession();
    if (session) { proceed(session); return; }
    showOverlay();
    initGsi();
  }

  return {
    init,
    logout,
    /** 供 KPI 卡「重試」按鈕呼叫：必須在使用者點擊事件的同步回呼內呼叫，見上方 fireTokenRequest 說明。*/
    requestSheetsAccess,
    /** 供 js/sheets.js 取得目前 access token；Promise reject 時 err.code === 'SHEETS_AUTH_REQUIRED'。*/
    getSheetsToken,
  };
})();
