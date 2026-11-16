#!/usr/bin/env node
/**
 * scripts/record-pompom.mjs — 生成帕姆 3D 立绘的静态海报 / 预览截图。
 *
 * 两种模式：
 *   1) 离线模式（默认）：从 node_modules 里拷贝 three 模块图 + 生成一个临时预览页，
 *      用本机 Chrome headless 截图，得到 public/model/pompom-poster.png。
 *      不需要 dev server，也不会污染 src/app（预览页放在 public/model/.preview/，用完即删）。
 *   2) dev 模式（--url）：直接截一张正在运行的 dev server 页面，用于验收截图，
 *      例如：node scripts/record-pompom.mjs --url http://127.0.0.1:3100/ --out docs/asset-preview.png
 *
 * 用法：
 *   node scripts/record-pompom.mjs
 *   node scripts/record-pompom.mjs --size 480x640 --out public/model/pompom-poster.png
 *   node scripts/record-pompom.mjs --url http://127.0.0.1:3100/preview --out docs/asset-preview.png --size 480x640
 *   node scripts/record-pompom.mjs --keep        # 保留 public/model/.preview/ 便于调试
 *
 * 依赖：pnpm install 已装 three；本机有 google-chrome / chromium（可用 CHROME_BIN 覆盖）。
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import fsSync from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const THREE_DIR = path.join(ROOT, "node_modules", "three");
const CORE_FILE = path.join(ROOT, "src", "components", "pompom", "pompomCore.js");
const PREVIEW_DIR = path.join(PUBLIC_DIR, "model", ".preview");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".fbx": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".ico": "image/x-icon",
};

function parseArgs(argv) {
  const args = {
    out: path.join(PUBLIC_DIR, "model", "pompom-poster.png"),
    size: "480x640",
    url: "",
    keep: false,
    debug: false,
    chrome: process.env.CHROME_BIN || "google-chrome",
    timeoutMs: 90_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") args.out = path.resolve(argv[++i]);
    else if (arg === "--size") args.size = argv[++i];
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--chrome") args.chrome = argv[++i];
    else if (arg === "--timeout") args.timeoutMs = Number(argv[++i]) * 1000;
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--debug") args.debug = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  const match = /^(\d+)x(\d+)$/.exec(args.size);
  if (!match) throw new Error(`--size 需要 WxH 格式，例如 480x640（收到 ${args.size}）`);
  args.width = Number(match[1]);
  args.height = Number(match[2]);
  if (!fsSync.existsSync(path.join(THREE_DIR, "package.json"))) {
    throw new Error("找不到 node_modules/three，请先 pnpm install");
  }
  return args;
}

function printHelp() {
  console.log(`用法: node scripts/record-pompom.mjs [选项]

  --out <path>     输出 PNG 路径（默认 public/model/pompom-poster.png）
  --size <WxH>     截图尺寸（默认 480x640）
  --url <url>      截取已运行的 dev server 页面（跳过离线预览页）
  --chrome <bin>   Chrome 可执行文件（默认 google-chrome / CHROME_BIN）
  --timeout <sec>  Chrome 超时秒数（默认 90）
  --keep           保留 public/model/.preview/ 临时预览页
  -h, --help       显示帮助
`);
}

/** 去掉 JS 注释，避免把 JSDoc 里的 @three_import 示例当成真实 import。 */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function extractModuleSpecifiers(code) {
  const clean = stripComments(code);
  const specifiers = new Set();
  const patterns = [
    /from\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(clean)) !== null) specifiers.add(match[1]);
  }
  return [...specifiers];
}

const copiedModules = new Map();

