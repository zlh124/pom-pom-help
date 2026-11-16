"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { QuizQuestion, QuizWeek } from "@/lib/quiz";
import { resultLabel } from "@/lib/quiz-labels";

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

  // 恢复进度（「暂时离开」回来还能接着答）
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
    const payload: Progress = { week: week.week, index, answers, phase };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
    <div className="mx-auto flex min-h-dvh w-full max-w-[860px] flex-col px-4 py-5">
      <header className="mb-4 flex items-center justify-between">
        <a href="/" className="text-[12px] text-white/45 transition-colors hover:text-gold">
          ← 回到聊天
        </a>
        <h1 className="font-[family-name:var(--font-display)] text-[15px] tracking-[0.2em] text-gold">帕姆问问</h1>
        <span className="text-[11px] text-white/30">{week.week}</span>
      </header>

      {phase === "intro" ? (
        <Intro week={week} onStart={start} hasProgress={answers.some((a) => a !== null)} onResume={() => setPhase("question")} />
      ) : null}

      {phase === "question" ? (
        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col justify-center">
          <div className="mb-3 flex items-center justify-between text-[12px] text-white/45">
            <span>
              第 <span className="text-gold">{index + 1}</span> / {total} 题
            </span>
            <div className="flex items-center gap-2">
              <span className="rounded border border-gold/30 px-1.5 py-0.5 text-[11px] text-gold/80">{DIFFICULTY_LABEL[current.difficulty]}</span>
              <span className="text-white/30">已答对 {score}</span>
            </div>
          </div>

          <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gold/70 transition-all" style={{ width: `${((index + (revealed ? 1 : 0)) / total) * 100}%` }} />
          </div>

          <div className="paper-bubble mt-4 rounded-2xl px-5 py-6">
            <div className="mb-2 text-[11px] text-ink/45">帕姆提问 · {week.theme}</div>
            <h2 className="text-[17px] font-semibold leading-relaxed text-ink">{current.question}</h2>
            <div className="mt-4 space-y-2">
              {current.options.map((option, i) => {
                const isAnswer = i === current.answer;
                const isPicked = i === picked;
                const cls = revealed
                  ? isAnswer
                    ? "border-teal/70 bg-teal/15 text-ink"
                    : isPicked
                      ? "border-crimson/60 bg-crimson/10 text-ink/70 line-through"
                      : "border-black/10 bg-black/[0.02] text-ink/45"
                  : "border-black/15 bg-black/[0.03] text-ink hover:border-gold/60 hover:bg-gold/10";
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={revealed}
                    onClick={() => choose(i)}
                    className={`w-full rounded-xl border px-3.5 py-2.5 text-left text-[14px] transition-colors ${cls}`}
                  >
                    <span className="mr-2 text-[12px] opacity-60">{String.fromCharCode(65 + i)}</span>
                    {option}
                  </button>
                );
              })}
            </div>
            {revealed ? (
              <div className="mt-4 rounded-xl border border-gold/30 bg-gold/5 px-3.5 py-3 text-[12px] leading-relaxed text-ink/75">
                <span className={picked === current.answer ? "text-teal" : "text-crimson"}>
                  {picked === current.answer ? "答对啦帕！" : "这题错了帕……"}
                </span>
                {current.explanation ? <p className="mt-1">{current.explanation}</p> : null}
                <button
                  type="button"
                  onClick={next}
                  className="mt-3 rounded-lg border border-gold/50 bg-gold/15 px-4 py-1.5 text-[12px] text-gold transition-colors hover:bg-gold/25"
                >
                  {index + 1 >= total ? "看结果" : "下一题"}
                </button>
              </div>
            ) : null}
          </div>

          </div>
          <div className="pt-4 text-center">
            <a href="/" className="text-[11px] text-white/30 underline decoration-white/20 underline-offset-4 hover:text-gold">
              暂时离开（去问帕姆帮帮）— 进度会保留
            </a>
          </div>
        </div>
      ) : null}

      {phase === "result" ? (
        <div className="paper-bubble mt-2 rounded-2xl px-5 py-6">
          <div className="text-center">
            <div className="text-[11px] tracking-[0.3em] text-ink/40">本周称号</div>
            <h2 className="mt-1 font-[family-name:var(--font-display)] text-[22px] text-ink">{result.label}</h2>
            <p className="mt-1 text-[13px] text-ink/55">
              答对 {score} / {total}
            </p>
          </div>
          <p className="mt-4 rounded-xl border border-gold/30 bg-gold/5 px-3.5 py-3 text-[13px] leading-relaxed text-ink/80">
            {result.comment}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Array.from(new Set(week.questions.flatMap((q) => q.tags ?? [])))
              .slice(0, 6)
              .map((tag) => (
                <span key={tag} className="rounded-full border border-black/15 px-2 py-0.5 text-[11px] text-ink/55">
                  {tag}
                </span>
              ))}
          </div>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={start}
              className="flex-1 rounded-xl border border-black/20 px-4 py-2.5 text-[13px] text-ink/70 transition-colors hover:border-gold/60 hover:bg-gold/10"
            >
              ↻ 再试一次
            </button>
            <a
              href="/"
              className="flex-1 rounded-xl border border-gold/50 bg-gold/15 px-4 py-2.5 text-center text-[13px] text-gold transition-colors hover:bg-gold/25"
            >
              ✓ 确认并退出
            </a>
          </div>
          <p className="mt-3 text-center text-[10px] text-ink/35">回复内容由 AI 生成，不代表官方立场 · 非官方复刻</p>
        </div>
      ) : null}
    </div>
  );
}

function Intro({
  week,
  onStart,
  hasProgress,
  onResume,
}: {
  week: QuizWeek;
  onStart: () => void;
  hasProgress: boolean;
  onResume: () => void;
}) {
  return (
    <div className="paper-bubble flex-1 rounded-2xl px-5 py-6">
      <div className="text-center">
        <div className="text-[11px] tracking-[0.3em] text-ink/40">本周主题</div>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-[24px] text-ink">{week.theme}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink/60">{week.themeIntro ?? "每周十题，答完有称号，答错也有讲解帕。"}</p>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[12px]">
        <div className="rounded-xl border border-black/10 px-2 py-2 text-ink/60">
          10 题
          <div className="text-[10px] text-ink/35">三选一</div>
        </div>
        <div className="rounded-xl border border-black/10 px-2 py-2 text-ink/60">
          完成即得
          <div className="text-[10px] text-ink/35">本周徽章</div>
        </div>
        <div className="rounded-xl border border-black/10 px-2 py-2 text-ink/60">
          即时讲解
          <div className="text-[10px] text-ink/35">答错不惩罚</div>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2">
        {hasProgress ? (
          <button
            type="button"
            onClick={onResume}
            className="w-full rounded-xl border border-gold/50 bg-gold/15 px-4 py-2.5 text-[13px] text-gold transition-colors hover:bg-gold/25"
          >
            继续上次进度
          </button>
        ) : null}
        <button
          type="button"
          onClick={onStart}
          className="w-full rounded-xl border border-black/20 px-4 py-2.5 text-[13px] text-ink/70 transition-colors hover:border-gold/60 hover:bg-gold/10"
        >
          {hasProgress ? "重新开始" : "开始答题帕"}
        </button>
      </div>
    </div>
  );
}
