/**
 * 中文检索分词（面向游戏专有名词）
 *
 * 实测结论（见 docs/research/data-sources.md §5）：
 * - SQLite FTS5 默认 unicode61 会把整句汉字当成一个 token → 查「黄泉」0 命中
 * - trigram 只在 ≥3 字生效 → 2 字角色名全部失效
 * - 所以：入库前必须用「游戏词典最大匹配 + 单字/双字兜底」切分，查询用同一套切分
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export type TokenizerDict = {
  /** 最长词长度（字符数） */
  maxLen: number;
  /** 游戏专有名词（角色/光锥/遗器/术语/别名），按长度降序 */
  words: Set<string>;
};

export function buildDict(names: Iterable<string>): TokenizerDict {
  const words = new Set<string>();
  let maxLen = 1;
  for (const raw of names) {
    const n = normalize(raw);
    if (!n) continue;
    words.add(n);
    maxLen = Math.max(maxLen, n.length);
  }
  return { words, maxLen: Math.min(maxLen, 12) };
}

export function normalize(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

/**
 * 把文本切成 token 数组。
 * - 词典命中：整词一个 token
 * - 其余汉字：单字 + 双字（相邻两字）都入 token，保证 2 字名与错字也有召回
 * - 拉丁/数字：整串一个 token
 */
export function tokenize(input: string, dict: TokenizerDict): string[] {
  const text = normalize(input);
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (CJK.test(ch)) {
      // 词典最大匹配
      let matched = false;
      if (dict.words.size) {
        const maxLen = Math.min(dict.maxLen, text.length - i);
        for (let len = maxLen; len >= 2; len--) {
          const slice = text.slice(i, i + len);
          if (dict.words.has(slice)) {
            out.push(slice);
            i += len;
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;
      // 单字 + 双字兜底
      out.push(ch);
      if (i + 1 < text.length && CJK.test(text[i + 1])) out.push(text.slice(i, i + 2));
      i += 1;
      continue;
    }
    // 拉丁 / 数字
    let j = i;
    while (j < text.length && !CJK.test(text[j]) && !/\s/.test(text[j])) j += 1;
    const word = text.slice(i, j).replace(/[^\p{L}\p{N}]+/gu, "");
    if (word) out.push(word);
    if (j === i) j += 1;
    i = j;
  }
  return dedupe(out);
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** 生成 FTS5 MATCH 表达式（OR 语义，靠 bm25 排序） */
export function toFtsQuery(tokens: string[]): string {
  const safe = tokens
    .map((t) => t.replace(/["*]/g, ""))
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"`);
  return safe.join(" OR ");
}

/** 用于「最长别名替换」：把用户问句里的黑话替换成官名 */
export function expandAliases(input: string, aliases: Map<string, string>): { text: string; hits: string[] } {
  if (!aliases.size) return { text: input, hits: [] };
  const keys = [...aliases.keys()].sort((a, b) => b.length - a.length);
  let text = input;
  const hits: string[] = [];
  for (const key of keys) {
    if (!key || key.length < 1) continue;
    if (text.includes(key)) {
      const canonical = aliases.get(key)!;
      text = text.split(key).join(canonical);
      hits.push(`${key}→${canonical}`);
    }
  }
  return { text, hits };
}
