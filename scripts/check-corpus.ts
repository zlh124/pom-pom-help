/**
 * 校验 corpus/**：taxonomy 注册表、frontmatter schema、来源、许可、id 规范、禁图片。
 * 用法：npm run corpus:check
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CORPUS_DIR } from "../src/lib/paths";
import { classify, isIgnored, validateTaxonomy, listSubtypes } from "../src/lib/corpus/taxonomy";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

type Issue = { file: string; level: "error" | "warn"; message: string };
const issues: Issue[] = [];
const counts = new Map<string, number>();

const sourceSchema = z.union([
  z.string().url(),
  z.object({ url: z.string().url(), label: z.string().optional(), note: z.string().optional() }),
]);

const baseSchema = z.object({
  id: z.string().min(3),
  type: z.string().min(1),
  subtype: z.string().min(1).optional(),
  title: z.string().min(2),
  game_version: z.string().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
  confidence: z.enum(["curated", "community", "derived"]).optional(),
  sources: z.array(sourceSchema).optional(),
  updated: z.string().optional(),
  license: z.string().optional(),
  entity: z
    .object({
      kind: z.string().optional(),
      id: z.union([z.string(), z.number()]).optional(),
      name: z.string().optional(),
      aliases: z.array(z.string()).optional(),
    })
    .optional(),
});

const buildSchema = baseSchema.extend({
  character_id: z.union([z.string(), z.number()]),
  character_name: z.string().min(1),
  relics: z.object({
    sets: z.array(z.object({ name: z.string(), pieces: z.number().int() })).min(1),
    main_stats: z.array(z.object({ slot: z.string(), stats: z.array(z.string()) })).optional(),
    sub_stats: z.array(z.string()).optional(),
  }),
  light_cones: z.array(z.object({ name: z.string(), rank: z.string(), obtain: z.string().optional() })).optional(),
  teams: z
    .array(z.object({ archetype: z.string(), slots: z.array(z.object({ name: z.string(), role: z.string().optional() })) }))
    .optional(),
});

const teamSchema = baseSchema.extend({
  archetype: z.string().min(1),
  core: z.string().optional(),
  slots: z.array(z.object({ name: z.string(), role: z.string().optional() })).length(4),
});

const quizSchema = baseSchema.extend({
  week: z.string().min(4),
  theme: z.string().min(1),
  questions: z
    .array(
      z.object({
        id: z.string(),
        difficulty: z.enum(["easy", "normal", "hard"]),
        question: z.string().min(4),
        options: z.array(z.string()).length(3),
        answer: z.number().int().min(0).max(2),
        explanation: z.string().optional(),
      }),
    )
    .length(10),
});

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

function readDoc(file: string): { meta: Record<string, any>; body: string } | null {
  const raw = fs.readFileSync(file, "utf8");
  if (file.endsWith(".md")) {
    const m = FRONTMATTER.exec(raw);
    if (!m) return null;
    return { meta: (parseYaml(m[1]) ?? {}) as Record<string, any>, body: m[2] };
  }
  const data = (parseYaml(raw) ?? {}) as Record<string, any>;
  const { body, ...meta } = data;
  return { meta, body: typeof body === "string" ? body : "" };
}

const rel = (f: string) => path.relative(process.cwd(), f);

// 0) 注册表
for (const err of validateTaxonomy()) issues.push({ file: "corpus/taxonomy.yaml", level: "error", message: err });
console.log(`注册表：${listSubtypes().length} 个 block/subtype`);

// 1) 文档
const files = walk(CORPUS_DIR);
console.log(`扫描 ${files.length} 个语料文件…`);
const seenIds = new Map<string, string>();

for (const file of files) {
  const where = classify(file);
  if (!where) {
    issues.push({ file: rel(file), level: "error", message: "不在 taxonomy 注册表内（检查目录是否为 block/subtype）" });
    continue;
  }
  let doc: { meta: Record<string, any>; body: string } | null = null;
  try {
    doc = readDoc(file);
  } catch (err) {
    issues.push({ file: rel(file), level: "error", message: `解析失败：${String(err)}` });
    continue;
  }
  if (!doc) {
    issues.push({ file: rel(file), level: "error", message: "缺少 frontmatter（--- ... ---）" });
    continue;
  }
  const { meta, body } = doc;
  const key = `${where.block}/${where.subtype}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);

  if (String(meta.type ?? "") !== where.block) {
    issues.push({ file: rel(file), level: "error", message: `type=${meta.type} 与目录 block=${where.block} 不一致` });
  }
  if (meta.subtype && String(meta.subtype) !== where.subtype) {
    issues.push({ file: rel(file), level: "error", message: `subtype=${meta.subtype} 与目录 subtype=${where.subtype} 不一致` });
  }

  const schema = key === "characters/builds" ? buildSchema : key === "guides/teams" ? teamSchema : key === "quiz/weeks" ? quizSchema : baseSchema;
  const parsed = schema.safeParse(meta);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ file: rel(file), level: "error", message: `字段 ${issue.path.join(".") || "(root)"}：${issue.message}` });
    }
    continue;
  }

  const id = String(meta.id);
  if (seenIds.has(id)) issues.push({ file: rel(file), level: "error", message: `id 重复：${id}（已在 ${seenIds.get(id)}）` });
  else seenIds.set(id, rel(file));

  const expectedPrefix = `${where.block}/${where.subtype}/`;
  if (!id.startsWith(expectedPrefix)) {
    issues.push({ file: rel(file), level: "warn", message: `id 建议以 ${expectedPrefix} 开头（当前 ${id}）` });
  }

  const isPersona = key === "persona/persona";
  if (!isPersona && (!Array.isArray(meta.sources) || meta.sources.length === 0)) {
    issues.push({ file: rel(file), level: "warn", message: "缺少 sources（贡献者应提供可点开的出处）" });
  }
  if (!isPersona && meta.license !== "CC-BY-SA-4.0") {
    issues.push({ file: rel(file), level: "warn", message: `license 建议为 CC-BY-SA-4.0（当前：${meta.license ?? "无"}）` });
  }
  if (!isPersona && !meta.game_version && !meta.version) {
    issues.push({ file: rel(file), level: "warn", message: "缺少 game_version/version（版本门控需要）" });
  }
  if (/!\[[^\]]*\]\([^)]*\)/.test(body)) issues.push({ file: rel(file), level: "error", message: "正文包含图片，语料禁止图片" });
}

// 2) 别名
const aliasesFile = path.join(CORPUS_DIR, "aliases.yaml");
if (fs.existsSync(aliasesFile)) {
  try {
    const parsed = parseYaml(fs.readFileSync(aliasesFile, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed?.aliases ?? [];
    if (!Array.isArray(list) || list.length === 0) {
      issues.push({ file: rel(aliasesFile), level: "error", message: "别名表为空或格式错误（应为数组）" });
    }
    for (const [i, item] of (list as unknown[]).entries()) {
      const entry = item as Record<string, unknown>;
      if (!entry?.alias || !entry?.canonical) {
        issues.push({ file: rel(aliasesFile), level: "error", message: `第 ${i + 1} 条别名缺少 alias/canonical` });
      }
    }
    console.log(`别名：${(list as unknown[]).length} 条`);
  } catch (err) {
    issues.push({ file: rel(aliasesFile), level: "error", message: `解析失败：${String(err)}` });
  }
}

console.log("\n各板块文件数：");
for (const [key, n] of [...counts.entries()].sort()) console.log(`  ${key}: ${n}`);

const errors = issues.filter((i) => i.level === "error");
const warns = issues.filter((i) => i.level === "warn");
for (const issue of issues) console.log(`${issue.level === "error" ? "✗" : "!"} ${issue.file}: ${issue.message}`);
console.log(`\n${errors.length ? "❌" : "✅"} 校验完成：${errors.length} 个错误，${warns.length} 个警告`);
if (errors.length) process.exit(1);
