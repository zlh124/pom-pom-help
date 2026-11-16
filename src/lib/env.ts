import fs from "node:fs";
import path from "node:path";

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

let cached: Record<string, string> | null = null;

/** 同时支持进程环境变量与项目根目录的 .env.local / .env */
export function env(): Record<string, string> {
  if (cached) return cached;
  const root = process.cwd();
  cached = {
    ...readEnvFile(path.join(root, ".env")),
    ...readEnvFile(path.join(root, ".env.local")),
    ...(process.env as Record<string, string>),
  };
  return cached;
}

export function requiredEnv(key: string): string {
  const value = env()[key];
  if (!value) throw new Error(`缺少环境变量 ${key}，请参考 .env.example 配置`);
  return value;
}

export const config = {
  get apiKey() {
    return requiredEnv("DEEPSEEK_API_KEY");
  },
  get baseUrl() {
    return (env().DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  },
  get model() {
    return env().CHAT_MODEL ?? "deepseek-flash";
  },
  get thinking() {
    const v = (env().CHAT_THINKING ?? "disabled").toLowerCase();
    return v === "enabled" ? "enabled" : "disabled";
  },
  get maxToolRounds() {
    return Number(env().MAX_TOOL_ROUNDS ?? 3);
  },
  get maxChunks() {
    return Number(env().MAX_CHUNKS ?? 8);
  },
  get maxHistory() {
    return Number(env().MAX_HISTORY ?? 12);
  },
  get gameVersion() {
    return env().GAME_VERSION ?? "4.7";
  },
};
