/**
 * 同步 StarRailRes 结构化数值 → data/pompom.sqlite
 * 用法：pnpm data:sync
 *
 * 数据源：https://github.com/Mar-7th/StarRailRes (AGPL-3.0)
 * 只在本机落库，不入 git；对外只输出事实字段与出处。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, RAW_DIR, DB_PATH, GAME_VERSION, pathCn, elementCn } from "../src/lib/paths";

const REPO = "Mar-7th/StarRailRes";
const MIRRORS = [
  `https://raw.githubusercontent.com/${REPO}/master`,
  `https://cdn.jsdelivr.net/gh/${REPO}@master`,
  `https://fastly.jsdelivr.net/gh/${REPO}@master`,
  `https://ghfast.top/https://raw.githubusercontent.com/${REPO}/master`,
];

const FILES = [
  "characters",
  "light_cones",
  "relic_sets",
  "items",
  "nickname",
  "character_promotions",
  "character_skill_trees",
] as const;

type Json = Record<string, any>;

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "pompom-helphelp/0.1 (local study project)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchJson(name: string): Promise<Json> {
  const cacheFile = path.join(RAW_DIR, `${name}.json`);
  const metaFile = path.join(RAW_DIR, `${name}.meta.json`);
  const versionMarker = GAME_VERSION;
  if (fs.existsSync(cacheFile) && fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      if (meta.version === versionMarker && meta.repo === REPO) {
        console.log(`  ↩ 使用本地缓存 ${name}.json`);
        return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      }
    } catch {
      /* 忽略坏缓存 */
    }
  }
  let lastErr: unknown;
  for (const base of MIRRORS) {
    const url = `${base}/index_min/cn/${name}.json`;
    try {
      process.stdout.write(`  → ${url}\n`);
      const text = await fetchText(url);
      ensureDir(RAW_DIR);
      fs.writeFileSync(cacheFile, text);
      fs.writeFileSync(metaFile, JSON.stringify({ repo: REPO, version: versionMarker, url, at: new Date().toISOString() }));
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      console.warn(`    ✗ ${String(err)}，换镜像重试`);
    }
  }
  throw new Error(`拉取 ${name}.json 失败：${String(lastErr)}`);
}

