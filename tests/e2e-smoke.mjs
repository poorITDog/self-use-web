// Solara end-to-end smoke test (Puppeteer + system Chrome)
import { createRequire } from "module";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function ensurePuppeteer() {
  try {
    createRequire(import.meta.url).resolve("puppeteer-core");
    return;
  } catch {
    console.log("Installing puppeteer-core…");
    const r = spawnSync("npm", ["install", "--no-save", "puppeteer-core@24"], {
      cwd: root,
      stdio: "inherit"
    });
    if (r.status !== 0) process.exit(1);
  }
}

ensurePuppeteer();
const puppeteer = (await import("puppeteer-core")).default;

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto("http://127.0.0.1:8765/index.html", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle0" });

async function assert(cond, name) {
  if (!cond) {
    console.error("FAIL:", name);
    await browser.close();
    process.exit(1);
  }
  console.log("PASS:", name);
}

const brand = await page.$eval("h1", (el) => el.textContent.trim());
await assert(brand === "Solara", "brand visible");

// default tab is habits
const activeNav = await page.$eval("#nav button.active", (el) => el.getAttribute("data-nav"));
await assert(activeNav === "habits", "default nav is habits");

// today strip renders
await page.waitForSelector(".today-strip");
const todayStrip = await page.$(".today-strip");
await assert(!!todayStrip, "today strip renders");

// create yes/no habit
await page.click('[data-action="add-habit"]');
await page.waitForSelector("#hName");
await page.type("#hName", "晨跑");
await page.select("#hType", "yesno");
await page.click("#hSave");
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

// complete it via large check button
await page.waitForSelector(".check-lg");
await page.click(".check-lg");
await page.waitForFunction(() => {
  const ring = document.querySelector(".progress-ring-inner strong");
  return ring && ring.textContent.includes("100");
});
const rate = await page.$eval(".progress-ring-inner strong", (el) => el.textContent);
await assert(rate.includes("100"), "completion rate updates to 100% after yes/no checkin");

// habit card with own month calendar
await page.waitForSelector(".habit-card .habit-mini-cal");
const cardCal = await page.$(".habit-card .habit-mini-cal");
await assert(!!cardCal, "habit card calendar renders");

// open habit detail with full calendar
await page.click('[data-habit-open]');
await page.waitForSelector(".habit-full-cal");
const detailCal = await page.$(".habit-full-cal");
await assert(!!detailCal, "habit detail calendar renders");
await page.click("#hdClose");
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

// duration habit + log minutes
await page.click('[data-action="add-habit"]');
await page.waitForSelector("#hName");
await page.evaluate(() => { document.getElementById("hName").value = ""; });
await page.type("#hName", "閱讀");
await page.select("#hType", "duration");
await page.evaluate(() => { document.getElementById("hTarget").value = "30"; });
await page.click("#hSave");
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

await page.waitForFunction(() => document.querySelectorAll(".habit-card").length >= 2);
await page.evaluate(() => {
  const btn = document.querySelectorAll(".habit-card")[1].querySelector(".check-lg");
  btn.scrollIntoView({ block: "center" });
  btn.click();
});
await page.waitForSelector("#logVal", { visible: true });
await page.evaluate(() => { document.getElementById("logVal").value = "30"; });
await page.click("#logSave");
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

const minsText = await page.$eval("#topChips", (el) => el.textContent);
await assert(minsText.includes("30") || minsText.includes("時"), "duration minutes reflected in chips");

// calendar
await page.click('[data-nav="calendar"]');
await page.waitForSelector(".cal-day.today");
const dayRate = await page.$eval(".cal-day-summary .value", (el) => el.textContent);
await assert(!!dayRate, "calendar day stats render");

// timetable
await page.click('[data-nav="timetable"]');
await page.waitForSelector("#view-timetable");
const timetableBody = await page.$eval("#view-timetable", (el) => el.textContent.length > 0);
await assert(timetableBody, "timetable view renders");

// countdown + focus
await page.click('[data-nav="countdown"]');
await page.waitForSelector(".focus-ring");
const countdownBody = await page.$eval("#view-countdown", (el) => el.textContent.length > 0);
await assert(countdownBody, "countdown view renders");

// settings tabs smoke (no money tab)
await page.click('[data-nav="settings"]');
for (const tab of ["goals", "theme", "sync"]) {
  await page.click('[data-settings="' + tab + '"]');
  await page.waitForSelector("#settingsBody");
  const body = await page.$eval("#settingsBody", (el) => el.textContent.length > 0);
  await assert(body, "settings tab renders: " + tab);
}
const moneyTab = await page.$('[data-settings="money"]');
await assert(!moneyTab, "money settings tab removed");

// theme switch
await page.click('[data-settings="theme"]');
await page.click('[data-theme-pick="sea"]');
const theme = await page.evaluate(() => document.body.getAttribute("data-theme"));
await assert(theme === "sea", "theme switches to sea");

// sync chip visible
await page.click('[data-nav="habits"]');
const syncChip = await page.$("#syncChip");
await assert(!!syncChip, "sync status chip visible");

await assert(errors.filter((e) => !e.includes("favicon")).length === 0, "no page errors: " + JSON.stringify(errors));

await browser.close();
console.log("\nAll e2e smoke tests passed.");
