# Solara（日暖）

私人用生產力 PWA：習慣追蹤 · 待辦 · 日曆 · 倒數 · 專注 · 目標。

## PWA 與原生功能限制

| 功能 | PWA 可行？ | 說明 |
|------|-----------|------|
| iOS 主畫面小工具 Widget | ❌ 不可 | 需原生 WidgetKit；或用 Capacitor 包一層 |
| 通知 | 部分 | iOS 16.4+ 加到主畫面後可用 Web Push；本機提醒在 App 開啟時有效，背景有限 |
| iCloud | ❌ 無官方 API | 用匯出 JSON 到「檔案」或 Google Drive 自動同步 |

**未來路徑建議：** 以 [Capacitor](https://capacitorjs.com/) 包裝為原生 App，可整合 WidgetKit 小工具、APNs 推播，以及可選的 CloudKit 同步。

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
| 待辦 | 一次性清單：打勾完成、可設到期日／備註；不計連續、不佔目標 |
| 日曆 | 月曆熱力圖、週檢視、**時間表**（月｜週｜時間表 三段切換）、時間軸 |
| 倒數 | 倒數／生日／紀念日（支援每年／每月／每週重複） |
| 專注 | Pomodoro 番茄鐘（可綁定計時習慣） |
| 設定 | 目標、主題、提醒、Google Drive 自動同步 |

### 主題

- **Sunshine** — 暖奶油／金色天空漸層 + 陽光光暈（accent `#F4A261`）
- **Blue Sea** — 柔和粉藍漸層 + 底部海浪場景（accent `#58A8D8`）
- **Warm Fire** — 蜜桃／珊瑚漸層（accent `#E76F51`）
- **自訂相片** — 上傳相片 → 自動抽色作 accent，相片作半透明背景

整個 App 介面（背景、導覽、按鈕、卡片）會隨主題變化。

### 提醒

- 設定 → **提醒**：請求通知權限、開啟習慣提醒（依習慣的建議時段）
- 僅在 App 開啟時以 `setTimeout` 排程；iOS 背景通知能力有限

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
