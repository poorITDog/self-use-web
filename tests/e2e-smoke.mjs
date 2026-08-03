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

const brand = await page.$eval(".solara-mark", (el) => el.getAttribute("aria-label"));
await assert(brand === "Solara", "brand mark visible on habits");

// default tab is habits; today panel is default
const activeNav = await page.$eval("#nav button.active", (el) => el.getAttribute("data-nav"));
await assert(activeNav === "habits", "default nav is habits");

await page.waitForSelector('[data-habits-panel="today"].on');
const todayDefault = await page.$eval('[data-habits-panel="today"]', (el) => el.classList.contains("on"));
await assert(todayDefault, "habits today panel is default");

// today summary renders
await page.waitForSelector(".today-strip");
const todayStrip = await page.$(".today-strip");
await assert(!!todayStrip, "today summary strip renders");
await page.waitForSelector(".week-summary");
const weekSummary = await page.$(".week-summary");
await assert(!!weekSummary, "week summary renders on habits");

// habits segment: 今天 | 儀表板
await page.waitForSelector('[data-habits-panel="board"]');
const boardTab = await page.$eval('[data-habits-panel="board"]', (el) => el.textContent);
await assert(boardTab.includes("儀表板"), "habits board tab label is Traditional Chinese");

async function clickAction(action) {
  await page.waitForSelector('[data-action="' + action + '"]');
  await page.evaluate((act) => {
    const el = document.querySelector('[data-action="' + act + '"]');
    if (el) el.click();
  }, action);
}

// create yes/no habit (defaults to suggested time)
await clickAction("add-habit");
await page.waitForSelector("#hName");
await page.type("#hName", "晨跑");
await page.select("#hType", "yesno");
const defaultTime = await page.$eval("#hTime", (el) => el.value);
await assert(!!defaultTime, "new habit gets default suggested time");
await page.evaluate(() => document.getElementById("hSave").click());
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

// today timeline appears after timed habit exists
await page.waitForSelector(".today-timeline");
const timeline = await page.$(".today-timeline");
await assert(!!timeline, "today timeline renders with timed habit");

// complete via check on today row
await page.waitForSelector(".habit-checkin-row .check-lg, .check-lg");
await page.evaluate(() => document.querySelector(".check-lg").click());
await page.waitForFunction(() => {
  const ring = document.querySelector(".progress-ring-inner strong");
  return ring && ring.textContent.includes("100");
});
const rate = await page.$eval(".progress-ring-inner strong", (el) => el.textContent);
await assert(rate.includes("100"), "completion rate updates to 100% after yes/no checkin");

// habit dashboard boxes on board
await page.click('[data-habits-panel="board"]');
await page.waitForSelector(".habit-box");
const habitBox = await page.$(".habit-box");
await assert(!!habitBox, "habit dashboard box renders");
const boxCal = await page.$(".habit-box-cal");
await assert(!!boxCal, "habit box calendar grid renders");
const monthLabel = await page.$(".habit-box-month-label");
await assert(!!monthLabel, "habit box month label renders");
const dayBtn = await page.$(".habit-box-day[data-habit-day]");
await assert(!!dayBtn, "habit box day cells are clickable buttons");

// switch to today panel still works
await page.click('[data-habits-panel="today"]');
await page.waitForSelector(".habit-checkin-row, .habit-row");
await page.click('[data-habits-panel="board"]');
await page.waitForSelector(".habit-box");

// open habit detail from box — edit must work inside modal (outside #app)
await page.click('[data-habit-box-open]');
await page.waitForSelector(".habit-full-cal");
const detailCal = await page.$(".habit-full-cal");
await assert(!!detailCal, "habit detail calendar renders");
const yearHeat = await page.$(".habit-year-heat");
await assert(!!yearHeat, "habit detail year heatmap renders");
const detailEdit = await page.$('#modal [data-edit-habit]');
await assert(!!detailEdit, "habit detail has edit button");
const detailDelete = await page.$('#modal [data-delete-habit]');
await assert(!!detailDelete, "habit detail has delete button");
await page.evaluate(() => document.querySelector('#modal [data-edit-habit]').click());
await page.waitForSelector("#hName");
const editName = await page.$eval("#hName", (el) => el.value);
await assert(editName.includes("晨跑"), "edit modal opens with habit name from detail");
await page.evaluate(() => { document.getElementById("hName").value = "晨跑改名"; });
await page.evaluate(() => document.getElementById("hSave").click());
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));
const renamed = await page.$eval("#view-habits", (el) => el.textContent.includes("晨跑改名"));
await assert(renamed, "habit rename saved from detail edit");

