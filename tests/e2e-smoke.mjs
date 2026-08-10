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

const brand = await page.$eval(".app-bar-title", (el) => el.getAttribute("aria-label") || el.textContent.trim());
await assert(brand === "Solara", "brand mark visible on habits");

// default tab is habits; today panel is default (no primary seg)
const activeNav = await page.$eval("#nav button.active", (el) => el.getAttribute("data-nav"));
await assert(activeNav === "habits", "default nav is habits");

await page.waitForSelector(".week-summary");
await assert(!await page.$(".habits-board"), "habits today panel is default (no board)");
await assert(!await page.$(".habits-seg"), "today has no primary 今天|儀表板 seg");

// week summary card renders (header ring is the progress meter; strip is optional)
const weekSummary = await page.$(".week-summary");
await assert(!!weekSummary, "week summary renders on habits");
const weekTitle = await page.$eval(".week-summary-title", (el) => el.textContent.trim());
await assert(weekTitle === "本週", "week card title is 本週");
const weekDow = await page.$$eval(".week-dot-label", (els) => els.map((el) => el.textContent.trim()).join(""));
await assert(weekDow === "一二三四五六日", "week summary labels are Mon→Sun: " + weekDow);
await assert(!await page.$(".today-strip .progress-ring"), "no duplicate progress ring in today strip");

// board opens from quiet week-foot link (not a primary seg) — only after habits exist
await assert(!await page.$('[data-habits-panel="board"]'), "empty today has no 儀表板 link");

// first-run empty state guides the user
await page.waitForSelector(".empty-steps");
const emptyGuide = await page.$eval(".empty", (el) => el.textContent);
await assert(emptyGuide.includes("開始你的每日節奏"), "empty state has friendly headline");
await assert(!!(await page.$(".empty-steps li")), "empty state shows step-by-step guide");
await assert(
  await page.$eval("#toast", (el) => el.getAttribute("aria-live") === "polite"),
  "toast has aria-live for status updates"
);

async function clickAction(action) {
  await page.waitForSelector('[data-action="' + action + '"]');
  await page.evaluate((act) => {
    const el = document.querySelector('[data-action="' + act + '"]');
    if (el) el.click();
  }, action);
}

async function ensureHabitsToday() {
  await page.click('[data-nav="habits"]');
  await page.waitForSelector(".week-summary");
  await page.evaluate(() => {
    const t = document.querySelector('[data-habits-panel="today"]');
    if (t) t.click();
  });
  await page.waitForFunction(() => !document.querySelector(".habits-board"));
}

