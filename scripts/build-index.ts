/**
 * 构建检索索引：corpus/** → data/index.sqlite
 * 用法：pnpm corpus:index
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse as parseYaml } from "yaml";
import { CORPUS_DIR, DB_PATH, INDEX_PATH, DATA_DIR } from "../src/lib/paths";
import { buildDict, tokenize } from "../src/lib/retrieval/tokenizer";

type Doc = { meta: Record<string, any>; body: string; file: string; kind: string };

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (!entry.name.startsWith("README") && (entry.name.endsWith(".md") || entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) out.push(p);
  }
  return out;
}

function readDoc(file: string): Doc | null {
  const raw = fs.readFileSync(file, "utf8");
  if (file.endsWith(".md")) {
    const m = FRONTMATTER.exec(raw);
    if (!m) return null;
    const meta = (parseYaml(m[1]) ?? {}) as Record<string, any>;
    return { meta, body: m[2].trim(), file, kind: String(meta.type ?? "guide") };
  }
  const data = (parseYaml(raw) ?? {}) as Record<string, any>;
  const { body, ...meta } = data;
  return { meta, body: typeof body === "string" ? body : "", file, kind: String(meta.type ?? "guide") };
}

function chunkBody(body: string, meta: Record<string, any>): Array<{ section: string; text: string }> {
  const trimmed = body.trim();
  if (!trimmed) {
    // 纯结构化 YAML：把主要字段拼成一句可检索文本
    const parts: string[] = [];
    const push = (v: unknown) => {
      if (typeof v === "string" && v.trim()) parts.push(v.trim());
      else if (Array.isArray(v)) v.forEach(push);
      else if (v && typeof v === "object") Object.values(v).forEach(push);
    };
    push(meta.relics ?? meta.light_cones ?? meta.slots ?? meta.questions ?? meta.core ?? "");
    return [{ section: "概要", text: parts.join("；").slice(0, 1200) }];
  }
  const sections: Array<{ section: string; text: string }> = [];
  let currentTitle = "概要";
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) sections.push({ section: currentTitle, text: text.slice(0, 1600) });
    buffer = [];
  };
  for (const line of trimmed.split("\n")) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      flush();
      currentTitle = h[1].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function main() {
  console.log("== 构建检索索引 ==");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(INDEX_PATH)) fs.rmSync(INDEX_PATH);
  const db = new DatabaseSync(INDEX_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(`
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      section TEXT,
      text TEXT NOT NULL,
      tokenized TEXT NOT NULL,
      source_url TEXT,
      version TEXT,
      tags TEXT,
      entity_kind TEXT,
      entity_id TEXT,
      confidence TEXT
    );
    CREATE INDEX idx_chunks_doc ON chunks(doc_id);
    CREATE VIRTUAL TABLE chunks_fts USING fts5(tokenized, title, content='chunks', content_rowid='id', tokenize='unicode61');
    CREATE TABLE alias_expansion (alias TEXT PRIMARY KEY, canonical TEXT NOT NULL, kind TEXT, entity_id TEXT);
  `);

  // 1) 别名：结构化库 + corpus/aliases.yaml
  const structured = new DatabaseSync(DB_PATH, { readOnly: true });
  const namesForDict = new Set<string>();
  const insAlias = db.prepare("INSERT OR REPLACE INTO alias_expansion(alias,canonical,kind,entity_id) VALUES(?,?,?,?)");
  const aliases = structured.prepare("SELECT alias, canonical, kind, target_id FROM aliases").all() as Array<{
    alias: string;
    canonical: string;
    kind: string;
    target_id: string;
  }>;
  for (const a of aliases) {
    insAlias.run(a.alias, a.canonical, a.kind, a.target_id);
    namesForDict.add(a.alias);
    namesForDict.add(a.canonical);
  }
  for (const table of ["characters", "light_cones", "relic_sets"]) {
    const rows = structured.prepare(`SELECT name FROM ${table}`).all() as Array<{ name: string }>;
    for (const r of rows) namesForDict.add(r.name);
  }

  for (const file of ["aliases.yaml", "aliases.yml"]) {
    const p = path.join(CORPUS_DIR, file);
    if (!fs.existsSync(p)) continue;
    const parsed = parseYaml(fs.readFileSync(p, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed?.aliases ?? [];
    for (const item of list as Array<Record<string, any>>) {
      if (!item?.alias || !item?.canonical) continue;
      insAlias.run(String(item.alias), String(item.canonical), item.kind ? String(item.kind) : null, item.id ? String(item.id) : null);
      namesForDict.add(String(item.alias));
      namesForDict.add(String(item.canonical));
    }
  }

  // 2) 文档分块
  const docs: Doc[] = walk(CORPUS_DIR)
    .map(readDoc)
    .filter(Boolean) as Doc[];
  for (const d of docs) {
    if (d.meta.title) namesForDict.add(String(d.meta.title));
    if (d.meta.character_name) namesForDict.add(String(d.meta.character_name));
  }

  const dict = buildDict(namesForDict);
  console.log(`词典词条：${dict.words.size} / 最长 ${dict.maxLen}`);

  const insChunk = db.prepare(
    `INSERT INTO chunks(doc_id,kind,title,section,text,tokenized,source_url,version,tags,entity_kind,entity_id,confidence)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  let chunkCount = 0;
  for (const doc of docs) {
    const meta = doc.meta;
    const kind = doc.kind;
    const docId = String(meta.id ?? path.relative(CORPUS_DIR, doc.file).replace(/\.(md|ya?ml)$/, ""));
    const title = String(meta.title ?? docId);
    const sources = Array.isArray(meta.sources) ? meta.sources : [];
    const sourceUrl = typeof sources[0] === "string" ? sources[0] : sources[0]?.url ? String(sources[0].url) : null;
    const entityKind = kind === "build" ? "character" : kind === "team" ? "team" : kind === "quiz" ? "quiz" : "guide";
    const entityId = meta.character_id ? String(meta.character_id) : null;
    const version = meta.version ? String(meta.version) : null;
    const tags = Array.isArray(meta.tags) ? JSON.stringify(meta.tags) : null;
    const confidence = meta.confidence ? String(meta.confidence) : null;

    const sections = chunkBody(doc.body, meta);
    sections.forEach((s, i) => {
      const text = `${s.text}`.trim();
      if (text.length < 8) return;
      const tokenized = tokenize(`${title} ${s.section} ${text}`, dict).join(" ");
      insChunk.run(docId, kind, title, s.section || null, text, tokenized, sourceUrl, version, tags, entityKind, entityId, confidence);
      chunkCount += 1;
    });
  }

  console.log(`文档：${docs.length}，分块：${chunkCount}`);
  const byKind = db.prepare("SELECT kind, COUNT(*) c FROM chunks GROUP BY kind ORDER BY c DESC").all() as Array<{ kind: string; c: number }>;
  for (const row of byKind) console.log(`  ${row.kind}: ${row.c}`);
  console.log(`索引：${INDEX_PATH}`);
}

main();
