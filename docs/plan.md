# 「帕姆帮帮」网页复刻 · 技术方案与实施计划

> 版本 v0.1（草案，待你拍板）· 2026-11-16
> 目标读者：项目作者（你）/ 未来的贡献者
> 相关文档：产品调研 [docs/research/product.md](research/product.md) · 数据调研 [docs/research/data-sources.md](research/data-sources.md)
> 参考截图：`refs/ui_main.png`（聊天主界面）、`refs/weekly.png`（帕姆问问结果页）、`refs/outfit.png`（衣装）——**仅作研究参考，不进仓库分发**

**目录**：§0 结论 · §1 背景 · §2 产品设计 · §3 技术栈 · §4 架构 · §5 数据/RAG · §6 Agent · §7 前端 · §8 工程 · §9 里程碑 · §10 风险 · §11 待拍板 · 附录 A 环境实测 · 附录 B 参考 · 附录 C M0 验证脚本

---

## 0. 一页结论（TL;DR）

**复刻的是什么**：一个本地优先、单用户、可部署的中文网页应用，把《崩坏：星穹铁道》4.2 版本限时上线的游戏内 AI 助手「帕姆帮帮（测试版）」重新做一遍——**帕姆人设闲聊 + 养成/遗器/光锥/配队/材料问答 + 结构化数据卡片 + 每周「帕姆问问」答题**。

**技术栈一句话**：Next.js 16（App Router）+ React 19 + TypeScript + Tailwind 4 + shadcn/ui；任意 **OpenAI 兼容** 大模型接口（默认 `deepseek-flash` 等，可换）；SQLite 单文件（StarRailRes 4.7 数值 + BWIKI 中文攻略语料 + FTS5 中文检索 + sqlite-vec 向量）；语料两层：`pnpm data:sync` + `pnpm wiki:sync` 抓取打底，**corpus-as-code**（Markdown/YAML，PR 式社区贡献）做校正、builds/teams、题库与人格。

**架构一句话**：Agentic RAG——LLM 通过 5~7 个确定性工具查结构化数据 / 混合检索语料，把结论做成卡片事件与文本一起流式返回；结构化数据负责"不胡说"，语料库负责"有观点"，人格层负责"像帕姆"。

**工期**：M0 技术验证 0.5~1 天 → M1 数据与检索 2~2.5 天 → M2 聊天 MVP 2 天（**约第 5 天有可玩版本**）→ M3 实用卡片 2~2.5 天 → M4 帕姆问问 1.5~2 天 → M5 打磨/部署/评测 1.5 天。总计 **9.5~11.5 个工作日**（单人 + AI 结对）。

**需要你拍板的 4 件事**（详见 §11）：
1. 具体用哪家 OpenAI 兼容服务、模型名、是否支持 `/embeddings`（向量检索要用）；
2. 语料是否放在**公开 GitHub 仓库**（决定社区贡献流程是 PR 还是本地目录）；
3. build/配队数据的覆盖策略：先做 12~20 个热门角色，还是全 99 角色（质量会稀释）；
4. 帕姆立绘：用我画的 SVG/CSS 简笔列车长，还是你提供同人图（官方美术不能打包）。

---

## 1. 背景与需求

### 1.1 原功能事实（有出处，详见 product.md）

| 项 | 内容 |
| --- | --- |
| 上线 | 2026-04-22，随 4.2 版本「如是，众生欢笑不已」 |
| 下线 | 2026-05-25 04:00（服务器时间）**「暂时下线优化」**（官方口径，非永久关停） |
| 入口 | 游戏内「聊天对话」-「帕姆帮帮（测试版）」 |
| 能力 | ① 日常闲聊（列车长人设）② 实用问答：材料刷取 / 配队 / 遗器 / 光锥 ③ 第二周起周常「帕姆问问」答题 |
| 交互 | 左帕姆立绘 + 右对话流；AI 回复=口癖开场白 + **结构化对比卡片**（当前装备 vs 推荐、评级 S/A、红警"主属性不匹配"、查看/解释/应用方案） |
| 技术口径 | 自研大模型基座、FP8；本地智库 + 社区 PUGC 联网；简称识别（"欢愉主""龙丹"）；多轮长线记忆；零 OOC |
| 为什么"下线"值得复刻 | 官方是"暂时下线优化"，正式版未上线，社区仍有人问"入口怎么找不到了"——复刻有真实需求 |

*（注：原功能是 4.22 开放、5.25 结束的限时测试，所以它并非"五月上线"，而是"五月下线"；这也是为什么现在找不到了。）*

### 1.2 复刻目标（产品级）

1. **人设可信**：输出像帕姆（口癖「帕」、列车长口吻、表情、认真又护短），而不是一个套壳 ChatGPT。
2. **攻略有用**：对"某角色怎么养 / 带什么遗器光锥 / 怎么配队 / 材料在哪刷"给出**可核对、有出处、可复制**的答案。
3. **卡片可执行**：把建议变成结构化卡片（遗器双栏对比、光锥列表、配队阵容、材料清单），网页版用「复制配置 / 生成清单 / 去 wiki」替代游戏内「应用方案」。
4. **有周常玩法**：还原「帕姆问问」每周 10 题 + 奖励 + 趣味标签，作为留存钩子。
5. **可维护**：游戏数据版本化同步，攻略语料可被社区持续贡献，模型/向量库可替换。

### 1.3 明确不做（v1）

- ❌ 不读取真实游戏账号（无官方 API；米游社/HoYoLab 需抓 cookie + 签名，合规与稳定性都不划算）→ 改为「对话中选择角色 / 通用推荐」，不保存账号档案。
- ❌ 不打包、不分发米哈游官方美术素材（立绘、图标、UI 切图）→ 自制/占位；可选脚本由用户本地自行下载。
- ❌ 不做多用户/登录/付费；不做联网搜索（P3 可选）。
- ❌ 不承诺"最优解"：卡片明确标注数据来源与置信度（社区语料 / 模型推断）。

---

## 2. 产品设计

### 2.1 信息架构

```
帕姆帮帮（非官方复刻）
├─ 聊天对话 /（默认）
│   ├─ 左侧角色栏：帕姆立绘 + 衣装槽（P2）+ 对话计数 + 开启新对话
│   ├─ 右侧：对话头（标题 + 常驻免责声明 + 菜单）→ 消息流（气泡 + 卡片）→ 输入区
│   └─ 卡片动作：查看 / 解释 / 复制配置 / 出处
├─ 帕姆问问 /quiz
│   ├─ 开始页：本周主题 + 规则 + 徽章奖励
│   ├─ 答题页：n/10 + 题干 + 选项 + 即时对错与讲解 + 「暂时离开」彩蛋
│   └─ 结果页：分数 + 2~3 个趣味标签 + 帕姆点评（模板 + LLM 短评）+ 再试一次
├─ 设置 /settings：数据设置（记忆开关/清除数据）、模型配置只读展示、关于与免责
└─ /api/*：chat(SSE)、quiz、feedback、health
```

### 2.2 页面线框（基于 `refs/ui_main.png` 还原）

