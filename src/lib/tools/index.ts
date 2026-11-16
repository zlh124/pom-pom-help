/**
 * Agent 工具集：全部确定性查询（不调 LLM），入参出参可单测。
 * 原则：结构化数据回答"事实"，语料回答"观点"，检索补"解释"。
 */
import { openStructured } from "@/lib/db";
import { loadCorpus, findBuild, findTeams, type CorpusDoc } from "@/lib/corpus/load";
import { searchCorpus } from "@/lib/retrieval/search";
import type { Card, MaterialCard, RelicCard, LightConeCard, TeamCard, Source } from "@/lib/cards";

export type ToolResult = {
  ok: boolean;
  summary: string;
  cards?: Card[];
  sources?: Source[];
};

type CharRow = { id: string; name: string; rarity: number | null; path: string | null; element: string | null; version: string | null };
type WikiRow = {
  char_id: string;
  name: string;
  role: string | null;
  nickname: string | null;
  path_material: string | null;
  ascension_material: string | null;
  series_material: string | null;
  weekly_material: string | null;
  page_title: string | null;
  game_version: string | null;
};

/** 统一各种间隔号/标点：· • ・ ‧ ∙ 等一律去掉，避免「阮·梅」vs「阮•梅」匹配失败 */
function normalizeName(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000·•・‧∙「」『』“”"'()（）\[\]【】、,，.。!！?？:：;；]/g, "");
}

