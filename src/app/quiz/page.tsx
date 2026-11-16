import { loadQuizWeeks } from "@/lib/quiz";
import QuizFlow from "@/components/quiz/QuizFlow";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "帕姆问问 · 帕姆帮帮（非官方复刻）",
};

export default function QuizPage() {
  const weeks = loadQuizWeeks();
  const week = weeks[0];
  if (!week) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-sm text-white/50">题库还在准备中帕…请先运行 pnpm corpus:index</p>
      </main>
    );
  }
  return (
    <main>
      <QuizFlow week={week} />
    </main>
  );
}
