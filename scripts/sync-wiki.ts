/**
 * 同步 BWIKI 角色图鉴字段（材料/昵称/定位）→ data/pompom.sqlite
 * 用法：pnpm wiki:sync [--limit=50]
 *
 * 重要：BWIKI 的 api.php 只接受 POST（GET 会被 EdgeOne WAF 返回 567）。
 * 礼仪：每次请求间隔 ≥2s，单日 ≤300 请求，失败指数退避。
 */
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "../src/lib/paths";

const API = "https://wiki.biligame.com/sr/api.php";
const USER_AGENT = "pompom-helphelp/0.1 (fan project; low-rate local research)";
const DELAY_MS = 2500;

type WikiPage = {
  pageid: number;
  title: string;
  revisions?: Array<{ revid?: number; timestamp?: string; slots?: { main?: { "*"?: string } } }>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({ format: "json", ...params });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "user-agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`  请求失败（第 ${attempt + 1} 次）：${String(err)}`);
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new Error("BWIKI 请求连续失败");
}

function cleanWikiText(input: string | undefined): string {
  if (!input) return "";
  return input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\{#info:[^}]*\}\}/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a, b) => b || a)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从 {{角色图鉴 ...}} 模板里抽取 |key=value 字段（跨行值不处理，BWIKI 模板基本单行） */
function parseTemplate(wikitext: string): Record<string, string> {
  const start = wikitext.indexOf("{{角色图鉴");
  if (start < 0) return {};
  const fields: Record<string, string> = {};
  const lines = wikitext.slice(start).split("\n");
  let depth = 0;
  for (const line of lines) {
    const match = /^\s*\|([^=]+)=(.*)$/.exec(line);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!(key in fields)) fields[key] = value;
    }
    depth += (line.match(/\{\{/g) ?? []).length;
    depth -= (line.match(/\}\}/g) ?? []).length;
    if (depth <= 0) break;
  }
  return fields;
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const perBatch = limitArg ? Number(limitArg.split("=")[1]) : 50;

  console.log("== BWIKI 角色图鉴同步（POST，限速 2.5s）==");
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS char_wiki (
      char_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT,
      rarity TEXT,
      path TEXT,
      element TEXT,
      role TEXT,
      nickname TEXT,
      path_material TEXT,
      ascension_material TEXT,
      series_material TEXT,
      weekly_material TEXT,
      game_version TEXT,
      page_title TEXT
    );
    CREATE TABLE IF NOT EXISTS aliases (
      alias TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      canonical TEXT NOT NULL,
      source TEXT
    );
  `);

  const chars = db.prepare("SELECT id, name FROM characters").all() as Array<{ id: string; name: string }>;
  const charByName = new Map(chars.map((c) => [c.name, c.id]));
  const insWiki = db.prepare(
    `INSERT INTO char_wiki(char_id,name,title,rarity,path,element,role,nickname,path_material,ascension_material,series_material,weekly_material,game_version,page_title)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(char_id) DO UPDATE SET
       title=excluded.title, rarity=excluded.rarity, path=excluded.path, element=excluded.element,
       role=excluded.role, nickname=excluded.nickname, path_material=excluded.path_material,
       ascension_material=excluded.ascension_material, series_material=excluded.series_material,
       weekly_material=excluded.weekly_material, game_version=excluded.game_version, page_title=excluded.page_title`,
  );
  const insAlias = db.prepare("INSERT OR REPLACE INTO aliases(alias,kind,target_id,canonical,source) VALUES(?,?,?,?,?)");

  let continueToken: Record<string, string> | undefined;
  let pages = 0;
  let matched = 0;
  do {
    const params: Record<string, string> = {
      action: "query",
      generator: "embeddedin",
      geititle: "模板:角色图鉴",
      geilimit: String(perBatch),
      prop: "revisions",
      rvprop: "ids|timestamp|content",
      rvslots: "main",
      ...(continueToken ?? {}),
    };
    process.stdout.write(`- 拉取 ${pages} 之后的 ${perBatch} 页…\n`);
    const data = await api(params);
    const list: WikiPage[] = data?.query?.pages ? Object.values(data.query.pages as Record<string, WikiPage>) : [];
    for (const page of list) {
      pages += 1;
      const wikitext = page.revisions?.[0]?.slots?.main?.["*"] ?? "";
      const fields = parseTemplate(wikitext);
      const name = cleanWikiText(fields["名称"]) || page.title.replace(/\(.*\)$/, "");
      const charId = charByName.get(name);
      if (!charId) {
        console.log(`  ? 图鉴页「${page.title}」没有匹配到 StarRailRes 角色（${name}）`);
        continue;
      }
      matched += 1;
      insWiki.run(
        charId,
        name,
        cleanWikiText(fields["称号"]),
        cleanWikiText(fields["稀有度"]),
        cleanWikiText(fields["命途"]),
        cleanWikiText(fields["元素属性"]),
        cleanWikiText(fields["角色定位"]),
        cleanWikiText(fields["昵称/外号"]),
        cleanWikiText(fields["命途材料"]),
        cleanWikiText(fields["晋阶属性材料"]),
        cleanWikiText(fields["晋阶系列材料"]),
        cleanWikiText(fields["周本材料"]),
        cleanWikiText(fields["实装版本"]),
        page.title,
      );
      // 社区昵称入别名表
      const nicknames = cleanWikiText(fields["昵称/外号"])
        .split(/[、,，/／;；]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 1 && s.length <= 12 && s !== name);
      for (const nick of nicknames) {
        insAlias.run(nick, "character", charId, name, "bwiki:nickname");
      }
    }
    continueToken = data?.continue ?? undefined;
    if (continueToken) await sleep(DELAY_MS);
  } while (continueToken);

  const count = (db.prepare("SELECT COUNT(*) c FROM char_wiki").get() as { c: number }).c;
  console.log(`\n✅ 完成：扫描 ${pages} 页，匹配入库 ${matched} 个角色（表内共 ${count}）`);
}

main().catch((err) => {
  console.error("❌ wiki 同步失败：", err);
  process.exit(1);
});
