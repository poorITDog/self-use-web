# Solara（日暖）— 設計計劃

## 1. 產品定位

私人用生產力 App，結合 Habi + TickTick 核心：

| 主功能 | 說明 |
|--------|------|
| 習慣追蹤 | 是/否、計時、數量；連續日、達成率、時數；每個習慣獨立月曆格 |
| 日曆 | 月／週／日；顯示習慣完成同總時數 |
| 時間表 | 一日時間區塊（朝早／下午／晚上） |
| 倒數 | 考試、旅行、deadline |
| 專注計時 | Pomodoro（可自訂） |
| 目標 | 短期 + 長期進度 |
| 記帳 | 收支、分類、月結 |

**不做（自用 YAGNI）：** 多用戶協作、Siri、Widget、NLP、訂閱其他日曆。

---

## 2. 技術選擇：HTML PWA（唔用 Flutter）

| 方案 | 優點 | 缺點 |
|------|------|------|
| **HTML + PWA（選呢個）** | 同「self-use web」一致；加主畫面即用；零 build；Google Drive 同步易做 | iCloud 無官方 Web API |
| Flutter | 原生 Widget／通知較強 | 環境重、發佈麻煩；iCloud 仍要 iOS native；自用過重 |

**結論：** 單檔（或少量靜態檔）PWA，本機優先，可「加到主畫面」。

---

## 3. 同步策略（研究結論）

### iCloud
- Browser **冇**可靠 iCloud／CloudKit API。
- 可行替代：匯出 JSON → iOS「檔案」App → iCloud Drive；或手動備份。

### Google Drive（推薦）
1. **Apps Script JSON 備份（首選自用）**  
   一個 Web App URL + Token，上傳／下載成個 JSON（類似常見 self-host sync）。
2. **Drive `appDataFolder` API**  
   OAuth + 隱藏 App 資料夾；要 Google Cloud Client ID。
3. **本機匯出／匯入**  
   永遠可用，唔依賴帳號。

**實作優先級：**  
`localStorage` → JSON 匯出／匯入 → Apps Script 雲端同步（可選填 URL）。

衝突策略：Last-Write-Wins（`updatedAt`／`syncUpdatedAt`）。

---

## 4. 資訊架構

```
習慣 Habits    — 今日記錄 + 每個習慣獨立月曆卡片（日數／時數／連續日）
日曆 Calendar  — 月曆總覽 + 當日時間軸
時間表         — 時間區塊
倒數           — 倒數日子 + 專注番茄鐘
設定           — 目標、記帳、主題、Google Drive 自動同步
```

---

## 5. UI／視覺

- **感覺：** 明亮、清新、帶暖意（陽光／海藍／暖火）。
- **字體：** Outfit（標題）+ Noto Sans TC（正文）— 唔用 Inter／系統堆。
- **背景場景（預設）：**
  1. Sunshine — 暖金 + 天藍
  2. Blue Sea — 青綠 + 海水藍
  3. Warm Fire — 琥珀 + 珊瑚
  4. Custom Photo — 上傳相片作全幅背景，Canvas 抽主色 → CSS 變數（accent／habit 色板）
- **動效：** 頁面淡入、習慣打勾彈、主題切換過渡（至少 2–3 個）。
- **原則：** 首屏一體構圖；唔用卡片牆；品牌 Solara 要夠強。

---

## 6. 資料模型（精簡）

```text
settings: { theme, photoDataUrl?, palette?, cloudUrl?, cloudToken?, locale }
habits[]: { id, name, color, type: yesno|count|duration, frequency[],
            group, timeOfDay?, target?, createdAt, updatedAt }
checkins[]: { id, habitId, date, value, minutes?, note?, updatedAt }
blocks[]: { id, title, dayOfWeek|date, start, end, color, habitId?, updatedAt }
countdowns[]: { id, title, targetAt, color, emoji?, updatedAt }
focusSessions[]: { id, startedAt, minutes, habitId?, label?, updatedAt }
goals[]: { id, title, kind: short|long, target, current, unit, dueAt?, updatedAt }
transactions[]: { id, type: in|out, amount, category, note, date, updatedAt }
```

全部包喺一個 `solara-v1` localStorage key，方便整包備份。

---

## 7. 功能落地順序（每步完先測再下一）

1. Scaffold：shell、nav、storage、主題預設  
2. 習慣 CRUD + 每習慣月曆格 + 連續日／時數  
3. 日曆總覽 + 時間表（獨立分頁）  
4. 倒數 + 專注  
5. 目標、記帳、主題  
6. Google Drive 自動同步（GIS + appDataFolder）  

---

## 8. 驗收標準

- 手機／桌面瀏覽器可用；可 Add to Home Screen  
- 離線可讀寫本機資料  
- 四大主功能 + 目標 + 記帳可用  
- 主題預設同自訂相片可用  
- 備份匯出／匯入成功；雲端 URL 可選配置  
- 唔依賴帳號即可用  

---

## 9. 計劃覆核（Review）

| 問題 | 決定 |
|------|------|
| Flutter？ | 唔用；自用 Web PWA 夠 |
| iCloud 即時同步？ | 唔做；改用匯出或 Google Drive |
| 協作／Widget？ | 不做 |
| 同舊 trading HTML？ | 空分支，完全獨立 |

計劃通過後按第 7 節實作。
