# 語境沉浸式英文習得 PWA — 使用說明

零成本、純前端，資料全存在你手機/電腦的瀏覽器 LocalStorage 裡。

## 檔案清單

- `index.html`：所有畫面與邏輯
- `manifest.json`：PWA 設定
- `sw.js`：離線快取
- `icons/icon-192.png`、`icons/icon-512.png`：目前是純色佔位圖示，之後可直接換成你自己的設計（檔名維持一致即可）
- `dict/ecdict.json`：離線中文辭典（約 6MB，v3 新增），查單字時優先從這裡查，離線也能用
- `userscript/youtube-collector.user.js`：（v3 新增，選用）桌機用的 YouTube 逐字稿收藏小工具，見下方「4. 桌機 YouTube 收藏小工具」

## 1. 部署到 GitHub Pages（免費、自帶 HTTPS）

PWA 必須跑在 HTTPS 上才能安裝，GitHub Pages 剛好符合。

1. 在 GitHub 建一個新的 repository（例如 `eng-immersion`），設為 Public。
2. 把這個資料夾裡的項目（`index.html`、`manifest.json`、`sw.js`、`icons/`、`dict/`）上傳到 repo 根目錄。
3. 到 repo 的 **Settings → Pages**，Source 選 `main` branch、`/ (root)` 資料夾，儲存。
4. 等 1–2 分鐘，會出現網址，格式類似：
   `https://你的帳號.github.io/eng-immersion/`
5. 用手機瀏覽器打開這個網址，確認畫面正常顯示即可進行安裝。

> 之後每次要更新程式，只要把改好的檔案重新上傳（覆蓋）到同一個 repo，GitHub Pages 會自動重新部署。

## 2. Android：安裝到桌面 + 系統分享採集文字

**安裝到桌面：**
1. 用 Chrome 打開你的 GitHub Pages 網址。
2. 點右上角選單（⋮）→「新增至主畫面」或「安裝應用程式」。
3. 桌面就會出現一個獨立圖示的 App。

**用系統分享採集文字：**
1. 在任何 App（瀏覽器、社群 App）裡選取一段英文句子。
2. 點「分享」，如果清單裡出現這個 App 的名稱，點它。
3. 會自動開啟「快速建卡」畫面，把句子拆開顯示、生字加底線，點生字就能查詢建卡。

> 若分享清單沒出現這個 App：Android 對 Web Share Target 的支援需要先把 App **安裝**到桌面（不是只加書籤），且部分機型/瀏覽器版本較舊可能不支援，這種情況請改用「頁面內手動貼上」或 iOS 捷徑的方式。

## 3. iOS：加入主畫面 + 建立文字擷取捷徑

**加入主畫面：**
1. 用 Safari 打開你的 GitHub Pages 網址。
2. 點下方分享圖示 → 「加入主畫面」。
3. 桌面會出現獨立圖示的 App（全螢幕、無 Safari 網址列）。

**建立「文字擷取」捷徑（iOS Shortcuts）：**

iOS 沒有 Web Share Target API，所以改用「捷徑」App 組出 `?text=` 網址來達到同樣效果：

1. 打開「捷徑」App → 新增捷徑。
2. 加入動作「取得快速鍵輸入項目」（Get Shortcut Input，型別選文字）。
3. 加入動作「文字」，內容留空，把上一步的輸入項目拖進來當變數，方便後面編碼。
4. 加入動作「URL 編碼」（URL Encode），把文字變數編碼一次（避免特殊字元讓網址壞掉）。
5. 加入動作「文字」，內容填：
   `https://你的帳號.github.io/eng-immersion/?text=` 後面接上一步編碼後的變數。
6. 加入動作「在 Safari 中打開網址」（Open URLs），選剛剛組好的網址。
7. 儲存這個捷徑，命名為「加入英文字卡」，並在捷徑設定裡打開「加入分享工作表」（Show in Share Sheet），輸入類型選「文字」。

**使用方式：**
1. 在任何 App 裡選取英文句子。
2. 點「分享」→ 找到「加入英文字卡」捷徑並點擊。
3. 會自動用 Safari 開啟 PWA 的「快速建卡」畫面。

## 4. 桌機 YouTube 收藏小工具（選用，解決「找逐字稿很麻煩」的問題）

App 內建的「YouTube 分頁」需要你自己去找逐字稿、複製貼上才能用，這個小工具讓你在看 YouTube 影片時**直接在頁面上點一下就收藏句子**，不用複製貼上。只支援桌機 Chrome/Edge。

**安裝步驟：**
1. 到 Chrome 線上應用程式商店搜尋「**Tampermonkey**」，安裝這個免費擴充功能。
2. 點瀏覽器右上角的 Tampermonkey 圖示 →「建立新指令碼」。
3. 把 `userscript/youtube-collector.user.js` 這個檔案的內容整個複製貼上，蓋掉編輯器裡原本的內容。
4. 按 Ctrl+S 儲存。

**第一次使用：**
1. 打開任何一部有字幕的 YouTube 影片。
2. 點影片下方「...更多」→「顯示轉錄稿」，叫出 YouTube 自己的逐字稿面板。
3. 每一行逐字稿旁邊會多一個「★ 收藏這句」按鈕。第一次點擊時會跳出視窗要你貼上你的 PWA 網址（例如 `https://你的帳號.github.io/eng-immersion/`），貼上後就不用再填。
4. 之後看到喜歡的句子，直接點該行的「★ 收藏這句」，會開一個新分頁進入 PWA 的「快速建卡」畫面。