// habit editor supports start/end time range (e.g. gym 06:30–08:30)
await page.click('[data-habit-box-open]');
await page.waitForSelector('#modal [data-edit-habit]');
await page.evaluate(() => document.querySelector('#modal [data-edit-habit]').click());
await page.waitForSelector("#hTimeEnd");
await page.evaluate(() => {
  document.getElementById("hTime").value = "06:30";
  document.getElementById("hTimeEnd").value = "08:30";
  document.getElementById("hSave").click();
});
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));
const rangeText = await page.$eval("#view-habits", (el) => el.textContent);
await assert(rangeText.includes("06:30") && rangeText.includes("08:30"), "habit time range 06:30–08:30 saved and shown");

// pull habit detail sheet down to return to main habits page
await page.click('[data-habit-box-open]');
await page.waitForSelector(".habit-detail .sheet-handle");
await page.waitForSelector("#hdBack");
const pullHint = await page.$(".sheet-pull-hint");
await assert(!!pullHint, "habit detail shows pull-to-back hint");
const backBtn = await page.$eval("#hdBack", (el) => el.textContent.includes("返回"));
await assert(backBtn, "habit detail shows back button");
await page.evaluate(() => {
  const modal = document.getElementById("modal");
  const rect = modal.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + 20;
  const opts = { bubbles: true, pointerId: 1, pointerType: "touch", isPrimary: true };
  modal.dispatchEvent(new PointerEvent("pointerdown", Object.assign({ clientX: x, clientY: y }, opts)));
  modal.dispatchEvent(new PointerEvent("pointermove", Object.assign({ clientX: x, clientY: y + 140 }, opts)));
  modal.dispatchEvent(new PointerEvent("pointerup", Object.assign({ clientX: x, clientY: y + 140 }, opts)));
});
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));
const afterPull = await page.$("#modalBackdrop.open");
await assert(!afterPull, "pull down dismisses habit detail back to main");

// main list stays clean — no inline edit buttons
const listEditBtns = await page.$$(".habit-edit-btn, .habit-checkin-row [data-edit-habit], .habit-box [data-edit-habit]");
await assert(listEditBtns.length === 0, "no inline edit buttons on habit main list");

// archive lives in settings
await page.click('[data-nav="settings"]');
await page.waitForSelector('[data-settings="archive"]');
await page.evaluate(() => document.querySelector('[data-settings="archive"]').click());
await page.waitForSelector("#settingsBody .archived-habits");
const archiveBody = await page.$eval("#settingsBody", (el) => el.textContent);
await assert(archiveBody.includes("封存") || archiveBody.includes("尚無"), "settings archive tab renders");
await page.click('[data-nav="habits"]');
await page.waitForSelector(".today-strip");
const habitsHasArchiveBlock = await page.$("#view-habits .archived-habits");
await assert(!habitsHasArchiveBlock, "habits main view no longer shows archive block");

// overview mode week strip
await page.click('[data-habits-panel="board"]');
await page.click('[data-habits-board-mode="overview"]');
await page.waitForSelector(".habit-row .week-strip");
const weekStrip = await page.$(".habit-row .week-strip");
await assert(!!weekStrip, "habit row week strip renders in overview");

// duration habit + log minutes
await clickAction("add-habit");
await page.waitForSelector("#hName");
await page.evaluate(() => { document.getElementById("hName").value = ""; });
await page.type("#hName", "閱讀");
await page.select("#hType", "duration");
await page.evaluate(() => { document.getElementById("hTarget").value = "30"; });
await page.evaluate(() => document.getElementById("hSave").click());
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

await page.click('[data-habits-panel="today"]');
await page.waitForFunction(() => document.querySelectorAll(".habit-checkin-row, .habit-row").length >= 2);
await page.evaluate(() => {
  const btn = document.querySelectorAll(".check-lg")[1];
  btn.scrollIntoView({ block: "center" });
  btn.click();
});
await page.waitForSelector("#logVal", { visible: true });
await page.evaluate(() => { document.getElementById("logVal").value = "30"; });
await page.evaluate(() => document.getElementById("logSave").click());
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

