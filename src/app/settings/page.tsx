import { openIndex, openStructured } from "@/lib/db";
import { env, config } from "@/lib/env";
import SettingsPanel from "@/components/settings/SettingsPanel";

export const dynamic = "force-dynamic";

export const metadata = { title: "设置 · 帕姆帮帮（非官方复刻）" };

function safeCount(dbGetter: () => ReturnType<typeof openStructured>, sql: string): number {
  try {
    const db = dbGetter();
    const row = db.prepare(sql).get() as { c?: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export default function SettingsPage() {
  let dataVersion: string | null = null;
  let syncedAt: string | null = null;
  try {
    const db = openStructured();
    const row = db.prepare("SELECT key, value FROM meta WHERE key IN ('version','synced_at')").all() as Array<{ key: string; value: string }>;
    for (const r of row) {
      if (r.key === "version") dataVersion = r.value;
      if (r.key === "synced_at") syncedAt = r.value;
    }
  } catch {
    /* 未同步 */
  }

  const summary = {
    gameVersion: config.gameVersion,
    dataVersion,
    syncedAt,
    characters: safeCount(openStructured, "SELECT COUNT(*) c FROM characters"),
    lightCones: safeCount(openStructured, "SELECT COUNT(*) c FROM light_cones"),
    relicSets: safeCount(openStructured, "SELECT COUNT(*) c FROM relic_sets"),
    items: safeCount(openStructured, "SELECT COUNT(*) c FROM items"),
    aliases: safeCount(openStructured, "SELECT COUNT(*) c FROM aliases"),
    wikiChars: safeCount(openStructured, "SELECT COUNT(*) c FROM char_wiki"),
    chunks: safeCount(openIndex, "SELECT COUNT(*) c FROM chunks"),
    model: config.model,
    baseUrl: config.baseUrl,
    thinking: config.thinking,
    embedding: env().EMBEDDING_MODEL ? `已启用（${env().EMBEDDING_MODEL}）` : "未启用（BM25-only）",
  };

  return (
    <div className="relative z-10 mx-auto w-full max-w-[1080px] px-3 py-2 md:px-5 md:py-3">
      <header className="glass-dark mb-2.5 flex items-center justify-between gap-2 rounded-2xl px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1.5 rounded-lg bg-white/12 px-2.5 py-1.5 text-[12px] text-white/70">
            <GearIcon /> 设置
          </span>
          <span className="ml-0.5 hidden rounded border border-white/20 px-1.5 py-0.5 text-[9.5px] text-white/45 sm:inline">
            本地优先
          </span>
        </div>
        <a href="/" className="rounded-lg px-2.5 py-1.5 text-[11.5px] text-white/65 transition-colors hover:bg-white/10 hover:text-white">
          ← 回到聊天
        </a>
      </header>
      <SettingsPanel summary={summary} />
      <footer className="mt-3 pb-2 text-center text-[10px] text-white/35">
        非官方粉丝复刻项目，与米哈游 /《崩坏：星穹铁道》无关。
      </footer>
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}