```
┌──────────────────────────────────────────────────────────────┐
│ 帕姆帮帮（非官方复刻）   [聊天对话] [帕姆问问]        ⚙ 设置  │
├────────────┬─────────────────────────────────────────────────┤
│            │ ◉ 帕姆帮帮（复刻版）              …   ▾         │
│  帕姆 SVG  │   回复内容由 AI 生成，不代表官方立场               │
│  立绘 36%  │                                                 │
│            │                      ┌────────────────────────┐  │
│  🎁 12/20  │                      │ 帮我推荐一下花火的遗器 │  │
│            │  ┌────────────────────────────────────────┐   │
│            │  │ 啦嗯！你想知道的火花遗器情报，列车长   │   │
│            │  │ 帮你搞到手了帕！                       │   │
│            │  ├────────────────────────────────────────┤   │
│            │  │ 当前装备遗器              暂无评级  🔍 │   │
│            │  │ [槽1][槽2][槽3][槽4][槽5][槽6]          │   │
│            │  │ ⚠ 主属性不匹配                        │   │
│            │  ├────────────────────────────────────────┤   │
│            │  │ 推荐套装（高使用率）        评级 S ⓘ  │   │
│            │  │ [套装×4][套装×2]   解释  复制配置     │   │
│            │  │ 有效副属性 22 · 来源：社区语料 v4.7    │   │
│            │  └────────────────────────────────────────┘   │
│ [更换衣装] │                                                 │
│ [开启新对话]│ ┌────────────────────────────────────────┐  │
└────────────┴─│ 输入…（引导词条：遗器/光锥/配队/材料）  │发送│──┘
               └────────────────────────────────────────┘
```

### 2.3 对话主流程（状态机）

```
[空会话] 欢迎语 + 4 个引导词条（选角色 → 遗器/光锥/配队/材料）
   │ 用户输入
   ▼
意图路由：闲聊 / 攻略 / 帕姆问问咨询 / 越界（写代码、时政、账号安全）→ 世界观内拒绝
   ├─ 闲聊 → 直接流式文本（人设化，可带 1 个轻卡片）
   └─ 攻略 → 实体解析（别名/错字/简称）
        ├─ 角色缺失 → 追问「你想问哪位乘客帕？」+ 角色快速选择器
        ├─ 角色存在 → 工具链：get_character → get_build / get_team / get_materials
        │              └ 语料混合检索（补机制解释、版本注意点）
        └─ 输出：口癖开场白（≤120 字）→ 卡片事件 → 出处 chips
   ▼
卡片动作：查看（详情）/ 解释（再调一次 LLM，只讲理由）/ 复制配置（toast）/ 出处跳转
   ▼
追问：保持上下文，自动补全主语；「那遗器呢」→ 沿用上一个角色
异常：模型超时/失败 → 降级「预设卡 + 帕姆口吻说明 + wiki 链接」，绝不空屏
```

### 2.4 四类数据卡片（生成式 UI，服务端产结构、前端渲染）

| 卡片 | 内容 | 网页版动作 |
| --- | --- | --- |
| `relicCard` 遗器 | 双栏：当前装备（可选）↔ 推荐套装；评级 S/A/B + 有效副词条数；主词条不匹配红警；来源标签 | 查看 / 解释 / **复制配装** |
| `lightconeCard` 光锥 | 同命途可选光锥列表（含获取途径、叠影建议）+「只显示可获得」开关 | 查看 / 复制 |
| `teamCard` 配队 | 2~4 套阵容（4 人位，含定位标签），标注"骨架/变体"与版本 | 复制 / 解释 |
| `materialCard` 材料 | 晋阶+行迹材料清单（数量合计）+ 掉落来源（拟造花萼·地点/周本/商店） | 复制清单 |
| `quizResult` 答题结果 | 分数、标签、点评 | 分享图（P2） |

> 卡片契约用 Zod 定义（与服务端工具返回值共用同一 schema），存进消息 `parts`，刷新后可复原。

### 2.5 「帕姆问问」玩法（还原 + 网页化）

- **周主题**：每周一个主题（如「味觉故障的天才」），从 `corpus/quiz/` 按 tag 抽题。
- **10 题**：3 选 1，难度分 3 档（常识 / 进阶 / 考据），答对连击升档；**完成即得徽章（替代 50 星琼）**。
- **即时反馈**：每题答完给 1~2 句讲解（来自题库 `explanation`，不由 LLM 现编）。
- **结果页**：分数 + 2~3 个趣味标签（如「七分熟的开拓者」）+ 帕姆短评（模板 + 变量，LLM 只写 ≤60 字且不编事实）。
- **彩蛋**：保留「暂时离开」→ 跳回聊天并预填"帮我查一下这题：…"，做成成就「以子之矛攻子之盾」。
- **可复现**：每周题组由 `quiz/weeks/2026-W47.yaml` 固定，种子随机化，避免每次不同题。

### 2.6 帕姆人设卡（写成 `corpus/persona/pampam.yaml`，社区可提 PR）

- **身份**：星穹列车列车长、官方吉祥物；称呼用户「开拓者」，自称「帕姆」，对列车成员用昵称（姬子姐姐、丹恒乘客、三月七）。
- **口癖**：「帕」字结尾或句中，**每条 0~2 次**（禁止每句都加）；颜文字/符号 `帕！/ 帕…… / (◕ ◡ ◕) / ✧ / ♪` 按情绪用，不滥用。
- **语气**：认真、守规矩、对开拓者温和；不谄媚、不说"作为 AI 助手"、不用"希望对你有帮助"这类客服腔。
- **长度**：文本部分 ≤120 字（卡片承载信息）；追问可 1~3 句。
- **知识边界**：不确定 → 「这个帕姆得去查查，先看看这张卡帕」；未上线内容 → 世界观内萌混过关；**不编版本号/卡池时间/数值**。
- **红线**：涉政涉黄、账号交易、外挂、现实人物评价 → 列车长口吻拒绝；剧透 → 折叠提示。
- **自检 lint**（CI 正则 + LLM judge）：口癖频率、长度、客服腔词表、是否出现"AI 助手"自述。

### 2.7 合规与免责（必须做，且要显眼）

- 页脚与对话头常驻：「**非官方粉丝复刻项目，与米哈游/《崩坏：星穹铁道》无关；AI 生成内容仅供参考**」。
- 不复刻"帕姆帮帮（测试版）"标识与官方 logo；UI 风格模仿但**自制所有图形**。
- 星琼/黑塔债券等游戏经济元素 → 页面内替换为「徽章/好感度」（避免与真实游戏混淆）。
- 语料许可：代码 MIT；语料 CC BY-SA 4.0（需署名 + 保留来源链接）；数据来自 StarRailRes（AGPL-3.0，见 §5.1 风险）。

---

## 3. 技术栈选型

### 3.1 结论表

