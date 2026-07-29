// Cloudflare Worker：LINE 到期提醒（多人版）
//
// 設計原則：使用者端零設定。App 裡不需要填任何網址或密碼，
// 綁定流程只有「加好友 → 送出一則已經幫他打好的訊息」兩個動作。
//
// 資料界線：字卡內容（單字、句子）完全不經過這裡，KV 只存
// 「配對碼 ↔ LINE userId」「配對碼 ↔ 瀏覽器推播訂閱」和「配對碼 ↔ 下次到期日」
// 這幾種對應。
//
// 兩條提醒管道獨立運作、互不依賴：LINE 需要 userId（webhook 綁定），
// Web Push 只需要一個推播服務的 endpoint 網址（訂閱時取得，不需要
// payload 加密用的 p256dh/auth，因為提醒內容固定不變，送無內容推播即可）。
//
// 五個 HTTP 端點 + 一個排程：
// 1. POST /webhook          —— LINE 平台呼叫。使用者把 App 產生的配對碼傳給官方帳號時，
//                              在這裡把配對碼跟他的 LINE userId 綁在一起，並免費回覆確認訊息。
// 2. POST /sync-due         —— App 呼叫。帶著自己的配對碼，回報「最早的一張到期日」。
//                              配對碼要綁過 LINE 或訂閱過 Web Push 才接受，避免被灌垃圾資料。
// 3. GET  /pair-status      —— App 呼叫。查詢這組配對碼的 LINE 綁定成功了沒。
// 4. POST /subscribe-push   —— App 呼叫。帶著配對碼和瀏覽器推播訂閱的 endpoint。
// 5. POST /unsubscribe-push —— App 呼叫。使用者關閉瀏覽器推播時，刪掉這組配對碼的訂閱。
// 6. GET  /sync-cards       —— App 呼叫。取回這組配對碼上次存放的字卡。
// 7. POST /sync-cards       —— App 呼叫。存放合併後的字卡，供另一台裝置取回。
// 8. GET  /tatoeba          —— App 呼叫。代打 Tatoeba 語料庫查真人翻譯的中英對照例句，
//                              純代理轉發、不寫 KV，繞過 tatoeba.org 沒開放的 CORS。
// 9. scheduled              —— 每天固定時間掃過所有配對碼，「今天已到期」的才推播，
//                              LINE 和 Web Push 各自獨立發送，兩邊都綁的人兩邊都收到。
//
// 注意：/sync-cards 會存放字卡內容，這是唯一會碰到卡片文字的端點。
// 其餘功能（提醒）仍然只交換日期，不需要知道卡片內容。
//
// 全檔刻意不使用反引號樣板字串：這支程式常常要在手機上用複製貼上更新，
// 反引號在部分輸入法／遠端桌面環境會被吃掉或轉成全形，導致貼上後語法錯誤。
//
// 需要的環境變數／綁定（在 Cloudflare Worker 設定裡建立，不寫進程式碼）：
//   - KV Namespace 綁定名稱：DUE_KV
//   - Secret：LINE_CHANNEL_ACCESS_TOKEN
//   - Secret：LINE_CHANNEL_SECRET
//   - Secret：VAPID_PRIVATE_JWK（Web Push 簽章用私鑰，JWK 格式，絕對不能外流）
//   - Variable：VAPID_PUBLIC_KEY（跟 App 端 index.html 裡的常數要一致）
//   - Variable：VAPID_SUBJECT（例如 mailto:you@example.com）
//   - Variable：APP_URL（PWA 網址）

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// 配對碼字母表刻意排除 0/O、1/I/L 這類看起來很像的字元，
// 使用者要用眼睛核對或手動重打時比較不會出錯。
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = new RegExp('[' + CODE_ALPHABET + ']{6}');
// 裝置識別碼會直接組進 KV 的 key，格式必須嚴格檢查，不能讓外部字元跑進來
const DEVICE_ID_PATTERN = new RegExp('^[' + CODE_ALPHABET + ']{8}$');

// no-store：同步的回應絕對不能被瀏覽器或中間層快取，
// 讀到舊的字卡清單會讓兩台裝置的合併結果永遠對不齊
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({}, CORS_HEADERS, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
  });
}

// 只接受已知的瀏覽器推播服務網域，擋掉亂灌進來的垃圾網址
// （這不是安全機制，只是最低成本擋雜訊——真正驗證訂閱有效性是靠 404/410 自動清除）
const ALLOWED_PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'push.apple.com',
  'notify.windows.com',
  'updates.push.services.mozilla.com'
];

function isAllowedPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch (e) {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_PUSH_HOST_SUFFIXES.some(function (suffix) {
    return url.hostname === suffix || url.hostname.endsWith('.' + suffix);
  });
}

// base64url 編碼（VAPID JWT 用，瀏覽器/Worker 都沒有內建版本）
function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonToBase64Url(obj) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

// 組出 VAPID 需要的簽章 JWT，證明這次推播是這個 App 發的
// Web Crypto 的 ECDSA 簽章直接就是 raw r||s（64 bytes），
// 剛好是 JWS ES256 要的格式，不用另外做 DER 轉換
async function buildVapidJwt(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const headerB64 = jsonToBase64Url({ typ: 'JWT', alg: 'ES256' });
  const payloadB64 = jsonToBase64Url({ aud: aud, exp: exp, sub: env.VAPID_SUBJECT });
  const signingInput = headerB64 + '.' + payloadB64;

  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );
  const signatureB64 = toBase64Url(new Uint8Array(signatureBuffer));
  return signingInput + '.' + signatureB64;
}

// 送一則無內容的推播，瀏覽器收到後由 sw.js 的 push 事件顯示固定文字通知
async function sendWebPush(endpoint, env) {
  const jwt = await buildVapidJwt(endpoint, env);
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC_KEY,
      TTL: '86400',
      'Content-Length': '0'
    }
  });
}

async function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode.apply(null, new Uint8Array(sigBuffer)));
  return expected === signature;
}

// 回覆訊息走 replyToken，不計入每月 200 則的免費推播額度
async function replyToLine(env, replyToken, text) {
  if (!replyToken) return;
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN
    },
    body: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] })
  });
}

async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-line-signature');
  const valid = await verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET);
  if (!valid) {
    return jsonResponse({ error: '簽章驗證失敗' }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return jsonResponse({ error: 'JSON 解析失敗' }, 400);
  }

  const events = payload.events || [];
  for (const event of events) {
    const userId = event.source && event.source.userId;
    if (!userId) continue;

    if (event.type === 'unfollow') {
      // 封鎖／刪除好友時一併清掉綁定與到期日，避免留下推不出去的殭屍資料
      const oldCode = await env.DUE_KV.get('code:' + userId);
      if (oldCode) {
        await env.DUE_KV.delete('user:' + oldCode);
        await env.DUE_KV.delete('due:' + oldCode);
        await env.DUE_KV.delete('code:' + userId);
      }
      continue;
    }

    if (event.type === 'message' && event.message && event.message.type === 'text') {
      const text = (event.message.text || '').toUpperCase();
      const match = CODE_PATTERN.exec(text);
      if (!match) {
        await replyToLine(env, event.replyToken, '請在 App 的「LINE 到期提醒」按下開啟按鈕，讓它幫你把綁定碼填好再送出。');
        continue;
      }

      const code = match[0];
      // 同一個人重新綁定時，把他舊的那組配對碼清掉，不然舊碼會繼續佔著到期日
      const previousCode = await env.DUE_KV.get('code:' + userId);
      if (previousCode && previousCode !== code) {
        await env.DUE_KV.delete('user:' + previousCode);
        await env.DUE_KV.delete('due:' + previousCode);
      }

      await env.DUE_KV.put('user:' + code, userId);
      await env.DUE_KV.put('code:' + userId, code);
      await replyToLine(env, event.replyToken, '綁定完成！之後有字卡到期時，我會在這裡提醒你。');
    }
  }

  return jsonResponse({ ok: true });
}

async function handleSyncDue(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'JSON 解析失敗' }, 400);
  }

  const code = String(body.code || '').toUpperCase();
  const dueDate = body.dueDate;

  if (!CODE_PATTERN.test(code)) {
    return jsonResponse({ error: '配對碼格式錯誤' }, 400);
  }
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return jsonResponse({ error: 'dueDate 格式錯誤，需為 YYYY-MM-DD' }, 400);
  }

  // 只接受綁過 LINE 或訂閱過 Web Push 的配對碼，未綁定的一律忽略，
  // 避免陌生人寫入垃圾資料；兩種提醒管道任一綁定就算數
  const userId = await env.DUE_KV.get('user:' + code);
  const pushEndpoint = await env.DUE_KV.get('push:' + code);
  if (!userId && !pushEndpoint) {
    return jsonResponse({ paired: false });
  }

  await env.DUE_KV.put('due:' + code, dueDate);
  return jsonResponse({ ok: true, paired: true });
}