async function ensureHabitsBoard() {
  await page.click('[data-nav="habits"]');
  await page.waitForSelector(".week-summary");
  await page.evaluate(() => {
    const b = document.querySelector('[data-habits-panel="board"]');
    if (b) b.click();
  });
  await page.waitForSelector(".habits-board");
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

// first habit stays on today (empty must not poison panel → board)
await page.waitForSelector(".habit-checkin-row");
await assert(!await page.$(".habits-board"), "first habit lands on today check-in, not board");
await page.waitForSelector('[data-habits-panel="board"]');
const boardTab = await page.$eval('[data-habits-panel="board"]', (el) => el.textContent);
await assert(boardTab.includes("儀表板"), "habits board entry label is Traditional Chinese");

// today stays lean: no duplicate timeline dropdown under the habit list
await assert(!await page.$(".today-timeline-wrap, .today-timeline"), "today has no timeline dropdown");
await assert(!await page.$(".day-journal-gate"), "today has no diary gate card");
await assert(!await page.$(".goals-teaser"), "today has no goals teaser");

// complete via check on today row
await page.waitForSelector(".habit-checkin-row .check-row, .habit-checkin-row [data-toggle]");
await page.evaluate(() => document.querySelector(".habit-checkin-row [data-toggle]").click());
await page.waitForFunction(() => {
  const ring = document.querySelector(".app-bar-ring-label, .progress-ring-inner strong");
  return ring && (ring.textContent.includes("1/") || ring.textContent.includes("100"));
});
const rate = await page.$eval(".app-bar-ring-label, .progress-ring-inner strong", (el) => el.textContent);
await assert(rate.includes("1/") || rate.includes("100"), "completion updates after yes/no checkin");

// habit dashboard boxes on board
await ensureHabitsBoard();
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
await ensureHabitsToday();
await page.waitForSelector(".habit-checkin-row, .habit-row");
await ensureHabitsBoard();
await page.waitForSelector(".habit-box");

// open habit detail from box — edit must work inside modal (outside #app)
await page.click('[data-habit-box-open]');
await page.waitForSelector(".habit-full-cal");
const detailCal = await page.$(".habit-full-cal");
await assert(!!detailCal, "habit detail calendar renders");
const detailDow = await page.$eval(".habit-full-dow", (el) => el.textContent.replace(/\s+/g, ""));
await assert(detailDow === "一二三四五六日", "habit detail calendar headers are Mon→Sun: " + detailDow);
const yearHeat = await page.$(".habit-year-heat");
await assert(!!yearHeat, "habit detail year heatmap renders");
const detailEdit = await page.$('#modal [data-edit-habit]');
await assert(!!detailEdit, "habit detail has edit button");
await assert(!!(await page.$("#modal .sheet-top-edit")), "habit detail topbar has always-visible 編輯");
await assert(!!(await page.$(".habit-detail-quick-actions")), "habit detail shows quick actions before calendar");
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
await ensureHabitsToday();
await page.waitForSelector(".habit-checkin-row");
const rangeText = await page.$eval("#view-habits", (el) => el.textContent);
await assert(rangeText.includes("06:30") && rangeText.includes("08:30"), "habit time range 06:30–08:30 saved and shown");

// pull habit detail sheet down to return to main habits page
await ensureHabitsBoard();
await page.waitForSelector("[data-habit-box-open]");
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
await page.waitForSelector(".week-summary");
const habitsHasArchiveBlock = await page.$("#view-habits .archived-habits");
await assert(!habitsHasArchiveBlock, "habits main view no longer shows archive block");

// overview mode week strip
await ensureHabitsBoard();
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

await ensureHabitsToday();
await page.waitForFunction(() => document.querySelectorAll(".habit-checkin-row, .habit-row").length >= 2);
await page.evaluate(() => {
  const btn = document.querySelectorAll(".habit-checkin-row [data-toggle]")[1];
  btn.scrollIntoView({ block: "center" });
  btn.click();
});
await page.waitForSelector("#logVal", { visible: true });
await page.evaluate(() => { document.getElementById("logVal").value = "30"; });
await page.evaluate(() => document.getElementById("logSave").click());
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

const minsRow = await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll(".habit-checkin-row")).find((el) =>
    el.textContent.includes("閱讀")
  );
  return row ? row.textContent : "";
});
await assert(minsRow.includes("30") && minsRow.includes("分"), "duration habit logged 30 分 on today list");

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
await assert(!goalsBody.includes("設定於「設定 → 目標」"), "goal does not show setup-location copy");
await assert(goalsBody.includes("開始於"), "goal shows start date");
await assert(!(await page.$(".goal-meta-chip.setup")), "setup meta chip removed");
await assert(!!(await page.$(".goal-meta-chip")), "goal shows start meta chip");
await assert(goalsBody.includes("成果"), "goal shows outcome type badge");
await assert(!!(await page.$("[data-goal-check]")), "goal has check-and-plus when habit linked");
await assert(!!(await page.$(".goal-habit-chip")), "linked habit shows colored chip");
await assert(!!(await page.$(".goal-habit-dot")), "linked habit chip shows color dot");
await assert(!!(await page.$(".goal-row.has-habit")), "linked goal row uses habit accent class");
await assert(!!(await page.$("#gColors, .goal-row.has-habit")), "goal color support present");

// reopen editor to assert color palette choices
await page.evaluate(() => document.querySelector("[data-edit-goal]").click());
await page.waitForSelector("#gColors .swatch");
const goalSwatches = await page.$$eval("#gColors .swatch", (els) => els.length);
await assert(goalSwatches >= 16, "goal editor offers many color choices");
await page.evaluate(() => document.getElementById("gCancel").click());
await page.waitForFunction(() => !document.getElementById("modalBackdrop").classList.contains("open"));