| 层 | 选型 | 版本（当前最新） | 一句话理由 |
| --- | --- | --- | --- |
| 运行时 | Node.js | 24.19.0（本机已有） | 原生 `node:sqlite` 带 FTS5（已实测），省编译依赖 |
| 包管理 | pnpm | 12.11.2 | 本机已装；npmmirror 源可用 |
| 全栈框架 | **Next.js（App Router）** | 16.4.6 | 一个进程搞定页面 + SSE API + 脚本；本地/部署一套代码 |
| UI | React + TypeScript | 19.3.1 / TS 7.0.2（不兼容则回退 5.9.3） | 生态与流式渲染生态最成熟 |
| 样式 | **Tailwind CSS 4** + shadcn/ui + framer-motion | 4.3.5 / 4.23.0 | 游戏化视觉定制快；组件可复制进仓库改 |
| LLM | **任意 OpenAI 兼容接口**（默认 DeepSeek） | `openai` 7.57 / `@ai-sdk/openai-compatible` 3.0.92 | 你说的"其他 OpenAI 兼容接口"；换 provisioner 只改 env |
| LLM 封装 | Vercel **AI SDK 7**（`streamText` + tools + UIMessage parts） | `ai@7.0.173` | 流式 + 工具调用 + 前端 `useChat` 一条龙，省 2~3 天 |
| 数据库 | **SQLite**（better-sqlite3 + Drizzle ORM；`node:sqlite` 作后备） | 13.2.0 / 0.45.4 | 单文件、零运维、可整体备份；本地优先 |
| 全文检索 | SQLite **FTS5** + 实体归一化 + 游戏词典最大匹配/单双字切分（`@node-rs/jieba` 可选） | 内置 | 实测：`unicode61` 中文整句成词、`trigram` 对 2 字名失效 → 必须预分词 |
| 向量检索 | **sqlite-vec**（0.1.9）+ OpenAI 兼容 `/embeddings` | 0.1.9 | 与 FTS5 同库同文件；后期可换 pgvector |
| 校验 | Zod 4 | 4.6.7 | 工具入参 / 卡片契约 / 语料 frontmatter 共用 |
| 测试 | Vitest 5 + Playwright 1.65（可选） | 5.1.0 | 检索/工具/人格单测 + 3 条 E2E 冒烟 |
| 字体 | @fontsource/noto-serif-sc | 5.3.1 | 游戏感靠衬线标题；本地自托管，不依赖 Google Fonts |

### 3.2 为什么不是别的

| 备选 | 否决理由 |
| --- | --- |
| FastAPI + React 双进程 | Python 的 RAG 生态更好，但两套依赖/两个进程/部署翻倍；本项目检索规模 <10 万块，Node 足够 |
| Vite + Express 手搓 | 流式 UI、路由、构建都要自己拼；Next 的 App Router + AI SDK 直接给到 |
| 直接用游戏内数据 API（米游社/HoYoLab） | 需 cookie + DS 签名，反爬强、账号风险高、违反 ToS，放弃 |
| 向量库用 Chroma/Qdrant/Docker | 本地单用户场景是过度设计；sqlite-vec 一个文件解决，且能平滑切 pgvector |
| 本地跑开源模型（Ollama） | 本机 8 核 / 7GB 无 GPU，只能跑小模型，人设与攻略质量会崩；不如用 API |
| Vercel 部署 | 目标环境无持久磁盘，SQLite 写不了；本地优先 + Docker/自托管更合适（预留 DAO 抽象，将来可换 Turso） |

### 3.3 依赖清单（初版，M0 锁定）

```jsonc
// dependencies
"next": "16.4.6", "react": "19.3.1", "react-dom": "19.3.1",
"ai": "7.0.173", "@ai-sdk/openai-compatible": "3.0.92",
"better-sqlite3": "13.2.0", "drizzle-orm": "0.45.4", "sqlite-vec": "0.1.9",
"zod": "4.6.7", "tailwindcss": "4.3.5", "framer-motion": "14.14.0",
"lucide-react": "1.73.0", "sonner": "2.0.8",
"@fontsource/noto-serif-sc": "5.3.1"
// devDependencies
"typescript": "7.0.2", "vitest": "5.1.0", "tsx": "4.23.15", "@playwright/test": "1.65.1"
```

---

## 4. 系统架构

### 4.1 总览

```
┌─────────────────────────── 浏览器 (React 19) ───────────────────────────┐
│ ChatShell  ── useChat(SSE) ──> MessageList ──> CardRegistry{4 类卡片}    │
│ QuizFlow   ── /api/quiz/* ──> QuizPage / ResultPage                     │
└───────────────┬──────────────────────────────────────────┬──────────────┘
                │ POST /api/chat (SSE: text-delta|data-card)│
┌───────────────▼──────────────────────────────────────────▼──────────────┐
│ Next.js 服务端                                                            │
│  ├─ Agent Runtime: streamText(model, tools, system) + 工具循环(≤3 轮)     │
│  │    工具: resolveEntity / getCharacter / getBuild / getTeam            │
│  │          / getMaterials / searchCorpus / saveMemory                   │
│  ├─ Retrieval: query 归一化 → 别名扩展 → FTS5(BM25) + 向量 → RRF → top8  │
│  ├─ Persona: persona.yaml → system prompt + few-shot + 口癖/长度约束      │
│  ├─ Memory: 会话最近12条 + 每10轮摘要 + 长期偏好表                        │
│  └─ Quiz: 题库选组 → 判分 → 标签/点评生成                                 │
├───────────────────────┬───────────────────────────┬─────────────────────┤
│ data/pompom.sqlite    │ data/index.sqlite          │ corpus/*.md (仓库)  │
│ 游戏结构化数据+会话    │ chunks + FTS5 + vec        │ 校正/增量/题库/人格  │
└───────────────────────┴───────────────────────────┴─────────────────────┘
      ▲            ▲                  ▲                ▲
      │data:sync   │                  │corpus:index    │（合并进索引）
StarRailRes 4.7    BWIKI（仅 POST 可抓）  └── 切块 + 词典分词 + 批量 embedding
```

### 4.2 模块职责

| 模块 | 路径 | 职责 | 不做什么 |
| --- | --- | --- | --- |
| Agent | `src/lib/agent/` | 工具定义与循环、系统提示组装、流式 parts 输出、降级 | 不直连 DB SQL、不拼 HTML |
| Tools | `src/lib/tools/` | 7 个纯函数（入参 Zod → 出参 Zod），可单测 | 不调 LLM |
| Retrieval | `src/lib/retrieval/` | 归一化/别名/分词/BM25/向量/RRF/去重 | 不做生成 |
| Data | `src/lib/db/` | schema、迁移、查询封装（DAO 接口，可换驱动） | 不含业务判断 |
| Corpus | `scripts/corpus-*` + `scripts/wiki-sync` + `corpus/` | 校验、抓取、切块、嵌入、构建索引 | 不做运行时写 |
| Persona | `src/lib/persona/` | 人设 prompt、few-shot、输出 lint | 不越权改事实 |
| UI | `src/components/` | 聊天/卡片/答题/设置 | 不含业务逻辑 |
| Quiz | `src/lib/quiz/` | 题组选择、判分、标签规则 | 不依赖 LLM 判对错 |

### 4.3 一次攻略问答的时序

```
用户: "流萤带什么遗器？"
 1. POST /api/chat  ── 写 messages(user)
 2. 意图/实体: resolveEntity("流萤") → {id:1310, name:流萤}
 3. LLM 第一轮: tool_calls = [getBuild(1310)]        
 4. Tool: 查 corpus/builds/1310.yaml（社区语料）+ 用结构化数据校验光锥命途/套装存在性
         + searchCorpus("流萤 遗器 击破") → 8 chunks
 5. LLM 第二轮: 生成 {text: "啦嗯！…帕！", cards:[relicCard…], citations:[…]}
 6. SSE 输出: text-delta* → data-card(relicCard) → data-citations
 7. 前端: 气泡打字机 → 卡片入场 → 出处 chips
 8. 落库 messages(assistant, parts) + 更新摘要/计数
```

### 4.4 仓库结构

