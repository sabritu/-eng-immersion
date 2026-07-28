// ==UserScript==
// @name         英文習得 - 網頁選字收藏 + YouTube 逐字稿收藏
// @namespace    sweetenbud.eng-immersion
// @version      1.5
// @description  任何網頁選取英文句子都能一鍵送進字卡 App；YouTube 影片頁面額外有逐句收藏與整份逐字稿傳送功能
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------
  // 設定：PWA 網址（固定寫死，全部人共用同一個部署，不用再貼）
  // 萬一之後真的要換網址，用 Tampermonkey 選單「設定 PWA 網址」覆蓋即可
  // ---------------------------------------------------------
  const DEFAULT_PWA_URL = 'https://sabritu.github.io/-eng-immersion/';

  function getPwaUrl() {
    return GM_getValue('pwaUrl', '') || DEFAULT_PWA_URL;
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
  // 任何網頁都能用：選取文字後跳出「收藏這句」浮動按鈕
  // ---------------------------------------------------------
  let selectionPopupEl = null;

  function ensureSelectionPopup() {
    if (selectionPopupEl) return selectionPopupEl;
    selectionPopupEl = document.createElement('button');
    selectionPopupEl.id = 'eng-selection-popup-btn';
    selectionPopupEl.textContent = '★ 收藏這句';
    selectionPopupEl.style.cssText = [
      'position:fixed', 'z-index:999999', 'display:none',
      'background:#d9a253', 'color:#14120f', 'font-weight:700',
      'padding:6px 12px', 'border-radius:9999px', 'border:none',
      'box-shadow:0 2px 10px rgba(0,0,0,.35)', 'cursor:pointer', 'font-size:13px'
    ].join(';');
    document.body.appendChild(selectionPopupEl);
    return selectionPopupEl;
  }

  document.addEventListener('mouseup', (e) => {
    // 自己注入的按鈕被點擊時不要跟選取邏輯打架
    if (e.target && e.target.id === 'eng-selection-popup-btn') return;

    const popup = ensureSelectionPopup();
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';

    // 至少要有英文字母才顯示，避免選到圖片/UI元素等無意義選取跳出按鈕
    if (!text || text.length < 2 || !/[A-Za-z]/.test(text) || selection.rangeCount === 0) {
      popup.style.display = 'none';
      return;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    popup.style.left = `${Math.max(8, rect.left)}px`;
    popup.style.top = `${Math.max(8, rect.top - 36)}px`;
    popup.style.display = 'block';

    popup.onclick = () => {
      collectText(text);
      popup.style.display = 'none';
      selection.removeAllRanges();
    };
  });

  document.addEventListener('mousedown', (e) => {
    if (selectionPopupEl && e.target !== selectionPopupEl) {
      selectionPopupEl.style.display = 'none';
    }
  });

  // ---------------------------------------------------------
  // 以下都是 YouTube 專屬功能（逐句收藏按鈕、整份逐字稿傳送），只在 YouTube 頁面上執行
  // ---------------------------------------------------------
  if (!location.hostname.includes('youtube.com')) return;

  // 傳送逐字稿：用 postMessage 傳給新開的 PWA 分頁
  // （不走網址參數，因為完整逐字稿常常長到超過瀏覽器網址長度上限）
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

  // 抓取目前畫面上已展開的逐字稿面板文字（新舊兩種版面都支援）
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

  // =========================================================
  // 判斷這支影片到底有沒有逐字稿（不必打開面板）
  //
  // YouTube 會先把逐字稿面板的「容器」放進網頁裡再隱藏起來，等使用者點才填內容；
  // 沒有逐字稿的影片則根本不會有這個容器。所以查容器在不在，就等於查有沒有逐字稿。
  // =========================================================
  function currentVideoId() {
    return new URLSearchParams(location.search).get('v') || '';
  }

  function isWatchPage() {
    return location.pathname === '/watch' && !!currentVideoId();
  }

  function findTranscriptPanel() {
    return document.querySelector(
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
    );
  }

  function hasTranscript() {
    if (!isWatchPage()) return false;
    return !!(
      findTranscriptPanel() ||
      document.querySelector('ytd-video-description-transcript-section-renderer')
    );
  }

  // =========================================================
  // 取得逐字稿：使用者不必自己動手點開面板
  //   面板已經開著 → 直接讀，零等待
  //   面板沒開     → 腳本自己點開、抓完再關掉，全程約 0.5 秒
  //
  // 為什麼一定要走「開面板」這條路（兩條看似更聰明的捷徑都已實測失敗）：
  //   1. 伺服器端代抓字幕（worker/transcript-worker.js 走的路）已被 YouTube 封鎖，
  //      實測回 HTTP 200 但內容 0 bytes，帶 cookie 也一樣。
  //   2. 頁面內直接呼叫 /youtubei/v1/get_transcript 一律回 Precondition check failed，
  //      連用 ytInitialData 裡 YouTube 自己準備好的 params 也不通。
  //   結論：只有讓 YouTube 自己的程式去要資料才拿得到，所以就是點它的按鈕。
  // =========================================================
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 描述區沒展開時，「顯示轉錄稿」按鈕還沒被畫出來，要先把描述打開
  function findTranscriptOpenButton() {
    const section = document.querySelector('ytd-video-description-transcript-section-renderer');
    return section ? section.querySelector('button') : null;
  }

  function expandDescription() {
    const expander = document.querySelector('#description-inline-expander #expand') ||
                     document.querySelector('tp-yt-paper-button#expand') ||
                     document.querySelector('#expand');
    if (expander) expander.click();
  }

  function closeTranscriptPanel(panel) {
    const closeBtn = panel.querySelector('#visibility-button button') ||
                     panel.querySelector('#header button[aria-label]');
    if (closeBtn) closeBtn.click();
  }

  async function fetchTranscriptByOpeningPanel() {
    const panel = findTranscriptPanel();
    if (!panel) return '';

    if (panel.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') {
      return collectAllTranscriptText();
    }

    let openBtn = findTranscriptOpenButton();
    if (!openBtn) {
      expandDescription();
      await sleep(600);
      openBtn = findTranscriptOpenButton();
    }
    if (!openBtn) return '';

    // 抓取期間先讓面板透明，使用者不會看到畫面整個彈出來又收回去
    const prevOpacity = panel.style.opacity;
    panel.style.opacity = '0';
    openBtn.click();

    let text = '';
    for (let i = 0; i < 40; i++) {   // 最多等 8 秒讓內容載完
      await sleep(200);
      text = collectAllTranscriptText();
      if (text) break;
    }

    closeTranscriptPanel(panel);
    panel.style.opacity = prevOpacity;
    return text;
  }

  async function getTranscriptText() {
    const onScreen = collectAllTranscriptText();
    if (onScreen) return onScreen;

    try {
      return await fetchTranscriptByOpeningPanel();
    } catch (e) {
      return '';
    }
  }

  // ---------------------------------------------------------
  // 浮動按鈕：一鍵把目前影片的逐字稿傳到 PWA
  // 平常只顯示短標題以免擋畫面，滑鼠移上去才展開完整名稱
  // ---------------------------------------------------------
  const BTN_LABEL_SHORT = '📥 收逐字稿';
  const BTN_LABEL_FULL = '📥 傳送逐字稿到英英美代誌';

  function ensureBulkSendButton() {
    let btn = document.getElementById('eng-bulk-send-btn');
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = 'eng-bulk-send-btn';
    btn.textContent = BTN_LABEL_SHORT;
    btn.title = BTN_LABEL_FULL;
    btn.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px', 'z-index:99999',
      'background:#d9a253', 'color:#14120f', 'font-weight:700',
      'padding:9px 14px', 'border-radius:9999px', 'border:none',
      'box-shadow:0 2px 10px rgba(0,0,0,.35)', 'cursor:pointer', 'font-size:13px',
      'white-space:nowrap'
    ].join(';');

    btn.addEventListener('mouseenter', () => {
      if (!btn.disabled) btn.textContent = BTN_LABEL_FULL;
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.disabled) btn.textContent = BTN_LABEL_SHORT;
    });

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '⏳ 抓取中…';
      try {
        const text = await getTranscriptText();
        if (!text) {
          alert('抓不到這支影片的逐字稿。請點影片下方「⋯更多」→「顯示轉錄稿」打開面板後，再點一次這顆按鈕。');
          return;
        }
        sendBulkTranscript(text);
      } finally {
        btn.disabled = false;
        btn.textContent = BTN_LABEL_SHORT;
      }
    });

    document.body.appendChild(btn);
    return btn;
  }

  // 只有「這支影片真的有逐字稿」時才讓按鈕出現，其餘時候一律藏起來
  function updateBulkSendButton() {
    const existing = document.getElementById('eng-bulk-send-btn');
    if (hasTranscript()) {
      ensureBulkSendButton().style.display = '';
    } else if (existing) {
      existing.style.display = 'none';
    }
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
    updateBulkSendButton();
  }

  // ---------------------------------------------------------
  // YouTube 是 SPA，切換影片不會整頁重新載入；用 MutationObserver 持續偵測轉錄稿面板。
  // YouTube 頁面變動非常頻繁，加 300ms 緩衝避免每次微小變動都重掃一遍。
  // ---------------------------------------------------------
  let pendingScan = null;
  const observer = new MutationObserver(() => {
    if (pendingScan) return;
    pendingScan = setTimeout(() => {
      pendingScan = null;
      injectButtons();
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // 切換影片時原本注入的按鈕會被 YouTube 重新渲染掉的元素帶走，MutationObserver 會自動補回
  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(injectButtons, 1000);
  });

  injectButtons();
})();