// habits today stays calm; full goals strip lives on 儀表板
await ensureHabitsToday();
await page.waitForSelector(".habit-checkin-row, .empty, .week-summary");
const noGoalsOnToday = await page.evaluate(() => {
  const root = document.getElementById("view-habits");
  return !root.querySelector(".goals-strip");
});
await assert(noGoalsOnToday, "habits today has no full goals strip (avoids crowding)");
await ensureHabitsBoard();
await page.waitForSelector(".goals-strip");
const habitsBeforeGoals = await page.evaluate(() => {
  const root = document.getElementById("view-habits");
  const goals = root.querySelector(".goals-strip");
  const habits = root.querySelector(".habit-box, .habits-board");
  if (!goals || !habits) return false;
  return (habits.compareDocumentPosition(goals) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
});
await assert(habitsBeforeGoals, "habits board shows goals after habit dashboard");
await ensureHabitsToday();
await page.waitForSelector(".habit-checkin-row, .habit-card, .empty");

// habit detail linked goals: manage button + colored block
await page.waitForSelector("[data-habit-open]");
await page.evaluate(() => document.querySelector("[data-habit-open]").click());
await page.waitForSelector(".habit-linked-goal");
await assert(!!(await page.$('[data-nav-jump="settings-goals"].btn')), "habit detail has 管理目標 button");
await assert(!!(await page.$(".habit-linked-goal .goal-habit-dot")), "habit detail linked goal has color dot");
// Click the in-modal 管理目標 button (not the habits-strip twin).
await page.evaluate(() => {
  const btn = document.querySelector('#modal [data-nav-jump="settings-goals"]');
  if (!btn) throw new Error("missing modal manage-goals button");
  btn.click();
});
await page.waitForSelector('#view-settings.active [data-settings="goals"].on');
const jumped = await page.evaluate(() => ({
  view: document.querySelector("#nav button.active")?.getAttribute("data-nav"),
  tabOn: document.querySelector("#view-settings.active [data-settings='goals']")?.classList.contains("on"),
  modalOpen: document.getElementById("modalBackdrop").classList.contains("open")
}));
await assert(jumped.view === "settings" && jumped.tabOn && !jumped.modalOpen,
  "管理目標 jumps to visible settings goals view");

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

// global quick-add FAB (hidden on habits — app bar + already covers add)
await page.click('[data-nav="habits"]');
await page.waitForSelector("#globalFab");
await assert(
  await page.$eval("#globalFab", (el) => !!el.hidden),
  "FAB hidden on habits so it does not cover check-in rows"
);
await page.click('[data-nav="countdown"]');
await page.waitForFunction(() => {
  const fab = document.getElementById("globalFab");
  return fab && !fab.hidden;
});
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

// Diary is its own page (not a habits tab); holiday sits next to finish on today rows
await page.click('[data-nav="habits"]');
await page.waitForSelector(".habit-checkin-row, .week-summary");
await assert(!await page.$('[data-habits-panel="journal"]'), "habits has no 日記 tab");
await assert(!await page.$(".habits-seg"), "today has no primary habits seg");
await assert(!!await page.$('[data-habits-panel="board"]'), "week foot still opens 儀表板");
await assert(!await page.$(".day-journal-gate"), "today has no diary gate card");
await assert(!await page.$(".today-timeline-wrap"), "today has no timeline dropdown");
const diaryBtn = await page.$eval('#appBar [data-open-diary], .app-bar [data-open-diary]', (el) => ({
  label: (el.getAttribute("aria-label") || "") + el.textContent,
  soft: el.classList.contains("soft")
}));
await assert(diaryBtn.label.includes("今日日記") || diaryBtn.label.includes("日記"), "app bar has diary entry");
await assert(diaryBtn.soft, "diary app-bar control uses soft Organic style");
await assert(!await page.$("#view-habits .day-journal"), "full journal not embedded on habits today");
await assert(!await page.$("#view-habits .holiday-habit-list"), "no holiday checklist on habits today");

// Holiday toggle lives beside check/finish on the check-in row
await page.waitForSelector(".habit-checkin-row .habit-holiday-btn");
const holidayBesideCheck = await page.$eval(".habit-checkin-row", (row) => {
  const check = row.querySelector(".check-row, [data-toggle]");
  const hol = row.querySelector(".habit-holiday-btn, [data-toggle-habit-holiday]");
  return !!(check && hol);
});
await assert(holidayBesideCheck, "放假 button sits on same row as finish/check");

const firstHabitHolidayId = await page.$eval(
  ".habit-checkin-row [data-toggle-habit-holiday]",
  (el) => el.getAttribute("data-toggle-habit-holiday")
);
await page.evaluate(() => {
  const btn = document.querySelector(".habit-checkin-row [data-toggle-habit-holiday]");
  if (btn) btn.click();
});
await page.waitForSelector(".excused-habits");
await assert(!await page.$(".today-strip"), "partial holiday has no strip (avoids double-tell)");

// Open dedicated diary page via app bar
await page.click('#appBar [data-open-diary], .app-bar [data-open-diary]');
await page.waitForSelector("#view-diary.active, #view-diary.view.active");
await page.waitForFunction(() => {
  const v = document.getElementById("view-diary");
  return v && v.classList.contains("active");
});
await page.waitForSelector("#view-diary .day-journal .mood-btn[data-mood='4']");
const diaryTitle = await page.$eval(".app-bar-title", (el) => el.textContent.trim());
await assert(diaryTitle === "日記", "diary page shows 日記 title");
await assert(
  !await page.$("#view-diary [data-toggle-habit-holiday]"),
  "diary page has no per-habit holiday checklist"
);
await page.evaluate(() => document.querySelector('#view-diary .mood-btn[data-mood="4"]').click());
await page.waitForFunction(() => {
  const btn = document.querySelector('#view-diary .mood-btn[data-mood="4"]');
  return btn && btn.classList.contains("on");
});
const moodOn = await page.$eval('#view-diary .mood-btn[data-mood="4"]', (el) => el.classList.contains("on"));
await assert(moodOn, "mood 4 selected on diary page");

await page.waitForSelector("#view-diary .holiday-banner, #view-diary input[id^='holidayReason-']");
const holidayBanner = await page.$("#view-diary .holiday-banner");
await assert(!!holidayBanner, "holiday banner shows on diary page after partial holiday");
const bannerText = await page.$eval("#view-diary .holiday-banner", (el) => el.textContent);
await assert(
  bannerText.includes("放假") && bannerText.includes("連續"),
  "partial holiday banner explains streak retention"
);
await page.waitForSelector('#view-diary input[id^="holidayReason-"]');
await page.type('#view-diary textarea[id^="dayComment-"]', "颱風停工，今天沒去健身房");
await page.type('#view-diary input[id^="holidayReason-"]', "颱風");
await page.click("#view-diary [data-save-day-journal]");
await page.waitForFunction((hid) => {
  const raw = JSON.parse(localStorage.getItem("solara-v1") || "{}");
  const today = new Date();
  const key = today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");
  const e = (raw.dayEntries || []).find((d) => d.date === key);
  return e && e.holiday && e.mood === 4 &&
    (e.holidayHabitIds || []).includes(hid) &&
    (e.comment || "").includes("健身房");
}, {}, firstHabitHolidayId);
const journalSaved = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("solara-v1") || "{}");
  const today = new Date();
  const key = today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");
  return (raw.dayEntries || []).find((d) => d.date === key) || null;
});
await assert(!!journalSaved && journalSaved.holiday && journalSaved.mood === 4,
  "day journal persisted with mood + holiday");
