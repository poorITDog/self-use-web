// Assert 放假 + circular check share a fixed action rail across habit rows.
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
await page.waitForSelector(".habit-checkin-row .habit-row-actions");

function assert(cond, name) {
  if (!cond) throw new Error("FAIL: " + name);
}

assert(!(await page.$(".today-timeline, .today-timeline-wrap")), "today timeline removed");

const checkin = await page.evaluate(() => {
  return [...document.querySelectorAll(".habit-checkin-row")].map((row) => {
    const actions = row.querySelector(".habit-row-actions");
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
      checkH: Math.round(cr.height),
      checkIsCircle: Math.abs(cr.width - cr.height) <= 1
    };
  }).filter(Boolean);
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

for (const r of checkin) {
  if (Math.abs(r.holH - r.checkH) > 1) {
    throw new Error("checkin action heights differ " + r.holH + "/" + r.checkH);
  }
  if (!r.checkIsCircle) {
    throw new Error("check button must stay circular");
  }
}

console.log("PASS checkin action columns aligned across", checkin.length, "rows");
console.log("PASS check buttons are circular");
console.log("PASS today has no timeline duplicate rail");
await browser.close();
