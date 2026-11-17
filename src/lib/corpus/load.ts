/**
 * 语料加载（taxonomy 驱动）
 *
 * 目录结构由 corpus/taxonomy.yaml 定义：<block>/<subtype>/<file>
 * 代码不再硬编码板块目录；新增板块只改 taxonomy + 加内容。
 * 语料目录可用 CORPUS_DIR 环境变量指向独立语料仓库/submodule。
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { CORPUS_DIR } from "@/lib/paths";
import { classify, isIgnored, loadTaxonomy, type Taxonomy } from "@/lib/corpus/taxonomy";

export type Confidence = "curated" | "community" | "derived";

export type CorpusMeta = {
  id: string;
  type: string; // block（characters/world/...）
  subtype?: string;
  title: string;
  version?: string;
  game_version?: string;
  tags?: string[];
  confidence?: Confidence;
  sources?: Array<string | { label?: string; url?: string; note?: string }>;
  updated?: string;
  license?: string;
  character_id?: string;
  entity?: { kind?: string; id?: string; name?: string; aliases?: string[] };
  [key: string]: unknown;
};

export type CorpusDoc = {
  meta: CorpusMeta;
  body: string;
  file: string;
  block: string;
  subtype: string;
  data: Record<string, any>;
};

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
  docs: CorpusDoc[];
  byBlock: Record<string, CorpusDoc[]>;
  builds: CorpusDoc[];
  teams: CorpusDoc[];
  guides: CorpusDoc[];
  quiz: CorpusDoc[];
  personas: PersonaDoc[];
  aliases: AliasEntry[];
  taxonomy: Taxonomy;
  loadedAt: number;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function readMarkdown(file: string): { meta: Record<string, any>; body: string } | null {
  const raw = fs.readFileSync(file, "utf8");
  const m = FRONTMATTER.exec(raw);
  if (!m) return null;
  return { meta: (parseYaml(m[1]) ?? {}) as Record<string, any>, body: m[2].trim() };
}

function readYaml(file: string): { meta: Record<string, any>; body: string } {
  const raw = fs.readFileSync(file, "utf8");
  const data = (parseYaml(raw) ?? {}) as Record<string, any>;
  const { body, ...meta } = data;
  return { meta: meta as Record<string, any>, body: typeof body === "string" ? body : "" };
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isIgnored(p)) continue;
      walk(p, out);
    } else if (/\.(md|ya?ml)$/.test(entry.name) && !entry.name.startsWith("README")) {
      if (!isIgnored(p)) out.push(p);
    }
  }
  return out;
}

function loadAliases(): AliasEntry[] {
  for (const name of ["aliases.yaml", "aliases.yml"]) {
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

let cached: Corpus | null = null;

export function loadCorpus(force = false): Corpus {
  if (cached && !force) return cached;
  const taxonomy = loadTaxonomy();
  const docs: CorpusDoc[] = [];
  const unclassified: string[] = [];

  for (const file of walk(CORPUS_DIR)) {
    const where = classify(file);
    if (!where) {
      unclassified.push(path.relative(CORPUS_DIR, file));
      continue;
    }
    try {
      const isMd = file.endsWith(".md");
      const parsed = isMd ? readMarkdown(file) : readYaml(file);
      if (!parsed) {
        unclassified.push(`${path.relative(CORPUS_DIR, file)}（缺少 frontmatter）`);
        continue;
      }
      const meta = { ...parsed.meta, type: parsed.meta.type ?? where.block, subtype: parsed.meta.subtype ?? where.subtype } as CorpusMeta;
      docs.push({ meta, body: parsed.body, file, block: where.block, subtype: where.subtype, data: parsed.meta });
    } catch (err) {
      console.warn(`[corpus] 解析失败 ${path.relative(CORPUS_DIR, file)}: ${String(err)}`);
    }
  }
  if (unclassified.length) {
    console.warn(`[corpus] ${unclassified.length} 个文件未能归类（检查 path 是否在 taxonomy 中）：${unclassified.slice(0, 5).join("、")}`);
  }

  const byBlock: Record<string, CorpusDoc[]> = {};
  for (const doc of docs) {
    (byBlock[doc.block] ??= []).push(doc);
  }
  const pick = (block: string, subtype?: string) =>
    docs.filter((d) => d.block === block && (!subtype || d.subtype === subtype));

  const personas: PersonaDoc[] = pick("persona", "persona").map((d) => d.data as PersonaDoc);

  const corpus: Corpus = {
    docs,
    byBlock,
    builds: pick("characters", "builds"),
    teams: pick("guides", "teams"),
    guides: byBlock.guides ?? [],
    quiz: pick("quiz", "weeks"),
    personas,
    aliases: loadAliases(),
    taxonomy,
    loadedAt: Date.now(),
  };
  cached = corpus;
  return corpus;
}

export function findBuild(corpus: Corpus, opts: { characterId?: string; characterName?: string }): CorpusDoc | null {
  const { characterId, characterName } = opts;
  return (
    corpus.builds.find((d) => {
      const entityId = String(d.meta.entity?.id ?? d.meta.character_id ?? d.data.character_id ?? "");
      const name = String(d.meta.entity?.name ?? d.data.character_name ?? d.meta.title ?? "");
      if (characterId && entityId === characterId) return true;
      if (characterName && (name.includes(characterName) || entityId === characterName)) return true;
      return false;
    }) ?? null
  );
}

export function findTeams(corpus: Corpus, opts: { archetype?: string; characterName?: string; limit?: number }): CorpusDoc[] {
  const { archetype, characterName, limit = 3 } = opts;
  // 容错：把「常规击破队怎么组？」清洗成「常规击破」再匹配
  const cleanQuery = (archetype ?? "")
    .trim()
    .replace(/[？?！!。，,\s]/g, "")
    .replace(/(怎么组|怎么配|怎么搭|配队|队伍|阵容|队)$/g, "");
  const scored = corpus.teams
    .map((doc) => {
      let score = 0;
      const hay = JSON.stringify(doc.meta) + JSON.stringify(doc.data) + doc.body;
      const arch = String(doc.data.archetype ?? doc.meta.archetype ?? "");
      if (archetype && hay.includes(archetype)) score += 3;
      if (cleanQuery && hay.includes(cleanQuery)) score += 4;
      if (cleanQuery && arch && (arch.includes(cleanQuery) || cleanQuery.includes(arch))) score += 4;
      if (characterName && hay.includes(characterName)) score += 5;
      return { doc, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.doc);
}

/** 按 block/subtype 取文档（新板块用） */
export function getDocs(corpus: Corpus, block: string, subtype?: string): CorpusDoc[] {
  return corpus.docs.filter((d) => d.block === block && (!subtype || d.subtype === subtype));
}