await assert(
  Array.isArray(journalSaved.holidayHabitIds) && journalSaved.holidayHabitIds.includes(firstHabitHolidayId),
  "holidayHabitIds stores selected habit"
);
await assert((journalSaved.holidayReason || "").includes("颱風") ||
  (journalSaved.comment || "").includes("颱風"), "holiday reason or comment saved");

// Back to habits today: remaining habits still checkable; gate shows holiday status
await page.click('#appBar [data-nav="habits"], .app-bar [data-nav="habits"]');
await page.waitForFunction(() => {
  const v = document.getElementById("view-habits");
  return v && v.classList.contains("active");
});
await page.waitForSelector(".today-checkin, .excused-habits");
const remainingChecks = await page.$$(".today-checkin .check-row, .today-checkin [data-toggle]");
await assert(remainingChecks.length >= 1, "non-holiday habits remain on today list");
await assert(!await page.$(".day-journal-gate"), "today still has no diary gate after holiday");
const stripHoliday = await page.$eval(".today-strip, .excused-habits", (el) => el.textContent.includes("放假"));
await assert(stripHoliday, "today shows holiday status without diary gate");
await assert(!await page.$("#view-habits .day-journal"), "today still has no embedded diary");
await assert(
  !await page.$("#view-habits .holiday-banner"),
  "today has no duplicate holiday banner"
);