function cleanWikiText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/\{\{#info:[^}]*\}\}/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a, b) => b || a)
    .trim();
}

export type EntityMatch = { kind: string; id: string; name: string; alias?: string };

type AliasRow = { alias: string; kind: string; target_id: string; canonical: string };

let aliasCache: AliasRow[] | null = null;

function getAliasRows(): AliasRow[] {
  if (aliasCache) return aliasCache;
  const db = openStructured();
  aliasCache = db.prepare("SELECT alias, kind, target_id, canonical FROM aliases").all() as AliasRow[];
  return aliasCache;
}

/**
 * 实体解析（确定性，不调 LLM）
 * 规则：精确别名 > 精确官名 > 前缀/包含，且优先短名 —— 避免「银狼」被
 * 变体角色「银狼LV.999」、「砂金」被「砂金•戏浪」抢走。
 */
export function resolveEntity(query: string): EntityMatch | null {
  const db = openStructured();
  const nq = normalizeName(query);
  if (!nq) return null;

  const rows = getAliasRows();
  const kindRank: Record<string, number> = { character: 0, light_cone: 1, relic_set: 2 };

  const pick = (list: AliasRow[]): AliasRow | null => {
    if (!list.length) return null;
    return [...list].sort((a, b) => {
      const ka = kindRank[a.kind] ?? 9;
      const kb = kindRank[b.kind] ?? 9;
      if (ka !== kb) return ka - kb;
      // 同类型：别名越短越可能是玩家真正想指的角色（变体名通常更长）
      if (a.alias.length !== b.alias.length) return a.alias.length - b.alias.length;
      return a.target_id.localeCompare(b.target_id);
    })[0];
  };

  // 1) 精确别名
  let hit = pick(rows.filter((r) => normalizeName(r.alias) === nq));
  // 2) 精确官名
  if (!hit) hit = pick(rows.filter((r) => normalizeName(r.canonical) === nq));
  // 3) 别名前缀 / 包含（优先短名）
  if (!hit) hit = pick(rows.filter((r) => normalizeName(r.alias).startsWith(nq) && nq.length >= 2));
  if (!hit) hit = pick(rows.filter((r) => normalizeName(r.alias).includes(nq) && nq.length >= 2));

  if (hit) {
    return { kind: hit.kind, id: hit.target_id, name: hit.canonical, alias: hit.alias };
  }

  // 4) 兜底：角色表模糊
  const chars = db.prepare("SELECT id, name FROM characters").all() as Array<{ id: string; name: string }>;
  const found =
    chars.find((c) => normalizeName(c.name) === nq) ??
    chars.find((c) => normalizeName(c.name).startsWith(nq) && nq.length >= 2) ??
    chars.find((c) => normalizeName(c.name).includes(nq) && nq.length >= 2);
  if (found) return { kind: "character", id: found.id, name: found.name };

  const lcs = db.prepare("SELECT id, name FROM light_cones").all() as Array<{ id: string; name: string }>;
  const lc = lcs.find((c) => normalizeName(c.name) === nq) ?? lcs.find((c) => normalizeName(c.name).includes(nq) && nq.length >= 2);
  if (lc) return { kind: "light_cone", id: lc.id, name: lc.name };

  return null;
}

function getCharacterRow(idOrName: string): CharRow | null {
  const db = openStructured();
  const row = db
    .prepare("SELECT id,name,rarity,path,element,version FROM characters WHERE id = ? OR name = ? LIMIT 1")
    .get(idOrName, idOrName) as CharRow | null;
  if (row) return row;
  const all = db.prepare("SELECT id,name,rarity,path,element,version FROM characters").all() as CharRow[];
  const target = normalizeName(idOrName);
  if (!target) return null;
  return (
    all.find((c) => normalizeName(c.name) === target) ??
    all.find((c) => normalizeName(c.name).startsWith(target) && target.length >= 2) ??
    all.find((c) => normalizeName(c.name).includes(target) && target.length >= 2) ??
    null
  );
}

function getWikiRow(charId: string): WikiRow | null {
  const db = openStructured();
  try {
    return db.prepare("SELECT * FROM char_wiki WHERE char_id = ? LIMIT 1").get(charId) as WikiRow | null;
  } catch {
    return null;
  }
}

function docSources(doc: CorpusDoc): Source[] {
  const raw = Array.isArray(doc.meta.sources) ? doc.meta.sources : [];
  return raw
    .map((s) => {
      if (typeof s === "string") return { label: s.replace(/^https?:\/\//, "").slice(0, 60), url: s };
      if (s && typeof s === "object" && "url" in s) return { label: String(s.label ?? s.url).slice(0, 60), url: String(s.url) };
      return null;
    })
    .filter(Boolean) as Source[];
}

function confidenceOf(doc: CorpusDoc): "curated" | "community" | "derived" {
  const c = String(doc.meta.confidence ?? "community");
  return c === "curated" || c === "community" || c === "derived" ? c : "community";
}

function buildRelicCard(doc: CorpusDoc, characterName: string): RelicCard {
  const data = doc.data as Record<string, any>;
  const relics = data.relics ?? {};
  const sets = Array.isArray(relics.sets)
    ? relics.sets
        .map((s: any) => {
          const name = String(s?.name ?? "").trim();
          if (!name) return null;
          const pieces = Number(s?.pieces ?? 4);
          return { name, pieces: pieces >= 4 ? 4 : 2, note: s?.note ? String(s.note) : undefined };
        })
        .filter(Boolean)
    : [];
  const mainStats = Array.isArray(relics.main_stats)
    ? relics.main_stats
        .map((m: any) => ({ slot: String(m?.slot ?? ""), stats: Array.isArray(m?.stats) ? m.stats.map(String) : [] }))
        .filter((m: any) => m.slot && m.stats.length)
    : [];
  const subStats = Array.isArray(relics.sub_stats) ? relics.sub_stats.map(String) : [];
  return {
    kind: "relic",
    character: characterName,
    title: `遗器推荐 · ${characterName}`,
    sets,
    mainStats,
    subStats,
    confidence: confidenceOf(doc),
    sources: docSources(doc),
  };
}

function buildLightConeCard(doc: CorpusDoc, characterName: string): LightConeCard | null {
  const data = doc.data as Record<string, any>;
  const list = Array.isArray(data.light_cones) ? data.light_cones : [];
  const items = list
    .map((lc: any) => ({ name: String(lc?.name ?? "").trim(), rank: String(lc?.rank ?? "A"), obtain: lc?.obtain ? String(lc.obtain) : undefined }))
    .filter((lc: any) => lc.name)
    .slice(0, 5);
  if (!items.length) return null;
  return {
    kind: "lightcone",
    character: characterName,
    title: `光锥推荐 · ${characterName}`,
    items,
    confidence: confidenceOf(doc),
    sources: docSources(doc),
  };
}

function buildTeamCards(doc: CorpusDoc): TeamCard[] {
  const data = doc.data as Record<string, any>;
  const teams = Array.isArray(data.teams) ? data.teams : [];
  return teams
    .map((t: any) => {
      const slots = (Array.isArray(t?.slots) ? t.slots : [])
        .map((s: any) => ({ name: String(s?.name ?? ""), role: s?.role ? String(s.role) : undefined }))
        .filter((s: any) => s.name);
      if (!slots.length) return null;
      return {
        kind: "team" as const,
        title: `配队 · ${String(t?.archetype ?? "推荐")}`,
        archetype: String(t?.archetype ?? "推荐"),
        slots,
        note: t?.note ? String(t.note) : undefined,
        confidence: confidenceOf(doc),
        sources: docSources(doc),
      };
    })
    .filter(Boolean)
    .slice(0, 3) as TeamCard[];
}

export function getCharacter(input: string): ToolResult {
  const row = getCharacterRow(input);
  if (!row) return { ok: false, summary: `没有找到角色「${input}」，可能名字不对或数据未收录。` };
  const wiki = getWikiRow(row.id);
  const lines = [`${row.name}（${row.rarity ?? "?"}★ · ${row.path ?? "?"} · ${row.element ?? "?"}）`];
  if (wiki?.role) lines.push(`定位：${cleanWikiText(wiki.role)}`);
  if (wiki?.nickname) {
    const nicks = cleanWikiText(wiki.nickname);
    if (nicks) lines.push(`社区昵称：${nicks}`);
  }
  return { ok: true, summary: lines.join("\n") };
}

export function getBuild(input: string): ToolResult {
  const entity = resolveEntity(input);
  const row =
    (entity?.kind === "character" ? getCharacterRow(entity.id) : null) ?? getCharacterRow(input) ?? (entity ? getCharacterRow(entity.name) : null);
  if (!row) return { ok: false, summary: `没有找到角色「${input}」，无法查询配装。` };
  const corpus = loadCorpus();
  const doc = findBuild(corpus, { characterId: row.id, characterName: row.name });
  if (!doc) {
    return {
      ok: false,
      summary: `${row.name} 的配装语料暂未收录（v1 先覆盖热门角色）。可以回答通用原则，或建议去 BWIKI 查「${row.name}/攻略」。`,
    };
  }
  const relic = buildRelicCard(doc, row.name);
  const lc = buildLightConeCard(doc, row.name);
  const teamCards = buildTeamCards(doc);
  const cards: Card[] = [relic];
  if (lc) cards.push(lc);
  cards.push(...teamCards);
  const summary = [
    `角色：${row.name}（${row.path ?? ""} · ${row.element ?? ""}）`,
    relic.sets.length ? `遗器：${relic.sets.map((s) => `${s.name}${s.pieces}件`).join(" + ")}` : "",
    relic.mainStats.length ? `主词条：${relic.mainStats.map((m) => `${m.slot}=${m.stats.join("/")}`).join("；")}` : "",
    relic.subStats.length ? `副词条优先级：${relic.subStats.join(" > ")}` : "",
    lc?.items?.length ? `光锥：${lc.items.map((i) => `${i.name}(${i.rank})`).join("、")}` : "",
    teamCards.length ? `配队：${teamCards.map((t) => `${t.archetype}[${t.slots.map((s) => s.name).join("/")}]`).join("；")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { ok: true, summary, cards, sources: docSources(doc) };
}

export function getTeam(input: string): ToolResult {
  const entity = resolveEntity(input);
  const row =
    (entity?.kind === "character" ? getCharacterRow(entity.id) : null) ?? getCharacterRow(input) ?? (entity ? getCharacterRow(entity.name) : null);
  const corpus = loadCorpus();
  const teams = findTeams(corpus, { characterName: row?.name ?? input, archetype: row ? undefined : input, limit: 3 });
  if (!teams.length) {
    return { ok: false, summary: `配队语料里没有找到「${input}」相关的队伍，可以试试直接问某个角色怎么配队。` };
  }
  const cards = teams
    .map((doc) => {
      const data = doc.data as Record<string, any>;
      const slots = (Array.isArray(data.slots) ? data.slots : [])
        .map((s: any) => ({ name: String(s?.name ?? ""), role: s?.role ? String(s.role) : undefined }))
        .filter((s: any) => s.name);
      if (!slots.length) return null;
      return {
        kind: "team" as const,
        title: `配队 · ${String(data.archetype ?? doc.meta.title)}`,
        archetype: String(data.archetype ?? "推荐"),
        slots,
        note: data.core ? String(data.core) : undefined,
        confidence: confidenceOf(doc),
        sources: docSources(doc),
      };
    })
    .filter(Boolean) as TeamCard[];
  const summary = cards.map((c) => `${c.archetype}：${c.slots.map((s) => `${s.name}(${s.role ?? ""})`).join(" / ")}`).join("\n");
  return { ok: true, summary, cards, sources: cards.flatMap((c) => c.sources ?? []) };
}

export function getMaterials(input: string): ToolResult {
  const entity = resolveEntity(input);
  const row =
    (entity?.kind === "character" ? getCharacterRow(entity.id) : null) ?? getCharacterRow(input) ?? (entity ? getCharacterRow(entity.name) : null);
  if (!row) return { ok: false, summary: `没有找到角色「${input}」。` };
  const db = openStructured();
  const wiki = getWikiRow(row.id);

  const itemByName = db.prepare("SELECT id,name,come_from FROM items WHERE name = ? LIMIT 1");
  const groups: MaterialCard["groups"] = [];

  const wikiGroups: Array<[string, string | null | undefined]> = [
    ["晋阶属性材料", wiki?.ascension_material],
    ["晋阶系列材料", wiki?.series_material],
    ["命途材料", wiki?.path_material],
    ["周本材料", wiki?.weekly_material],
  ];
  for (const [label, raw] of wikiGroups) {
    const names = cleanWikiText(raw)
      .split(/[、,，/／\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) continue;
    const items = names.map((name) => {
      const found = itemByName.get(name) as { id: string; name: string; come_from: string } | null;
      let from: string[] = [];
      try {
        from = found ? (JSON.parse(found.come_from) as string[]) : [];
      } catch {
        from = [];
      }
      return { name, from };
    });
    groups.push({ label, items });
  }

  // 行迹材料（StarRailRes 聚合，按数量降序取前 6）
  const traceRows = db
    .prepare(
      `SELECT i.name AS name, m.num AS num, i.come_from AS come_from
       FROM char_trace_materials m JOIN items i ON i.id = m.item_id
       WHERE m.char_id = ? ORDER BY m.num DESC LIMIT 6`,
    )
    .all(row.id) as Array<{ name: string; num: number; come_from: string }>;
  if (traceRows.length) {
    groups.push({
      label: "行迹材料（合计）",
      items: traceRows.map((t) => {
        let from: string[] = [];
        try {
          from = JSON.parse(t.come_from);
        } catch {
          from = [];
        }
        return { name: t.name, num: t.num, from };
      }),
    });
  }

  if (!groups.length) {
    return { ok: false, summary: `${row.name} 的材料数据还没有同步（需要跑 pnpm wiki:sync 补角色图鉴字段）。` };
  }

  const card: MaterialCard = {
    kind: "material",
    character: row.name,
    title: `材料清单 · ${row.name}`,
    groups,
    confidence: "derived",
    sources: wiki?.page_title
      ? [{ label: `BWIKI · ${wiki.page_title}`, url: `https://wiki.biligame.com/sr/${encodeURIComponent(wiki.page_title)}` }]
      : [],
  };
  const summary = groups
    .map((g) => `${g.label}：${g.items.map((i) => `${i.name}${i.num ? `×${i.num}` : ""}`).join("、")}`)
    .join("\n");
  return { ok: true, summary, cards: [card], sources: card.sources };
}

export function searchCorpusTool(query: string): ToolResult {
  const result = searchCorpus(query, { limit: 8 });
  if (!result.chunks.length) {
    return { ok: false, summary: "本地语料里没有检索到相关内容。" };
  }
  const lines = result.chunks.map((c, i) => {
    const src = c.source_url ? `（出处：${c.source_url}）` : "";
    return `[${i + 1}] ${c.title}${c.section ? ` / ${c.section}` : ""}：${c.text.slice(0, 260)}${src}`;
  });
  const sources: Source[] = [];
  for (const c of result.chunks) {
    if (c.source_url && !sources.some((s) => s.url === c.source_url)) {
      sources.push({ label: c.title.slice(0, 50), url: c.source_url });
    }
  }
  return { ok: true, summary: lines.join("\n"), sources };
}