async function handleSubscribePush(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'JSON 解析失敗' }, 400);
  }

  const code = String(body.code || '').toUpperCase();
  const endpoint = String(body.endpoint || '');

  if (!CODE_PATTERN.test(code)) {
    return jsonResponse({ error: '配對碼格式錯誤' }, 400);
  }
  if (!isAllowedPushEndpoint(endpoint)) {
    return jsonResponse({ error: '不支援的推播服務網址' }, 400);
  }

  await env.DUE_KV.put('push:' + code, endpoint);
  return jsonResponse({ ok: true });
}

async function handleUnsubscribePush(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'JSON 解析失敗' }, 400);
  }

  const code = String(body.code || '').toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    return jsonResponse({ error: '配對碼格式錯誤' }, 400);
  }

  await env.DUE_KV.delete('push:' + code);
  return jsonResponse({ ok: true });
}

// 跨裝置同步。
//
// 合併刻意放在伺服器端，而且是「只增不減」：裝置只上傳自己本機有的卡片，
// Worker 把它併進已存放的那份再回傳合併結果。
//
// 為什麼不能讓裝置上傳「自己算好的合併結果」：Cloudflare KV 是最終一致，
// 一次寫入最多要 60 秒才會傳播到其他節點。手機和電腦連到的節點不同，
// 若手機讀到尚未更新的舊資料，再把自己算出的結果當成權威狀態覆蓋回去，
// 就會把另一台剛同步上來的卡片整批洗掉。改成伺服器端併入之後，
// 讀到舊資料最多只是慢一點收斂，不會弄丟東西。
//
// 單一 KV 值上限 25MB，幾千張字卡的 JSON 遠遠用不到。
const MAX_SYNC_BYTES = 2 * 1024 * 1024;
const DELETION_KEEP_DAYS = 90;

// 同一個單字在兩台裝置上是同一張卡（字卡的 id 就是單字本身），
// 衝突時保留 updatedAt 較新的那一版；刪除時間晚於卡片修改時間的一律不收。
function mergeCardLists(listA, listB, deletions) {
  const byId = new Map();
  const takeNewer = (card) => {
    if (!card || !card.id) return;
    const existing = byId.get(card.id);
    if (!existing || String(card.updatedAt || '') > String(existing.updatedAt || '')) {
      byId.set(card.id, card);
    }
  };
  (listA || []).forEach(takeNewer);
  (listB || []).forEach(takeNewer);

  const result = [];
  byId.forEach((card, id) => {
    const deletedAt = deletions[id];
    // 刪除之後又編輯過的卡片要留下來（使用者顯然又把它加回來了）
    if (deletedAt && String(card.updatedAt || '') <= deletedAt) return;
    result.push(card);
  });
  return result;
}

function mergeDeletionMaps(mapA, mapB) {
  const merged = Object.assign({}, mapA || {});
  Object.keys(mapB || {}).forEach((id) => {
    if (!merged[id] || mapB[id] > merged[id]) merged[id] = mapB[id];
  });
  const cutoff = new Date(Date.now() - DELETION_KEEP_DAYS * 86400000).toISOString();
  const kept = {};
  Object.keys(merged).forEach((id) => {
    if (merged[id] > cutoff) kept[id] = merged[id];
  });
  return kept;
}

// 收集這組同步碼底下所有裝置存放的資料並合併。
// 舊版把全部裝置的資料寫在同一個 key，改版後留在那裡的資料也一併收進來，
// 免得升級當下看起來像是卡片突然變少。
async function collectAllDevices(env, code, skipKey) {
  let cards = [];
  let deletions = {};

  const legacy = await env.DUE_KV.get('cards:' + code);
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy);
      deletions = mergeDeletionMaps(deletions, parsed.deletedCards);
      cards = mergeCardLists(cards, parsed.cards, deletions);
    } catch (e) {
      // 壞掉的舊資料直接略過，不擋同步
    }
  }

  let cursor = undefined;
  let done = false;
  while (!done) {
    const listed = await env.DUE_KV.list({ prefix: 'cards:' + code + ':', cursor: cursor });
    for (const key of listed.keys) {
      if (key.name === skipKey) continue;
      const raw = await env.DUE_KV.get(key.name);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        deletions = mergeDeletionMaps(deletions, parsed.deletedCards);
        cards = mergeCardLists(cards, parsed.cards, deletions);
      } catch (e) {
        // 同上，單一裝置資料壞掉不影響其他裝置
      }
    }
    done = listed.list_complete;
    cursor = listed.cursor;
  }

  return { cards: cards, deletedCards: deletions };
}

