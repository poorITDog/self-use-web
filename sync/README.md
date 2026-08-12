# Solara Google Drive 自動同步

Solara 預設使用 **Google Identity Services (GIS)** + **Drive API `appDataFolder`** 自動同步整包本機資料（`localStorage` key: `solara-v1`）。

同步檔名：`solara-v1.json`（存放於使用者的 Google Drive appDataFolder，不會出現在一般檔案列表）

## 建立 Google Cloud OAuth Client（Web）

### 1. 建立專案

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新專案（或選現有專案）

### 2. 啟用 Drive API

1. **API 和服務** → **程式庫**
2. 搜尋 **Google Drive API** → **啟用**

### 3. 設定 OAuth 同意畫面

1. **API 和服務** → **OAuth 同意畫面**
2. 使用者類型：**外部**（私人用可設測試使用者）
3. 填寫應用程式名稱（例如 `Solara`）
4. 範圍：加入 `https://www.googleapis.com/auth/drive.appdata`

### 4. 建立 OAuth 2.0 Client ID（Web）

1. **API 和服務** → **憑證** → **建立憑證** → **OAuth 用戶端 ID**
2. 應用程式類型：**網頁應用程式**
3. **已授權的 JavaScript 來源**（必須加入，注意格式）：
   - `http://localhost:8765`（本機測試）
   - `https://pooritdog.github.io`（GitHub Pages）
4. 建立後複製 **用戶端 ID**（格式：`123456789-xxxx.apps.googleusercontent.com`）

#### GitHub Pages 注意（常見 403 原因）

| 正確 | 錯誤 |
|------|------|
| 來源只寫 `https://pooritdog.github.io` | ❌ 唔好加路徑：`https://pooritdog.github.io/self-use-web` |
| 唔好加結尾 `/` | ❌ `https://pooritdog.github.io/` |
| App 實際網址可以係 `…/self-use-web/` | Origin 仍然只係域名本身 |

GIS OAuth 核對嘅係 **origin**（協議 + 域名），唔係完整 path。  
所以你用 `https://pooritdog.github.io/self-use-web/` 開 App，來源一樣只填 `https://pooritdog.github.io`。

#### OAuth 同意畫面「測試」模式（另一個常見 403）

若同意畫面狀態係 **測試中（Testing）**：

1. **OAuth 同意畫面** → **測試使用者** → **新增使用者**
2. 加入你會用來登入嘅 Gmail（一定要加，否則會 `403: access_denied`）
3. 私人自用保持測試模式即可；唔使公開發布

### 5. 在 Solara 連接

1. 用正確網址開啟：`https://pooritdog.github.io/self-use-web/`
2. **設定** → **同步**
3. 貼上 **OAuth Client ID**（只要 Client ID，唔使 Client Secret）
4. 按 **連接 Google Drive**
5. 用已加入「測試使用者」嘅 Google 帳戶授權
6. 確認 **自動同步** 已開啟（預設開啟）

## 同步行為（Git 式：fetch → merge → push）

Drive 同步跟 Git／常見雲端同步一樣，**唔會盲推本機蓋過雲端**：

| 步驟 | 動作 |
|------|------|
| 1. Fetch | 讀取 Drive `solara-v1.json` + `modifiedTime` |
| 2. Merge | 空本機 → fast-forward 雲端；兩邊都有資料 → 按 `id` 合併列表（衝突用 `updatedAt`） |
| 3. Push | 有需要先上傳；**永遠唔會用空本機覆寫有內容嘅雲端** |

| 時機 | 動作（自動，唔使撳掣） |
|------|------|
| App 載入（已連接＋自動同步開） | 自動 fetch → merge → 必要時 push |
| 每次改資料 `saveState` | 防抖 ~1.5 秒後自動完整 sync |
| 分頁／App 重新可見 | 自動完整 sync |
| 網絡由斷線恢復（`online`） | 自動完整 sync |
| 背景定時（約每 3 分鐘，頁面可見時） | 自動完整 sync |
| 打開「自動同步」掣 | 立即跑一次＋啟動定時 |
| 「立即同步」 | 手動完整 sync（自動關閉時都得） |

### 衝突策略

- **重新安裝／空本機：** fast-forward 雲端（等同 `git checkout` 遠端），唔 push
- **兩邊都有資料：** union merge（兩邊習慣／打卡都會保留），再 push 合併結果
- **本機有、雲端無：** push 本機（首次上傳）
- `syncBaseAt` 記錄上次成功對齊嘅雲端 revision（類似 upstream tip）

