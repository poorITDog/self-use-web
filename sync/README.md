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
3. **已授權的 JavaScript 來源**（必須加入）：
   - `http://localhost:8765`
   - `https://pooritdog.github.io`
4. 建立後複製 **用戶端 ID**（格式：`123456789-xxxx.apps.googleusercontent.com`）

### 5. 在 Solara 連接

1. 開啟 Solara → **設定** → **同步**
2. 貼上 **OAuth Client ID**
3. 按 **連接 Google Drive**
4. 登入 Google 帳戶並授權
5. 確認 **自動同步** 已開啟（預設開啟）

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
| `連接失敗` | Client ID 錯誤；或未加入正確的 JavaScript 來源 |
| `未連接` | 尚未按連接；或 Token 已過期（重新按連接） |
| `失敗` | 網絡問題；Drive API 未啟用；授權範圍不足 |
| 多裝置資料不一致 | 等自動同步完成；或到設定按「立即同步」 |

## 安全提示

- OAuth Client ID 可公開（僅識別應用程式），但請勿分享 refresh token
- `appDataFolder` 只有本應用可讀寫，其他 Drive 用戶看不到
- 敏感個人資料請自行評估是否使用雲端同步