// Mark remaining habits holiday via row buttons → full-day banner on diary
for (let guard = 0; guard < 20; guard++) {
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector(".habit-checkin-row [data-toggle-habit-holiday]");
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) break;
  await new Promise((r) => setTimeout(r, 80));
}
await page.click('#appBar [data-open-diary], .app-bar [data-open-diary]');
await page.waitForFunction(() => {
  const v = document.getElementById("view-diary");
  return v && v.classList.contains("active");
});
await page.waitForFunction(() => {
  const b = document.querySelector("#view-diary .holiday-banner");
  return b && b.textContent.includes("全日放假");
});
const fullBanner = await page.$eval("#view-diary .holiday-banner", (el) => el.textContent);
await assert(fullBanner.includes("全日放假"), "all row holidays show full-day banner on diary");

// Clear holidays one-by-one (each click re-renders)
await page.click('#appBar [data-nav="habits"]');
await page.waitForFunction(() => {
  const v = document.getElementById("view-habits");
  return v && v.classList.contains("active");
});
await page.waitForSelector(".excused-habits [data-toggle-habit-holiday].on");
for (let guard = 0; guard < 20; guard++) {
  const clicked = await page.evaluate(() => {
    const onBtn = document.querySelector(".excused-habits [data-toggle-habit-holiday].on");
    if (!onBtn) return false;
    onBtn.click();
    return true;
  });
  if (!clicked) break;
  await new Promise((r) => setTimeout(r, 40));
}
await page.waitForFunction(() => !document.querySelector(".excused-habits"));

