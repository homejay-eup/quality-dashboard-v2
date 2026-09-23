/**
 * js/auth.js — Google 登入介面閘（掛 App.auth）
 *
 * 純前端靜態網站（GitHub Pages，無後端），僅作為「介面層」門檔：
 * 擋不知道網址／不想登入的人看到儀表板畫面，不是真正的資料存取控制
 * （來源 Google Sheet 仍設為「知道連結的人可檢視」，見 js/sheets.js 的 ERR_PRIVATE）。
 * 只信任 Google userinfo 端點回傳的 email／email_verified，足以擋住隨手瀏覽，
 * 但技術能力足夠的人仍可繞過——之後若要做到「連資料也真的鎖住」，需改為限制
 * Sheet 分享對象＋改用 OAuth token 呼叫 Sheets API（後者已經是現在的做法）。
 *
 * 2026-09-23：改成單一 OAuth2 token client 同時要「身份」＋「讀取 Sheets」授權
 * （原本是 ID Token 登入＋另一套 OAuth2 token client 分兩步各跳一次同意畫面，
 * 使用者反映體驗不好）。合併後身份判斷改用 access token 打 userinfo 端點，
 * 不再解析 ID Token JWT；一次同意涵蓋兩種用途，只跳一次畫面。
 *
 * 依賴：https://accounts.google.com/gsi/client（需先於本檔載入）
 * 由 index.html 於 DOMContentLoaded 呼叫 App.auth.init()；登入成功才會呼叫 App.app.init()。
 */
window.App = window.App || {};

App.auth = (() => {
  const CLIENT_ID = '49182385706-96bcusg30519r5q8tioleovdqmoti4d7.apps.googleusercontent.com';
  const ALLOWED_DOMAIN = 'eup.com.tw';
  const SESSION_KEY = 'eup_auth_session_v1';
  const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

  // ── OAuth2 Token Client：一次涵蓋「確認身份」（email/profile）＋「讀取私有 Sheet
  // 車機鏡頭上線明細」（spreadsheets.readonly）兩種用途，只跳一次同意畫面。──
  const SCOPE = 'email profile https://www.googleapis.com/auth/spreadsheets.readonly';
  const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 到期前 5 分鐘背景換發，避免使用者中途撞到 401

  const $ = (id) => document.getElementById(id);
  let onAuthed = null; // 登入成功（含既有有效 session）後呼叫一次

  let tokenClient = null;              // google.accounts.oauth2 的 token client（延遲建立）
  let sheetsToken = null;              // { accessToken, expiresAt(ms epoch) }
  let refreshTimer = null;
  let pendingResolve = null;           // 目前這一次 requestAccessToken() 呼叫對應的 Promise resolve/reject
  let pendingReject = null;
  let tokenPromise = null;             // 進行中（尚未回應）的授權請求，getSheetsToken() 可等待同一個結果

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
        <div class="auth-card__btn">
          <button type="button" class="google-btn" id="auth-login-btn">
            <svg class="google-btn__icon" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
            </svg>
            <span>使用 Google 帳戶登入</span>
          </button>
        </div>
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
    sheetsToken = null;
    clearTimeout(refreshTimer);
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
    refreshTimer = setTimeout(() => { fireTokenRequest({ prompt: '' }).catch(() => {}); }, delay);
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
      scope: SCOPE,
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
   * 供登入按鈕的點擊回呼（handleLoginClick）與 KPI 卡「重試」按鈕呼叫。
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

  /** 用拿到的 access token 打 Google userinfo 端點換身份資訊（取代原本解析 ID Token JWT）。*/
  async function fetchUserInfo(accessToken) {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`讀取使用者資訊失敗（HTTP ${res.status}）`);
    return res.json(); // { email, email_verified, name, picture, ... }
  }

  /**
   * 登入按鈕點擊：一次跳出同意畫面，同時取得「身份」＋「Sheets 讀取」授權（SCOPE 已合併兩者）。
   * fireTokenRequest() 必須在這個點擊的同一個呼叫堆疊內同步送出（見 fireTokenRequest 說明），
   * 拿到 access token 後才非同步去 userinfo 端點換身份、判斷網域——這段不影響彈出視窗封鎖判斷。
   */
  async function handleLoginClick() {
    let accessToken;
    try {
      accessToken = await fireTokenRequest();
    } catch (err) {
      showErr('登入授權失敗，請重試（若瀏覽器擋下了 Google 的彈出視窗，請允許後再試一次）。');
      return;
    }
    let info;
    try {
      info = await fetchUserInfo(accessToken);
    } catch {
      showErr('讀取帳號資訊失敗，請重試。');
      return;
    }
    const email = info.email || '';
    const verified = info.email_verified === true || info.email_verified === 'true';
    if (!verified || !email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
      showErr(`僅限 @${ALLOWED_DOMAIN} 網域的公司 Google 帳號登入，請改用公司帳號重試。`);
      sheetsToken = null;
      clearTimeout(refreshTimer);
      return;
    }
    const session = {
      email, name: info.name || email, picture: info.picture || '',
      exp: Math.floor((sheetsToken ? sheetsToken.expiresAt : Date.now() + 3600000) / 1000),
    };
    saveSession(session);
    proceed(session);
  }

  function initLoginUI() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      showErr('Google 登入元件載入失敗，請確認網路連線（或防火牆是否封鎖 accounts.google.com）後重新整理。');
      return;
    }
    if (CLIENT_ID.startsWith('YOUR_')) {
      showErr('尚未設定 Google OAuth Client ID，請洽系統管理員完成登入設定。');
      return;
    }
    const btn = $('auth-login-btn');
    if (btn) btn.addEventListener('click', handleLoginClick);
  }

  /**
   * @param {() => void} onSuccess - 驗證通過（含既有有效 session）時呼叫一次
   */
  function init(onSuccess) {
    onAuthed = onSuccess;
    const session = loadSession();
    if (session) {
      // 走快取 session 這條路徑時沒有使用者點擊手勢（跳過了登入按鈕），無法比照
      // handleLoginClick() 用點擊手勢跳出同意畫面；改嘗試靜默換發（prompt:''），
      // 只有先前已同意過才會成功、不會跳出任何畫面。失敗不影響登入本身（session 本身
      // 還沒過期），沿用既有「無法載入，點選重試」機制兜底（見 js/app.js retryOnlineAge）。
      fireTokenRequest({ prompt: '' }).catch(() => {});
      proceed(session);
      return;
    }
    showOverlay();
    initLoginUI();
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
