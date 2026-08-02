# Solara Google Apps Script 同步

Solara 支援將整包本機資料（`localStorage` key: `solara-v1`）備份到 Google Drive，透過一個 Apps Script Web App URL + Token 拉取／推送。

## 設定步驟

### 1. 建立 Apps Script 專案

1. 前往 [https://script.google.com](https://script.google.com) 開新專案
2. 將 `google-apps-script.js` 的內容貼入編輯器並儲存

### 2. 設定 Token（指令碼屬性）

1. 專案設定 → **指令碼屬性**
2. 新增屬性：
   - **名稱：** `SOLARA_TOKEN`
   - **值：** 自訂密碼（例如一組長隨機字串）

此 Token 用於驗證請求，請勿公開分享。

### 3. 部署為網頁應用程式

1. **部署** → **新部署**
2. 類型：**網頁應用程式**
3. 設定：
   - **執行身分：** 我
   - **可存取對象：** 任何擁有連結的人
4. 部署後複製 **Web App URL**（格式類似 `https://script.google.com/macros/s/.../exec`）

### 4. 在 Solara 填入設定

1. 開啟 Solara → **更多** → **同步**
2. 貼上 **Apps Script URL**
3. 輸入 **Token**（與 `SOLARA_TOKEN` 相同）
4. 使用 **推送到雲端** 或 **從雲端拉取**

## API 行為

腳本會在你 Google Drive **根目錄**建立／更新 `solara-backup.json`。

| 方法 | URL | 說明 |
|------|-----|------|
| GET | `?token=YOUR_TOKEN` | 回傳 `{ ok, data, updatedAt }`；若無檔案則 `data: null` |
| POST | `?token=YOUR_TOKEN&mode=merge` | Body: `{ "data": { ...整包 Solara state... } }`，寫入 Drive |
| POST | `?token=YOUR_TOKEN&mode=delete` | 將備份檔移至垃圾桶 |

## 衝突策略（Last-Write-Wins）

- **拉取：** 比較本機 `syncUpdatedAt` 與雲端檔案 `updatedAt`（Drive 最後修改時間）。雲端較新則覆蓋本機。
- **推送：** 將目前本機整包 state 上傳（建議在單一裝置編輯後再推送，避免多裝置同時寫入）。

## 本機備份（無需 Google）

- **匯出 JSON：** 下載完整備份檔
- **匯入 JSON：** 從檔案還原（會覆蓋目前本機資料）

## 疑難排解

| 問題 | 可能原因 |
|------|----------|
| `unauthorized` | Token 錯誤或未設定 `SOLARA_TOKEN` |
| CORS / 拉取失敗 | 確認已重新部署 Web App；部分瀏覽器對 `script.google.com` 跨域有限制，可改用匯出／匯入 |
| 推送成功但拉取為空 | 首次推送後需等 Drive 寫入完成再拉取 |

## 安全提示

- Token 等同備份密碼，勿寫入公開 repo
- Web App 設為「任何擁有連結」時，只有知道 Token 的人才能讀寫
- 敏感記帳資料請自行評估是否使用雲端同步
