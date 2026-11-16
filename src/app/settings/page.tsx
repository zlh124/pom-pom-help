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
    <main className="mx-auto min-h-dvh w-full max-w-[720px] px-4 py-5">
      <header className="mb-4 flex items-center justify-between">
        <a href="/" className="text-[12px] text-white/45 transition-colors hover:text-gold">
          ← 回到聊天
        </a>
        <h1 className="font-[family-name:var(--font-display)] text-[15px] tracking-[0.2em] text-gold">设置</h1>
        <span className="text-[11px] text-white/25">本地优先</span>
      </header>
      <SettingsPanel summary={summary} />
    </main>
  );
}