async function main() {
  console.log("== 帕姆帮帮 · StarRailRes 同步 ==");
  ensureDir(DATA_DIR);
  ensureDir(RAW_DIR);

  // 1. 读版本
  let upstreamVersion = GAME_VERSION;
  try {
    const info = JSON.parse(await fetchText(`${MIRRORS[0]}/info.json`));
    upstreamVersion = String(info.version ?? GAME_VERSION);
    console.log(`上游数据版本：${upstreamVersion}（配置 GAME_VERSION=${GAME_VERSION}）`);
  } catch (err) {
    console.warn(`读取 info.json 失败（${String(err)}），沿用 ${GAME_VERSION}`);
  }

  // 2. 拉数据
  const data: Record<string, Json> = {};
  for (const name of FILES) {
    console.log(`- ${name}`);
    data[name] = await fetchJson(name);
  }

  // 3. 落库
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT, rarity INTEGER, path TEXT, element TEXT, version TEXT);
    CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(name);
    CREATE TABLE IF NOT EXISTS light_cones (id TEXT PRIMARY KEY, name TEXT NOT NULL, rarity INTEGER, path TEXT, version TEXT);
    CREATE TABLE IF NOT EXISTS relic_sets (id TEXT PRIMARY KEY, name TEXT NOT NULL, two_piece TEXT, four_piece TEXT, version TEXT);
    CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, sub_type TEXT, rarity INTEGER, come_from TEXT);
    CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
    CREATE TABLE IF NOT EXISTS char_trace_materials (char_id TEXT NOT NULL, item_id TEXT NOT NULL, num INTEGER NOT NULL, PRIMARY KEY (char_id, item_id));
    CREATE TABLE IF NOT EXISTS aliases (alias TEXT PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL, canonical TEXT NOT NULL, source TEXT);
    CREATE INDEX IF NOT EXISTS idx_aliases_target ON aliases(target_id);
  `);

  const tx = (fn: () => void) => {
    db.exec("BEGIN");
    try {
      fn();
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  const versionCn = upstreamVersion;
  const nameById = new Map<string, string>();

  tx(() => {
    db.exec("DELETE FROM characters; DELETE FROM light_cones; DELETE FROM relic_sets; DELETE FROM items; DELETE FROM aliases; DELETE FROM char_trace_materials;");

    const insChar = db.prepare("INSERT INTO characters(id,name,tag,rarity,path,element,version) VALUES(?,?,?,?,?,?,?)");
    for (const [id, c] of Object.entries<Json>(data.characters)) {
      const name = String(c.name ?? "");
      nameById.set(`character:${id}`, name);
      insChar.run(id, name, c.tag ?? null, c.rarity ?? null, pathCn(c.path), elementCn(c.element), versionCn);
    }

    const insLc = db.prepare("INSERT INTO light_cones(id,name,rarity,path,version) VALUES(?,?,?,?,?)");
    for (const [id, lc] of Object.entries<Json>(data.light_cones)) {
      const name = String(lc.name ?? "");
      nameById.set(`light_cone:${id}`, name);
      insLc.run(id, name, lc.rarity ?? null, pathCn(lc.path), versionCn);
    }

    const insRelic = db.prepare("INSERT INTO relic_sets(id,name,two_piece,four_piece,version) VALUES(?,?,?,?,?)");
    for (const [id, r] of Object.entries<Json>(data.relic_sets)) {
      const name = String(r.name ?? "");
      nameById.set(`relic_set:${id}`, name);
      const desc: string[] = Array.isArray(r.desc) ? r.desc : [];
      insRelic.run(id, name, desc[0] ?? null, desc[1] ?? null, versionCn);
    }

    const insItem = db.prepare("INSERT INTO items(id,name,type,sub_type,rarity,come_from) VALUES(?,?,?,?,?,?)");
    for (const [id, it] of Object.entries<Json>(data.items)) {
      insItem.run(id, String(it.name ?? ""), it.type ?? null, it.sub_type ?? null, it.rarity ?? null, JSON.stringify(it.come_from ?? []));
    }

    // 行迹/技能材料：按角色聚合
    const insMat = db.prepare(
      "INSERT INTO char_trace_materials(char_id,item_id,num) VALUES(?,?,?) ON CONFLICT(char_id,item_id) DO UPDATE SET num = num + excluded.num",
    );
    const skillTrees = data.character_skill_trees ?? {};
    for (const [charId, c] of Object.entries<Json>(data.characters)) {
      const nodes: string[] = Array.isArray(c.skill_trees) ? c.skill_trees : [];
      for (const nodeId of nodes) {
        const node = skillTrees[nodeId];
        if (!node) continue;
        const levels: Json[] = Array.isArray(node.levels) ? node.levels : [];
        for (const lv of levels) {
          const mats: Json[] = Array.isArray(lv.materials) ? lv.materials : [];
          for (const m of mats) {
            if (!m?.id || !m?.num) continue;
            insMat.run(charId, String(m.id), Number(m.num));
          }
        }
      }
    }

    // 别名：nickname.json 三组
    const insAlias = db.prepare("INSERT OR REPLACE INTO aliases(alias,kind,target_id,canonical,source) VALUES(?,?,?,?,?)");
    const nickname = data.nickname ?? {};
    const groups: Array<[string, Json]> = [
      ["character", nickname.characters ?? {}],
      ["light_cone", nickname.light_cones ?? {}],
      ["relic_set", nickname.relic_sets ?? {}],
    ];
    for (const [kind, group] of groups) {
      for (const [id, names] of Object.entries<string[]>(group)) {
        const canonical = nameById.get(`${kind}:${id}`) ?? names?.[0] ?? "";
        if (!canonical) continue;
        for (const alias of names ?? []) {
          const trimmed = String(alias).trim();
          if (!trimmed) continue;
          insAlias.run(trimmed, kind, id, canonical, "starrailres:nickname");
        }
        insAlias.run(canonical, kind, id, canonical, "starrailres:name");
      }
    }

    db.prepare("INSERT INTO meta(key,value) VALUES('version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(versionCn);
    db.prepare("INSERT INTO meta(key,value) VALUES('synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString());
  });

  const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  console.log("\n✅ 同步完成");
  console.log(`   characters        ${count("characters")}`);
  console.log(`   light_cones       ${count("light_cones")}`);
  console.log(`   relic_sets        ${count("relic_sets")}`);
  console.log(`   items             ${count("items")}`);
  console.log(`   trace materials   ${count("char_trace_materials")}`);
  console.log(`   aliases           ${count("aliases")}`);
  console.log(`   db                ${DB_PATH}`);
}

main().catch((err) => {
  console.error("❌ 同步失败：", err);
  process.exit(1);
});
