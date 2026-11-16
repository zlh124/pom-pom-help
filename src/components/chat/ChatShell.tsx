"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePomChat, type ChatMessage } from "@/components/chat/usePomChat";
import { CardRenderer } from "@/components/chat/Cards";
import RichText from "@/components/chat/RichText";

const PomPomStage = dynamic(() => import("@/components/pompom/PomPomStage"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-white/[0.03]" />,
});

const QUICK_PROMPTS = [
  "流萤的遗器怎么选？",
  "黄泉配队怎么组？",
  "花火的光锥带什么？",
  "行迹材料一般在哪刷？",
];

const STATUS_TEXT: Record<string, string> = {
  thinking: "帕姆正在翻手册…",
  retrieving: "列车长正在查资料…",
  writing: "帕姆正在组织语言…",
};

export default function ChatShell() {
  const { messages, send, status, reset, error } = usePomChat();
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = (text?: string) => {
    const value = (text ?? input).trim();
    if (!value) return;
    setInput("");
    void send(value);
  };

  const busy = status !== "idle" && status !== "error";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-gold/20 px-4 py-2.5 md:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-[family-name:var(--font-display)] text-[15px] tracking-[0.18em] text-gold md:text-[17px]">
            帕姆帮帮
          </h1>
          <span className="rounded border border-gold/30 px-1.5 py-0.5 text-[10px] text-gold/70">非官方复刻</span>
        </div>
        <nav className="flex items-center gap-3 text-[12px] text-white/50">
          <a href="/quiz" className="transition-colors hover:text-gold">
            帕姆问问
          </a>
          <a href="/settings" className="transition-colors hover:text-gold">
            设置
          </a>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-0 md:grid md:grid-cols-[minmax(280px,34%)_1fr] md:gap-5 md:py-5">
        {/* 左：帕姆立绘栏 */}
        <aside className="relative hidden overflow-hidden rounded-2xl border border-gold/20 bg-gradient-to-b from-[#0d1330] to-[#0a0e24] md:flex md:flex-col">
          <div className="relative flex-1">
            <PomPomStage className="h-full min-h-[380px] w-full" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0a0e24] to-transparent" />
            <div className="absolute right-3 top-3 rounded-full border border-gold/30 bg-black/30 px-2.5 py-1 text-[11px] text-gold/80">
              ✦ 列车长
            </div>
          </div>
          <div className="relative z-10 space-y-2 p-3">
            <div className="rounded-lg border border-gold/20 bg-black/20 px-3 py-2 text-[11px] text-white/45">
              对话计数 <span className="text-gold">{messages.filter((m) => m.role === "user").length}</span> · 距离「礼服」还差{" "}
              {Math.max(0, 10 - messages.filter((m) => m.role === "user").length)} 次
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled
                className="rounded-lg border border-gold/25 px-3 py-2 text-[12px] text-white/35"
                title="换装尚未开放"
              >
                更换
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-gold/40 px-3 py-2 text-[12px] text-gold transition-colors hover:bg-gold/10"
              >
                开启新对话
              </button>
            </div>
          </div>
        </aside>

        {/* 右：对话面板 */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gold/15 bg-[#0b1026]/60">
          <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-[12px] text-gold">
                帕
              </span>
              <div>
                <div className="text-[13px] text-white/85">帕姆帮帮（复刻版）</div>
                <div className="text-[10px] text-white/35">回复内容由 AI 生成，不代表官方立场</div>
              </div>
            </div>
            <div className="text-[11px] text-white/30">{busy ? "帕姆在思考…" : "在线"}</div>
          </div>

          <div ref={listRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? <EmptyState onPick={(p) => submit(p)} /> : null}
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}
            {error ? (
              <div className="rounded-lg border border-crimson/40 bg-crimson/10 px-3 py-2 text-[12px] text-crimson/90">
                通讯异常：{error}
              </div>
            ) : null}
          </div>

          <form
            className="border-t border-white/5 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder="问问帕姆吧，比如「流萤带什么遗器？」"
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[13px] text-white/90 outline-none placeholder:text-white/25 focus:border-gold/50"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="h-[44px] shrink-0 rounded-xl border border-gold/50 bg-gold/15 px-5 text-[13px] text-gold transition-colors hover:bg-gold/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                发送
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.slice(0, 4).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => submit(p)}
                  disabled={busy}
                  className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/45 transition-colors hover:border-gold/40 hover:text-gold disabled:opacity-40"
                >
                  {p}
                </button>
              ))}
            </div>
          </form>
        </section>
      </main>

      <footer className="border-t border-white/5 px-4 py-2 text-center text-[10px] leading-relaxed text-white/25">
        非官方粉丝复刻项目，与米哈游 /《崩坏：星穹铁道》无关。AI 生成内容仅供参考。素材版权归原作者所有。
      </footer>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2.5">
        <div className="paper-bubble max-w-[86%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[13px] leading-relaxed">
          欢迎回到列车，开拓者！帕姆今天也在列车长室值班帕。
          <br />
          想问配队、遗器、光锥还是材料？直接说就好——帕姆会去翻手册的！
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="rounded-xl border border-gold/20 bg-white/[0.02] px-3 py-2.5 text-left text-[12px] text-white/55 transition-colors hover:border-gold/45 hover:bg-gold/5 hover:text-gold"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-2xl rounded-br-sm bg-gradient-to-br from-[#d8a95f]/25 to-[#b5343f]/15 px-3.5 py-2.5 text-[13px] leading-relaxed text-[#f6efe2] ring-1 ring-gold/25">
          {message.content}
        </div>
      </div>
    );
  }

  const showStatus = (message.status === "thinking" || message.status === "retrieving") && !message.content;
  return (
    <div className="space-y-1">
      <div className="flex gap-2.5">
        <div className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-[11px] text-gold">
          帕
        </div>
        <div className="min-w-0 flex-1">
          {message.content ? (
            <div className="paper-bubble max-w-[94%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[13px] leading-relaxed">
              <RichText text={message.content} />
            </div>
          ) : null}
          {showStatus ? (
            <div className="paper-bubble inline-flex items-center gap-2 rounded-2xl rounded-bl-sm px-3.5 py-2 text-[12px] text-ink/60">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-crimson/70" />
              {STATUS_TEXT[message.status ?? "thinking"] ?? "帕姆正在思考…"}
            </div>
          ) : null}
          {message.cards.map((card, i) => (
            <CardRenderer key={`${card.kind}-${i}`} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}
