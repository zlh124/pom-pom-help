import { loadCorpus } from "@/lib/corpus/load";

export type QuizQuestion = {
  id: string;
  difficulty: "easy" | "normal" | "hard";
  question: string;
  options: string[];
  answer: number;
  explanation?: string;
  tags?: string[];
  sources?: string[];
};

export type QuizWeek = {
  week: string;
  theme: string;
  themeIntro?: string;
  questions: QuizQuestion[];
  title: string;
  sources?: string[];
};


/** 用固定种子打乱选项，避免「答案总在 A」；同一题每次顺序一致 */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function shuffleQuestion(q: QuizQuestion): QuizQuestion {
  if (q.options.length <= 1) return q;
  const rand = mulberry32(hashString(`${q.id}:${q.question}`));
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    answer: order.indexOf(q.answer),
  };
}

export function loadQuizWeeks(): QuizWeek[] {
  const corpus = loadCorpus();
  const weeks: QuizWeek[] = [];
  for (const doc of corpus.quiz) {
    const data = doc.data as Record<string, any>;
    const questions = Array.isArray(data.questions) ? data.questions : [];
    if (!questions.length) continue;
    weeks.push({
      week: String(data.week ?? doc.meta.id ?? ""),
      theme: String(data.theme ?? doc.meta.title ?? "本周主题"),
      themeIntro: data.theme_intro ? String(data.theme_intro) : undefined,
      title: String(doc.meta.title ?? "帕姆问问"),
      sources: Array.isArray(doc.meta.sources) ? (doc.meta.sources as string[]) : undefined,
      questions: questions.map((q: any, i: number) => ({
        id: String(q.id ?? `q${i + 1}`),
        difficulty: q.difficulty === "hard" || q.difficulty === "normal" ? q.difficulty : "easy",
        question: String(q.question ?? ""),
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        answer: Number(q.answer ?? 0),
        explanation: q.explanation ? String(q.explanation) : undefined,
        tags: Array.isArray(q.tags) ? q.tags.map(String) : undefined,
        sources: Array.isArray(q.sources) ? q.sources.map(String) : undefined,
      })).map(shuffleQuestion),
    });
  }
  return weeks.sort((a, b) => (a.week < b.week ? 1 : -1));
}
