import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, DB_PATH, INDEX_PATH } from "@/lib/paths";

export type Db = DatabaseSync;

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

const STRUCTURED_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tag TEXT,
  rarity INTEGER,
  path TEXT,
  element TEXT,
  version TEXT
);
CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(name);

CREATE TABLE IF NOT EXISTS light_cones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rarity INTEGER,
  path TEXT,
  version TEXT
);

CREATE TABLE IF NOT EXISTS relic_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  two_piece TEXT,
  four_piece TEXT,
  version TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  sub_type TEXT,
  rarity INTEGER,
  come_from TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);

CREATE TABLE IF NOT EXISTS char_trace_materials (
  char_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  num INTEGER NOT NULL,
  PRIMARY KEY (char_id, item_id)
);

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
CREATE INDEX IF NOT EXISTS idx_aliases_target ON aliases(target_id);

CREATE TABLE IF NOT EXISTS wiki_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  page_title TEXT NOT NULL,
  section TEXT,
  text TEXT NOT NULL,
  source_url TEXT,
  revid TEXT,
  updated_at TEXT,
  game_version TEXT,
  kind TEXT
);
`;

const INDEX_SCHEMA = `
CREATE TABLE IF NOT EXISTS chunks (
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
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  tokenized,
  title,
  content='chunks',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS alias_expansion (
  alias TEXT PRIMARY KEY,
  canonical TEXT NOT NULL,
  kind TEXT,
  entity_id TEXT
);
`;

let structuredDb: Db | null = null;
let indexDb: Db | null = null;

export function openStructured(): Db {
  if (structuredDb) return structuredDb;
  ensureDir(path.dirname(DB_PATH));
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(STRUCTURED_SCHEMA);
  structuredDb = db;
  return db;
}

export function openIndex(): Db {
  if (indexDb) return indexDb;
  ensureDir(path.dirname(INDEX_PATH));
  const db = new DatabaseSync(INDEX_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(INDEX_SCHEMA);
  indexDb = db;
  return db;
}

export function structuredExists(): boolean {
  return fs.existsSync(DB_PATH);
}

export function indexExists(): boolean {
  return fs.existsSync(INDEX_PATH);
}

export function resetIndex(): void {
  ensureDir(DATA_DIR);
  if (fs.existsSync(INDEX_PATH)) fs.rmSync(INDEX_PATH);
  indexDb = null;
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
