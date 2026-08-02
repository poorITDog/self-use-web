# Solara（日暖）

私人用生產力 PWA：習慣追蹤 · 日曆 · 時間表 · 倒數 · 專注 · 目標。

## GitHub Pages（推薦）

呢個 repo **已經開咗** GitHub Pages（來源：`main` 分支根目錄）。

**網址：**

```text
https://pooritdog.github.io/self-use-web/
```

### 第一次上線（你要做）

1. Merge PR：[#1 Solara](https://github.com/poorITDog/self-use-web/pull/1) 入 `main`
2. 等 1–2 分鐘等 Pages rebuild  
   （Settings → Pages 可以看到狀態）
3. 用瀏覽器開上面個網址

> 而家 `main` 仲係舊檔；**merge 完** Pages 先會變成 Solara。

### iPhone 加到主畫面

1. 用 **Safari** 打開  
   `https://pooritdog.github.io/self-use-web/`
2. 底部分享掣 → **加入主畫面**
3. 名稱用 `Solara` → 加入

之後主畫面個 icon 就可以當 App 用；資料存喺手機本機。

---

## 本地預覽

```bash
python3 -m http.server 8765
# 開 http://localhost:8765
```

## 功能

| 頁面 | 內容 |
|------|------|
| 習慣 | 今日進度環 + 快速打卡；習慣列表（連續日、達成率、本週格）；點擊開啟月曆詳情 |
| 日曆 | 月曆熱力圖、當日習慣清單、時間表區塊 |
| 時間表 | 每週時間區塊規劃 |
| 倒數 | 倒數日子 + 專注番茄鐘 |
| 設定 | 目標、主題、Google Drive 自動同步 |

### 主題

- Sunshine / Blue Sea / Warm Fire
- 上傳相片 → 自動抽色做 accent／習慣色板

### 同步

- **Google Drive 自動同步**（預設路徑）：GIS OAuth + `appDataFolder`，見 [`sync/README.md`](sync/README.md)
- **匯出／匯入 JSON**（永遠可用；可手動放去 iCloud Drive）
- **舊版 Apps Script**：設定頁「進階／舊版同步」

> Browser 冇官方 iCloud API；iCloud 請用匯出 JSON →「檔案」App。

## 開發／測試

```bash
python3 -m http.server 8765
node tests/storage-test.mjs
node tests/e2e-smoke.mjs   # 需要 Chrome + 本機 8765
```

設計計劃見 [`PLAN.md`](PLAN.md)。
