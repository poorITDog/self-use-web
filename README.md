# Solara（日暖）

私人用生產力 PWA：習慣追蹤 · 日曆 · 時間表 · 倒數 · 專注 · 目標 · 記帳。

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
