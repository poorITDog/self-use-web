// Assert 放假 stays inside the habit row / viewport on phone + desktop widths.
import { createRequire } from "module";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
try {
  createRequire(import.meta.url).resolve("puppeteer-core");
} catch {
  spawnSync("npm", ["install", "--no-save", "puppeteer-core@24"], { cwd: root, stdio: "inherit" });
}
const puppeteer = (await import("puppeteer-core")).default;
const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});
const page = await browser.newPage();

async function seedAndMeasure(width, height) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:8765/index.html", { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    localStorage.setItem("solara-v1", JSON.stringify({
      habits: [
        {
          id: "h1", name: "早晨運動超長名字用來測試擠位", type: "yesno", target: 1,
          frequency: [0, 1, 2, 3, 4, 5, 6], color: "#c67139", archived: false,
          timeOfDay: "07:30", group: "早上", createdAt: Date.now() - 86400000
        },
        {
          id: "h2", name: "閱讀", type: "yesno", target: 1,
          frequency: [0, 1, 2, 3, 4, 5, 6], color: "#7a8a5e", archived: false,
          timeOfDay: "07:30", group: "早上", createdAt: Date.now() - 86400000
        }
      ],
      checkins: [], goals: [], events: [], dayEntries: [], settings: { theme: "sunshine" }
    }));
  });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".habit-checkin-row .habit-holiday-btn");
  return page.evaluate(() => {
    const row = document.querySelector(".habit-checkin-row");
    const btn = row.querySelector(".habit-holiday-btn");
    const r = row.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const style = getComputedStyle(row);
    return {
      cols: style.gridTemplateColumns,
      btnText: (btn.textContent || "").trim(),
      inRow: b.left >= r.left - 1 && b.right <= r.right + 1,
      inViewport: b.left >= 0 && b.right <= innerWidth + 1 && b.width > 0 && b.height > 0,
      btnLeft: b.left,
      rowRight: r.right,
      innerWidth
    };
  });
}

for (const [w, h] of [[390, 844], [360, 740], [1440, 900]]) {
  const m = await seedAndMeasure(w, h);
  if (!m.inRow || !m.inViewport || m.btnText !== "放假") {
    console.error("FAIL", w, m);
    await browser.close();
    process.exit(1);
  }
  console.log("PASS", w + "x" + h, "放假 visible in row", m.cols.split(" ").length, "tracks");
}
await browser.close();
console.log("All holiday layout checks passed.");