**修改設定：** 點瀏覽器工具列的 Tampermonkey 圖示 → 選單裡的「設定 PWA 網址」即可重新輸入。

> 這個小工具是讀取 YouTube 自己頁面上顯示的逐字稿內容，不是連去 YouTube 的伺服器硬抓，所以不會有「查無結果」或被擋的問題；只要 YouTube 網頁上看得到逐字稿，這個工具就能用。

## 5. LINE 到期提醒（選用，解決「App 沒開就收不到提醒」的問題）

App 本身的「到期提醒通知」只有在你開著 App 的時候才會跳出來，沒開 App 就完全不會提醒。這個功能用一個免費的 Cloudflare Worker + LINE 官方帳號，做到「有字卡到期時，主動推播到 LINE」。

**設計原則：只在真的有字卡到期時才推播，不會每天騷擾你**——字卡內容完全不會上傳，Worker 只知道「下次到期日」這一個日期。

### 5-1　開一個新的免費 LINE 官方帳號

建議另外開一個新帳號，不要跟甜甜草工作室的官方帳號共用（避免占用業務用的免費推播額度、也避免這個小工具的程式碼影響到業務帳號）。

1. 到 [LINE Official Account Manager](https://manager.line.biz/) 用你的 LINE 帳號登入，點「建立帳號」。
2. 帳號名稱隨意（例如「英語複習提醒」），類別選個人／其他即可，免費方案就夠用。
3. 建立後，進到該帳號的「設定」→「回應設定」，把「加入好友的歡迎訊息」「自動回應訊息」都關掉（避免干擾，只留 Messaging API 主動推播）。

### 5-2　開通 Messaging API，拿到金鑰

1. 到 [LINE Developers Console](https://developers.line.biz/console/)，用同一個 LINE 帳號登入。
2. 應該會自動看到剛剛建立的官方帳號變成一個 Provider／Channel，點進去該 Channel。
3. 「Messaging API」分頁 → 找到 **Channel access token**，按「Issue」產生一組長期有效的 token，複製起來。
4. 同一頁上方「Basic settings」分頁能看到 **Channel secret**，也複製起來。
5. 這兩組資料等一下要貼進 Cloudflare Worker 的 Secret 設定，先存到密碼管理工具或筆記裡，不要外流。

### 5-3　部署 Cloudflare Worker

沿用你之前部署 `transcript-worker.js` 的同一個 Cloudflare 帳號：

1. 到 [Cloudflare Dashboard](https://dash.cloudflare.com/) → 左側「Workers & Pages」→「建立」→「建立 Worker」，取名例如 `line-due-reminder`。
2. 進到剛建好的 Worker，點「編輯程式碼」，把整包內容清空，貼上這個資料夾裡 `worker/line-worker.js` 的內容，儲存並部署。
3. 建立 KV 資料庫：Workers & Pages 首頁左側「KV」→「建立命名空間」，取名例如 `line-due-kv`。
4. 回到 `line-due-reminder` 這個 Worker →「設定」→「變數與機密」：
   - 「KV 命名空間繫結」新增一筆：變數名稱填 `DUE_KV`，選剛建立的 `line-due-kv`。
   - 「環境變數」新增（型態選 **Secret**，避免明碼外洩）：
     - `LINE_CHANNEL_ACCESS_TOKEN` = 5-2 拿到的 token
     - `LINE_CHANNEL_SECRET` = 5-2 拿到的 secret
     - `SYNC_SECRET` = 自己隨便編一組英數字密碼（例如用密碼產生器生一組），等一下 App 端要填同一組
   - 「環境變數」再新增一筆一般變數（不用勾 Secret）：`APP_URL` = 你的 PWA 網址（`https://sabritu.github.io/-eng-immersion/`）
5. 加排程：同一個 Worker 的「觸發器」分頁 →「Cron 觸發器」→ 新增，填 `0 0 * * *`（這是 UTC 時間 00:00，等於台北時間每天早上 8 點檢查一次；想改時間可以自己調整這個 cron 運算式）。
6. 部署完成後，Worker 首頁會顯示網址，格式類似 `https://line-due-reminder.你的帳號.workers.dev`，複製起來。

### 5-4　設定 LINE Webhook

1. 回到 LINE Developers Console 該 Channel 的「Messaging API」分頁。
2. 「Webhook settings」→ Webhook URL 填：`https://line-due-reminder.你的帳號.workers.dev/webhook`（把網址換成你自己的），儲存。
3. 打開「Use webhook」開關。
4. 可以點旁邊的「Verify」測試連線是否成功（會顯示 Success）。

### 5-5　加好友 + 完成綁定

1. 在 LINE Official Account Manager 首頁找到這個帳號的 QR Code，用你自己的手機 LINE 掃描加好友。
2. 加好友的瞬間，Worker 會自動抓到你的 LINE userId 存進 KV，不需要手動操作。

### 5-6　把 Worker 網址填回 App

1. 打開 PWA →「資料」分頁 → 找到「LINE 到期提醒」卡片。
2. 「Worker 網址」填 5-3 步驟 6 拿到的網址，「同步密碼」填 5-3 步驟 4 設定的 `SYNC_SECRET`，按「儲存」。
3. 之後每次開啟 App，會自動把下次到期日同步給 Worker；真的有字卡到期時，Cron 會在設定的時間點透過 LINE 推播提醒你。

## 補充

- 首次使用建議先到「首頁」點「開啟到期提醒通知」授權，之後才會收到複習提醒推播。
- 定期使用「資料」分頁匯出 JSON 備份，避免清除瀏覽器資料時遺失字卡。