```
pompom-helphelp/
├─ src/
│  ├─ app/                    # /, /quiz, /settings, /about, api/{chat,quiz,feedback,health}
│  ├─ components/
│  │  ├─ chat/  (ChatShell, MessageList, Bubble, Composer, TypingIndicator)
│  │  ├─ cards/ (RelicCard, LightconeCard, TeamCard, MaterialCard, CitationChips)
│  │  ├─ quiz/  (QuizStart, QuizQuestion, QuizResult, TagChip)
│  │  └─ ui/    (shadcn 组件)
│  ├─ lib/     (agent, tools, retrieval, db, persona, quiz, memory, env, logger)
│  └─ styles/
├─ corpus/                    # 语料即代码（社区贡献入口）
│  ├─ aliases.yaml            # 别名/黑话词典
│  ├─ persona/pampam.yaml     # 人设卡
│  ├─ characters/*.md         # 角色攻略（补充结构化数据讲不清的）
│  ├─ builds/*.yaml           # 配装（遗器/光锥/词条优先级）
│  ├─ teams/*.yaml            # 配队模板（按 archetype）
│  ├─ guides/*.md             # 机制/系统/新手 FAQ
│  ├─ world/*.md              # 世界观/版本活动（帕姆问问素材）
│  └─ quiz/weeks/2026-W47.yaml# 每周题组
├─ scripts/                   # sync-data / check-corpus / build-index / eval / fetch-icons(可选)
├─ data/                      # gitignored: pompom.sqlite, index.sqlite
├─ eval/                      # 60 题评测集 + 基线报告
├─ docs/                      # plan.md / research/ / adr/
├─ refs/                      # 参考截图（研究用）
├─ public/                    # 自绘 SVG、字体、OG 图
├─ .env.example  Dockerfile  README.md  LICENSE  CONTRIBUTING.md
```

---

## 5. 数据层与 RAG

### 5.1 数据源实测（本机实测；完整记录见 [data-sources.md](research/data-sources.md)）

| 来源 | 实测 | 结论 | 用途 |
| --- | --- | --- | --- |
| **StarRailRes**（Mar-7th）`index_min/cn/*.json` | raw / jsDelivr / ghfast 全 **200**；`info.json`=`4.7.0` | ✅ **数值主源**：99 角色 / 172 光锥 / 64 遗器套 / 4,141 物品；含 `nickname.json` 别名表、`items.json.come_from` 刷取点 | 角色/行迹/晋阶/光锥/遗器/材料/别名 |
| **BWIKI** `wiki.biligame.com/sr/api.php` | ⚠️ GET=**567**（EdgeOne WAF）；**POST=200**（连续 5/5，1.3–3.3s/次） | ✅ **中文攻略文本唯一可用源**：角色图鉴 103 页 / 角色攻略 87 页（7 段固定结构）/ 光锥 173 / 遗器 65 / 材料 202 / 关卡 91 / 攻略长文 22 | 配装/配队/机制/世界观语料 |
| `nickname.json`（StarRailRes） | 200，13.7KB | 100 角色 + 172 光锥 + 64 遗器套别名（银狼→小板鸭、遗器套→治疗套）；「欢愉主/龙丹/记忆主」缺 | 别名表基础 |
| fandom HSR wiki API | 200（英文 17,466 条） | 🔵 P2 英文兜底/交叉验证 | — |
| enka.network API | 200 | 🔵 P2 玩家展示柜（非知识库），可做「我的角色」 | — |
| kel-z/HSR-Data、npm `dsh-hsr`（MIT） | 200 | 🔵 P2 许可友好兜底/交叉校验（数据滞后或不全） | — |
| hakush.in | **000**（TLS reset） | ❌ 本机不可达（需代理） | 不用 |
| Prydwen / HoneyHunter / huijiwiki | **403**（Cloudflare/地区） | ❌ | 不用 |
| 米游社 / 官方站 / yatta | 000 / 000 / 404 | ❌ | 不用 |
| 萌娘百科 | 400 | ❌ | 不用 |

**关键洞察**：**结构化数值（StarRailRes）+ 中文攻略（BWIKI POST）双源都拿到了**。"材料 / 遗器 / 光锥"可做到"精确数值 + 攻略解释"双轨；配队/词条从 BWIKI 87 页「角色攻略」（7 段固定结构，含低配→高配配队表）直接结构化。**语料不是从零自建**——corpus-as-code + 社区贡献的定位从"补全唯一来源"变成"**校正、增量、扩展**"（新版本先行内容、黑话、builds/teams 的结构化、题库、人格话术）。

**两个必须记住的坑**：
1. **BWIKI 只能 POST**：`fetch(url,{method:'POST',body:new URLSearchParams({action:'query',...})})`；响应无 CORS 头 → 只能服务端抓，浏览器直连会被拦。
2. **抓取礼仪**：单日 ≤300 请求、间隔 ≥2s、带 UA、不抓 `File:`/图片/用户页、按 `revid` 缓存去重、失败 3 次告警并跳过。

**许可风险**：StarRailRes **AGPL-3.0**（上游 Dimbreath/StarRailData 无 LICENSE）；BWIKI **未声明 CC**（正文含游戏原文）。对策：
- 数据/语料**不 vendor 进 git**，只由 `pnpm data:sync` / `pnpm wiki:sync` 落到 `data/`（gitignored）；
- 对外只输出「事实 + 短引用（每段 ≤100 字）+ 出处链接」，不镜像图片、不整包分发 JSON；
- 若公开部署：项目整体改 AGPL-3.0，或与源方沟通授权；README/页脚标注来源。

### 5.2 摄入管线（两源两条命令）

```bash
pnpm data:sync   # ① StarRailRes 数值（index_min/cn）
  ├─ 读 info.json（4.7.0）；版本变了才全量，否则增量
  ├─ 拉：characters / character_promotions / character_skill_trees / character_skills /
  │        light_cones / light_cone_ranks / relic_sets / relic_*_affix* / items / nickname
  ├─ 归一化 → SQLite（§8.4 schema）
  └─ 派生：角色→晋阶/行迹材料清单（含数量）、材料→掉落来源、材料→使用角色反查

pnpm wiki:sync   # ② BWIKI 攻略语料（POST + 限速 ≥2s + 增量）
  ├─ 按模板批量抓：角色图鉴 103 / 角色攻略 87 / 光锥 173 / 遗器 65 / 材料 202 / 关卡 91 / 攻略长文 22
  ├─ wikitext 解析：模板参数→字段；清洗 {{黑幕|}} {{#info:}} {{颜色|}} <br>
  ├─ 对齐：以「名称」对齐 StarRailRes id；wiki 已有 4.8 角色（艾莲/耀嘉音）而 StarRailRes 仍 4.7
  │        → 名册以 wiki 为准，数值缺失标「待补」，绝不编数
  ├─ 分块（§5.5）→ chunks（继承 entity_id / section / revid / source_url）
  └─ 写 data/index.sqlite；`list=recentchanges` 增量，按 revid 去重
```

**版本策略**：StarRailRes 每 5~6 周随版本更新（实测 4.5→4.6→4.7）；BWIKI 编辑更活跃（当天仍在改）。每日探测一次 `info.json`；回答上下文带 `data_version`，超过 1 个版本的数据打「可能已过期」标记而非删除。

### 5.3 语料即代码（corpus-as-code）+ 社区贡献 ★

**这是本项目"可维护、支持社区贡献的 RAG 知识库"的核心机制。** wiki 抓取给基线，`corpus/` 给校正、增量与结构化，两者合并进同一份索引。

- 每个条目 = 一个 Markdown / YAML 文件 + frontmatter，提交即入库（wiki 原文不进 corpus，只存"整理结果 + 出处"）：

