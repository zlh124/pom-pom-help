/**
 * 构建检索索引：corpus/** → data/index.sqlite（taxonomy 驱动）
 * 用法：npm run corpus:index
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse as parseYaml } from "yaml";
import { CORPUS_DIR, DB_PATH, INDEX_PATH, DATA_DIR } from "../src/lib/paths";
import { classify, isIgnored, loadTaxonomy } from "../src/lib/corpus/taxonomy";
import { buildDict, tokenize } from "../src/lib/retrieval/tokenizer";

type Doc = {
  file: string;
  block: string;
  subtype: string;
  meta: Record<string, any>;
  data: Record<string, any>;
  body: string;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!isIgnored(p)) walk(p).forEach((f) => out.push(f));
    } else if (/\.(md|ya?ml)$/.test(entry.name) && !entry.name.startsWith("README") && !isIgnored(p)) {
      out.push(p);
    }
  }
  return out;
}

function readDoc(file: string): Doc | null {
  const raw = fs.readFileSync(file, "utf8");
  const where = classify(file);
  if (!where) {
    console.warn(`[index] 未归类文件（跳过）：${path.relative(CORPUS_DIR, file)}`);
    return null;
  }
  if (file.endsWith(".md")) {
    const m = FRONTMATTER.exec(raw);
    if (!m) return null;
    const meta = (parseYaml(m[1]) ?? {}) as Record<string, any>;
    return { file, block: where.block, subtype: where.subtype, meta, data: meta, body: m[2].trim() };
  }
  const data = (parseYaml(raw) ?? {}) as Record<string, any>;
  const { body, ...meta } = data;
  return { file, block: where.block, subtype: where.subtype, meta: meta as Record<string, any>, data: meta as Record<string, any>, body: typeof body === "string" ? body : "" };
}

function chunkDoc(doc: Doc): Array<{ section: string; text: string }> {
  const { meta, body, subtype } = doc;
  if (!body.trim()) {
    // 纯结构化 YAML：把关键字段拼成可检索文本
    const parts: string[] = [];
    const push = (v: unknown) => {
      if (typeof v === "string" && v.trim()) parts.push(v.trim());
      else if (Array.isArray(v)) v.forEach(push);
      else if (v && typeof v === "object") Object.values(v).forEach(push);
    };
    const prefer = subtype === "teams" ? [meta.archetype, meta.core, meta.slots, meta.variants] : [meta.position, meta.relics, meta.light_cones, meta.teams];
    prefer.forEach(push);
    if (!parts.length) push(meta);
    return [{ section: subtype === "teams" ? "配队" : "概要", text: parts.join("；").slice(0, 1600) }];
  }
  const sections: Array<{ section: string; text: string }> = [];
  let currentTitle = "概要";
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) sections.push({ section: currentTitle, text: text.slice(0, 1600) });
    buffer = [];
  };
  for (const line of body.trim().split("\n")) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      flush();
      currentTitle = h[1].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ section: "概要", text: body.slice(0, 1600) }];
}

function main() {
  console.log("== 构建检索索引（taxonomy v2）==");
  const taxonomy = loadTaxonomy();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(INDEX_PATH)) fs.rmSync(INDEX_PATH);
  const db = new DatabaseSync(INDEX_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(`
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id TEXT NOT NULL,
      block TEXT NOT NULL,
      subtype TEXT NOT NULL,
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
      confidence TEXT,
      source TEXT NOT NULL DEFAULT 'curated'
    );
    CREATE INDEX idx_chunks_doc ON chunks(doc_id);
    CREATE INDEX idx_chunks_block ON chunks(block);
    CREATE VIRTUAL TABLE chunks_fts USING fts5(tokenized, title, content='chunks', content_rowid='id', tokenize='unicode61');
    CREATE TABLE alias_expansion (alias TEXT PRIMARY KEY, canonical TEXT NOT NULL, kind TEXT, entity_id TEXT);
  `);

  // 1) 别名：结构化库 + corpus/aliases.yaml + meta/glossary（可选）
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

  // 2) 文档
  const docs = walk(CORPUS_DIR).map(readDoc).filter(Boolean) as Doc[];
  for (const d of docs) {
    if (d.meta.title) namesForDict.add(String(d.meta.title));
    if (d.meta.entity?.name) namesForDict.add(String(d.meta.entity.name));
    if (d.meta.character_name) namesForDict.add(String(d.meta.character_name));
  }
  const dict = buildDict(namesForDict);
  console.log(`词典词条：${dict.words.size} / 最长 ${dict.maxLen}`);

  const insChunk = db.prepare(
    `INSERT INTO chunks(doc_id,block,subtype,kind,title,section,text,tokenized,source_url,version,tags,entity_kind,entity_id,confidence,source)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  let chunkCount = 0;
  for (const doc of docs) {
    const meta = doc.meta;
    const docId = String(meta.id ?? path.relative(CORPUS_DIR, doc.file).replace(/\.(md|ya?ml)$/, ""));
    const title = String(meta.title ?? docId);
    const sources = Array.isArray(meta.sources) ? meta.sources : [];
    const sourceUrl = typeof sources[0] === "string" ? sources[0] : sources[0]?.url ? String(sources[0].url) : null;
    const entityKind = meta.entity?.kind ? String(meta.entity.kind) : null;
    const entityId = meta.entity?.id ? String(meta.entity.id) : meta.character_id ? String(meta.character_id) : null;
    const version = meta.game_version ? String(meta.game_version) : meta.version ? String(meta.version) : null;
    const tags = Array.isArray(meta.tags) ? JSON.stringify(meta.tags) : null;
    const confidence = meta.confidence ? String(meta.confidence) : null;

    for (const section of chunkDoc(doc)) {
      const text = section.text.trim();
      if (text.length < 8) continue;
      const tokenized = tokenize(`${title} ${section.section} ${text}`, dict).join(" ");
      insChunk.run(
        docId,
        doc.block,
        doc.subtype,
        `${doc.block}/${doc.subtype}`,
        title,
        section.section || null,
        text,
        tokenized,
        sourceUrl,
        version,
        tags,
        entityKind,
        entityId,
        confidence,
        "curated",
      );
      chunkCount += 1;
    }
  }

  // external-content FTS 必须显式 rebuild
  db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');");
  console.log(`FTS 索引已重建`);

  console.log(`文档：${docs.length}，分块：${chunkCount}`);
  const byBlock = db.prepare("SELECT block, subtype, COUNT(*) c FROM chunks GROUP BY block, subtype ORDER BY block, subtype").all() as Array<{
    block: string;
    subtype: string;
    c: number;
  }>;
  for (const row of byBlock) console.log(`  ${row.block}/${row.subtype}: ${row.c}`);
  console.log(`检索板块白名单：${taxonomy.retrieval.chat_blocks.join(", ")}`);
  console.log(`索引：${INDEX_PATH}`);
}

main();