async function copyModuleGraph(entryAbsPath) {
  if (copiedModules.has(entryAbsPath)) return copiedModules.get(entryAbsPath);
  const relFromThree = path.relative(THREE_DIR, entryAbsPath);
  if (relFromThree.startsWith("..")) throw new Error(`模块不在 node_modules/three 内：${entryAbsPath}`);
  const vendorRel = path.posix.join("vendor", relFromThree.split(path.sep).join("/"));
  copiedModules.set(entryAbsPath, vendorRel);

  const code = await fs.readFile(entryAbsPath, "utf8");
  const dest = path.join(PREVIEW_DIR, vendorRel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, code);

  for (const specifier of extractModuleSpecifiers(code)) {
    let targetAbs;
    if (specifier === "three") {
      targetAbs = path.join(THREE_DIR, "build", "three.module.js");
    } else if (specifier.startsWith(".")) {
      targetAbs = path.resolve(path.dirname(entryAbsPath), specifier);
    } else {
      throw new Error(`未预期的裸模块说明符 "${specifier}"（来自 ${relFromThree}），预览页需要扩展 importmap`);
    }
    if (!fsSync.existsSync(targetAbs)) throw new Error(`模块依赖缺失：${targetAbs}`);
    await copyModuleGraph(targetAbs);
  }
  return vendorRel;
}

function previewHtml() {
  return `<!doctype html>
<html lang="zh-CN" data-ready="0">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PomPom stage preview</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #070b1c; }
  body { display: flex; }
  #stage {
    position: relative; flex: 1;
    background:
      radial-gradient(120% 82% at 50% 0%, #1c2557 0%, #0d1330 55%, #070b1c 100%);
  }
  #stage::before {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(58% 38% at 50% 88%, rgba(217,180,106,.16), transparent 72%);
  }
  #status {
    position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
    font: 12px/1.5 system-ui, "Noto Sans SC", sans-serif;
    letter-spacing: .18em; color: #d9b46a; opacity: .85; white-space: nowrap;
  }
</style>
<script type="importmap">
{
  "imports": {
    "three": "./vendor/build/three.module.js",
    "three/examples/jsm/loaders/FBXLoader.js": "./vendor/examples/jsm/loaders/FBXLoader.js"
  }
}
</script>
</head>
<body>
<div id="stage"><div id="status">帕姆立绘加载中…</div></div>
<script type="module">
  import { createPomPomStage } from "./pompomCore.js";
  const stage = document.getElementById("stage");
  const statusEl = document.getElementById("status");
  const params = new URLSearchParams(location.search);
  // 调试参数：?freeze=1 关闭待机动画；?morph=まばたき 强制某个 blendShape 权重=1
  const freeze = params.get("freeze") === "1";
  const morph = params.get("morph");
  window.__POMPOM_STATE__ = "loading";
  const handle = createPomPomStage({
    container: stage,
    reducedMotion: freeze,
    onReady() {
      window.__POMPOM_STATE__ = "ready";
      document.documentElement.dataset.ready = "1";
      document.documentElement.dataset.morphs = handle.getMorphNames().join("|");
      document.documentElement.dataset.debug = JSON.stringify(handle.getDebugInfo());
      document.title = "ready";
      statusEl.style.display = "none";
      if (morph) {
        window.setTimeout(() => handle.setMorph(morph, 1), 60);
      }
    },
    onError(error) {
      window.__POMPOM_STATE__ = "error";
      document.documentElement.dataset.ready = "error";
      document.title = "error";
      statusEl.textContent = "降级：" + (error && error.message ? error.message : String(error));
      statusEl.style.color = "#b5343f";
    },
  });
</script>
</body>
</html>
`;
}

/** 生成临时预览页：vendor 模块图 + pompomCore.js + preview.html */
async function preparePreview() {
  copiedModules.clear();
  await fs.rm(PREVIEW_DIR, { recursive: true, force: true });
  await fs.mkdir(PREVIEW_DIR, { recursive: true });

  await copyModuleGraph(path.join(THREE_DIR, "build", "three.module.js"));
  await copyModuleGraph(path.join(THREE_DIR, "examples", "jsm", "loaders", "FBXLoader.js"));
  await fs.copyFile(CORE_FILE, path.join(PREVIEW_DIR, "pompomCore.js"));
  await fs.writeFile(path.join(PREVIEW_DIR, "preview.html"), previewHtml(), "utf8");
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
      const filePath = path.resolve(PUBLIC_DIR, "." + pathname);
      if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const stat = fsSync.statSync(filePath);
      if (stat.isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "content-length": stat.size,
        "cache-control": "no-store",
      });
      fsSync.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