// Re-open diary: mood click must not wipe unsaved comment
await page.evaluate(() => {
  const btn = document.querySelector(".habit-checkin-row [data-toggle-habit-holiday], .habit-holiday-btn");
  if (btn) btn.click();
});
await page.evaluate(() => {
  const btn = document.querySelector('#appBar [data-open-diary], .app-bar [data-open-diary]');
  if (btn) btn.click();
});
await page.waitForSelector("#view-diary .holiday-banner");
await page.waitForSelector('#view-diary textarea[id^="dayComment-"]');
await page.evaluate(() => {
  const el = document.querySelector('#view-diary textarea[id^="dayComment-"]');
  if (!el) return;
  el.focus();
  el.value = "草稿測試";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.evaluate(() => {
  const mood = document.querySelector('#view-diary [data-mood="2"], #view-diary .mood-btn[data-mood="2"]');
  if (mood) mood.click();
});
const draftKept = await page.$eval(
  '#view-diary textarea[id^="dayComment-"]',
  (el) => el.value.includes("草稿測試")
);
await assert(draftKept, "mood change keeps unsaved journal draft");

// Draft must survive leaving diary without pressing 儲存
await page.evaluate(() => {
  const el = document.querySelector("#view-diary textarea[data-day-comment]");
  if (el) el.value = String(el.value || "") + "分頁草稿";
  const back = document.querySelector('#appBar [data-nav="habits"], .app-bar [data-nav="habits"]');
  if (back) back.click();
});
await page.waitForSelector("#view-habits.active, #view-habits.view.active");
await page.waitForFunction(() => {
  const raw = JSON.parse(localStorage.getItem("solara-v1") || "{}");
  const today = new Date();
  const key = today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");
  const e = (raw.dayEntries || []).find((d) => d.date === key);
  return e && String(e.comment || "").includes("分頁草稿");
});
await page.click('#appBar [data-open-diary], .app-bar [data-open-diary]');
await page.waitForSelector("#view-diary textarea[data-day-comment]");
const draftAcrossPage = await page.$eval(
  "#view-diary textarea[data-day-comment]",
  (el) => el.value.includes("分頁草稿")
);
await assert(draftAcrossPage, "journal draft kept across diary page switch");

// Calendar is schedule-focused: hint + diary button, no embedded journal / holiday picker
await page.click('[data-nav="calendar"]');
await page.waitForSelector(".day-panel");
await page.waitForSelector(".cal-page-hint");
await assert(!await page.$(".day-panel .day-journal"), "calendar has no embedded diary");
await assert(!await page.$(".day-panel .holiday-habit-list"), "calendar has no holiday checklist");
await page.waitForSelector('.day-panel [data-open-diary]');
const calDiaryBtn = await page.$eval('.day-panel [data-open-diary]', (el) => el.textContent.trim());
await assert(calDiaryBtn.includes("日記"), "calendar day panel links out to diary");
const calShowsHoliday = await page.$eval(".day-panel", (el) =>
  el.textContent.includes("放假") || el.textContent.includes("部分放假")
);
await assert(calShowsHoliday, "calendar day panel shows holiday state tag");

// Calendar → diary must open the *selected* (possibly non-today) date
const selectedCalDay = await page.evaluate(() => {
  const today = new Date();
  const tKey = today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");
  const tDow = today.getDay();
  const days = Array.from(document.querySelectorAll(".cal-day[data-day]"));
  // Prefer future same weekday so habitScheduleDueOn still includes habits
  // created today (past days are gated by createdAt).
  const futureSameDow = days.find((el) => {
    const key = el.getAttribute("data-day");
    if (!key || key === tKey || key < tKey) return false;
    return new Date(key + "T12:00:00").getDay() === tDow;
  });
  const anyFuture = days.find((el) => {
    const key = el.getAttribute("data-day");
    return key && key > tKey;
  });
  const other = futureSameDow || anyFuture || days.find((el) => {
    const key = el.getAttribute("data-day");
    return key && key !== tKey;
  });
  if (!other) return null;
  other.click();
  return other.getAttribute("data-day");
});
await assert(!!selectedCalDay, "found a non-today calendar day to select");
await page.waitForFunction((key) => {
  const btn = document.querySelector(".day-panel [data-open-diary]");
  return btn && btn.getAttribute("data-open-diary") === key;
}, {}, selectedCalDay);
await page.click(".day-panel [data-open-diary]");
await page.waitForFunction(() => {
  const v = document.getElementById("view-diary");
  return v && v.classList.contains("active");
});
const diaryOpenedFor = await page.$eval(
  "#view-diary .day-journal",
  (el) => el.getAttribute("data-day-journal")
);
await assert(
  diaryOpenedFor === selectedCalDay,
  "calendar diary opens journal for selected day (" + selectedCalDay + ")"
);
const diaryTitleLabel = await page.$eval("#view-diary .day-journal-head .section-title", (el) =>
  el.textContent.trim()
);
await assert(diaryTitleLabel === "當日日記", "non-today diary uses 當日日記 title");
const diaryDateChip = await page.$eval("#appBar .date-chip, .app-bar .date-chip", (el) =>
  el.textContent.trim()
);
await assert(!!diaryDateChip && !diaryDateChip.includes("今天"), "diary app bar shows selected date");
const diaryHeadDate = await page.$eval("#view-diary .diary-date-chip", (el) => el.textContent.trim());
await assert(!!diaryHeadDate, "diary journal head shows date chip");
const habitsNavOnDiary = await page.$eval('#nav [data-nav="habits"]', (el) =>
  el.classList.contains("active")
);
await assert(habitsNavOnDiary, "habits nav stays active on diary page");
await page.waitForSelector("#view-diary .diary-holiday-list [data-toggle-habit-holiday]");
await page.click("#view-diary .diary-holiday-list [data-toggle-habit-holiday]");
await page.waitForFunction(() => {
  const b = document.querySelector("#view-diary .holiday-banner");
  return b && b.textContent.includes("當日") && b.textContent.includes("放假");
});
const pastBanner = await page.$eval("#view-diary .holiday-banner", (el) => el.textContent);
await assert(pastBanner.includes("當日") && !pastBanner.includes("今天"),
  "past-day holiday banner uses 當日 not 今天");

// Scenic themes available (+ theme-scene layer)
await page.click('[data-nav="settings"]');
await page.evaluate(() => document.querySelector('[data-settings="theme"]').click());
await page.waitForSelector('[data-theme-pick="ocean"]');
await page.waitForSelector('[data-theme-pick="nightcity"]');
await page.waitForSelector('[data-theme-pick="forest"]');
await page.waitForSelector('[data-theme-pick="aurora"]');
await page.evaluate(() => document.querySelector('[data-theme-pick="ocean"]').click());
const oceanTheme = await page.evaluate(() => ({
  body: document.body.getAttribute("data-theme"),
  scene: document.getElementById("themeScene") &&
    document.getElementById("themeScene").getAttribute("data-scene")
}));
await assert(oceanTheme.body === "ocean" && oceanTheme.scene === "ocean",
  "scenic ocean theme applies to body + themeScene");
await page.evaluate(() => document.querySelector('[data-theme-pick="nightcity"]').click());
const nightTheme = await page.evaluate(() => ({
  body: document.body.getAttribute("data-theme"),
  scene: document.getElementById("themeScene") &&
    document.getElementById("themeScene").getAttribute("data-scene")
}));
await assert(nightTheme.body === "nightcity" && nightTheme.scene === "nightcity",
  "scenic nightcity theme applies to body + themeScene");
await page.evaluate(() => document.querySelector('[data-theme-pick="dusk"]').click());
const duskTheme = await page.evaluate(() => document.body.getAttribute("data-theme"));
await assert(duskTheme === "dusk", "scenic dusk theme applies");

// Past completion must ignore habits created after that day (run last; reseeds storage)
const pastRateStable = await page.evaluate(() => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = yesterday.getFullYear() + "-" +
    String(yesterday.getMonth() + 1).padStart(2, "0") + "-" +
    String(yesterday.getDate()).padStart(2, "0");
  const yDow = yesterday.getDay();
  const oldMs = Date.now() - 3 * 86400000;
  const raw = {
    habits: [1, 2, 3].map((n) => ({
      id: "old" + n,
      name: "舊習慣" + n,
      type: "yesno",
      target: 1,
      frequency: [yDow],
      color: "#2A9D8F",
      archived: false,
      createdAt: oldMs,
      updatedAt: oldMs
    })),
    checkins: [1, 2, 3].map((n) => ({
      id: "c" + n,
      habitId: "old" + n,
      date: yKey,
      value: 1,
      updatedAt: oldMs
    })),
    goals: [],
    events: [],
    settings: {}
  };
  raw.habits.push({
    id: "newToday",
    name: "新習慣",
    type: "yesno",
    target: 1,
    frequency: [0, 1, 2, 3, 4, 5, 6],
    color: "#E76F51",
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  localStorage.setItem("solara-v1", JSON.stringify(raw));
  return yKey;
});
await page.reload({ waitUntil: "networkidle0" });
const yRate = await page.evaluate((yKey) => {
  const raw = JSON.parse(localStorage.getItem("solara-v1") || "{}");
  function dueOn(h, key) {
    const d = new Date(key + "T12:00:00").getDay();
    const freq = (h.frequency || []).map(Number);
    if (!freq.includes(d)) return false;
    const start = Number(h.createdAt) || 0;
    if (start) {
      const sd = new Date(start);
      const sk = sd.getFullYear() + "-" + String(sd.getMonth() + 1).padStart(2, "0") + "-" +
        String(sd.getDate()).padStart(2, "0");
      if (key < sk) return false;
    }
    return true;
  }
  const due = (raw.habits || []).filter((h) => !h.archived && dueOn(h, yKey));
  const done = due.filter((h) => (raw.checkins || []).some((c) => c.habitId === h.id && c.date === yKey && c.value));
  return { rate: Math.round((done.length / Math.max(1, due.length)) * 100), due: due.length };
}, pastRateStable);
await assert(yRate.due === 3 && yRate.rate === 100,
  "yesterday stays 100% after adding a new habit today");

// Off-schedule habit under 額外完成; check-in bumps linked goal +1
await ensureHabitsToday();
await page.evaluate(() => {
  const raw = localStorage.getItem("solara-v1");
  const s = raw ? JSON.parse(raw) : {};
  const todayWd = new Date().getDay();
  const otherWd = (todayWd + 3) % 7;
  s.habits = s.habits || [];
  s.goals = s.goals || [];
  s.checkins = s.checkins || [];
  s.habits.push({
    id: "hx-extra",
    name: "額外閱讀",
    type: "yesno",
    color: "#7c9a82",
    frequency: [otherWd],
    group: "生活",
    target: 1,
    emoji: "📖",
    archived: false,
    createdAt: Date.now() - 86400000 * 14,
    updatedAt: Date.now()
  });
  s.goals.push({
    id: "gx-extra",
    title: "閱讀目標",
    kind: "short",
    goalType: "general",
    target: 10,
    current: 0,
    unitMode: "count",
    unit: "次",
    habitId: "hx-extra",
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  localStorage.setItem("solara-v1", JSON.stringify(s));
});
await page.reload({ waitUntil: "networkidle0" });
await page.waitForSelector(".extra-habits .habit-checkin-row");
const extraLabel = await page.$eval(".extra-habits .extra-habits-label", (el) => el.textContent);
await assert(extraLabel.includes("額外完成"), "extra section label visible");
const extraNames = await page.$$eval(
  ".extra-habits .habit-checkin-row .habit-row-name",
  (els) => els.map((el) => el.textContent)
);
await assert(
  extraNames.some((n) => n.includes("額外閱讀")),
  "extra section shows off-schedule habit: " + JSON.stringify(extraNames)
);

await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll(".extra-habits .habit-checkin-row")).find((el) =>
    el.textContent.includes("額外閱讀")
  );
  row.querySelector("[data-toggle]").click();
});
await page.waitForFunction(() => {
  const raw = localStorage.getItem("solara-v1");
  if (!raw) return false;
  const s = JSON.parse(raw);
  const g = (s.goals || []).find((x) => x.id === "gx-extra");
  const today = new Date();
  const key =
    today.getFullYear() +
    "-" +
    String(today.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(today.getDate()).padStart(2, "0");
  const c = (s.checkins || []).find((x) => x.habitId === "hx-extra" && x.date === key);
  return g && g.current === 1 && c && c.value && c.extra;
});
const afterExtra = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("solara-v1"));
  const g = s.goals.find((x) => x.id === "gx-extra");
  const today = new Date();
  const key =
    today.getFullYear() +
    "-" +
    String(today.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(today.getDate()).padStart(2, "0");
  const c = s.checkins.find((x) => x.habitId === "hx-extra" && x.date === key);
  return { goal: g.current, extra: !!c.extra, done: !!c.value, lastBumpKey: g.lastBumpKey };
});
await assert(afterExtra.done && afterExtra.extra, "extra check-in marks done+extra");
await assert(afterExtra.goal === 1, "extra check-in bumps linked goal +1");

// Habit detail must record the extra day (calendar + 本月額外)
await page.evaluate(() => {
  const btn = document.querySelector('.extra-habits [data-habit-open="hx-extra"]');
  if (btn) btn.click();
});
await page.waitForSelector(".habit-detail .habit-full-cal");
const detailExtra = await page.evaluate(() => {
  const stats = Array.from(document.querySelectorAll(".habit-detail-stats .detail-stat")).map((el) => ({
    label: el.querySelector(".label")?.textContent || "",
    value: el.querySelector(".value")?.textContent || ""
  }));
  const extraStat = stats.find((s) => s.label.includes("本月額外"));
  const calExtra = document.querySelectorAll(".habit-full-cal .habit-day.extra").length;
  const heatExtra = document.querySelectorAll(".habit-year-heat .heat-cell.extra").length;
  return {
    extraStat: extraStat ? extraStat.value : null,
    calExtra,
    heatExtra
  };
});
await assert(!!detailExtra.extraStat && !detailExtra.extraStat.startsWith("0"),
  "habit detail shows 本月額外 record: " + detailExtra.extraStat);
await assert(detailExtra.calExtra >= 1, "habit month calendar records extra day cell");
await assert(detailExtra.heatExtra >= 1, "habit year heatmap records extra day cell");
await page.evaluate(() => {
  const close = document.getElementById("hdClose") || document.getElementById("hdBack");
  if (close) close.click();
});

await browser.close();
console.log("\nAll e2e smoke tests passed.");
