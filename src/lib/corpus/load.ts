/**
 * 读取 corpus/ 下的语料（YAML / Markdown+frontmatter），进程内缓存。
 * 语料即代码：贡献者 PR 修改 corpus/** 后重新 corpus:index 即可生效。
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { CORPUS_DIR } from "@/lib/paths";

export type Confidence = "curated" | "community" | "derived";

export type CorpusMeta = {
  id: string;
  type: string;
  title: string;
  version?: string;
  tags?: string[];
  confidence?: Confidence;
  sources?: Array<string | { label?: string; url?: string }>;
  updated?: string;
  license?: string;
  character_id?: string;
  [key: string]: unknown;
};

export type CorpusDoc = { meta: CorpusMeta; body: string; file: string; data: Record<string, any> };

export type AliasEntry = { alias: string; canonical: string; kind?: string; id?: string; note?: string };

export type PersonaDoc = {
  name?: string;
  identity?: string;
  voice?: Record<string, any>;
  rules?: string[];
  banned?: string[];
  examples?: Array<{ user: string; assistant: string }>;
  [key: string]: unknown;
};

export type Corpus = {
  builds: CorpusDoc[];
  teams: CorpusDoc[];
  guides: CorpusDoc[];
  worlds: CorpusDoc[];
  quiz: CorpusDoc[];
  personas: PersonaDoc[];
  aliases: AliasEntry[];
  loadedAt: number;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function readMarkdown(file: string): CorpusDoc | null {
  const raw = fs.readFileSync(file, "utf8");
  const m = FRONTMATTER.exec(raw);
  if (!m) return null;
  const meta = (parseYaml(m[1]) ?? {}) as CorpusMeta;
  return { meta, body: m[2].trim(), file, data: {} };
}

function readYaml(file: string): CorpusDoc | null {
  const raw = fs.readFileSync(file, "utf8");
  const data = (parseYaml(raw) ?? {}) as Record<string, any>;
  const { body, ...rest } = data;
  return {
    meta: rest as CorpusMeta,
    body: typeof body === "string" ? body : "",
    file,
    data: rest,
  };
}

function walk(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, ext));
    else if (entry.name.endsWith(ext)) out.push(p);
  }
  return out;
}

function safeReadDir<T>(dir: string, fn: (file: string) => T | null): T[] {
  const result: T[] = [];
  for (const file of walk(dir, "")) {
    if (file.includes("README")) continue;
    try {
      const doc = fn(file);
      if (doc) result.push(doc);
    } catch (err) {
      console.warn(`[corpus] 解析失败 ${file}: ${String(err)}`);
    }
  }
  return result;
}

function loadAliases(): AliasEntry[] {
  const candidates = ["aliases.yaml", "aliases.yml"];
  for (const name of candidates) {
    const file = path.join(CORPUS_DIR, name);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = parseYaml(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) return parsed as AliasEntry[];
      if (parsed?.aliases && Array.isArray(parsed.aliases)) return parsed.aliases as AliasEntry[];
    } catch (err) {
      console.warn(`[corpus] aliases 解析失败: ${String(err)}`);
    }
  }
  return [];
}

function loadPersonas(): PersonaDoc[] {
  return safeReadDir(path.join(CORPUS_DIR, "persona"), (file) => {
    const parsed = parseYaml(fs.readFileSync(file, "utf8"));
    return (parsed ?? {}) as PersonaDoc;
  });
}

let cached: Corpus | null = null;

export function loadCorpus(force = false): Corpus {
  if (cached && !force) return cached;
  const corpus: Corpus = {
    builds: safeReadDir(path.join(CORPUS_DIR, "builds"), (f) => (f.endsWith(".yaml") || f.endsWith(".yml") ? readYaml(f) : f.endsWith(".md") ? readMarkdown(f) : null)),
    teams: safeReadDir(path.join(CORPUS_DIR, "teams"), (f) => (f.endsWith(".yaml") || f.endsWith(".yml") ? readYaml(f) : f.endsWith(".md") ? readMarkdown(f) : null)),
    guides: safeReadDir(path.join(CORPUS_DIR, "guides"), (f) => (f.endsWith(".md") ? readMarkdown(f) : readYaml(f))),
    worlds: safeReadDir(path.join(CORPUS_DIR, "world"), (f) => (f.endsWith(".md") ? readMarkdown(f) : readYaml(f))),
    quiz: safeReadDir(path.join(CORPUS_DIR, "quiz"), (f) => (f.endsWith(".yaml") || f.endsWith(".yml") ? readYaml(f) : null)),
    personas: loadPersonas(),
    aliases: loadAliases(),
    loadedAt: Date.now(),
  };
  cached = corpus;
  return corpus;
}

export function findBuild(corpus: Corpus, opts: { characterId?: string; characterName?: string }): CorpusDoc | null {
  const { characterId, characterName } = opts;
  return (
    corpus.builds.find((d) => {
      const cid = String(d.meta.character_id ?? d.data.character_id ?? d.data.character?.id ?? "");
      const name = String(d.meta.title ?? d.data.character_name ?? d.data.character?.name ?? "");
      if (characterId && cid === characterId) return true;
      if (characterName && (name.includes(characterName) || cid === characterName)) return true;
      return false;
    }) ?? null
  );
}

export function findTeams(corpus: Corpus, opts: { archetype?: string; characterName?: string; limit?: number }): CorpusDoc[] {
  const { archetype, characterName, limit = 3 } = opts;
  const scored = corpus.teams
    .map((doc) => {
      let score = 0;
      const hay = JSON.stringify(doc.meta) + doc.body;
      if (archetype && hay.includes(archetype)) score += 3;
      if (characterName && hay.includes(characterName)) score += 5;
      return { doc, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.doc);
}
