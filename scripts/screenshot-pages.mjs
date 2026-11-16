import { chromium } from "playwright-core";

/**
 * 页面截图 + 交互回归：
 *   node scripts/screenshot-pages.mjs
 * 产出：docs/screens/{home,chat,quiz,quiz-result,settings}.png
 */
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const outDir = process.env.OUT_DIR ?? "docs/screens";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[browser:error]", msg.text().slice(0, 150));
});

// 1. 首页
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector("textarea");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/home.png` });
console.log("saved home.png");

// 2. 问一个遗器问题，等卡片出现
await page.fill("textarea", "流萤带什么遗器？");
await page.click('button[type="submit"]');
await page
  .waitForFunction(
    () => {
      const titles = Array.from(document.querySelectorAll(".gold-frame h3")).map((el) => el.textContent ?? "");
      return titles.some((t) => t.includes("遗器推荐"));
    },
    { timeout: 120000 },
  )
  .catch(() => console.log("[warn] 等卡片超时"));
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/chat.png` });
console.log("saved chat.png");

// 3. 帕姆问问
await page.goto(`${base}/quiz`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/quiz-intro.png` });
await page.click("text=开始答题帕");
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/quiz.png` });
console.log("saved quiz.png");

// 答完 10 题（每题选第一个选项，然后下一题）
for (let i = 0; i < 10; i++) {
  const opt = page.locator("button").filter({ hasText: /^[A-C]/ }).first();
  if (await opt.count()) {
    await opt.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const next = page.locator("text=下一题").first();
    if (await next.count()) await next.click().catch(() => {});
    else {
      const done = page.locator("text=看结果").first();
      if (await done.count()) await done.click().catch(() => {});
    }
    await page.waitForTimeout(400);
  }
}
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/quiz-result.png` });
console.log("saved quiz-result.png");

// 4. 设置
await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/settings.png` });
console.log("saved settings.png");

await browser.close();