### 更新 App／重新「加入主畫面」後點還原

本機資料放喺瀏覽器 `localStorage`。清除網站資料、換瀏覽器、或某些「刪除 App 再加入」流程會清空本機，**唔會自動記住已連接狀態**。

請用：

1. **同一個** OAuth Client ID（唔好新建另一個 Client——`appDataFolder` 係跟 Client 嘅）
2. **同一個** Google 帳戶按 **連接 Google Drive**
3. 連接成功後會自動拉取；若雲端有舊資料，會提示「已從雲端還原資料」

亦可先用設定 → 同步 → **匯出備份**，重裝後 **匯入備份**（唔經 Google 都得）。

### 同步狀態

頂部晶片顯示：**已同步** / **同步中** / **未連接** / **失敗**

## 本機備份（無需 Google）

- **匯出 JSON**：下載完整備份檔（建議定期備份）
- **匯入 JSON**：從檔案還原（會覆蓋目前本機資料）

## 進階／舊版同步（Apps Script）

設定頁底部 **進階／舊版同步** 仍保留 Google Apps Script 手動拉取／推送方式。一般情況請使用上方 Drive 自動同步。

舊版腳本設定見 [`google-apps-script.js`](google-apps-script.js)。

## 疑難排解

| 問題 | 可能原因 |
|------|----------|
| **`403` / `access_denied`** | ① 同意畫面係測試模式，但你嘅 Gmail **未加做測試使用者**；② JavaScript 來源唔係剛好 `https://pooritdog.github.io`（唔好加 `/self-use-web`） |
| `origin_mismatch` / 來源錯誤 | Cloud Console 未加目前網頁嘅 origin；改完要等幾分鐘再生效 |
| `連接失敗` | Client ID 貼錯（多咗空格／貼咗 Secret）；或 Drive API 未啟用 |
| `未連接` | 尚未按連接；或 Token 已過期（重新按連接） |
| `失敗` | 網絡問題；Drive API 未啟用；授權範圍不足（要有 `drive.appdata`） |
| 多裝置資料不一致 | 等自動同步完成；或到設定按「立即同步」 |
| **取消打卡後另一邊又變回已完成** | 舊版取消 yes/no 打卡只刪本機紀錄、冇 tombstone，合併時雲端舊「已完成」會復活。而家取消會寫 `habitId\|date` tombstone，同刪除習慣一樣唔會被舊雲端蓋返 |
| **重裝／再加入主畫面後係空嘅** | ① 要用**同一個** Client ID + **同一個** Google 帳戶重新連接；② 唔好新建 OAuth Client；③ 連接後等「已從雲端還原」；④ 若從未開過 Drive 同步，只能靠「匯入備份」 |

### 同一般雲端服務差喺邊

| | Solara Drive sync | 常見雲端（Notion / TickTick 等） |
|--|--|--|
| 單位 | 整包 JSON snapshot（`solara-v1.json`） | 多數係逐條 API／CRDT |
| 合併 | Fetch → union-by-id → LWW(`updatedAt`) → push（待辦整行 LWW：改名＋打勾衝突以較新 `updatedAt` 整行勝出） | 伺服器權威或操作式同步 |
| 刪除 | 要靠 **tombstone**（否則舊 snapshot 會把刪除項「復活」） | 伺服器標記刪除／tombstone |
| 打卡取消 | 必須 tombstone `habitId\|date`（同 id） | 更新同一條為 undone／刪除事件 |

所以 Solara 嘅正確模型比較似 **Git + tombstone**，唔係「最後一部機整包蓋過」。一邊取消打卡如果唔寫 tombstone，另一邊／雲端舊嘅「完成」就會永遠釘死做已完成。

### 403 快速檢查清單

1. [ ] Drive API 已啟用  
2. [ ] OAuth Client 類型 = **網頁應用程式**  
3. [ ] JavaScript 來源 = `https://pooritdog.github.io`（無 path、無尾隨 `/`）  
4. [ ] 測試使用者已加入你嘅 Gmail  
5. [ ] Solara 貼嘅係 **Client ID**，唔係 Client Secret  
6. [ ] 用 `https://pooritdog.github.io/self-use-web/` 開啟（唔好用 `file://`）

## 安全提示

- OAuth Client ID 可公開（僅識別應用程式），但請勿分享 refresh token
- `appDataFolder` 只有本應用可讀寫，其他 Drive 用戶看不到
- 敏感個人資料請自行評估是否使用雲端同步
