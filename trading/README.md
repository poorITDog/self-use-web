# Apex Trade Lab

真實行情 · 零風險永續模擬練習。六維風格雷達 + Challenge 排行。

**非 Bybit 產品。** 模擬資金，唔係投資建議。

## 開啟

GitHub Pages：`https://pooritdog.github.io/self-use-web/trading/`

本地：

```bash
python3 -m http.server 8765
# http://localhost:8765/trading/
```

## 功能摘要

- Trade：真實行情圖表、訂單簿、市價／限價、槓桿、TP/SL、Reduce-Only、補倉／重置
- Portfolio：權益曲線、回撤／Sharpe／勝率
- Analyze：六維雷達 + Ability Score
- Rank：7 日 Challenge、可排序本機榜、成績碼匯出
- Settings：費用、匯入預覽、免責

## 測試

```bash
node --check trading/apex.js
node trading/tests/money-test.mjs
node trading/tests/engine-test.mjs
node trading/tests/analytics-test.mjs
node trading/tests/store-test.mjs
# 需本機 http.server 8765：
node trading/tests/smoke-check.mjs
```

設計計劃見 [`PLAN.md`](PLAN.md)。