```markdown
---
id: builds/1310
type: build              # character|build|team|guide|world|quiz|faq
title: 流萤 配装建议（4.7）
character_id: "1310"
version: "4.7"
tags: [击破, 火属性, 主C]
source:
  - https://wiki.biligame.com/sr/…（保留出处，不转全文）
  - 社区实测 2026-11
confidence: community   # community | derived | curated
updated: 2026-11-16
license: CC-BY-SA-4.0
---
## 遗器
- 4 件套：…
- 主词条：躯干 暴击率 / 脚部 速度 …
- 副词条优先级：…
## 光锥
| 光锥 | 适配度 | 说明 |
…
```

- **贡献流程**：Fork → 新增/修改 `corpus/**` → 本地 `pnpm corpus:check`（Zod schema + 规则：必须有 source、version、license、禁整篇转载、禁图片、id 唯一）→ PR（CI 自动校验 + 构建索引 + 预览检索效果）→ 人工 review（内容准确性、版本时效）→ 合并后索引重建。
- **运行时只读**：部署形态下索引是构建产物，不允许多用户写库；投稿只走 PR（P2 再做网页投稿 → 自动开 PR）。
- **版本化**：每条语料带 `version`；检索时按当前游戏版本过滤（`WHERE version <= 4.7`），过时语料自动降权而非删除。
- **置信度分层**：`curated`（人工审过）> `derived`（从结构化数据推导）> `community`（玩家提交）> `none`（模型推断）→ 卡片上显示来源徽标，用户可判断可信度。这直接回应原版"AI 生成可能出错"的问题。

### 5.4 向量库选型

| 方案 | 形态 | 适合度 | 结论 |
| --- | --- | --- | --- |
| **sqlite-vec** | SQLite 扩展，单文件 | 1k~100k chunks 无压力；与 FTS5 同库；无需服务 | ✅ **选它**（本地优先 + 预留部署） |
| LanceDB | 嵌入式列存 | TS SDK 好，向量原生；但多一套存储 | 备选（语料 >10 万块再换） |
| pgvector | Postgres | 多人部署最顺 | P3（DAO 抽象已预留） |
| Chroma / Qdrant | 独立服务/Docker | 本地单用户过重 | ❌ |

**Embedding 供应**：走 OpenAI 兼容 `/v1/embeddings`（`EMBEDDING_BASE_URL/KEY/MODEL`）。**注意 DeepSeek 不提供 embedding 接口**（`/models` 可达但无 embedding），向量轨必须另配：`api.siliconflow.cn`（本机可达，`BAAI/bge-m3`；第三方文档称有免费档，以控制台为准）或 `api.openai.com`（`text-embedding-3-small`，$0.02/M）。**若两者都没有 → 自动降级 BM25-only**，索引跳过向量列，不阻塞 MVP。
**成本（实测估算）**：清理后语料 ≈1.2~1.5M 中文字 → 6k~8k chunks × ≈350 token ≈ 2.5~3M token → 全量重建 **$0.05~0.06**（或免费档）；存储 1024 维 f32 ≈ 4KB/块 → 约 32MB；版本增量重建 ≈ $0.01/次。
**本地兜底（可选）**：`bge-small-zh-v1.5` ONNX int8 ≈25MB，8 核 CPU 约 10~30 块/s，8k 块 10~15 分钟建完；`bge-m3`（568M）CPU 推理太慢，只适合离线建库。本机无 GPU、无 ollama，本地向量仅建议离线使用。

### 5.5 混合检索（Hybrid，按实测设计）

**实测结论先行**（详见 data-sources.md §5）：
- FTS5 默认 `unicode61` 把整句汉字当一个 token → 查「黄泉」**0 命中**；`trigram` 只在 ≥3 字生效 → 「黄泉/银狼/流萤」等 **2 字角色名全部失效**。
- **jieba + 游戏自定义词典预分词 + 空格连接**最稳；不载词典会把「遗器→遗/器、行迹→行/迹」切碎。
- 整句 AND 检索必挂（「龙丹带什么」= 0 命中）→ **必须先做实体 + 意图抽取**，再进检索。

```
query
 ├─ ① 归一化：繁→简（OpenCC）、全半角、去语气词
 ├─ ② 实体识别：最长匹配 alias → {kind,id,canonical}（龙丹 → 丹恒·饮月）
 ├─ ③ 意图：养成 / 遗器 / 光锥 / 配队 / 材料 / 版本 / 闲聊
 ├─ ④ 关键词通道：FTS5(bm25)，`tokenized` 列 = 游戏词典最大匹配 + 单/双字兜底
 │        （词典 = StarRailRes 全部角色/光锥/遗器/术语名 ≈500–1000 词；标题权重×3）
 ├─ ⑤ 向量通道（P1）：embed(query) → sqlite-vec top 30
 ├─ ⑥ 按 intent/entity/section 过滤 → RRF(k=60) → 去重 → 版本过滤 → top 8
 └─ ⑦ 拼上下文：[C1] 标题/章节 + 正文 + 来源URL + revid（预算 ≤4k token）
```

分词选型（Node 侧，不引 Python 进程）：

| 方案 | 实测表现 | 说明 |
| --- | --- | --- |
| **游戏词典最大匹配 + 单/双字兜底（纯 TS）** | ✅ 最稳 | 词典从 StarRailRes 名称自动生成；无词典时退化为双字切分（实测「流萤 击破」命中 2/2） |
| `@node-rs/jieba`（npm 200，预编译） | ✅ 准 | 需带自定义词典；多一个原生依赖 |
| `Intl.Segmenter` | 🔶 银狼→银/狼、遗器→遗/器 | 零依赖兜底；同器同分仍可 AND 命中但噪音大 |
| MiniSearch 默认 tokenizer | ❌ 中文 0 命中 | 必须自定义 tokenize |

不做 rerank（P2 可选，需服务商支持 `bge-reranker`）；top 8 + 结构化校验已足够。

### 5.6 别名/黑话（原版亮点，必须做）

- **三源合并**：① StarRailRes `nickname.json`（100/172/64 组，实测「银狼 → 小板鸭/酷鸭/超级骇客」）② BWIKI 角色图鉴「昵称/外号」字段（103 页中 87 页有值：「花火→火子姐、流萤→萨姆、丹恒→冷面小青龙」）③ 手工词典 50~150 条补缺口（「欢愉主/龙丹/记忆主/大鸭」等 4.7+ 黑话 + 繁简转换）。
- `corpus/aliases.yaml` 只存**增量与校正**，构建时与上面三源合并成 `alias → {kind,id,canonical}` 表。
- 实现：**最长匹配**替换（避免子串误伤），命中时给 LLM 一句「（别名：火花 → 花火）」；错字/谐音（火花→花火）用编辑距离兜底。

### 5.7 检索评测

- `eval/questions.yaml`：60 题，分 4 类（角色养成 20 / 遗器光锥 15 / 配队 10 / 机制世界观 15），每题带期望实体与期望关键词。
- 指标：**实体命中率**、**引用覆盖率**（回答含出处）、**幻觉率**（LLM judge 对照语料判定，抽查 20）、**人格通过率**（口癖/长度/客服腔）、**P50/P95 延迟**。
- 基线存 `eval/baseline.json`，每次改 prompt/语料跑 `pnpm eval` 出对比表（写进 M5 验收）。

---

## 6. Agent 设计

### 6.1 工具清单（全部确定性，Zod 校验，strict）

