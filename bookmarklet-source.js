// 這是書籤小工具的「未壓縮」原始版本，方便閱讀跟之後維護。
// 真正要貼到書籤網址欄的是同資料夾 bookmarklet.txt 裡那一行 javascript: 開頭的壓縮版本。
(function () {
  const STORAGE_KEY = 'engImmersionPwaUrl';

  function getPwaUrl() {
    let url = localStorage.getItem(STORAGE_KEY);
    if (!url) {
      url = window.prompt('請貼上你的英文習得 PWA 網址（例如 https://你的帳號.github.io/eng-immersion/）：', '');
      if (url) {
        url = url.trim().replace(/\/+$/, '') + '/';
        localStorage.setItem(STORAGE_KEY, url);
      }
    }
    return url;
  }

  function collectText(text) {
    const pwaUrl = getPwaUrl();
    if (!pwaUrl) {
      alert('尚未設定 PWA 網址。');
      return;
    }
    window.open(`${pwaUrl}?text=${encodeURIComponent(text)}`, '_blank');
  }

  const PROCESSED_ATTR = 'data-eng-collector-done';

  function createCollectButton(getText) {
    const btn = document.createElement('button');
    btn.textContent = '★ 收藏這句';
    btn.style.cssText = [
      'margin-left:8px', 'font-size:11px', 'padding:2px 8px', 'border-radius:9999px',
      'border:1px solid #d9a253', 'color:#d9a253', 'background:transparent',
      'cursor:pointer', 'vertical-align:middle', 'white-space:nowrap'
    ].join(';');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const text = getText();
      if (text) collectText(text);
    });
    return btn;
  }

  function injectForVariant(containerSelector, textSelector, rowSelector) {
    const segments = document.querySelectorAll(`${containerSelector}:not([${PROCESSED_ATTR}])`);
    segments.forEach((seg) => {
      seg.setAttribute(PROCESSED_ATTR, '1');
      const textEl = seg.querySelector(textSelector);
      if (!textEl) return;
      const row = rowSelector ? (seg.querySelector(rowSelector) || seg) : seg;
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.appendChild(createCollectButton(() => textEl.textContent.trim()));
    });
  }

  let count = 0;
  count += document.querySelectorAll('ytd-transcript-segment-renderer:not([' + PROCESSED_ATTR + '])').length;
  count += document.querySelectorAll('transcript-segment-view-model:not([' + PROCESSED_ATTR + '])').length;

  injectForVariant('ytd-transcript-segment-renderer', '.segment-text', '.segment');
  injectForVariant('transcript-segment-view-model', 'span.ytAttributedStringHost', null);

  if (count === 0) {
    alert('沒有找到逐字稿內容。請先點影片下方「顯示轉錄稿」打開字幕面板，再點一次這個書籤。');
  } else {
    alert(`已為 ${count} 句字幕加上收藏按鈕！`);
  }
})();
