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

  const $ = (id) => document.getElementById(id);
  let onAuthed = null; // 登入成功（含既有有效 session）後呼叫一次

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

  return { init, logout };
})();
