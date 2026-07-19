// ==UserScript==
// @name         英文習得 - YouTube 逐字稿收藏
// @namespace    sweetenbud.eng-immersion
// @version      1.1
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
  // 收藏動作：把選取的文字組成 ?text= 網址，開新分頁到 PWA
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
