/**
 * 校验 corpus/**：frontmatter schema、必填字段、来源、许可、禁图片、id 唯一。
 * 用法：npm run corpus:check
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CORPUS_DIR } from "../src/lib/paths";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const confidenceSchema = z.enum(["curated", "community", "derived"]);

const baseSchema = z.object({
  id: z.string().min(2),
  type: z.enum(["build", "team", "guide", "world", "faq", "quiz", "persona", "aliases"]),
  title: z.string().min(2),
  version: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  confidence: confidenceSchema.optional(),
  sources: z.array(z.union([z.string().url(), z.object({ url: z.string().url(), label: z.string().optional() })])).optional(),
  updated: z.string().optional(),
  license: z.string().optional(),
  character_id: z.union([z.string(), z.number()]).optional(),
});

const buildSchema = baseSchema.extend({
  character_name: z.string().min(1),
  relics: z.object({
    sets: z.array(z.object({ name: z.string(), pieces: z.number().int(), note: z.string().optional() })).min(1),
    main_stats: z.array(z.object({ slot: z.string(), stats: z.array(z.string()) })).optional(),
    sub_stats: z.array(z.string()).optional(),
  }),
  light_cones: z.array(z.object({ name: z.string(), rank: z.string(), obtain: z.string().optional() })).optional(),
});

const teamSchema = baseSchema.extend({
  archetype: z.string().min(1),
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

type Issue = { file: string; level: "error" | "warn"; message: string };
const issues: Issue[] = [];
const seenIds = new Map<string, string>();

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".cache" || entry.name === "scripts") continue;
      out.push(...walk(p));
    } else if (/\.(md|ya?ml)$/.test(entry.name) && !entry.name.startsWith("README")) out.push(p);
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

function rel(file: string) {
  return path.relative(process.cwd(), file);
}

const files = walk(CORPUS_DIR);
console.log(`扫描 ${files.length} 个语料文件…`);

for (const file of files) {
  let doc: { meta: Record<string, any>; body: string } | null = null;
  try {
    doc = readDoc(file);
  } catch (err) {
    issues.push({ file: rel(file), level: "error", message: `YAML 解析失败：${String(err)}` });
    continue;
  }
  if (!doc) {
    issues.push({ file: rel(file), level: "error", message: "缺少 frontmatter（--- ... ---）" });
    continue;
  }
  const { meta, body } = doc;
  const type = String(meta.type ?? "");
  const schema = type === "build" ? buildSchema : type === "team" ? teamSchema : type === "quiz" ? quizSchema : baseSchema;
  const parsed = schema.safeParse(meta);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ file: rel(file), level: "error", message: `字段 ${issue.path.join(".") || "(root)"}：${issue.message}` });
    }
    continue;
  }
  const id = String(meta.id);
  if (seenIds.has(id)) issues.push({ file: rel(file), level: "error", message: `id 重复：${id}（已在 ${seenIds.get(id)} 使用）` });
  else seenIds.set(id, rel(file));

  if (!meta.sources || (Array.isArray(meta.sources) && meta.sources.length === 0)) {
    if (type !== "persona") issues.push({ file: rel(file), level: "warn", message: "缺少 sources（贡献者应提供可点开的出处）" });
  }
  if (meta.license !== "CC-BY-SA-4.0") issues.push({ file: rel(file), level: "warn", message: `license 建议为 CC-BY-SA-4.0（当前：${meta.license ?? "无"}）` });
  if (type !== "persona" && !meta.version) issues.push({ file: rel(file), level: "warn", message: "缺少 version（版本门控需要）" });
  if (/!\[[^\]]*\]\([^)]*\)/.test(body)) issues.push({ file: rel(file), level: "error", message: "正文包含图片，语料禁止图片" });
  if (body.length > 4000) issues.push({ file: rel(file), level: "warn", message: `正文过长（${body.length} 字），建议拆分` });
  if (!["quiz", "team", "persona", "aliases"].includes(type) && body.trim().length < 20) {
    issues.push({ file: rel(file), level: "warn", message: "正文过短（<20 字）" });
  }
}

// aliases.yaml 单独校验
const aliasesFile = path.join(CORPUS_DIR, "aliases.yaml");
if (fs.existsSync(aliasesFile)) {
  try {
    const parsed = parseYaml(fs.readFileSync(aliasesFile, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed?.aliases ?? [];
    if (!Array.isArray(list) || list.length === 0) {
      issues.push({ file: rel(aliasesFile), level: "error", message: "别名表为空或格式错误（应为数组）" });
    }
    for (const [i, item] of (list as unknown[]).entries()) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (!entry.alias || !entry.canonical) {
        issues.push({ file: rel(aliasesFile), level: "error", message: `第 ${i + 1} 条别名缺少 alias/canonical` });
      }
    }
    console.log(`别名：${(list as unknown[]).length} 条`);
  } catch (err) {
    issues.push({ file: rel(aliasesFile), level: "error", message: `解析失败：${String(err)}` });
  }
}

const errors = issues.filter((i) => i.level === "error");
const warns = issues.filter((i) => i.level === "warn");
for (const issue of issues) {
  console.log(`${issue.level === "error" ? "✗" : "!"} ${issue.file}: ${issue.message}`);
}
console.log(`\n${errors.length ? "❌" : "✅"} 校验完成：${errors.length} 个错误，${warns.length} 个警告`);
if (errors.length) process.exit(1);
