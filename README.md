# Solara（日暖）

私人用生產力 PWA：習慣追蹤 · 日曆 · 時間表 · 倒數 · 專注 · 目標 · 記帳。

## 點樣用

1. 用瀏覽器打開 `index.html`（或任何靜態伺服器）
2. iPhone：Safari → 分享 → **加入主畫面**
3. Android：Chrome → 選單 → **安裝應用程式 / 加到主畫面**

資料預設只存本機（`localStorage`）。

## 功能

| 頁面 | 內容 |
|------|------|
| 今日 | 今日習慣打卡、達成率、時數、倒數、短期目標 |
| 習慣 | 是/否、數量、計時；連擊、本月達成、累計時數 |
| 日曆 | 月曆熱點、當日時數、時間流、打卡紀錄 |
| 更多 | 時間表、倒數、番茄鐘、短/長期目標、記帳、主題、同步 |

### 主題

- Sunshine / Blue Sea / Warm Fire
- 上傳相片 → 自動抽色做 accent／習慣色板

### 同步

- **匯出／匯入 JSON**（永遠可用；可手動放去 iCloud Drive）
- **Google Drive**：見 [`sync/README.md`](sync/README.md)（Apps Script）

> Browser 冇官方 iCloud API；iCloud 請用匯出 JSON →「檔案」App。

## 開發／測試

```bash
python3 -m http.server 8765
node tests/storage-test.mjs
node tests/e2e-smoke.mjs   # 需要 Chrome + 本機 8765
```

設計計劃見 [`PLAN.md`](PLAN.md)。
