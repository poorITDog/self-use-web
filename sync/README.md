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

## 同步行為

| 時機 | 動作 |
|------|------|
| App 載入（已連接） | 從 Drive 拉取 → 與本機 LWW 合併（`syncUpdatedAt`） |
| 每次 `saveState` | 防抖 ~1.5 秒後上傳完整 JSON |
| 分頁重新可見 | 若已連接且自動同步開啟，再次拉取合併 |

### 衝突策略（Last-Write-Wins）

比較本機 `syncUpdatedAt` 與雲端檔案 `modifiedTime`。較新的一方覆蓋較舊。

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
