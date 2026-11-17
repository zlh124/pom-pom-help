/**
 * Agent Runtime：DeepSeek（OpenAI 兼容） + 工具调用 + 流式输出 + 卡片事件
 *
 * 流程：
 *  1. 带 tools 调 N 轮（非流式）→ 决定调用哪些工具
 *  2. 工具执行（确定性本地查询），收集卡片/出处
 *  3. 最终回答用 stream:true + tool_choice:none 流式生成
 */
import { config } from "@/lib/env";
import type { Card, Source } from "@/lib/cards";
import { loadCorpus } from "@/lib/corpus/load";
import { getBuild, getCharacter, getMaterials, getTeam, resolveEntity, searchCorpusTool } from "@/lib/tools";
import type { ToolResult } from "@/lib/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AgentEvent =
  | { type: "status"; stage: "thinking" | "retrieving" | "writing"; text?: string }
  | { type: "text"; delta: string }
  | { type: "card"; card: Card }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; text: string; cards: Card[]; sources: Source[] }
  | { type: "error"; message: string };

type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type ChatResponse = {
  choices?: Array<{
    message?: { role?: string; content?: string | null; tool_calls?: ToolCall[] };
    finish_reason?: string;
  }>;
  usage?: unknown;
};

const TOOL_SCHEMAS = [
  {
    type: "function" as const,
    function: {
      name: "resolve_entity",
      description: "把玩家口语/黑话/简称解析成游戏内实体（角色/光锥/遗器）。当用户提到不确定的名字时先调用。",
      strict: true,
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "用户提到的名字或称呼，如「龙丹」「银狼」「死水深潜」" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_character",
      description: "查询角色基础信息（星级/命途/属性/定位/社区昵称）。",
      strict: true,
      parameters: {
        type: "object",
        properties: { character: { type: "string", description: "角色官名或别名" } },
        required: ["character"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_build",
      description: "查询角色配装：遗器套装/主副词条/光锥推荐/配队模板。问「怎么养/带什么遗器/带什么光锥/怎么配队」时调用。",
      strict: true,
      parameters: {
        type: "object",
        properties: { character: { type: "string", description: "角色官名或别名" } },
        required: ["character"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_team",
      description: "查询配队模板（按角色或队伍流派，如「超击破队」「黄泉队」）。",
      strict: true,
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "角色名或流派名" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_materials",
      description: "查询角色养成材料清单与刷取地点（晋阶/行迹/周本材料）。问「材料在哪刷/要什么材料」时调用。",
      strict: true,
      parameters: {
        type: "object",
        properties: { character: { type: "string", description: "角色官名或别名" } },
        required: ["character"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_corpus",
      description: "在本地攻略语料库检索机制解释、版本信息、配队思路等文本。前面工具查不到或需要解释「为什么」时调用。",
      strict: true,
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "检索关键词，尽量带游戏专有名词" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

const FALLBACK_PERSONA = `你是「帕姆」——《崩坏：星穹铁道》星穹列车的列车长，也是开拓者的 AI 助手。
说话要点：
- 自称「帕姆」，称呼对方「开拓者」，偶尔称其他角色「XX乘客/姬子姐姐/三月七」。
- 句尾或句中带「帕」字口癖，但每条回复最多 2 次，不要每句都加。
- 活泼、认真、护短，语气像列车长在照顾乘客；可以用「帕！」「帕……」「（耳朵动了动）」这类小动作和 emoji（✧ ◕ ◡ ◕ ♪ ！？）。
- 回答攻略问题时：先给结论，再给关键理由；有卡片时正文要短（≤120 字），不要重复卡片里已经列出的全部数值。
- 不确定或语料里没有的内容，直接说「这个帕姆得去翻翻手册」并说明缺什么，**绝不编造数值、版本号、卡池时间或角色信息**。
- 不要自称"AI 助手/AI 模型"，不要用"希望对你有帮助"这类客服腔；不要在正文里写 Markdown 表格（卡片会展示）。
- 遇到涉政涉黄、账号交易、外挂、攻击他人的问题：用列车长的口吻拒绝，不要展开。`;

function buildSystemPrompt(): string {
  const corpus = loadCorpus();
  const persona = corpus.personas[0];
  const personaLines: string[] = [];
  if (persona) {
    if (persona.identity) personaLines.push(`身份：${persona.identity}`);
    if (persona.voice) personaLines.push(`语气设定：${JSON.stringify(persona.voice, null, 0).slice(0, 800)}`);
    if (Array.isArray(persona.rules)) personaLines.push(`规则：\n${persona.rules.map((r) => `- ${r}`).join("\n")}`);
    if (Array.isArray(persona.banned)) personaLines.push(`禁止：${persona.banned.join("；")}`);
    if (Array.isArray(persona.examples) && persona.examples.length) {
      personaLines.push(
        `示例：\n${persona.examples
          .slice(0, 5)
          .map((e) => `开拓者：${e.user}\n帕姆：${e.assistant}`)
          .join("\n")}`,
      );
    }
  }
  const personaBlock = personaLines.length ? personaLines.join("\n") : FALLBACK_PERSONA;
  return `${personaBlock}

【当前版本】${config.gameVersion}。你的知识来自本地语料与结构化数据，数据可能滞后一个版本，不确定就说明。

【工具使用】
- 用户问角色养成/遗器/光锥/配队 → 调 get_build；问材料 → get_materials；问某队怎么组 → get_team；问机制/版本/为什么 → search_corpus。
- 名字可能是黑话/简称/错字（例如「龙丹」「欢愉主」「火花」→ 花火），先调 resolve_entity 再调对应工具。
- 一次可以调多个工具；查不到就如实说没收录，不要硬编。
- 工具返回的卡片会自动展示给用户，你不需要在正文重复卡片内所有细节。
- **涉及游戏内容（角色/配装/配队/材料/机制/版本）必须先调用工具**，不允许凭记忆直接回答；工具说没收录就如实说没收录。
- **不要编造**等级、数值、版本号、角色名绰号（例如不要给「银狼」加「LV.999」之类没来由的细节）。

【输出】只输出帕姆要说的话（中文，≤120 字为主），不要输出 JSON、不要输出工具名、不要输出"（卡片已生成）"之类的话。`;
}

const TOOL_ROUND_TIMEOUT_MS = 75_000;
const STREAM_TIMEOUT_MS = 150_000;

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function chatCompletion(body: Record<string, unknown>, signal?: AbortSignal): Promise<ChatResponse> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, thinking: { type: config.thinking }, ...body }),
    signal: withTimeout(signal, TOOL_ROUND_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`模型接口 ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as ChatResponse;
}

function executeTool(call: ToolCall): ToolResult {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    return { ok: false, summary: "工具参数解析失败" };
  }
  switch (call.function.name) {
    case "resolve_entity": {
      // eslint-disable-next-line no-case-declarations
      const entity = resolveEntity(String(args.query ?? ""));
      return entity
        ? { ok: true, summary: `解析结果：${entity.name}（kind=${entity.kind}, id=${entity.id}${entity.alias ? `, 别名=${entity.alias}` : ""}）` }
        : { ok: false, summary: `没解析出「${String(args.query ?? "")}」对应的游戏实体。` };
    }
    case "get_character":
      return getCharacter(String(args.character ?? ""));
    case "get_build": {
      const result = getBuild(String(args.character ?? ""));
      if (process.env.DEBUG_TOOLS === "1") {
        console.log("[tool] get_build", JSON.stringify(args), "→ ok=", result.ok, "|", result.summary.split("\n")[0].slice(0, 120));
      }
      return result;
    }
    case "get_team":
      return getTeam(String(args.query ?? ""));
    case "get_materials":
      return getMaterials(String(args.character ?? ""));
    case "search_corpus":
      return searchCorpusTool(String(args.query ?? ""));
    default:
      return { ok: false, summary: `未知工具 ${call.function.name}` };
  }
}

function dedupeCards(cards: Card[]): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const card of cards) {
    const key = card.kind === "team" ? `team:${card.archetype}:${card.slots.map((s) => s.name).join(",")}` : `${card.kind}:${"character" in card ? card.character : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

export type RunAgentOptions = {
  messages: ChatMessage[];
  signal?: AbortSignal;
};


/** 清洗模型可能漏出的工具调用特殊标记（DeepSeek DSML / 其他） */
function sanitizeModelText(input: string): string {
  return input
    .replace(/<[^>\n]{0,60}?｜[^>\n]{0,60}?>/g, "")
    .replace(/<\|[^|\n]*\|>/g, "")
    .replace(/^\s*(invoke|parameter)\s+name=.*$/gm, "")
    .replace(/^\s*\/?(invoke|parameter)>?\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 工具全部失败/返回未收录时，用工具结论兜底，避免模型编造 */
function fallbackFromTools(summaries: Array<{ ok: boolean; summary: string }>): string {
  const failed = summaries.filter((t) => !t.ok);
  if (failed.length) {
    const first = failed[0].summary.split("\n")[0].slice(0, 120);
    return `帕姆去翻了下手册，这个没能查到：${first}。开拓者可以先看看卡片里的通用思路，或者去 BWIKI 确认帕！`;
  }
  return "帕姆翻遍手册也没找到相关资料，开拓者换个说法再问问？";
}

export async function* runAgent({ messages, signal }: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const history = messages.slice(-config.maxHistory);
  const openaiMessages: OpenAiMessage[] = [{ role: "system", content: buildSystemPrompt() }];
  for (const m of history) openaiMessages.push({ role: m.role, content: m.content });

  const cards: Card[] = [];
  const sources: Source[] = [];
  const toolSummaries: Array<{ ok: boolean; summary: string }> = [];

  yield { type: "status", stage: "thinking", text: "帕姆正在翻手册…" };

  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const gameContent = /(遗器|光锥|配队|队伍|材料|行迹|命途|击破|角色|配装|养成|词条|开拓等级|保底|忘却|虚构|刷取|深渊|模拟宇宙|版本|活动)/.test(lastUser);

  let directContent = "";
  let rounds = 0;
  const maxRounds = Math.max(1, config.maxToolRounds);
  while (rounds < maxRounds) {
    rounds += 1;
    const resp = await chatCompletion(
      {
        messages: openaiMessages,
        tools: TOOL_SCHEMAS,
        // 游戏内容问题首轮强制调工具，避免模型凭记忆直接回答（评测：guide 类曾出现 0 引用）
        tool_choice: rounds === 1 && gameContent ? "required" : "auto",
        temperature: 0.2,
        max_tokens: 600,
        stream: false,
      },
      signal,
    );
    const message = resp.choices?.[0]?.message;
    if (!message) throw new Error("模型返回为空");
    const toolCalls = message.tool_calls ?? [];
    if (!toolCalls.length) {
      // 模型没调工具：直接采用它的回答，不再追加一轮（否则会变成"续写"）
      directContent = message.content ?? "";
      break;
    }
    openaiMessages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });
    yield { type: "status", stage: "retrieving", text: "列车长正在查资料…" };
    for (const call of toolCalls) {
      const result = executeTool(call);
      toolSummaries.push({ ok: result.ok, summary: result.summary });
      if (result.cards?.length) cards.push(...result.cards);
      if (result.sources?.length) sources.push(...result.sources);
      openaiMessages.push({ role: "tool", tool_call_id: call.id, content: result.summary });
    }
  }

  yield { type: "status", stage: "writing", text: "帕姆正在组织语言…" };

  let answer = sanitizeModelText(directContent);

  if (!answer) {
    // 流式最终回答：只在此前没有拿到完整文本时使用
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        thinking: { type: config.thinking },
        messages: openaiMessages,
        temperature: 0.8,
        max_tokens: 500,
        stream: true,
        tools: TOOL_SCHEMAS,
        tool_choice: "none",
      }),
      signal: withTimeout(signal, STREAM_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`模型流式接口 ${res.status}: ${text.slice(0, 300)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let raw = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            raw += delta;
            const visible = sanitizeModelText(delta);
            if (visible) yield { type: "text", delta: visible };
          }
        } catch {
          /* 忽略不完整 JSON */
        }
      }
    }
    answer = sanitizeModelText(raw);
  }

  if (!answer) {
    answer = fallbackFromTools(toolSummaries);
    yield { type: "text", delta: answer };
  } else if (directContent) {
    // 直接回答：整段一次性下发（前端会整体替换为 done.text）
    yield { type: "text", delta: answer };
  }

  const finalCards = dedupeCards(cards);
  const finalSources = sources.filter((s, i, arr) => s.url && arr.findIndex((x) => x.url === s.url) === i).slice(0, 5);
  if (finalCards.length) for (const card of finalCards) yield { type: "card", card };
  if (finalSources.length) yield { type: "sources", sources: finalSources };
  yield { type: "done", text: answer, cards: finalCards, sources: finalSources };
}