| 工具 | 入参 | 出参（摘要） | 说明 |
| --- | --- | --- | --- |
| `resolve_entity` | `query: string` | `{kind, id, name, alias_hit, candidates[]}` | 别名/错字/模糊匹配；歧义时返回候选让模型追问 |
| `get_character` | `id` | 命途/属性/定位/晋阶材料/行迹材料/技能摘要 | 来自结构化表 |
| `get_build` | `id, mode: "general"\|"meta"` | `{relics, lightcones, stat_priority, confidence, sources[]}` | 语料优先；无则规则推导（命途→套装族）+ 标 `derived` |
| `get_team` | `id? / archetype?` | `{teams:[{slots, note, version}]}` | 配队模板语料 |
| `get_materials` | `id` | `{items:[{name, count, sources[]}]}` | 晋阶+行迹合并；`come_from` 给刷取点 |
| `search_corpus` | `query, k=8` | `chunks[]`（含来源） | 混合检索；模型可多次调 |
| `save_memory` | `note, kind` | `{ok}` | 用户偏好（常用角色/称呼/禁忌），P1 |

> 工具数控制 ≤7，避免模型选择困难；每个工具的 description 写清"什么时候用/什么时候不要用"。

### 6.2 循环与降级

- `maxSteps: 4`（工具轮次 ≤3），单轮墙钟 ≤25s，超时降级。
- 无工具可调 → 直接人设回复；工具报错 → 把错误当 tool 结果回填让模型自然处理（"帕姆没查到…"）。
- 模型不可用/超时：返回预置降级卡（按实体给出 wiki 链接与通用建议）+ 帕姆口吻道歉。
- 内容安全：请求前规则过滤（涉政/账号/外挂词表）→ 命中走固定拒绝话术，不调模型。

### 6.3 流式协议与卡片事件

用 AI SDK 的 `UIMessage` parts 语义（持久化友好）：

```ts
type Part =
  | { type: "text"; text: string }
  | { type: "data-card"; data: Card }        // Card = relic|lightcone|team|material 判别联合
  | { type: "data-citations"; data: Source[] }
  | { type: "data-status"; data: { stage: "retrieving"|"thinking"|"writing" } };
```

服务端 `streamText` + `tools`（工具结果里直接返回结构化 payload），再映射成 parts 推给前端；前端按 `data-card` 用注册表渲染。落库存整个 parts 数组 → 刷新可复原。**卡片不靠模型写 HTML/Markdown**，杜绝注入与格式崩坏。

### 6.4 记忆（对应原版"多轮长线记忆"）

- **会话内**：最近 12 条原文（含上一张卡片的摘要，保证"那遗器呢"能接上）。
- **滚动摘要**：每 10 轮用 flash 模型压缩 ≤200 字，存 `summaries`。
- **长期偏好**：`memories` 表（常用角色、称呼、喜欢/讨厌的话题），端点 `/settings` 可查看/删除。
- **跨会话召回**（P2）：按 embedding 相似度召回旧结论，需用户开启。

### 6.5 Prompt 结构（分层，便于替换模型）

```
[系统-人格] persona.yaml + few-shot（官方语气样例 3~5 条）
[系统-规则] 工具使用策略 / 输出格式 / 口癖限度 / 不知道就说 / 禁止事项
[系统-上下文] 当前版本 4.7 / 玩家档案（若有）/ 记忆摘要
[检索上下文] corpus chunks（编号 + 来源）
[历史] 最近 12 条 + 摘要
[用户] 问题
```

### 6.6 成本与护栏

- 单轮 token：system ≈1.2k + 8 chunks ≈3.6k + 历史 ≈1.2k + 工具 ≈0.8k ≈ **6.8k in / 0.4k out**。
- 按 deepseek-flash 峰值价（$0.3/M 入、$1.2/M 出）≈ **$0.0025/轮**；1000 轮 ≈ $2.5。上下文缓存可再降（稳定前缀）。
- 护栏：`MAX_TOOL_ROUNDS=3`、`MAX_CHUNKS=8`、`MAX_HISTORY=12`、单 IP 20 req/min、单会话 200 轮上限、`/api/chat` 总超时 60s。

---

## 7. 前端实现要点（还原游戏内 UI 风格）

### 7.1 视觉 token

```css
--bg-deep: #0b1026;      /* 深夜蓝 */
--bg-panel: #141a38;     /* 面板 */
--paper: #f6efe2;        /* 气泡纸质感 */
--gold: #d9b46a;         /* 金色描边/分隔 */
--gold-soft: #8a6d3b;
--crimson: #b5343f;      /* 帕姆制服红 / 警示 */
--teal: #7fd1c8;         /* 评級 S / 正确 */
--ink: #2a2320;          /* 纸面文字 */
--radius: 14px;  --shadow: 0 8px 24px rgba(0,0,0,.35);
字体：标题 = Noto Serif SC（自托管子集），正文 = system-ui / Noto Sans SC
```

### 7.2 关键实现

- **左立绘**：自绘帕姆 SVG（列车长帽 + 白胡子 + 大眼 + 红制服），分层支持换装（帽子/礼服/围裙三个 slot）；`<PomPomAvatar outfit="dress" />`。官方截图只做参考比例。
- **气泡**：帕姆侧纸底圆角 + 左下尖角 + 金细边；用户侧暖橙渐变 + 右对齐；入场 framer-motion（y 8→0, opacity）。
- **流式文本**：`useChat` 增量 part；打字机效果用 CSS `::after` 光标，不逐字 setState（性能）。
- **卡片**：统一 `ToolCard` 壳（标题 + 右侧徽标/动作位 + 底部小字"来源"），内嵌 4 种内容；卡片入场 150ms 上浮；`查看/解释/复制` 用 shadcn `Dialog`/`Tooltip`/`toast`。
- **响应式**：<900px 左栏折叠为顶部头像条；卡片横向滚动；输入区 fixed bottom + `env(safe-area-inset-bottom)`。
- **无障碍**：焦点环、`aria-live` 流式文本、对比度 ≥4.5:1。
- **空态/错误态**：4 个引导词条（配队/遗器/光锥/材料）+ 角色快捷选择器。

### 7.3 素材合规

默认只用自制 SVG/纯 CSS 图形 + 通用图标（lucide）；官方遗器/光锥图标不打包。`public/outfits/` 留空槽位，README 说明"可自行放置同人图用于本地学习"。

---

## 8. 工程与质量

### 8.1 环境变量（`.env.example`）

```bash
# --- LLM（任意 OpenAI 兼容）---
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_API_KEY=sk-...
CHAT_MODEL=deepseek-flash
# --- Embedding（可选，缺失则降级 BM25-only）---
EMBEDDING_BASE_URL=            # 留空 = 复用 OPENAI_BASE_URL
EMBEDDING_API_KEY=             # 留空 = 复用 OPENAI_API_KEY
EMBEDDING_MODEL=               # 例：BAAI/bge-m3
EMBEDDING_DIM=1024
# --- 运行时 ---
DATABASE_PATH=data/pompom.sqlite
INDEX_PATH=data/index.sqlite
GAME_VERSION=4.7
MAX_TOOL_ROUNDS=3
MAX_CHUNKS=8
SITE_TITLE=帕姆帮帮（非官方复刻）
```

