import { chromium } from "playwright-core";

/**
 * 用系统 Chrome 跑真实交互截图：
 *   node scripts/screenshot-chat.mjs "流萤带什么遗器？" docs/screens/chat.png [--wait=8000]
 */
const prompt = process.argv[2] ?? "流萤带什么遗器？";
const out = process.argv[3] ?? "docs/screens/chat.png";
const waitArg = process.argv.find((a) => a.startsWith("--wait="));
const extraWait = waitArg ? Number(waitArg.split("=")[1]) : 2500;
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[browser:error]", msg.text().slice(0, 180));
});

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector("textarea");
await page.waitForTimeout(2500); // 等立绘（3D 或海报）

await page.fill("textarea", prompt);
await page.click('button[type="submit"]');

// 等到出现「助手已完成」的迹象：卡片出现 或 助手气泡有内容且发送按钮恢复
try {
  await page.waitForFunction(
    () => {
      const bubbles = document.querySelectorAll(".paper-bubble").length;
      const btn = document.querySelector('button[type="submit"]');
      return bubbles >= 2 && btn && !btn.disabled;
    },
    { timeout: 120000 },
  );
} catch {
  console.log("[warn] 等待回答完成超时，仍截图");
}
await page.waitForTimeout(extraWait);
await page.screenshot({ path: out, fullPage: false });
console.log(`screenshot saved: ${out}`);
await browser.close();
