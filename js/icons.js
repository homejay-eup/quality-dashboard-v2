/**
 * js/icons.js — 線性 SVG 圖示（掛 App.icons）
 *
 * 取代原本的彩色 emoji（🚗📷🖨📥☁️✕🧭💾📊）。
 * 每個圖示都是 24x24 viewBox 的純線條 SVG 字串：
 *   - width/height="1em"：字級隨所在文字大小縮放（跟 icon font 一樣好用）
 *   - stroke="currentColor"：顏色沿用所在元素的 color（按鈕白字、teal 標題...都自動跟上）
 *   - 只能用在 innerHTML／HTML 字串拼接的地方；<option>、textarea.value 等純文字欄位無法插入 SVG，
 *     那些地方維持原本的文字/emoji。
 */
window.App = window.App || {};

App.icons = (() => {
  const base = 'viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" ' +
    'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true" focusable="false"';

  const svg = (inner) => `<svg ${base}>${inner}</svg>`;

  return {
    // 🚗 車機
    car: () => svg(
      '<path d="M3 16h1.2l1-4.6A2 2 0 0 1 7.1 10h9.8a2 2 0 0 1 1.9 1.4l1 4.6H21"/>' +
      '<path d="M3 16v2.5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V17"/>' +
      '<path d="M18 16v2.5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V17"/>' +
      '<circle cx="7" cy="16.5" r="1.5"/><circle cx="17" cy="16.5" r="1.5"/>' +
      '<path d="M6 10l1.5-3h9L18 10"/>'
    ),
    // 📷 鏡頭
    camera: () => svg(
      '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-1.5h7l1 1.5h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z"/>' +
      '<circle cx="12" cy="12.5" r="3.2"/>'
    ),
    // 🖨 生成落地頁報告
    printer: () => svg(
      '<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8" rx="1.5"/>' +
      '<path d="M7 16h10v4H7z"/><circle cx="17" cy="11" r="0.6" fill="currentColor" stroke="none"/>'
    ),
    // 📥 匯出本期快照
    download: () => svg(
      '<path d="M12 4v10"/><path d="M8 10.5 12 14.5 16 10.5"/>' +
      '<path d="M5 17v1.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V17"/>'
    ),
    // ☁️ 共用雲端
    cloud: () => svg('<path d="M7 18h9.5a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6-1.7A3.8 3.8 0 0 0 7 18Z"/>'),
    // ✕ 關閉
    x: () => svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    // 🧭 品管/採購建議
    compass: () => svg('<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2 13 13l-3.8 1.8L11 11z"/>'),
    // 💾 儲存
    save: () => svg(
      '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H16l3 3v13.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5z"/>' +
      '<path d="M8 3v5h7V3"/><path d="M8 21v-6h8v6"/>'
    ),
    // 📊 品牌標誌／彙整快照
    chart: () => svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    // 📄 一般檔案（雲端快照清單）
    file: () => svg('<path d="M7 3h7l4 4v13.5A1.5 1.5 0 0 1 16.5 22h-9A1.5 1.5 0 0 1 6 20.5V4.5A1.5 1.5 0 0 1 7 3Z"/><path d="M14 3v4h4"/>'),
    // 📌 整體總覽
    pin: () => svg('<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.3"/>'),
    // 🏭 重點廠商比較
    factory: () => svg('<path d="M3 21V10l5 3v-3l5 3V7l6 3.5V21H3Z"/><path d="M8 21v-4h3v4"/><path d="M14 21v-4h3v4"/>'),
    // 🔄 再使用率
    refresh: () => svg('<path d="M4 12a8 8 0 0 1 14-5.3M20 5v4h-4"/><path d="M20 12a8 8 0 0 1-14 5.3M4 19v-4h4"/>'),
    // 📖 資料來源與邏輯說明
    book: () => svg('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5Z"/>'),
    // 📋 派工
    clipboard: () => svg('<rect x="6" y="4" width="12" height="17" rx="1.5"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6M9 15h6"/>'),
    // 🏭 回廠
    inbox: () => svg('<path d="M3 12h4l2 3h6l2-3h4"/><path d="M5.5 5h13L21 12v6.5A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5V12Z"/>'),
    // 🔧 維修
    wrench: () => svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 4.6L3 17.2 6.8 21l6.3-6.3a4 4 0 0 0 4.6-5.4l-2.8 2.8-2.1-2.1Z"/>'),
    // 🗑️ 報廢
    trash: () => svg('<path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 13.5A1.5 1.5 0 0 0 8.5 22h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/>'),
    // ✅ 完成／已帶入
    checkCircle: () => svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.6 2.6L16 9.5"/>'),
    // ⚠️ 不良率
    alertTriangle: () => svg('<path d="M12 4 2.5 20h19Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none"/>'),
    // 📦 過保率
    box: () => svg('<path d="M3.5 8.5 12 4l8.5 4.5V16L12 20l-8.5-4.5Z"/><path d="M3.5 8.5 12 12.5l8.5-4"/><path d="M12 12.5V20"/>'),
  };
})();
