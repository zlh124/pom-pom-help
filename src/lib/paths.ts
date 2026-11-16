import path from "node:path";

export const ROOT = process.cwd();

export const DATA_DIR = path.join(ROOT, "data");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const CORPUS_DIR = path.join(ROOT, "corpus");

function resolveEnvPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

export const DB_PATH = resolveEnvPath(process.env.DATABASE_PATH, path.join(DATA_DIR, "pompom.sqlite"));
export const INDEX_PATH = resolveEnvPath(process.env.INDEX_PATH, path.join(DATA_DIR, "index.sqlite"));

export const GAME_VERSION = process.env.GAME_VERSION ?? "4.7";

/** 命途英文 → 中文 */
export const PATH_NAMES: Record<string, string> = {
  Destruction: "毁灭",
  Hunt: "巡猎",
  Erudition: "智识",
  Harmony: "同谐",
  Nihility: "虚无",
  Preservation: "存护",
  Abundance: "丰饶",
  Remembrance: "记忆",
  Elation: "欢愉",
};

/** 属性英文 → 中文 */
export const ELEMENT_NAMES: Record<string, string> = {
  Physical: "物理",
  Fire: "火",
  Ice: "冰",
  Lightning: "雷",
  Wind: "风",
  Quantum: "量子",
  Imaginary: "虚数",
};

export function pathCn(value: string | undefined): string {
  if (!value) return "";
  return PATH_NAMES[value] ?? value;
}

export function elementCn(value: string | undefined): string {
  if (!value) return "";
  return ELEMENT_NAMES[value] ?? value;
}
