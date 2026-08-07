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

## 測試

```bash
node --check trading/apex.js
node trading/tests/money-test.mjs
node trading/tests/engine-test.mjs
node trading/tests/analytics-test.mjs
node trading/tests/store-test.mjs
```

設計計劃見 [`PLAN.md`](PLAN.md)。