const CHROME_BASE_ARGS = [
  "--headless=new",
  "--disable-gpu",
  "--ozone-platform=headless",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--hide-scrollbars",
  "--mute-audio",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-dev-shm-usage",
  "--force-device-scale-factor=1",
  "--no-sandbox",
];

function chromeEnv() {
  // 无显示环境下 WebGL 必须走 ANGLE SwiftShader；同时去掉 DISPLAY/WAYLAND_DISPLAY，
  // 否则 ANGLE 会尝试 Vulkan-XCB 并因 xcb_connect() 失败导致 WebGL 不可用（截图黑屏）。
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  delete env.XDG_SESSION_TYPE;
  return env;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 极简 CDP 客户端：等页面里的组件 data-status="ready" 后再截图，避免截到加载中。 */
async function captureWithCdp({ chrome, url, out, width, height, timeoutMs, debug }) {
  const profileDir = path.join(os.tmpdir(), `pompom-chrome-${process.pid}-${Date.now()}`);
  await fs.mkdir(profileDir, { recursive: true });
  const args = [
    ...CHROME_BASE_ARGS,
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "about:blank",
  ];
  const started = Date.now();
  const child = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"], env: chromeEnv() });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const cleanup = async () => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* noop */
    }
    // 等 Chrome 真正退出后再删临时 profile（否则会 ENOTEMPTY）
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 2000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    try {
      await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* 临时目录清理失败不影响截图 */
    }
  };

  const deadline = started + timeoutMs;
  try {
    // 1) 等 DevToolsActivePort 出现
    const portFile = path.join(profileDir, "DevToolsActivePort");
    let devtoolsPort = 0;
    while (Date.now() < deadline) {
      if (fsSync.existsSync(portFile)) {
        const lines = (await fs.readFile(portFile, "utf8")).split("\n");
        devtoolsPort = Number(lines[0]);
        if (devtoolsPort) break;
      }
      if (child.exitCode !== null) throw new Error(`Chrome 提前退出（${child.exitCode}）\n${stderr.slice(-800)}`);
      await sleep(100);
    }
    if (!devtoolsPort) throw new Error("Chrome 未打开 DevTools 端口");

    // 2) 找 page target 的 WebSocket 地址
    let target = null;
    while (Date.now() < deadline && !target) {
      const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`);
      const list = await response.json();
      target = list.find((item) => item.type === "page");
      if (!target) await sleep(100);
    }
    if (!target) throw new Error("Chrome 未创建 page target");

    // 3) CDP over WebSocket（Node 22+ 内置 WebSocket）
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || "CDP 调用失败"));
        else resolve(message.result);
      }
    });

    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url });

    // 4) 轮询组件状态，等到 ready
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true });
      return result?.result?.value;
    };
    let status = null;
    while (Date.now() < deadline) {
      try {
        const state = await evaluate(
          `(() => {
            const el = document.querySelector("[data-status]");
            return JSON.stringify({
              status: el ? el.getAttribute("data-status") : null,
              htmlReady: document.documentElement.dataset.ready || null,
              state: window.__POMPOM_STATE__ || null,
              title: document.title || "",
              bodyText: (document.body && document.body.innerText || "").slice(0, 300),
            });
          })()`,
        );
        if (state) {
          const parsed = JSON.parse(state);
          const raw = parsed.status || parsed.htmlReady || parsed.state;
          const isReady = raw === "ready" || raw === "1";
          const isFailed =
            raw === "fallback" || raw === "error" || parsed.htmlReady === "error";
          status = isReady ? "ready" : isFailed ? "fallback" : raw;
          if (isReady) break;
          if (isFailed) {
            throw new Error(`组件降级（${status}），页面文本：${parsed.bodyText}`);
          }
        }
      } catch (error) {
        if (String(error.message).includes("组件降级")) throw error;
        // 页面还在导航/加载，忽略 evaluate 失败
      }
      await sleep(200);
    }
    if (status !== "ready") {
      let diag = "";
      try {
        diag = await evaluate(
          `JSON.stringify({ url: location.href, state: window.__POMPOM_STATE__ || null, body: (document.body && document.body.innerText || "").slice(0, 400) })`,
        );
      } catch {
        /* noop */
      }
      throw new Error(`等待 3D 立绘 ready 超时（${timeoutMs}ms）status=${status} ${diag}`);
    }

    // 5) 调试信息（尺寸/取景）
    if (debug) {
      try {
        const info = await evaluate(
          `JSON.stringify({
            debug: document.documentElement.dataset.debug || null,
            stage: (() => { const el = document.querySelector("[data-status]"); return el ? [el.clientWidth, el.clientHeight] : null; })(),
            canvas: (() => { const el = document.querySelector("canvas"); return el ? [el.clientWidth, el.clientHeight] : null; })(),
            dpr: window.devicePixelRatio,
          })`,
        );
        console.log("[record-pompom] debug:", info);
      } catch (error) {
        console.log("[record-pompom] debug 读取失败:", error.message);
      }
    }
    // 再等 1200ms 让海报淡出过渡结束，避免截图出现重影
    await sleep(1200);
    const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await fs.writeFile(out, Buffer.from(shot.data, "base64"));
    try {
      await send("Browser.close");
    } catch {
      /* noop */
    }
    socket.close();
    return { elapsedMs: Date.now() - started };
  } finally {
    await cleanup();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  if (fsSync.existsSync(args.out)) await fs.rm(args.out, { force: true });

  let server = null;
  let preparedPreview = false;
  try {
    let targetUrl = args.url;
    if (targetUrl) {
      console.log(`[record-pompom] dev 模式：截取 ${targetUrl} → ${path.relative(ROOT, args.out)}`);
      if (/^http:\/\/127\.0\.0\.1:3\d{3}/.test(targetUrl)) {
        console.log(
          "[record-pompom] 提示：Next.js dev server 默认只信任 localhost origin，127.0.0.1 可能被拦截导致客户端不 hydrate；建议把 URL 换成 http://localhost:PORT/...",
        );
      }
    } else {
      await preparePreview();
      preparedPreview = true;
      const started = await startStaticServer();
      server = started.server;
      targetUrl = `http://127.0.0.1:${started.port}/model/.preview/preview.html`;
      console.log(`[record-pompom] 离线模式：临时静态服务器 ${targetUrl}`);
    }

    const result = await captureWithCdp({
      chrome: args.chrome,
      url: targetUrl,
      out: args.out,
      width: args.width,
      height: args.height,
      timeoutMs: args.timeoutMs,
      debug: args.debug,
    });

    const stat = await fs.stat(args.out);
    if (stat.size < 4096) throw new Error(`截图文件异常地小：${stat.size} bytes`);
    console.log(
      `[record-pompom] OK ${path.relative(ROOT, args.out)}（${args.width}x${args.height}, ` +
        `${(stat.size / 1024).toFixed(1)} KB, ${result.elapsedMs}ms）`,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (preparedPreview) {
      if (!args.keep) await fs.rm(PREVIEW_DIR, { recursive: true, force: true });
      else console.log(`[record-pompom] 已保留预览页：${path.relative(ROOT, PREVIEW_DIR)}/preview.html`);
    }
  }
}

main().catch((error) => {
  console.error("[record-pompom] 失败：", error.message || error);
  process.exit(1);
});
