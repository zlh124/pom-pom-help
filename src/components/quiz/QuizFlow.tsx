"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { QuizQuestion, QuizWeek } from "@/lib/quiz";
import { resultLabel } from "@/lib/quiz-labels";

const PomPomStage = dynamic(() => import("@/components/pompom/PomPomStage"), { ssr: false });

type Phase = "intro" | "question" | "result";

const STORAGE_KEY = "pompom-quiz-progress-v1";

type Progress = { week: string; index: number; answers: Array<number | null>; phase: Phase };

const DIFFICULTY_LABEL: Record<QuizQuestion["difficulty"], string> = {
  easy: "常识",
  normal: "进阶",
  hard: "考据",
};

export default function QuizFlow({ week }: { week: QuizWeek }) {
  const total = week.questions.length;
  const [phase, setPhase] = useState<Phase>("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Array<number | null>>(() => Array(total).fill(null));
  const [picked, setPicked] = useState<number | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Progress;
      if (p.week === week.week && Array.isArray(p.answers) && p.answers.length === total) {
        setAnswers(p.answers);
        setIndex(Math.min(p.index, total - 1));
        if (p.phase === "question") setPhase("question");
        if (p.phase === "result") setPhase("result");
      }
    } catch {
      /* ignore */
    } finally {
      restored.current = true;
    }
  }, [week.week, total]);

  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ week: week.week, index, answers, phase } satisfies Progress));
    } catch {
      /* ignore */
    }
  }, [week.week, index, answers, phase]);

  const score = useMemo(
    () => answers.reduce<number>((acc, ans, i) => (ans !== null && ans === week.questions[i].answer ? acc + 1 : acc), 0),
    [answers, week.questions],
  );
  const current = week.questions[index];
  const revealed = picked !== null;
  const result = resultLabel(score, total);

  const start = () => {
    setPhase("question");
    setIndex(0);
    setAnswers(Array(total).fill(null));
    setPicked(null);
  };

  const choose = (option: number) => {
    if (revealed) return;
    setPicked(option);
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = option;
      return next;
    });
  };

  const next = () => {
    if (index + 1 >= total) {
      setPhase("result");
      return;
    }
    setIndex(index + 1);
    setPicked(null);
  };

  return (
    <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1480px] flex-col px-3 py-2 md:px-5 md:py-3">
      {/* 顶部栏 */}
      <header className="glass-dark mb-2.5 flex items-center justify-between gap-2 rounded-2xl px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1.5 rounded-lg bg-white/12 px-2.5 py-1.5 text-[12px] text-white/70">
            <QuizIcon /> 帕姆问问
          </span>
          <span className="ml-0.5 hidden rounded border border-white/20 px-1.5 py-0.5 text-[9.5px] text-white/45 sm:inline">
            {week.week}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <a href="/" className="rounded-lg px-2.5 py-1.5 text-[11.5px] text-white/65 transition-colors hover:bg-white/10 hover:text-white">
            ← 回到聊天
          </a>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(480px,720px)] lg:items-stretch lg:gap-5">
        <aside className="relative hidden min-h-0 overflow-hidden rounded-[22px] lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_20%,rgba(255,255,255,0.14),transparent_70%)]" />
          <PomPomStage className="absolute inset-0 h-full w-full" />
        </aside>
        <div className="flex min-h-0 flex-1 flex-col">
        {phase === "intro" ? (
          <Intro week={week} onStart={start} hasProgress={answers.some((a) => a !== null)} onResume={() => setPhase("question")} />
        ) : null}

        {phase === "question" ? (
          <div className="flex flex-1 flex-col">
            <div className="flex flex-1 flex-col justify-center">
              <div className="mx-auto w-full max-w-[720px]">
                <div className="mb-2 flex items-center justify-between px-1 text-[11.5px] text-white/60">
                  <span>
                    第 <span className="font-semibold text-[#f2d79b]">{index + 1}</span> / {total} 题
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10.5px] text-[#f2d79b]">
                      {DIFFICULTY_LABEL[current.difficulty]}
                    </span>
                    <span className="text-white/40">已答对 {score}</span>
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#f2d79b] to-[#d3a94f] transition-all"
                    style={{ width: `${((index + (revealed ? 1 : 0)) / total) * 100}%` }}
                  />
                </div>

                <div className="mt-3 overflow-hidden rounded-[22px] border border-white/70 bg-[#fbf6ea] shadow-[0_18px_50px_rgba(4,8,24,0.45)]">
                  <div className="flex items-center gap-2 border-b border-[#efe2c4] bg-gradient-to-r from-[#b5343f] to-[#8f2730] px-4 py-2.5 text-[12px] text-[#fbe9cf]">
                    <span className="text-[11px] tracking-[0.2em]">帕姆提问</span>
                    <span className="text-[#f4d7a8]/70">·</span>
                    <span className="truncate">{week.theme}</span>
                  </div>
                  <div className="px-4 py-5 md:px-6">
                    <h2 className="text-[17px] font-semibold leading-relaxed text-[#3a2d1c] md:text-[18px]">{current.question}</h2>
                    <div className="mt-4 space-y-2">
                      {current.options.map((option, i) => {
                        const isAnswer = i === current.answer;
                        const isPicked = i === picked;
                        const cls = revealed
                          ? isAnswer
                            ? "border-[#7fbfb4] bg-[#e8f6f2] text-[#2c5f57]"
                            : isPicked
                              ? "border-[#d9a3a3] bg-[#fbeeee] text-[#8d5a5a] line-through"
                              : "border-[#ece3cf] bg-[#f7f1e3] text-[#a89a82]"
                          : "border-[#e8dcc2] bg-white/70 text-[#4a3a22] hover:border-[#d3a94f] hover:bg-[#fdf8ee]";
                        return (
                          <button
                            key={option}
                            type="button"
                            disabled={revealed}
                            onClick={() => choose(i)}
                            className={`w-full rounded-xl border px-3.5 py-2.5 text-left text-[14px] transition-colors ${cls}`}
                          >
                            <span className="mr-2 text-[11.5px] opacity-55">{String.fromCharCode(65 + i)}</span>
                            {option}
                          </button>
                        );
                      })}
                    </div>
                    {revealed ? (
                      <div className="mt-4 rounded-xl border border-[#e8dcc2] bg-[#f8f0de] px-3.5 py-3 text-[12px] leading-relaxed text-[#5a4a30]">
                        <span className={picked === current.answer ? "font-semibold text-[#2c7a6d]" : "font-semibold text-[#b5343f]"}>
                          {picked === current.answer ? "答对啦帕！" : "这题错了帕……"}
                        </span>
                        {current.explanation ? <p className="mt-1">{current.explanation}</p> : null}
                        <button
                          type="button"
                          onClick={next}
                          className="mt-3 rounded-lg bg-gradient-to-b from-[#efd495] to-[#d3a94f] px-4 py-1.5 text-[12px] font-semibold text-[#4b3306] shadow-sm transition-all hover:brightness-105"
                        >
                          {index + 1 >= total ? "看结果" : "下一题"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            <div className="pt-2.5 text-center">
              <a href="/" className="text-[10.5px] text-white/40 underline decoration-white/20 underline-offset-4 transition-colors hover:text-[#f2d79b]">
                暂时离开（去问帕姆帮帮）— 进度会保留
              </a>
            </div>
          </div>
        ) : null}

        {phase === "result" ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-[560px] overflow-hidden rounded-[22px] border border-white/70 bg-[#fbf6ea] shadow-[0_18px_50px_rgba(4,8,24,0.45)]">
              <div className="border-b border-[#efe2c4] bg-gradient-to-r from-[#b5343f] to-[#8f2730] px-4 py-2.5 text-center text-[12px] tracking-[0.24em] text-[#fbe9cf]">
                帕姆问问 · 本周称号
              </div>
              <div className="px-5 py-6 text-center">
                <h2 className="font-[family-name:var(--font-display)] text-[24px] text-[#3a2d1c]">{result.label}</h2>
                <p className="mt-1 text-[12.5px] text-[#9a8a70]">
                  答对 {score} / {total}
                </p>
                <p className="mt-4 rounded-xl border border-[#e8dcc2] bg-[#f8f0de] px-3.5 py-3 text-left text-[13px] leading-relaxed text-[#5a4a30]">
                  {result.comment}
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {Array.from(new Set(week.questions.flatMap((q) => q.tags ?? [])))
                    .slice(0, 6)
                    .map((tag) => (
                      <span key={tag} className="rounded-full border border-[#e2d4b8] bg-white/60 px-2 py-0.5 text-[10.5px] text-[#8a7858]">
                        {tag}
                      </span>
                    ))}
                </div>
                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    onClick={start}
                    className="flex-1 rounded-xl border border-[#e0d2b4] bg-white/70 px-4 py-2.5 text-[13px] text-[#6f5d3e] transition-colors hover:border-[#d3a94f] hover:bg-white"
                  >
                    ↻ 再试一次
                  </button>
                  <a
                    href="/"
                    className="flex-1 rounded-xl bg-gradient-to-b from-[#efd495] to-[#d3a94f] px-4 py-2.5 text-center text-[13px] font-semibold text-[#4b3306] shadow-sm transition-all hover:brightness-105"
                  >
                    ✓ 确认并退出
                  </a>
                </div>
                <p className="mt-3 text-center text-[10px] text-[#b3a58b]">回复内容由 AI 生成，不代表官方立场 · 非官方复刻</p>
              </div>
            </div>
          </div>
        ) : null}
        </div>
      </main>
    </div>
  );
}

function Intro({ week, onStart, hasProgress, onResume }: { week: QuizWeek; onStart: () => void; hasProgress: boolean; onResume: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-[560px] overflow-hidden rounded-[22px] border border-white/70 bg-[#fbf6ea] shadow-[0_18px_50px_rgba(4,8,24,0.45)]">
        <div className="border-b border-[#efe2c4] bg-gradient-to-r from-[#b5343f] to-[#8f2730] px-4 py-2.5 text-center text-[12px] tracking-[0.24em] text-[#fbe9cf]">
          帕姆问问 · 本周主题
        </div>
        <div className="px-5 py-6">
          <h2 className="text-center font-[family-name:var(--font-display)] text-[24px] text-[#3a2d1c]">{week.theme}</h2>
          <p className="mt-2 text-center text-[13px] leading-relaxed text-[#8a7858]">
            {week.themeIntro ?? "每周十题，答完有称号，答错也有讲解帕。"}
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[12px]">
            {[
              ["10 题", "三选一"],
              ["完成即得", "本周徽章"],
              ["即时讲解", "答错不惩罚"],
            ].map(([a, b]) => (
              <div key={a} className="rounded-xl border border-[#e8dcc2] bg-white/60 px-2 py-2 text-[#6f5d3e]">
                {a}
                <div className="text-[10px] text-[#b3a58b]">{b}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-2">
            {hasProgress ? (
              <button
                type="button"
                onClick={onResume}
                className="w-full rounded-xl bg-gradient-to-b from-[#efd495] to-[#d3a94f] px-4 py-2.5 text-[13px] font-semibold text-[#4b3306] shadow-sm transition-all hover:brightness-105"
              >
                继续上次进度
              </button>
            ) : null}
            <button
              type="button"
              onClick={onStart}
              className="w-full rounded-xl border border-[#e0d2b4] bg-white/70 px-4 py-2.5 text-[13px] text-[#6f5d3e] transition-colors hover:border-[#d3a94f] hover:bg-white"
            >
              {hasProgress ? "重新开始" : "开始答题帕"}
            </button>
          </div>
          <p className="mt-4 text-center text-[10px] text-[#b3a58b]">完成 10 题可获得本周称号 · 非官方复刻</p>
        </div>
      </div>
    </div>
  );
}

function QuizIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 9a3 3 0 1 1 4.2 2.7c-.8.4-1.2 1-1.2 1.8v.5" />
      <circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