// 只讀不寫，用來檢查目前存了什麼（App 端正常流程不需要，除錯時方便）
async function handleSyncPull(request, env) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    return jsonResponse({ error: '配對碼格式錯誤' }, 400);
  }
  const all = await collectAllDevices(env, code, null);
  return jsonResponse({
    found: all.cards.length > 0,
    cards: all.cards,
    deletedCards: all.deletedCards
  });
}

// 每台裝置只寫自己專屬的 key，永遠不碰別台的。
//
// 這是這支同步能不能信任的關鍵。KV 是最終一致，一次寫入最多要 60 秒才會
// 傳播到其他節點，而且每個節點還會把讀到的值快取一段時間。如果所有裝置
// 共用同一個 key，流程就會是「讀取 → 合併 → 整份覆寫」——只要那次讀取拿到
// 還沒更新的舊值，覆寫就會把另一台剛同步上來的卡片整批抹掉，而且無法復原。
//
// 改成一台一個 key 之後，「覆寫別人的資料」在架構上就不可能發生：
// 讀到舊值最多是這次少收到別台的最新內容，下次同步自然補齊。
async function handleSyncPush(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'JSON 解析失敗' }, 400);
  }

  const code = String(body.code || '').toUpperCase();
  const deviceId = String(body.deviceId || '').toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    return jsonResponse({ error: '配對碼格式錯誤' }, 400);
  }
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    return jsonResponse({ error: '裝置識別碼格式錯誤' }, 400);
  }
  if (!Array.isArray(body.cards)) {
    return jsonResponse({ error: 'cards 必須是陣列' }, 400);
  }

  const ownPayload = JSON.stringify({
    cards: body.cards,
    deletedCards: body.deletedCards || {},
    savedAt: new Date().toISOString()
  });
  if (ownPayload.length > MAX_SYNC_BYTES) {
    return jsonResponse({ error: '資料量過大，無法同步' }, 413);
  }

  const deviceKey = 'cards:' + code + ':' + deviceId;
  await env.DUE_KV.put(deviceKey, ownPayload);

  // 自己這份直接用請求帶進來的內容，不從 KV 回讀，避免讀到自己剛寫但還沒生效的值
  const others = await collectAllDevices(env, code, deviceKey);
  const mergedDeletions = mergeDeletionMaps(others.deletedCards, body.deletedCards);
  const mergedCards = mergeCardLists(others.cards, body.cards, mergedDeletions);

  return jsonResponse({
    ok: true,
    cards: mergedCards,
    deletedCards: mergedDeletions,
    count: mergedCards.length
  });
}

async function handlePairStatus(request, env) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    return jsonResponse({ error: '配對碼格式錯誤' }, 400);
  }
  const userId = await env.DUE_KV.get('user:' + code);
  return jsonResponse({ paired: Boolean(userId) });
}

