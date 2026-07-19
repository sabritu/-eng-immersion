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

## 補充

- 首次使用建議先到「首頁」點「開啟到期提醒通知」授權，之後才會收到複習提醒推播。
- 定期使用「資料」分頁匯出 JSON 備份，避免清除瀏覽器資料時遺失字卡。
