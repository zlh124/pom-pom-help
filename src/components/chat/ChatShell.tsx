"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePomChat, type ChatMessage } from "@/components/chat/usePomChat";
import { CardRenderer } from "@/components/chat/Cards";
import RichText from "@/components/chat/RichText";

const PomPomStage = dynamic(() => import("@/components/pompom/PomPomStage"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-white/30" />,
});

const QUICK_PROMPTS = ["流萤的遗器怎么选？", "黄泉配队怎么组？", "花火的光锥带什么？", "行迹材料一般在哪刷？"];

const STATUS_TEXT: Record<string, string> = {
  thinking: "帕姆正在翻手册…",
  retrieving: "列车长正在查资料…",
  writing: "帕姆正在组织语言…",
};

export default function ChatShell() {
  const { messages, send, status, reset, error } = usePomChat();
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const chatCount = messages.filter((m) => m.role === "user").length;

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
    <div className="relative z-10 mx-auto flex h-dvh w-full flex-col overflow-hidden px-2 pb-2 pt-2 sm:px-3 md:px-4 md:pt-3 lg:px-5">
      <TopBar />

      <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3 md:grid-cols-[clamp(340px,32%,620px)_1fr] md:gap-4">
        {/* 左：帕姆立绘栏（原版左侧角色区） */}
        <aside className="character-panel relative hidden min-h-0 overflow-hidden rounded-[22px] md:block">
          <div className="window-stripes absolute inset-0" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-3/5 bg-[radial-gradient(65%_55%_at_50%_32%,rgba(255,255,255,0.9),transparent_72%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#b9cdea]/70 to-transparent" />
          <PomPomStage className="absolute inset-0 h-full w-full" />

          {/* 礼物进度 */}
          <button
            type="button"
            onClick={() => submit("帕姆，问问奖励进度～")}
            title="对话奖励 · 礼服套装"
            className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white/85 text-[#a2813c] shadow-[0_2px_10px_rgba(60,80,120,0.18)] backdrop-blur transition-transform hover:scale-105"
          >
            <GiftIcon />
            <span className="absolute -bottom-1.5 rounded-full border border-white bg-[#b5343f] px-1.5 text-[9px] font-semibold leading-4 text-white">
              {chatCount}
            </span>
          </button>

          {/* 底部操作 */}
          <div className="absolute inset-x-3 bottom-3 z-20 flex gap-2">
            <button
              type="button"
              disabled
              title="换装功能敬请期待"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/80 bg-white/80 px-3 py-2.5 text-[12px] text-[#5d6b85] shadow-sm backdrop-blur disabled:opacity-70"
            >
              <SwapIcon /> 更换
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/80 bg-white/85 px-3 py-2.5 text-[12px] text-[#3c4c68] shadow-sm backdrop-blur transition-colors hover:bg-white"
            >
              <RefreshIcon /> 开启新对话
            </button>
          </div>

        </aside>

        {/* 右：聊天主面板（原版浅色对话区） */}
        <section className="chat-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px]">
          <div className="chat-header flex items-center justify-between gap-3 px-3.5 py-2.5">
            <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b from-[#f7e5bd] to-[#e3bd78] text-[13px] font-bold text-[#58400f] shadow-sm ring-2 ring-[#c9a86a]">
                帕
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[#f6f1e6]">
                  帕姆帮帮
                  <span className="rounded border border-[#c9a86a]/50 bg-[#c9a86a]/15 px-1.5 py-0.5 text-[9.5px] font-normal text-[#e5c98c]">
                    非官方复刻
                  </span>
                </div>
                <div className="text-[10.5px] text-[#a89f93]">回复内容由 AI 生成，不代表官方立场</div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[#d8d1c4]">
              <button type="button" title="更多" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
                <DotsIcon />
              </button>
              <button type="button" title="收起" className="hidden h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex">
                <ChevronIcon />
              </button>
            </div>
            </div>
          </div>

          <div ref={listRef} className="scrollbar-thin flex-1 overflow-y-auto bg-[#eae8e3] px-3.5 py-4">
            <div className="w-full space-y-4">
              {messages.length === 0 ? <EmptyState onPick={(p) => submit(p)} /> : null}
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
              {error ? (
                <div className="rounded-xl border border-[#e9c2c2] bg-[#fdf3f3] px-3 py-2 text-[11.5px] text-[#b06a6a]">
                  通讯异常：{error}
                </div>
              ) : null}
            </div>
          </div>

          <form
            className="border-t border-[#ddd6c8] bg-[#f2efe9] px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="w-full">
            <div className="flex items-end gap-2">
              <div className="flex flex-1 items-end rounded-2xl border border-[#d8d2c6] bg-[#f9f7f2] px-1.5 py-1.5 shadow-sm transition-colors focus-within:border-[#c9a86a]">
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
                  className="max-h-32 min-h-[34px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] text-[#3b3630] outline-none placeholder:text-[#a9a196]"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="h-[44px] shrink-0 rounded-xl border border-[#cfc7b8] bg-[#fbf9f4] px-5 text-[13px] font-semibold text-[#5c5346] shadow-[0_2px_6px_rgba(90,70,40,0.12)] transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                发送
              </button>
            </div>
            <div className={`mt-2 flex flex-wrap gap-1.5 ${messages.length > 0 ? "hidden" : ""}`}>
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => submit(p)}
                  disabled={busy}
                  className="rounded-full border border-[#dcd5c8] bg-[#fbf9f4] px-2.5 py-1 text-[11px] text-[#7a7264] transition-colors hover:border-[#c9a86a] hover:text-[#8a6d3b] disabled:opacity-45"
                >
                  {p}
                </button>
              ))}
            </div>
            </div>
          </form>
        </section>
      </main>

      <footer className="mt-2 text-center text-[10px] leading-relaxed text-white/40">
        非官方粉丝复刻项目，与米哈游 /《崩坏：星穹铁道》无关。AI 生成内容仅供参考，素材版权归原作者所有。
      </footer>
    </div>
  );
}

/* ------------------------------ 顶部栏 ------------------------------ */

function TopBar() {
  return (
    <header className="glass-dark mb-2.5 flex items-center justify-between gap-2 rounded-2xl px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
        <span className="flex items-center gap-1.5 rounded-lg bg-white/12 px-2.5 py-1.5 text-[12px] font-medium text-[#f2d79b]">
          <ChatIcon /> 聊天对话
        </span>
        <a
          href="/quiz"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <QuizIcon /> 帕姆问问
        </a>
        <span className="ml-0.5 hidden rounded border border-white/20 px-1.5 py-0.5 text-[9.5px] text-white/45 sm:inline">
          v0.1 · 复刻版
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="列车长礼物（对话累计奖励）"
          className="hidden h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 sm:flex"
        >
          <GiftIcon />
        </button>
        <button
          type="button"
          title="问题反馈"
          className="hidden h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 sm:flex"
        >
          <HelpIcon />
        </button>
        <button
          type="button"
          title="更换对话框（敬请期待）"
          className="hidden items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/65 transition-colors hover:bg-white/10 sm:flex"
        >
          <SwapIcon /> 更换对话框
        </button>
        <a
          href="/settings"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-white/65 transition-colors hover:bg-white/10 hover:text-white"
        >
          <GearIcon /> <span className="hidden sm:inline">设置</span>
        </a>
      </div>
    </header>
  );
}

/* ------------------------------ 空态 ------------------------------ */

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="space-y-3.5">
      <div className="flex items-end gap-2">
        <div className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#f7e5bd] to-[#e3bd78] text-[11px] font-bold text-[#58400f] ring-2 ring-white">
          帕
        </div>
        <div className="bubble-pom max-w-[88%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px] leading-relaxed">
          欢迎回到列车，开拓者！帕姆今天也在列车长室值班帕。
          <br />
          想问配队、遗器、光锥还是材料？直接说就好——帕姆会去翻手册的！
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:max-w-[760px]">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="rounded-xl border border-[#ddd6c8] bg-[#f4f1eb] px-3 py-2.5 text-left text-[12px] text-[#5f584c] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c9a86a] hover:shadow"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ 消息 ------------------------------ */

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bubble-user max-w-[86%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px] leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  const showStatus = (message.status === "thinking" || message.status === "retrieving") && !message.content;
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#f7e5bd] to-[#e3bd78] text-[11px] font-bold text-[#58400f] ring-2 ring-white">
          帕
        </div>
        <div className="min-w-0 flex-1">
          {message.content ? (
            <div className="bubble-pom max-w-[94%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px] leading-relaxed">
              <RichText text={message.content} />
            </div>
          ) : null}
          {showStatus ? (
            <div className="bubble-pom inline-flex items-center gap-2 rounded-2xl rounded-bl-md px-3.5 py-2 text-[11.5px] text-[#8b8b97]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#d3a94f]" />
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

/* ------------------------------ 图标 ------------------------------ */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
      <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
    </svg>
  );
}

function QuizIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
      <path d="M9 9a3 3 0 1 1 4.2 2.7c-.8.4-1.2 1-1.2 1.8v.5" />
      <circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}>
      <path d="M20 12v8H4v-8M2 8h20v4H2zM12 8v12" />
      <path d="M12 8c-1.5-3-3-4-4.5-4A2.5 2.5 0 0 0 5 6.5C5 8 6 8 8 8ZM12 8c1.5-3 3-4 4.5-4A2.5 2.5 0 0 1 19 6.5C19 8 18 8 16 8Z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.1.9-1.1 1.7v.5" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