// Tatoeba 語料庫代理：前端瀏覽器直接打 tatoeba.org 會被 CORS 擋（實測沒有
// access-control-allow-origin 標頭），這裡代打一次繞過。
//
// 關鍵過濾：Tatoeba 的 trans_filter=limit（要求有中文直譯）一旦跟片語查詢
// 搭配，排序邏輯會跑掉，退化成鬆散的關鍵字比對，回傳完全不相關的句子
// （例如查 "get away with" 卻回 "Get in touch with your agent right away."）。
// 這裡在後端再做一次「句子必須真的包含查詢詞」的過濾，失敗模式從「顯示
// 錯的句子」變成「什麼都不顯示」，寧可少顯示也不要顯示誤導的例句。
async function handleTatoeba(request, env) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '').trim();

  if (!q || q.length > 60) {
    return jsonResponse({ error: 'q 參數缺失或過長' }, 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  let data;
  try {
    const apiUrl = 'https://tatoeba.org/en/api_v0/search?from=eng&trans_filter=limit&trans_to=cmn&trans_link=direct&query=' + encodeURIComponent(q);
    // tatoeba.org 的 nginx 沒收到 User-Agent 會直接回 500（實測確認過），
    // Worker 的 fetch 預設不帶瀏覽器那種 User-Agent，一定要自己補上。
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; eng-immersion-app)' }
    });
    clearTimeout(timer);
    if (!res.ok) return jsonResponse({ query: q, sentences: [] });
    data = await res.json();
  } catch (e) {
    clearTimeout(timer);
    return jsonResponse({ query: q, sentences: [] });
  }

  const needle = q.toLowerCase();
  const picked = [];
  for (const r of (data.results || [])) {
    const text = r.text || '';
    if (!text.toLowerCase().includes(needle)) continue; // 過濾掉不相關的鬆散比對結果
    // Tatoeba 的 cmn 語言代碼不分繁簡（貢獻者各寫各的），但每句翻譯附了
    // script 欄位可以分辨。同一句話如果有繁體版本就用繁體，只有簡體版本
    // 才標記需要轉換——先收集起來，稍後只對真正需要的那幾句多打一次
    // Google 翻譯轉繁體，不是每句都轉。
    const zhCandidates = (r.translations || []).flat().filter((t) => t.lang === 'cmn' && t.text);
    const zh = zhCandidates.find((t) => t.script === 'Hant') || zhCandidates[0];
    if (!zh) continue;
    picked.push({ en: text, zh: zh.text, needsConversion: zh.script !== 'Hant' });
    if (picked.length >= 5) break;
  }

  // 實測過乾淨的請求一定會成功，Cloudflare Workers 環境下偶爾還是會失敗
  // （推測是流量限制之類的暫時性問題），所以失敗重試一次；兩次都失敗就
  // 整句拿掉，不要讓沒轉成功的簡體漏出去——寧可少一句，不要顯示不一致。
  await Promise.all(picked.map(async (s) => {
    if (!s.needsConversion) return;
    let converted = await convertSimplifiedToTraditional(s.zh);
    if (!converted) converted = await convertSimplifiedToTraditional(s.zh);
    if (converted) {
      s.zh = converted;
    } else {
      s.failed = true;
    }
  }));

  const sentences = picked.filter((s) => !s.failed).map((s) => ({ en: s.en, zh: s.zh }));
  return jsonResponse({ query: q, sentences: sentences });
}

// Tatoeba 的簡體例句轉繁體：字元對字元的映射表在異體字上會出錯（例如「干」
// 對應「幹/乾/干」三種繁體字，選錯字比顯示簡體更糟），所以借用已經在跑的
// Google 翻譯做 zh-CN -> zh-TW 轉換，這是同語言不同書寫系統的轉寫，不是
// 真的翻譯，實測不會改動字詞、只轉字形。
async function convertSimplifiedToTraditional(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=zh-TW&dt=t&q=' + encodeURIComponent(text);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const converted = (data[0] || []).map((seg) => seg[0]).join('').trim();
    return converted || null;
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

function taipeiTodayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

async function sendReminders(env) {
  const today = taipeiTodayISO();
  const appUrl = env.APP_URL || '';
  const text = '記憶即將遺忘，有字卡到期囉！打開 App 複習一下：' + appUrl;

  let cursor = undefined;
  let done = false;
  while (!done) {
    const listed = await env.DUE_KV.list({ prefix: 'due:', cursor: cursor });
    for (const key of listed.keys) {
      const code = key.name.slice(4);
      const dueDate = await env.DUE_KV.get(key.name);
      if (!dueDate || dueDate > today) continue; // 還沒到期，跳過，不騷擾

      // LINE 和 Web Push 各自獨立發送，兩邊都綁的人兩邊都收到；
      // 任一邊失敗不影響另一邊，也不影響其他使用者
      const userId = await env.DUE_KV.get('user:' + code);
      if (userId) {
        await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN
          },
          body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text }] })
        });
      }

      const pushEndpoint = await env.DUE_KV.get('push:' + code);
      if (pushEndpoint) {
        try {
          const pushRes = await sendWebPush(pushEndpoint, env);
          if (pushRes.status === 404 || pushRes.status === 410) {
            // 訂閱已失效（使用者移除通知權限、換裝置等），清掉避免每天白跑
            await env.DUE_KV.delete('push:' + code);
          }
        } catch (e) {
          // 單次推播失敗不影響其他使用者，下次排程再試
        }
      }
    }
    done = listed.list_complete;
    cursor = listed.cursor;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      return handleWebhook(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/sync-due') {
      return handleSyncDue(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/pair-status') {
      return handlePairStatus(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/subscribe-push') {
      return handleSubscribePush(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/unsubscribe-push') {
      return handleUnsubscribePush(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/sync-cards') {
      return handleSyncPull(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/sync-cards') {
      return handleSyncPush(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/tatoeba') {
      return handleTatoeba(request, env);
    }

    return jsonResponse({ error: '找不到這個路徑' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  }
};