### 8.2 脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm data:sync` | 拉 StarRailRes 4.7.0 数值 → 归一化 → `data/pompom.sqlite` |
| `pnpm wiki:sync` | POST 抓 BWIKI 约 720 页攻略 → 解析/对齐/切块 → 增量写索引 |
| `pnpm corpus:check` | 校验 `corpus/**`（Zod + 规则） |
| `pnpm corpus:index` | 合并 wiki chunks + corpus → 词典分词 → FTS5 + 批量 embedding → `data/index.sqlite` |
| `pnpm quiz:build` | 校验本周题组、生成周主题清单 |
| `pnpm eval` | 跑 60 题评测出报告 |
| `pnpm dev` / `pnpm build` / `pnpm start` | 本地/构建/生产 |

### 8.3 测试

- **单测（Vitest）**：CJK tokenizer、RRF、别名最长匹配、工具 schema、quiz 判分、persona lint（正则）。
- **评测（eval）**：§5.7，需真模型。
- **E2E（Playwright，可选）**：发消息→出卡片、答题全流程、设置清除数据。
- **CI（GitHub Actions）**：typecheck + lint + test + corpus:check + build；语料 PR 额外跑 index 构建与 5 题抽样检索。

### 8.4 SQLite schema（初稿）

```sql
-- 游戏结构化数据（data:sync 重建）
characters(id PK, name, rarity, path, element, tag, version)
character_promotions(char_id, level, materials_json)
character_skill_trees(char_id, node, materials_json)
light_cones(id PK, name, rarity, path, version)
relic_sets(id PK, name, effects_json, version)
relic_affixes(slot, type, stats_json)
items(id PK, name, rarity, type, sub_type, come_from_json)

-- 应用状态
sessions(id PK, title, created_at, updated_at)
messages(id PK, session_id, role, parts_json, created_at)
summaries(session_id PK, text, upto_msg_id)
memories(id PK, kind, text, created_at)
feedback(id PK, message_id, rating, reason, created_at)
quiz_weeks(week PK, theme, question_ids_json)
quiz_attempts(id PK, week, score, answers_json, created_at)

-- 语料索引（data/index.sqlite，corpus:index 重建）
chunks(id PK, corpus_id, title, heading_path, text, tokenized, source_url, version, tags_json, license)
chunks_fts USING fts5(tokenized, title, content='chunks', content_rowid='id')
chunks_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[DIM])
```

### 8.5 部署形态（预留）

- 本地：`pnpm dev` / `pnpm build && pnpm start`（监听 127.0.0.1:3000）。
- 自托管：多阶段 `Dockerfile`（node:24-alpine），volume 挂 `data/`，`/api/health` 探活；可选 Caddy 反代 + Basic Auth（家庭局域网）。
- **不选 Vercel**：无持久盘。若将来必须上，`src/lib/db` 的 DAO 接口可换 Turso/libSQL，向量换 pgvector（已预留抽象）。

---

## 9. 里程碑与验收

| # | 里程碑 | 交付物 | 验收标准 | 预估 |
| --- | --- | --- | --- | --- |
| **M0** | 技术验证 | spike 分支/脚本 | ① OpenAI 兼容接口流式 + 2 轮工具调用跑通（含 strict 关闭时的容错）② `data:sync` 落库 4.7.0 且能查到流萤材料与刷取点 ③ FTS5 双字切分对 20 个中文查询召回 ≥70% ④ 帕姆人设 prompt 抽 20 条人工评分 ≥3.5/5 | 0.5~1 天 |
| **M1** | 数据与检索底座 | `data:sync`、`wiki:sync`、`corpus:check`、`corpus:index`、`eval/results` | StarRailRes 全量 + BWIKI ≥600 页入库；60 题检索实体命中率 ≥80%；索引构建 <3 分钟；别名 20 词全命中 | 2~2.5 天 |
| **M2** | 聊天 MVP（可玩） | `/` 页面 + `/api/chat` | 能聊、能问 1 个角色的遗器并出卡；流式首字 <2.5s；免责声明常驻；刷新后消息仍在；3 个引导词条可用 | 2 天 |
| **M3** | 实用卡片 | 4 类卡片 + 复制/解释 | 遗器/光锥/配队/材料各 5 个真实问题通过；复制配置可用；出处可点；实体缺失会追问 | 2~2.5 天 |
| **M4** | 帕姆问问 | `/quiz` + 题库 + 结果页 | 10 题流程完整；判分正确；标签/点评符合规则；「暂时离开」彩蛋可用；每周题组可切换 | 1.5~2 天 |
| **M5** | 打磨与交付 | 设置页、评测报告、Dockerfile、README/CONTRIBUTING | 评测集跑出基线报告（幻觉率 <10%、人格通过率 ≥90%）；`docker run` 一条命令起服务；贡献流程文档完整 | 1.5 天 |

> 关键节奏：**M2 结束（约第 4 天）就要有一个能跑、能聊、能出卡的版本**，之后每个里程碑都是增量可演示。

---

## 10. 风险与对策

| 风险 | 概率/影响 | 对策 |
| --- | --- | --- |
| 数据源许可（StarRailRes AGPL-3.0、BWIKI 未声明 CC） | 中/高 | 数据/语料不入 git、仅本地同步；对外只输出事实 + 短引用 + 出处；公开部署时项目整体改 AGPL 或与源方沟通；不打包官方美术 |
| BWIKI 抓取被封（GET 已 567，POST 也可能收紧） | 中/高 | 限速 2~3s、单日 ≤300 请求、revid 缓存、离线快照降级；抓到的语料可导出为可提交的 corpus 快照，封站后仍能跑 |
| 版本漂移（wiki 已有 4.8、StarRailRes 仍 4.7） | 高/中 | 名册以 wiki 为准、数值缺失标「待补」；`data_version` 门控 + 过期提示，不编数字 |
| "社区贡献"带来错误/过时攻略 | 高/中 | frontmatter 强制 source+version；`confidence` 分层；PR review 清单；评测集拦截回归；卡片显示置信度 |
| 模型端点差异（不支持 strict / tool calls 格式不同） | 中/高 | 工具 schema 用宽松 JSON + Zod `safeParse` + 一次重试；`maxSteps` 兜底；M0 用你的真实端点验证 |
| 无 embedding 端点 | 中/低 | 自动降级 BM25-only（结构化数据兜底），索引不阻塞 |
| 幻觉（编造数值/卡池/版本） | 高/高 | 结构化工具优先；语料外不说；「不知道就说」prompt；评测幻觉率门禁 |
| 中文检索召回差 | 中/中 | 双字切分 + 别名 + 向量混合；评测集驱动调参 |
| 帕姆人设 OOC | 中/中 | 人设卡 + few-shot + lint + 人工抽检；口癖频率可调参数 |
| build/配队语料覆盖不足（99 角色） | 高/中 | v1 先覆盖 12~20 热门角色；其余走"规则推导 + 标明置信度 + 去社区查"的诚实降级 |
| 版权/商标（UI 风格、名称） | 中/中 | 非官方声明显眼；自制图形；不用官方 logo；不商用 |
| 本机资源（7GB 内存） | 低/低 | 不跑本地模型；索引构建分批；Next dev 足够 |

---

## 11. 已确认与待拍板

**已确认（2026-11-16 你的选择，已按此实施）**：
- 大模型：**DeepSeek 官方**（`deepseek-flash`，OpenAI 兼容 + tool calling + strict）；key 在 `.env.local`（gitignore）；
- MVP 范围：**核心聊天 + 实用问答 + 帕姆问问**；不做开拓者档案、衣装收集、联网搜索；
- 语料：**放公开仓库、PR 贡献**（`corpus/` corpus-as-code + `corpus:check` 校验 + CI）；
- 角色覆盖：先做**热门角色**（已收录 15 个）；
- 视觉：**还原游戏内 UI 风格**，立绘用你提供的 PomPom 3D 模型（three.js 实时渲染 + 海报降级，不打包官方美术）；
- 部署：**先本地**，架构预留部署能力（SQLite 单文件 + Docker/DAO 抽象）。