const minsText = await page.$eval(".today-strip", (el) => el.textContent);
await assert(minsText.includes("30") || minsText.includes("時"), "duration minutes reflected in today summary");

// calendar
await page.click('[data-nav="calendar"]');
await page.waitForSelector(".cal-day.today");
const dayRate = await page.$eval(".day-panel-stats .value", (el) => el.textContent);
await assert(!!dayRate, "calendar day stats render");

// timetable inside calendar (月 | 週 | 時間表)
await page.click('[data-nav="calendar"]');
await page.waitForSelector('[data-cal-mode="timetable"]');
await page.click('[data-cal-mode="timetable"]');
await page.waitForSelector(".timetable-wrap");
const timetableBody = await page.$eval("#view-calendar", (el) => el.textContent.length > 0);
await assert(timetableBody, "calendar timetable mode renders");

// countdown (no focus ring)
await page.click('[data-nav="countdown"]');
await page.waitForSelector(".countdown-cards, .empty");
const hasFocusOnCountdown = await page.$("#view-countdown .focus-ring");
await assert(!hasFocusOnCountdown, "countdown view has no pomodoro");

// focus page sound toggle
await page.click('[data-nav="focus"]');
await page.waitForSelector("#view-focus .focus-ring");
const focusSoundToggle = await page.$("#focusSoundEnabled");
await assert(!!focusSoundToggle, "focus page has sound toggle");

// calendar add-event modal with weekly repeat
await page.reload({ waitUntil: "networkidle0" });
await page.click('[data-nav="calendar"]');
await page.waitForSelector('[data-action="add-event"]');
await page.click('[data-action="add-event"]');
await page.waitForSelector("#eTitle");
const eventTitleField = await page.$("#eTitle");
await assert(!!eventTitleField, "add-event modal opens with eTitle field");
const repeatField = await page.$("#eRepeat");
await assert(!!repeatField, "event editor has repeat select");
await page.type("#eTitle", "每週站會");
await page.select("#eRepeat", "weekly");
await page.evaluate(() => document.getElementById("eSave").click());
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));
const dayPanel = await page.$eval(".day-panel", (el) => el.textContent);
await assert(dayPanel.includes("每週站會"), "recurring event appears on selected day");
await assert(dayPanel.includes("每週"), "recurring event shows weekly label");

// goals can link to habits; cert/hours; finished → achievement list
await page.click('[data-nav="settings"]');
await page.click('[data-settings="goals"]');
await page.waitForSelector('[data-action="add-goal-short"]');
await page.click('[data-action="add-goal-short"]');
await page.waitForSelector("#gHabit");
await page.waitForSelector("#gType");
await page.type("#gTitle", "跑步目標");
await page.select("#gType", "outcome");
await page.select("#gUnitMode", "count");
await page.type("#gOutcome", "成為穩定完賽跑者");
const habitOpts = await page.$$eval("#gHabit option", (opts) => opts.map((o) => o.value).filter(Boolean));
await assert(habitOpts.length > 0, "goal editor lists habits to link");
await page.select("#gHabit", habitOpts[0]);
await page.evaluate(() => document.getElementById("gSave").click());
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));
const goalsBody = await page.$eval("#settingsBody", (el) => el.textContent);
await assert(goalsBody.includes("跑步目標"), "goal saved");
await assert(goalsBody.includes("連結習慣"), "goal shows linked habit");
await assert(goalsBody.includes("設定於「設定 → 目標」"), "goal shows setup location");
await assert(goalsBody.includes("開始於"), "goal shows start date");
await assert(goalsBody.includes("成果"), "goal shows outcome type badge");
await assert(!!(await page.$("[data-goal-check]")), "goal has check-and-plus when habit linked");
await assert(!!(await page.$(".goal-habit-chip")), "linked habit shows colored chip");
await assert(!!(await page.$(".goal-row.has-habit")), "linked goal row uses habit accent class");

