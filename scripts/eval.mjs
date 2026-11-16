/**
 * 评测脚本：对本地 /api/chat 跑固定问题集，输出指标报告。
 *   npm run eval            # 全量
 *   npm run eval -- --limit=10
 *   npm run eval -- --filter=relic
 * 产出：eval/latest.json + eval/report.md
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const root = process.cwd();
const questionsFile = path.join(root, "eval", "questions.yaml");
const evalDir = path.join(root, "eval");

const args = process.argv.slice(2);
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);
const filter = args.find((a) => a.startsWith("--filter="))?.split("=")[1] ?? "";

const FORBIDDEN = ["作为AI", "作为 AI", "作为人工智能", "希望对你有帮助", "AI助手", "人工智能助手", "语言模型"];
const HONEST_RE = /(没收录|暂未收录|没有收录|没查到|没有查到|查不到|不编|无法确认|不确定|建议.{0,12}BWIKI|去.{0,8}wiki|没有这个角色的详细)/i;

const { questions } = parseYaml(fs.readFileSync(questionsFile, "utf8"));
const list = questions.filter((q) => !filter || q.category === filter).slice(0, limit > 0 ? limit : undefined);

async function ask(question) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let cards = [];
  let sources = [];
  let error = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      let ev;
      try {
        ev = JSON.parse(t.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.type === "text") text += ev.delta ?? "";
      else if (ev.type === "card") cards.push(ev.card);
      else if (ev.type === "sources") sources = ev.sources ?? [];
      else if (ev.type === "done") {
        if (ev.text) text = ev.text;
        if (Array.isArray(ev.cards)) cards = ev.cards;
        if (Array.isArray(ev.sources)) sources = ev.sources;
      } else if (ev.type === "error") error = ev.message;
    }
  }
  return { text, cards, sources, error, latency: (Date.now() - t0) / 1000 };
}

function scoreQuestion(q, result) {
  const hay = `${result.text}\n${result.cards.map((c) => JSON.stringify(c)).join("\n")}`;
  const checks = {};

  checks.answered = Boolean(result.text && result.text.trim().length > 0);
  if (q.expect_entity) checks.entity = hay.includes(q.expect_entity);
  if (Array.isArray(q.expect_keywords) && q.expect_keywords.length) {
    const hits = q.expect_keywords.filter((k) => hay.includes(k)).length;
    checks.keywords = hits / q.expect_keywords.length;
    checks.keywordsHit = hits;
    checks.keywordsTotal = q.expect_keywords.length;
    checks.keywordsPass = checks.keywords >= 0.5;
  }
  if (q.expect_card) checks.card = result.cards.some((c) => c.kind === q.expect_card);
  if (q.expect_no_card) checks.noCard = result.cards.length === 0;
  if (q.expect_citation) checks.citation = result.sources.length > 0 || /出处|wiki/i.test(result.text);
  if (q.expect_honest) checks.honest = HONEST_RE.test(result.text);

  // 人设
  const forbiddenHits = FORBIDDEN.filter((w) => result.text.includes(w));
  checks.persona = forbiddenHits.length === 0 && result.text.length > 0 && result.text.length <= 400;
  checks.forbiddenHits = forbiddenHits;
  checks.length = result.text.length;
  checks.latency = result.latency;
  checks.ok = checks.answered && checks.persona && checks.entity !== false && checks.keywordsPass !== false && checks.card !== false && checks.noCard !== false && checks.citation !== false && checks.honest !== false && !result.error;
  return checks;
}

function pct(n, d) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "—";
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

const results = [];
console.log(`评测 ${list.length} 题 @ ${BASE} …`);
for (const q of list) {
  process.stdout.write(`- ${q.id} … `);
  let r;
  try {
    const answer = await ask(q.question);
    const checks = scoreQuestion(q, answer);
    r = { question: q, answer: { text: answer.text, cards: answer.cards.map((c) => c.kind), sources: answer.sources, error: answer.error }, checks };
  } catch (err) {
    r = { question: q, answer: { text: "", cards: [], sources: [], error: String(err) }, checks: { ok: false, error: String(err) } };
  }
  results.push(r);
  console.log(r.checks.ok ? "✓" : `✗ ${r.checks.forbiddenHits?.join("/") || r.answer.error || "未达标"}`);
}

const total = results.length;
const passed = results.filter((r) => r.checks.ok).length;
const latencies = results.map((r) => r.checks.latency ?? 0).filter((x) => x > 0);
const keywordQ = results.filter((r) => r.checks.keywordsTotal);
const keywordAvg = keywordQ.reduce((acc, r) => acc + (r.checks.keywords ?? 0), 0) / (keywordQ.length || 1);
const citationQ = results.filter((r) => r.checks.citation !== undefined);
const citationRate = citationQ.filter((r) => r.checks.citation).length / (citationQ.length || 1);
const entityQ = results.filter((r) => r.checks.entity !== undefined);
const entityRate = entityQ.filter((r) => r.checks.entity).length / (entityQ.length || 1);
const cardQ = results.filter((r) => r.checks.card !== undefined);
const cardRate = cardQ.filter((r) => r.checks.card).length / (cardQ.length || 1);
const honestQ = results.filter((r) => r.checks.honest !== undefined);
const honestRate = honestQ.filter((r) => r.checks.honest).length / (honestQ.length || 1);
const personaRate = results.filter((r) => r.checks.persona).length / total;
const forbiddenCount = results.reduce((acc, r) => acc + (r.checks.forbiddenHits?.length ?? 0), 0);

const summary = {
  at: new Date().toISOString(),
  base: BASE,
  total,
  passed,
  passRate: passed / total,
  entityRate,
  keywordAvg,
  cardRate,
  citationRate,
  honestRate,
  personaRate,
  forbiddenCount,
  latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: Math.max(...latencies) },
};

fs.mkdirSync(evalDir, { recursive: true });
fs.writeFileSync(path.join(evalDir, "latest.json"), JSON.stringify({ summary, results }, null, 2));

const rows = results
  .map((r) => {
    const q = r.question;
    const c = r.checks;
    const what = [
      c.entity !== undefined ? `实体${c.entity ? "✓" : "✗"}` : "",
      c.keywordsTotal ? `关键词${c.keywordsHit}/${c.keywordsTotal}` : "",
      c.card !== undefined ? `卡片${c.card ? "✓" : "✗"}` : "",
      c.citation !== undefined ? `引用${c.citation ? "✓" : "✗"}` : "",
      c.honest !== undefined ? `诚实${c.honest ? "✓" : "✗"}` : "",
      c.persona ? "人设✓" : `人设✗${c.forbiddenHits?.join("/") ?? ""}`,
      c.latency ? `${c.latency}s` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `| ${q.id} | ${q.category} | ${q.question} | ${c.ok ? "✅" : "❌"} | ${what} |`;
  })
  .join("\n");

const report = `# 帕姆帮帮 · 评测报告

- 时间：${summary.at}
- 目标：${summary.base}
- 题目数：${total}，通过：${passed}（${pct(passed, total)}）
- 实体命中率：${pct(entityRate * entityQ.length, entityQ.length)}
- 关键词平均命中：${pct(keywordAvg * keywordQ.length, keywordQ.length)}（${keywordQ.length} 题）
- 卡片命中率：${pct(cardRate * cardQ.length, cardQ.length)}
- 引用覆盖率：${pct(citationRate * citationQ.length, citationQ.length)}
- 诚实降级率：${pct(honestRate * honestQ.length, honestQ.length)}（未收录角色/问题的「不知道就说」）
- 人设通过率：${pct(personaRate * total, total)}（禁用词 ${forbiddenCount} 次）
- 延迟：P50 ${summary.latency.p50.toFixed(1)}s · P95 ${summary.latency.p95.toFixed(1)}s · Max ${summary.latency.max.toFixed(1)}s

| id | 类别 | 问题 | 结果 | 明细 |
| --- | --- | --- | --- | --- |
${rows}

> 说明：关键词按「命中≥50%」计通过；人设检查 = 无客服腔/无 AI 自述/长度≤400 字。
`;

fs.writeFileSync(path.join(evalDir, "report.md"), report);
console.log(`\n通过 ${passed}/${total}（${pct(passed, total)}）`);
console.log(`P50 ${summary.latency.p50.toFixed(1)}s / P95 ${summary.latency.p95.toFixed(1)}s · 引用 ${pct(citationRate * citationQ.length, citationQ.length)} · 人设 ${pct(personaRate * total, total)}`);
console.log("报告：eval/report.md");