**实施状态（v0.1 MVP，已可运行）**：
- ✅ 聊天 `/`（SSE 流式 + 帕姆人设 + 状态提示 + 免责声明）、工具循环（resolve/get_character/get_build/get_team/get_materials/search_corpus）；
- ✅ 4 类卡片（遗器/光锥/配队/材料）+ 出处链接 + 置信度徽标；富文本渲染；
- ✅ 数据管线：`data:sync`（99 角色/172 光锥/64 遗器套/4141 物品/595 别名）、`wiki:sync`（88 角色材料+昵称）、`corpus:index`（32 文档/120 块）；
- ✅ 帕姆问问 `/quiz`（每周 10 题 + 难度 + 即时讲解 + 称号 + 断点续答 + 选项确定性打乱）；
- ✅ 设置 `/settings`（数据版本/模型信息/清除本地数据/免责）；
- ✅ 3D 立绘（`PomPomStage`）+ WebGL 不可用时的海报降级；`/preview` 调试页；
- ✅ 工程：`corpus:check` 0 error、`tsc --noEmit` 通过、生产构建通过、截图回归脚本；
- ⬜ 待办：向量检索（P1，架构已留位）、e2e 测试、Dockerfile、更多角色 build。

**仍待确认**：
1. **向量检索**：DeepSeek 无 embedding 接口；要开向量轨需另配（如硅基流动 bge-m3 / OpenAI 3-small）。要不要现在就接？（默认 BM25-only，已可用）
2. **GitHub 仓库**：代码已可初始化提交，但 `assets/model/` 与 `refs/` 默认 gitignore（版权原因）。你建好远端仓库后我可以推（需你授权/提供远端地址）。
3. **部署**：继续本地即可，还是现在就补 Dockerfile + 反代说明？
4. **模型素材**：海报降级图与 3D 渲染参数如需调整（比例、机位、换装），告诉我具体目标。

## 附录 A · 环境实测记录（2026-11-16 本机）

```
node v24.19.0 / pnpm 12.11.2 / Python 3.10.12（jieba 0.42.1 可装）/ uv / sqlite3 3.37.2 / git / jq
npm registry: npmmirror（可用）；api.deepseek.com 可达（401=需 key，且无 embedding 接口）
node:sqlite FTS5: OK（无需编译原生模块）；SQLite unicode61 对中文整句成词、trigram 对 2 字名失效（实测）
无 key、无 ollama、无 docker；8 核 / 7GB 内存 / 无 GPU；~/.npm 缓存目录只读（装包需指定 `npm_config_cache`）
StarRailRes raw/jsDelivr/ghfast: 200；info.json version=4.7.0；nickname.json 200
BWIKI api.php: GET=567（WAF）/ POST=200（连续 5/5，1.3–3.3s/次）
hakush.in: 000；fandom/enka/kel-z: 200；prydwen/huijiwiki/honeyhunter: 403；miyoushe/官方站: 000
api.siliconflow.cn / api.openai.com: 401（可达，需 key）；HF/ModelScope/ollama registry: 200
```

## 附录 B · 参考资料

- 产品事实与界面拆解：见 [docs/research/product.md](research/product.md)（含官方公告转录、玩家实测、帕姆问问规则）
- 数据源实测：见 [docs/research/data-sources.md](research/data-sources.md)（BWIKI POST 实测、中文 BM25 对比、embedding 成本）
- StarRailRes：<https://github.com/Mar-7th/StarRailRes>（AGPL-3.0，4.7.0）
- DeepSeek 定价与 Tool Calls：<https://api-docs.deepseek.com/quick_start/pricing>、<https://api-docs.deepseek.com/guides/tool_calls>
- 官方公告转录：<https://wiki.biligame.com/sr/?curid=38178>（原始 <https://www.miyoushe.com/sr/article/74728255>）

## 附录 C · M0 技术验证脚本（明天就能跑）

```bash
# ---------- 1. 骨架 ----------
pnpm create next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*"
pnpm add ai @ai-sdk/openai-compatible zod better-sqlite3 drizzle-orm
pnpm add -D tsx vitest @types/better-sqlite3
cp .env.example .env.local           # 填 OPENAI_BASE_URL / OPENAI_API_KEY / CHAT_MODEL

# ---------- 2. 数据源确认 ----------
curl -s  https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/info.json
# → {"version":"4.7.0","folder":"index_min",...}
curl -sL https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_new/cn/characters.json | jq 'length'
# → 99
curl -sL https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_new/cn/items.json \
  | jq -r 'to_entries | map(.value) | map(select(.name|test("破碎残刃"))) | .[0] | {name, come_from}'
# → 验证材料刷取点字段

# BWIKI：GET 必被 WAF 拦（567），必须 POST（表单体，参数同 query）
curl -s -X POST https://wiki.biligame.com/sr/api.php \
  --data-urlencode 'action=query' --data-urlencode 'list=allpages' \
  --data-urlencode 'aplimit=3' --data-urlencode 'format=json' | head -c 200
# → {"batchcomplete":"","query":{"allpages":[{"ns":0,"title":...}]}}

# ---------- 3. 模型连通性 + 工具调用（关键！）----------
curl -s "$OPENAI_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"'"$CHAT_MODEL"'","messages":[{"role":"user","content":"帕姆，流萤带什么遗器？"}],
       "tools":[{"type":"function","function":{"name":"get_build","description":"查配装",
       "parameters":{"type":"object","properties":{"character":{"type":"string"}},"required":["character"]}}}]}' \
  | jq '.choices[0].message.tool_calls // .choices[0].message.content'
# 期望：返回 tool_calls，参数含「流萤」；若返回纯文本 → 该服务商 tool calls 支持有问题，需换模型/端点

# ---------- 4. 中文 FTS5 双字切分验证 ----------
node -e '
const {DatabaseSync}=require("node:sqlite");
const seg=s=>[...s.replace(/[^\u4e00-\u9fa5a-z0-9]+/gi," ")].map((c,i,a)=>
  /[\u4e00-\u9fa5]/.test(c)?[c,(a[i+1]&&/[\u4e00-\u9fa5]/.test(a[i+1]))?c+a[i+1]:""].filter(Boolean).join(" "):c).join(" ");
const db=new DatabaseSync(":memory:");
db.exec("CREATE VIRTUAL TABLE t USING fts5(tok)");
const ins=db.prepare("INSERT INTO t(tok) VALUES(?)");
["击破特攻是流萤的核心词条","流萤遗器推荐击破套"].forEach(x=>ins.run(seg(x)));
console.log(db.prepare("SELECT count(*) c FROM t WHERE t MATCH ?").get(seg("流萤 击破")));
// 期望 c>=2；若为 0 说明分词逻辑要调
'

# ---------- 5. 人设抽检 ----------
# 用 CHAT_MODEL 跑 20 条（10 闲聊 + 10 攻略），人工按 §2.6 评分：
#   口癖自然度 / 列车长口吻 / 是否有客服腔 / 是否编造数值 / 长度
# 通过线：平均 ≥3.5/5，且编造 0 次
```

**M0 判定**：3、4 两项任一失败，先调整（换模型 / 改分词），不要进入 M1。