// hours + cert goal, finish into achievements
await page.waitForSelector('[data-action="add-goal-long"]');
await page.evaluate(() => document.querySelector('[data-action="add-goal-long"]').click());
await page.waitForSelector("#modalBackdrop.open #gTitle");
await page.evaluate(() => {
  document.getElementById("gTitle").value = "AWS SAA 證書";
  document.getElementById("gType").value = "cert";
  document.getElementById("gUnitMode").value = "hours";
  document.getElementById("gCur").value = "40";
  document.getElementById("gTarget").value = "40";
  document.getElementById("gOutcome").value = "取得 AWS Solutions Architect Associate";
  document.getElementById("gSave").click();
});
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));
await page.waitForSelector(".achievements-group");
const achieveBody = await page.$eval("#settingsBody", (el) => el.textContent);
await assert(achieveBody.includes("成就列表"), "achievements section renders");
await assert(achieveBody.includes("AWS SAA 證書"), "finished cert goal appears in achievements");
await assert(achieveBody.includes("取得 AWS Solutions Architect Associate"), "achievement shows outcome text");
await assert(!!(await page.$("[data-goal-reopen]")), "achievement has reopen control");

// global quick-add FAB
await page.click('[data-nav="habits"]');
await page.waitForSelector("#globalFab");
await page.evaluate(() => document.getElementById("globalFab").click());
await page.waitForSelector("#qaHabit");
const quickAdd = await page.$("#qaEvent");
await assert(!!quickAdd, "quick-add sheet offers event option");
await page.evaluate(() => document.getElementById("qaCancel").click());
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

// settings notify tab has focus sound + event remind options
await page.click('[data-nav="settings"]');
await page.evaluate(() => document.querySelector('[data-settings="notify"]').click());
await page.waitForSelector("#notifyEvents");
const notifySound = await page.$("#settingsFocusSound");
await assert(!!notifySound, "settings notify tab has focusSound toggle");
const notifyEvents = await page.$("#notifyEvents");
await assert(!!notifyEvents, "settings notify tab has event remind toggle");

// focus / pomodoro (revisit)
await page.click('[data-nav="focus"]');
await page.waitForSelector("#view-focus .focus-ring");
const focusRing = await page.$("#view-focus .focus-ring");
await assert(!!focusRing, "focus view renders pomodoro");

// countdown with yearly birthday repeat
await page.click('[data-nav="countdown"]');
await clickAction("add-countdown");
await page.waitForSelector("#cTitle");
await page.type("#cTitle", "生日");
await page.select("#cKind", "birthday");
await page.waitForFunction(() => document.getElementById("cRepeat").value === "yearly");
const repeatVal = await page.$eval("#cRepeat", (el) => el.value);
await assert(repeatVal === "yearly", "birthday defaults to yearly repeat");
await page.evaluate(() => document.getElementById("cSave").click());
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));
const countdownBody = await page.$eval("#view-countdown", (el) => el.textContent);
await assert(countdownBody.includes("生日"), "countdown view renders birthday item");

// settings tabs smoke (no money tab)
await page.click('[data-nav="settings"]');
for (const tab of ["goals", "archive", "theme", "notify", "sync"]) {
  await page.evaluate((t) => document.querySelector('[data-settings="' + t + '"]').click(), tab);
  await page.waitForSelector("#settingsBody");
  const body = await page.$eval("#settingsBody", (el) => el.textContent.length > 0);
  await assert(body, "settings tab renders: " + tab);
}
const moneyTab = await page.$('[data-settings="money"]');
await assert(!moneyTab, "money settings tab removed");

// theme switch
await page.evaluate(() => document.querySelector('[data-settings="theme"]').click());
await page.waitForSelector('[data-theme-pick="sea"]');
await page.evaluate(() => document.querySelector('[data-theme-pick="sea"]').click());
const theme = await page.evaluate(() => document.body.getAttribute("data-theme"));
await assert(theme === "sea", "theme switches to sea");

// sync chip visible
await page.click('[data-nav="habits"]');
const syncChip = await page.$("#syncChip");
await assert(!!syncChip, "sync status chip visible");

await assert(errors.filter((e) => !e.includes("favicon")).length === 0, "no page errors: " + JSON.stringify(errors));

await browser.close();
console.log("\nAll e2e smoke tests passed.");
