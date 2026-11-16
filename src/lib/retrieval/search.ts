/**
 * 混合检索：别名归一化 → 实体识别 → FTS5 BM25 → top-k
 * 索引由 scripts/build-index.ts 生成（data/index.sqlite）。
 */
import { openIndex } from "@/lib/db";
import { buildDict, expandAliases, toFtsQuery, tokenize, type TokenizerDict } from "@/lib/retrieval/tokenizer";

export type Chunk = {
  id: number;
  doc_id: string;
  kind: string;
  title: string;
  section: string | null;
  text: string;
  source_url: string | null;
  version: string | null;
  tags: string | null;
  entity_kind: string | null;
  entity_id: string | null;
  confidence: string | null;
  rank: number;
};

export type RetrievalResult = {
  chunks: Chunk[];
  query: string;
  expanded: string;
  aliasHits: string[];
  entities: Array<{ alias: string; canonical: string; kind?: string; id?: string }>;
};

let dictCache: TokenizerDict | null = null;
let aliasCache: Map<string, { canonical: string; kind?: string; id?: string }> | null = null;

export function getRetrievalAssets(): { dict: TokenizerDict; aliases: Map<string, { canonical: string; kind?: string; id?: string }> } {
  if (!dictCache || !aliasCache) {
    const db = openIndex();
    const names = new Set<string>();
    const aliases = new Map<string, { canonical: string; kind?: string; id?: string }>();

    const aliasRows = db.prepare("SELECT alias, canonical, kind, entity_id FROM alias_expansion").all() as Array<{
      alias: string;
      canonical: string;
      kind: string | null;
      entity_id: string | null;
    }>;
    for (const row of aliasRows) {
      aliases.set(row.alias, { canonical: row.canonical, kind: row.kind ?? undefined, id: row.entity_id ?? undefined });
      names.add(row.canonical);
      names.add(row.alias);
    }

    const titles = db.prepare("SELECT DISTINCT title FROM chunks").all() as Array<{ title: string }>;
    for (const t of titles) {
      names.add(t.title);
      for (const part of t.title.split(/[·\s/]+/)) if (part.length >= 2) names.add(part);
    }

    dictCache = buildDict(names);
    aliasCache = aliases;
  }
  return { dict: dictCache, aliases: aliasCache };
}

export function invalidateRetrievalCache(): void {
  dictCache = null;
  aliasCache = null;
}

export function detectEntities(query: string): Array<{ alias: string; canonical: string; kind?: string; id?: string }> {
  const { aliases } = getRetrievalAssets();
  const hits: Array<{ alias: string; canonical: string; kind?: string; id?: string }> = [];
  // 最长优先，避免「银狼」命中「狼尊」类子串
  const keys = [...aliases.keys()].sort((a, b) => b.length - a.length);
  const consumed: Array<[number, number]> = [];
  for (const key of keys) {
    if (!key) continue;
    let idx = query.indexOf(key);
    while (idx >= 0) {
      const end = idx + key.length;
      const overlap = consumed.some(([s, e]) => idx < e && end > s);
      if (!overlap) {
        const value = aliases.get(key)!;
        hits.push({ alias: key, ...value });
        consumed.push([idx, end]);
      }
      idx = query.indexOf(key, idx + 1);
    }
  }
  return hits;
}

export type SearchOptions = {
  limit?: number;
  entities?: Array<{ canonical: string; kind?: string; id?: string }>;
};

export function searchCorpus(query: string, options: SearchOptions = {}): RetrievalResult {
  const limit = options.limit ?? 8;
  const { dict, aliases } = getRetrievalAssets();
  const { text: expanded, hits: aliasHits } = expandAliases(query, new Map([...aliases].map(([k, v]) => [k, v.canonical])));
  const entities = detectEntities(query);

  const tokens = tokenize(expanded, dict);
  const db = openIndex();
  const seen = new Set<number>();
  const results: Chunk[] = [];

  const run = (ftsQuery: string, lim: number) => {
    if (!ftsQuery) return;
    const rows = db
      .prepare(
        `SELECT c.*, bm25(chunks_fts) AS rank
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ?
         ORDER BY rank ASC LIMIT ?`,
      )
      .all(ftsQuery, lim) as Chunk[];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      results.push(row);
    }
  };

  // 1) 实体精确过滤通道：命中实体时优先查该实体的文档
  const entityIds = entities.map((e) => e.id).filter(Boolean) as string[];
  if (entityIds.length > 0) {
    const placeholders = entityIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT c.*, 0 AS rank FROM chunks c
         WHERE c.entity_id IN (${placeholders})
         ORDER BY CASE c.kind WHEN 'build' THEN 0 WHEN 'team' THEN 1 WHEN 'guide' THEN 2 ELSE 3 END, c.id
         LIMIT ?`,
      )
      .all(...entityIds, limit) as Chunk[];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      results.push(row);
    }
  }

  // 2) BM25 通道
  run(toFtsQuery(tokens), limit * 3);

  // 3) 兜底：去掉停用字后再试一次
  if (results.length === 0) {
    const relaxed = tokens.filter((t) => t.length >= 2);
    run(toFtsQuery(relaxed), limit * 3);
  }

  return {
    chunks: results.slice(0, limit),
    query,
    expanded,
    aliasHits,
    entities,
  };
}
