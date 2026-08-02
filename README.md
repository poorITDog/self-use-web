# Solara（日暖）

私人用生產力 PWA：習慣追蹤 · 日曆 · 時間表 · 倒數 · 專注 · 目標。

## GitHub Pages（推薦）

此 repo **已啟用** GitHub Pages（來源：`main` 分支根目錄）。

**網址：**

```text
https://pooritdog.github.io/self-use-web/
```

### 第一次上線

1. Merge PR：[#1 Solara](https://github.com/poorITDog/self-use-web/pull/1) 至 `main`
2. 等待 1–2 分鐘讓 Pages 重新建置  
   （Settings → Pages 可查看狀態）
3. 以瀏覽器開啟上方網址

### iPhone 加入主畫面

1. 以 **Safari** 開啟  
   `https://pooritdog.github.io/self-use-web/`
2. 底部分享按鈕 → **加入主畫面**
3. 名稱使用 `Solara` → 加入

之後可從主畫面圖示啟動；資料儲存於本機。

---

## 本地預覽

```bash
python3 -m http.server 8765
# 開啟 http://localhost:8765
```

## 功能

| 頁面 | 內容 |
|------|------|
| 習慣 | 今天打卡清單（早上／下午／晚上）+ **儀表板**（Habitify 風格月曆格）；點選方塊開啟詳情 |
| 日曆 | 月曆熱力圖、時間軸、可切換顯示習慣／倒數 |
| 時間表 | 每週時間區塊規劃（可連結習慣） |
| 倒數 | 倒數／生日／紀念日（支援每年／每月／每週重複）+ 專注番茄鐘 |
| 設定 | 目標、主題、Google Drive 自動同步 |

### 主題

- Sunshine / Blue Sea / Warm Fire
- 上傳相片 → 自動抽色作 accent／習慣色板

### 同步

- **Google Drive 自動同步**（預設路徑）：GIS OAuth + `appDataFolder`，見 [`sync/README.md`](sync/README.md)
- **匯出／匯入 JSON**（永遠可用；可手動放至 iCloud Drive）
- **舊版 Apps Script**：設定頁「進階／舊版同步」

> 瀏覽器無官方 iCloud API；iCloud 請使用匯出 JSON →「檔案」App。

## 開發／測試

```bash
python3 -m http.server 8765
node --check solara.js
node tests/storage-test.mjs
node tests/e2e-smoke.mjs   # 需要 Chrome + 本機 8765
```

設計計劃見 [`PLAN.md`](PLAN.md)。
