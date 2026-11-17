/**
 * 语料目录注册表（taxonomy.yaml）加载与分类。
 * 代码不再硬编码板块/子目录：新增板块只改 corpus/taxonomy.yaml。
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { CORPUS_DIR } from "@/lib/paths";

export type SubtypeSpec = {
  label?: string;
  format?: "md" | "yaml";
  retrieval?: boolean;
  cards?: boolean;
  quiz?: boolean;
};

export type BlockSpec = {
  label?: string;
  subtypes: Record<string, SubtypeSpec>;
};

export type Taxonomy = {
  version: number;
  license_default?: string;
  blocks: Record<string, BlockSpec>;
  ignore: string[];
  retrieval: {
    chat_blocks: string[];
    cards_blocks: string[];
    quiz_blocks: string[];
  };
};

export type Classified = { block: string; subtype: string };

let cache: Taxonomy | null = null;

export function corpusDir(): string {
  return CORPUS_DIR;
}

export function loadTaxonomy(force = false): Taxonomy {
  if (cache && !force) return cache;
  const file = path.join(CORPUS_DIR, "taxonomy.yaml");
  if (!fs.existsSync(file)) {
    throw new Error(`缺少语料注册表 ${file}（v2 结构必需）`);
  }
  const raw = parseYaml(fs.readFileSync(file, "utf8")) as Partial<Taxonomy>;
  if (!raw?.blocks || typeof raw.blocks !== "object") {
    throw new Error("taxonomy.yaml 缺少 blocks 定义");
  }
  cache = {
    version: Number(raw.version ?? 2),
    license_default: raw.license_default,
    blocks: raw.blocks,
    ignore: Array.isArray(raw.ignore) ? raw.ignore : ["meta", ".cache", "README.md", "taxonomy.yaml"],
    retrieval: {
      chat_blocks: raw.retrieval?.chat_blocks ?? Object.keys(raw.blocks),
      cards_blocks: raw.retrieval?.cards_blocks ?? ["characters", "guides"],
      quiz_blocks: raw.retrieval?.quiz_blocks ?? ["quiz"],
    },
  };
  return cache;
}

export function invalidateTaxonomy(): void {
  cache = null;
}

function relParts(file: string): string[] {
  return path.relative(CORPUS_DIR, file).split(path.sep);
}

/** 判断文件是否被忽略（meta/、.cache/、README、taxonomy.yaml 等） */
export function isIgnored(file: string): boolean {
  const parts = relParts(file);
  if (parts.some((p) => p.startsWith("."))) return true;
  const taxonomy = loadTaxonomy();
  if (parts.length === 1 && taxonomy.ignore.includes(parts[0])) return true;
  return parts.some((p) => taxonomy.ignore.includes(p));
}

/** 根据相对路径判断 block/subtype；不在注册表内返回 null */
export function classify(file: string): Classified | null {
  const parts = relParts(file);
  if (parts.length < 2) return null;
  const [block, subtype] = parts;
  const taxonomy = loadTaxonomy();
  const blockSpec = taxonomy.blocks[block];
  if (!blockSpec) return null;
  if (!blockSpec.subtypes?.[subtype]) return null;
  return { block, subtype };
}

/** 校验注册表本身（供 corpus:check 使用） */
export function validateTaxonomy(): string[] {
  const errors: string[] = [];
  let taxonomy: Taxonomy;
  try {
    taxonomy = loadTaxonomy(true);
  } catch (err) {
    return [String(err)];
  }
  if (!Object.keys(taxonomy.blocks).length) errors.push("taxonomy.blocks 为空");
  for (const [block, spec] of Object.entries(taxonomy.blocks)) {
    if (!/^[a-z][a-z0-9-]*$/.test(block)) errors.push(`板块名 ${block} 应使用小写英文/连字符`);
    if (!spec.subtypes || !Object.keys(spec.subtypes).length) errors.push(`板块 ${block} 没有 subtypes`);
    for (const [subtype, sub] of Object.entries(spec.subtypes ?? {})) {
      if (!/^[a-z][a-z0-9-]*$/.test(subtype)) errors.push(`${block}/${subtype} 应使用小写英文/连字符`);
      if (sub.format && sub.format !== "md" && sub.format !== "yaml") errors.push(`${block}/${subtype} format 只能是 md/yaml`);
    }
  }
  for (const block of taxonomy.retrieval.chat_blocks) {
    if (!taxonomy.blocks[block]) errors.push(`retrieval.chat_blocks 引用了不存在的板块 ${block}`);
  }
  return errors;
}

/** 列出注册表里所有 block/subtype（用于文档与检查） */
export function listSubtypes(): Array<{ block: string; subtype: string; label?: string }> {
  const taxonomy = loadTaxonomy();
  const out: Array<{ block: string; subtype: string; label?: string }> = [];
  for (const [block, spec] of Object.entries(taxonomy.blocks)) {
    for (const [subtype, sub] of Object.entries(spec.subtypes)) {
      out.push({ block, subtype, label: sub.label });
    }
  }
  return out;
}
