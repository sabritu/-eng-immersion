// ==UserScript==
// @name         英文習得 - YouTube 逐字稿收藏
// @namespace    sweetenbud.eng-immersion
// @version      1.2
// @description  在 YouTube 逐字稿面板上加「收藏這句」按鈕，點一下直接開啟 PWA 建卡，不用複製貼上
// @match        https://www.youtube.com/watch*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------
  // 設定：PWA 網址（第一次使用時會跳出詢問，之後存起來不用再填）
  // ---------------------------------------------------------
  function getPwaUrl() {
    let url = GM_getValue('pwaUrl', '');
    if (!url) {
      url = window.prompt('請貼上你的英文習得 PWA 網址（例如 https://你的帳號.github.io/eng-immersion/）：', '');
      if (url) {
        url = url.trim().replace(/\/+$/, '') + '/';
        GM_setValue('pwaUrl', url);
      }
    }
    return url;
  }

  GM_registerMenuCommand('設定 PWA 網址', () => {
    const current = GM_getValue('pwaUrl', '');
    const url = window.prompt('修改 PWA 網址：', current);
    if (url) {
      GM_setValue('pwaUrl', url.trim().replace(/\/+$/, '') + '/');
      alert('已更新，重新整理頁面生效。');
    }
  });

  // ---------------------------------------------------------
  // 收藏單句：把選取的文字組成 ?text= 網址，開新分頁到 PWA
  // ---------------------------------------------------------
  function collectText(text) {
    const pwaUrl = getPwaUrl();
    if (!pwaUrl) {
      alert('尚未設定 PWA 網址，請透過 Tampermonkey 選單設定。');
      return;
    }
    const url = `${pwaUrl}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }

  // ---------------------------------------------------------
  // 傳送整份逐字稿：用 postMessage 傳給新開的 PWA 分頁
  // （不走網址參數，因為完整逐字稿常常長到超過瀏覽器網址長度上限）
  // ---------------------------------------------------------
  function sendBulkTranscript(text) {
    const pwaUrl = getPwaUrl();
    if (!pwaUrl) {
      alert('尚未設定 PWA 網址，請透過 Tampermonkey 選單設定。');
      return;
    }
    const win = window.open(pwaUrl, '_blank');
    if (!win) {
      alert('新分頁被瀏覽器擋下了，請允許這個網站開啟彈出視窗後再試一次。');
      return;
    }
    const targetOrigin = new URL(pwaUrl).origin;
    const payload = { type: 'ENG_IMMERSION_BULK_TEXT', text, source: document.title };

    const trySend = () => {
      try { win.postMessage(payload, targetOrigin); } catch (e) { /* 分頁還沒準備好，忽略 */ }
    };

    // PWA 準備好接收時會回傳 ready 訊號，收到就立刻送並停止重試
    function onReady(e) {
      if (e.source === win && e.data && e.data.type === 'ENG_IMMERSION_READY') {
        clearInterval(retryTimer);
        trySend();
        window.removeEventListener('message', onReady);
      }
    }
    window.addEventListener('message', onReady);

    // 保險：就算沒收到 ready 訊號，也每 300ms 重送一次，最多 6 秒
    let attempts = 0;
    const retryTimer = setInterval(() => {
      attempts++;
      trySend();
      if (attempts >= 20) clearInterval(retryTimer);
    }, 300);
  }

  // 抓取目前頁面上的完整逐字稿文字（新舊兩種版面都支援）
  function collectAllTranscriptText() {
    const oldSegs = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'))
      .map((seg) => seg.querySelector('.segment-text'))
      .filter(Boolean)
      .map((el) => el.textContent.trim());
    const newSegs = Array.from(document.querySelectorAll('transcript-segment-view-model'))
      .map((seg) => seg.querySelector('span.ytAttributedStringHost'))
      .filter(Boolean)
      .map((el) => el.textContent.trim());
    const all = oldSegs.length ? oldSegs : newSegs;
    return all.join(' ');
  }

  // 浮動按鈕：一鍵把目前影片的完整逐字稿傳到 PWA
  function ensureBulkSendButton() {
    if (document.getElementById('eng-bulk-send-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'eng-bulk-send-btn';
    btn.textContent = '📥 傳送整份逐字稿到字卡 App';
    btn.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px', 'z-index:99999',
      'background:#d9a253', 'color:#14120f', 'font-weight:700',
      'padding:10px 16px', 'border-radius:9999px', 'border:none',
      'box-shadow:0 2px 10px rgba(0,0,0,.35)', 'cursor:pointer', 'font-size:13px'
    ].join(';');
    btn.addEventListener('click', () => {
      const text = collectAllTranscriptText();
      if (!text) {
        alert('沒有找到逐字稿內容，請先點影片下方「顯示轉錄稿」打開字幕面板，再點一次這個按鈕。');
        return;
      }
      sendBulkTranscript(text);
    });
    document.body.appendChild(btn);
  }

  // ---------------------------------------------------------
  // 在每一段逐字稿旁加上「收藏」按鈕（YouTube 原生轉錄稿面板的每一行）
  //
  // 實測發現 YouTube 目前同時有新舊兩種轉錄稿元素在跑（不同影片/帳號分配到不同版本），
  // 所以兩種都要處理，缺一個就會有一部分影片按鈕生不出來：
  //   舊版：<ytd-transcript-segment-renderer> 內層 .segment 是可點列，文字在 .segment-text
  //   新版：<transcript-segment-view-model> 本身就是那一列，文字在 span.ytAttributedStringHost
  // ---------------------------------------------------------
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

  function injectButtons() {
    injectForVariant('ytd-transcript-segment-renderer', '.segment-text', '.segment');
    injectForVariant('transcript-segment-view-model', 'span.ytAttributedStringHost', null);
    ensureBulkSendButton();
  }

  // ---------------------------------------------------------
  // YouTube 是 SPA，切換影片不會整頁重新載入；用 MutationObserver 持續偵測轉錄稿面板
  // ---------------------------------------------------------
  const observer = new MutationObserver(() => {
    injectButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // 切換影片時原本注入的按鈕會被 YouTube 重新渲染掉的元素帶走，MutationObserver 會自動補回
  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(injectButtons, 1000);
  });

  injectButtons();
})();
