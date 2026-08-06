// Assert 放假 + circular check share a fixed action rail across rows.
import { createRequire } from "module";
import { spawnSync } from "child_process";

try {
  createRequire(import.meta.url).resolve("puppeteer-core");
} catch {
  spawnSync("npm", ["install", "--no-save", "puppeteer-core@24"], { stdio: "inherit" });
}
const puppeteer = (await import("puppeteer-core")).default;

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:8765/index.html", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle0" });

async function addHabit(name) {
  await page.waitForSelector('[data-action="add-habit"]');
  await page.evaluate(() => document.querySelector('[data-action="add-habit"]').click());
  await page.waitForSelector("#hName");
  await page.evaluate((n) => {
    const el = document.getElementById("hName");
    el.focus();
    el.value = n;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
  await page.select("#hType", "yesno");
  await page.evaluate(() => document.getElementById("hSave").click());
  await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));
}

await addHabit("晨跑對齊");
await addHabit("聽力對齊");
await page.waitForSelector(".habit-checkin-row .row-actions");
await page.waitForSelector(".today-timeline-item .row-actions");

const checkin = await page.evaluate(() => {
  return [...document.querySelectorAll(".habit-checkin-row")].map((row) => {
    const actions = row.querySelector(".row-actions");
    const hol = actions && actions.querySelector(".habit-holiday-btn");
    const check = actions && actions.querySelector(".check-row, [data-toggle]");
    if (!actions || !hol || !check) return null;
    const ar = actions.getBoundingClientRect();
    const hr = hol.getBoundingClientRect();
    const cr = check.getBoundingClientRect();
    return {
      actionsLeft: Math.round(ar.left),
      holLeft: Math.round(hr.left),
      checkLeft: Math.round(cr.left),
      holH: Math.round(hr.height),
      checkH: Math.round(cr.height)
    };
  }).filter(Boolean);
});

const timeline = await page.evaluate(() => {
  return [...document.querySelectorAll(".today-timeline-item .row-actions")].map((actions) => {
    const hol = actions.querySelector(".habit-holiday-btn, .row-actions-spacer");
    const check = actions.querySelector(".check-row, [data-toggle]");
    const ar = actions.getBoundingClientRect();
    const hr = hol.getBoundingClientRect();
    const cr = check.getBoundingClientRect();
    return {
      actionsLeft: Math.round(ar.left),
      holLeft: Math.round(hr.left),
      checkLeft: Math.round(cr.left),
      checkIsCircle: Math.abs(cr.width - cr.height) <= 1,
      hasTextCheck: !!actions.querySelector(".timeline-check-btn, .btn.sm")
    };
  });
});

const order = await page.evaluate(() => {
  const checkinEl = document.querySelector(".today-checkin");
  const timelineEl = document.querySelector(".today-timeline");
  if (!checkinEl || !timelineEl) return null;
  return (checkinEl.compareDocumentPosition(timelineEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
});

function assertCol(rows, key, label) {
  if (rows.length < 2) throw new Error(label + ": need ≥2 rows, got " + rows.length);
  const first = rows[0][key];
  for (const r of rows) {
    if (Math.abs(r[key] - first) > 1) {
      throw new Error(label + " " + key + " misaligned: " + rows.map((x) => x[key]).join(","));
    }
  }
}

assertCol(checkin, "actionsLeft", "checkin");
assertCol(checkin, "holLeft", "checkin");
assertCol(checkin, "checkLeft", "checkin");
assertCol(timeline, "actionsLeft", "timeline");
assertCol(timeline, "holLeft", "timeline");
assertCol(timeline, "checkLeft", "timeline");

for (const r of checkin) {
  if (Math.abs(r.holH - r.checkH) > 1) {
    throw new Error("checkin action heights differ " + r.holH + "/" + r.checkH);
  }
}
if (timeline.some((r) => !r.checkIsCircle || r.hasTextCheck)) {
  throw new Error("timeline must use circular check, not text 打卡/已完成");
}
if (!order) throw new Error("soft habit cards must render before timeline (DC order)");

console.log("PASS checkin action columns aligned across", checkin.length, "rows");
console.log("PASS timeline action columns aligned across", timeline.length, "rows");
console.log("PASS timeline uses circular check (no text wrap)");
console.log("PASS habit cards appear before timeline");
await browser.close();
