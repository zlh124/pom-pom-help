/**
 * 浏览器冒烟测试（需要先 npm run build && npm start）
 *   npm run test:ui
 * 覆盖：闲聊（无卡片回复）/ 攻略问答（卡片）/ 多轮追问 / 帕姆问问流程，断言页面不崩。
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const env = { ...process.env };
delete env.DISPLAY;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  env,
  args: [
    "--no-sandbox",
    "--ozone-platform=headless",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
  ],
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("textarea");

  // 1) 闲聊：无卡片回复，历史上曾因 cards=undefined 崩溃
  await page.fill("textarea", "列车长下午好啊");
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes("下午好") || t.includes("通讯异常");
    },
    { timeout: 60000 },
  ).catch(() => {});
  const greeting = await page.evaluate(() => ({
    crashed: document.body.innerText.includes("couldn’t load") || document.body.innerText.includes("This page"),
    replied: document.querySelectorAll(".bubble-pom").length > 0,
  }));
  check("闲聊不崩且能回复", !greeting.crashed && greeting.replied, JSON.stringify(greeting));

  // 2) 攻略问答：应产出卡片
  await page.fill("textarea", "流萤带什么遗器？");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => Array.from(document.querySelectorAll("h3")).some((e) => (e.textContent ?? "").includes("遗器推荐")), {
    timeout: 90000,
  }).catch(() => {});
  const cards = await page.evaluate(() => document.querySelectorAll("h3").length);
  check("攻略问答出卡片", cards >= 2, `h3=${cards}`);

  // 3) 帕姆问问
  await page.goto(`${BASE}/quiz`, { waitUntil: "networkidle" });
  await page.click("text=开始答题帕");
  await page.waitForTimeout(800);
  const quizOk = await page.evaluate(() => (document.body.innerText.includes("第 1") || document.body.innerText.includes("第 1 /")));
  check("帕姆问问可开始答题", quizOk);

  check("无未捕获前端异常", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? "❌" : "✅"} 冒烟测试：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exit(1);
