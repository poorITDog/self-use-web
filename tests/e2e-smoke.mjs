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

// create yes/no habit
await page.click('[data-action="add-habit"]');
await page.waitForSelector("#hName");
await page.type("#hName", "晨跑");
await page.select("#hType", "yesno");
await page.click("#hSave");
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

// complete it
await page.waitForSelector('[data-toggle]');
await page.click('[data-toggle]');
await page.waitForFunction(() => {
  const chip = document.querySelector("#topChips strong");
  return chip && chip.textContent.includes("100");
});
const rate = await page.$eval("#topChips strong", (el) => el.textContent);
await assert(rate.includes("100"), "completion rate updates to 100% after yes/no checkin");

// duration habit + log minutes
await page.click('[data-action="add-habit"]');
await page.waitForSelector("#hName");
await page.evaluate(() => { document.getElementById("hName").value = ""; });
await page.type("#hName", "閱讀");
await page.select("#hType", "duration");
await page.evaluate(() => { document.getElementById("hTarget").value = "30"; });
await page.click("#hSave");
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

const toggles = await page.$$('[data-toggle]');
await toggles[toggles.length - 1].click();
await page.waitForSelector("#logVal");
await page.evaluate(() => { document.getElementById("logVal").value = "30"; });
await page.click("#logSave");
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

const minsText = await page.$eval("#topChips", (el) => el.textContent);
await assert(minsText.includes("30") || minsText.includes("時"), "duration minutes reflected in chips");

// calendar
await page.click('[data-nav="calendar"]');
await page.waitForSelector(".cal-day.today");
const dayHours = await page.$eval(".stat .value", (el) => el.textContent);
await assert(!!dayHours, "calendar day stats render");

// more tabs smoke
await page.click('[data-nav="more"]');
for (const tab of ["timetable", "countdown", "focus", "goals", "money", "theme", "sync"]) {
  await page.click('[data-more="' + tab + '"]');
  await page.waitForSelector("#moreBody");
  const body = await page.$eval("#moreBody", (el) => el.textContent.length > 0);
  await assert(body, "more tab renders: " + tab);
}

// theme switch
await page.click('[data-more="theme"]');
await page.click('[data-theme-pick="sea"]');
const theme = await page.evaluate(() => document.body.getAttribute("data-theme"));
await assert(theme === "sea", "theme switches to sea");

await assert(errors.filter((e) => !e.includes("favicon")).length === 0, "no page errors: " + JSON.stringify(errors));

await browser.close();
console.log("\nAll e2e smoke tests passed.");
