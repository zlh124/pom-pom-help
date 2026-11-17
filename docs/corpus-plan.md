# 语料库结构 v2 · 规划（待你拍板）

> 目标：把现在"扁平 + 与数据源强耦合"的 `corpus/` 重构成**按游戏内容领域分块、两级子目录、可独立演进**的知识库；代码不再硬编码目录/数据源，语料库可以脱离应用仓库单独维护。
> 现状：`corpus/` 只有 `builds / teams / guides / persona / quiz / aliases` 六块、33 个文件；`src/lib/corpus/load.ts` 硬编码了这 6 个目录名，`build-index.ts` / `check-corpus.ts` 也按固定 type 枚举处理。
> 实测数据：2026-11-17 通过 BWIKI `api.php`（仅 POST）拉到的分类/模板计数（仅作体量参考，非全量）。

---

## 0. 一页结论（推荐方案）

```
corpus/
├─ taxonomy.yaml          # 唯一"目录→类型"注册表（代码只读它，新增板块不用改代码）
├─ meta/                  # schema / 板块说明 / 数据源与许可 / 中英术语表
├─ characters/            # ① 角色：profiles · stories · builds
├─ world/                 # ② 世界观：cosmology · regions · factions · history · glossary
├─ ingame/                # ③ 局内文本：books · messages · quests · achievements · items · lightcones · relics · curios · events
├─ enemies/               # ④ 敌人：common · elites · bosses · mechanics
├─ npcs/                  # ⑤ NPC：crew · planets/<region> · organizations
├─ systems/               # ⑥ 玩法系统：progression · combat · gearing · endgame · universe · gacha
├─ guides/                # ⑦ 攻略：teams · materials · newbie · endgame · faq
├─ live/                  # ⑧ 版本活动：versions · events · banners
├─ quiz/weeks/            # ⑨ 帕姆问问题库
├─ persona/               # ⑩ 帕姆人设
└─ aliases.yaml           # ⑪ 别名/黑话
```

三层解耦：

| 层 | 位置 | 职责 |
| --- | --- | --- |
| **内容包** | `corpus/`（可独立成仓库 / 用 `CORPUS_DIR` 指向任意目录） | 只放**人工整理**的知识（事实 + 短引用 + 出处） |
| **适配器** | `scripts/adapters/*.ts` | StarRailRes / BWIKI / 未来的 hakush：抓取、解析、归一化，产物写 `data/derived/`，**不污染 corpus** |
| **应用** | `src/lib/**` | 只依赖 `taxonomy.yaml` + schema + 索引，不关心内容来自哪个仓库/数据源 |

---

## 1. 现状诊断

| 问题 | 具体表现 |
| --- | --- |
| 板块缺失 | 没有角色设定/语音、世界观（星神/地区/阵营/历史）、局内文本（书籍/短信/任务/成就）、敌人、NPC、玩法系统、版本活动、地图 |
| 代码硬编码 | `load.ts` 直接 `path.join(CORPUS_DIR, "builds")` 等 6 处；`check-corpus`/`build-index` 用固定 type 枚举；新增板块必须改代码 |
| 与数据源强绑定 | 配装字段（`relics.sets`、`light_cones`）按 StarRailRes 的字段命名组织，语料结构是"数据源投影"而不是"游戏内容模型" |
| 与仓库强绑定 | `corpus/` 只能随 app 仓库走；没有 `CORPUS_DIR` 覆盖，没法单独维护/复用 |
| 检索无分层 | 所有块混在一个 FTS 表里，无法按板块过滤（例如"世界观问题只搜 world、"攻略问题优先 guides"） |
| 版本门控粗 | 只有 `version` 字符串，没有 `valid_from/valid_until`，无法表达"4.2 下线/4.7 过期" |

---

## 2. 目录结构 v2（两级 + 按需三级）

> 命名建议：**目录用英文**（代码/URL 友好、贡献者不依赖中文输入法），frontmatter 的 `title` 用中文；`planets/<region>` 允许第三级。

```
corpus/
├─ taxonomy.yaml
├─ meta/
│  ├─ schema.md                    # frontmatter 规范（唯一权威）
│  ├─ taxonomy.md                  # 每个板块收什么/不收什么
│  ├─ sources.md                   # 数据源登记（URL/许可/抓取礼仪）
│  └─ glossary/zh-en.yaml          # 中英术语对照（角色名/地区名/系统名）
│
├─ characters/                     # ① 角色
│  ├─ profiles/<char_id>.md        # 角色小传/设定/TAG/定位（短引用+摘要）
│  ├─ stories/<char_id>.md         # 角色故事、星魂、语音台词
│  ├─ builds/<char_id>.yaml        # 配装（现有 15 个迁入；卡片数据源）
│  └─ index/<char_id>.yaml         # 可选：归属/命途/属性/稀有度等索引快照（人工校对版）
│
├─ world/                          # ② 背景世界观
│  ├─ cosmology/                   # 星神、命途、虚数之树、命途行者
│  ├─ regions/                     # 雅利洛-VI / 仙舟 / 匹诺康尼 / 翁法罗斯…（含地图要点）
│  ├─ factions/                    # 星核猎手、星际和平公司、家族、云骑军、泯灭帮…
│  ├─ history/                     # 编年史、版本主线时间线、重大事件
│  └─ glossary/                    # 专有名词表（名词+出处+一句话解释）
│
├─ ingame/                         # ③ 局内文本（游戏里"能读到的字"）
│  ├─ books/                       # 书籍/阅读物（含分卷）
│  ├─ messages/                    # 短信、群聊、信件
│  ├─ quests/                      # 任务描述/剧情对话（主线/同行/活动）
│  ├─ achievements/                # 成就（名称/描述/获取）
│  ├─ items/                       # 道具描述（材料/消耗品/任务道具）
│  ├─ lightcones/                  # 光锥描述/叠影
│  ├─ relics/                      # 遗器套装故事（4 件套文案）
│  ├─ curios/                      # 奇物/祝福（模拟宇宙/差分宇宙）
│  └─ events/                      # 局内小事件/彩蛋/告示牌
│
├─ enemies/                        # ④ 敌人
│  ├─ common/                      # 普通敌人（30-50 试点）
│  ├─ elites/                      # 精英/拟态/召唤物
│  ├─ bosses/                      # 首领/周本/大世界 BOSS
│  └─ mechanics/                   # 弱点/韧性/特殊机制（按机制聚合，便于回答"这怪怎么打"）
│
├─ npcs/                           # ⑤ NPC
│  ├─ crew/                        # 列车组（姬子/三月七/丹恒/瓦尔特/帕姆…）
│  ├─ planets/<region>/            # 各星球 NPC（xianzhou、penacony、jarilo-vi…）
│  └─ organizations/               # 商人/组织/活动 NPC
│
├─ systems/                        # ⑥ 玩法系统（"机制怎么运作"）
│  ├─ progression/                 # 开拓等级/均衡等级/体力/每日实训
│  ├─ combat/                      # 击破/DoT/超击破/能量/行动序列
│  ├─ gearing/                     # 遗器词条/位面饰品/光锥/行迹
│  ├─ endgame/                     # 忘却之庭/虚构叙事/末日幻影/异相仲裁
│  ├─ universe/                    # 模拟宇宙/差分宇宙/货币战争
│  └─ gacha/                       # 跃迁/保底/星琼
│
├─ guides/                         # ⑦ 攻略（可直接照做的结论）
│  ├─ teams/                       # 配队（现有 9 个迁入）
│  ├─ materials/                   # 材料刷取路线/体力规划
│  ├─ newbie/                      # 新手/回归
│  ├─ endgame/                     # 玩法向攻略
│  └─ faq/                         # 高频问题（"为什么不建议…"）
│
├─ live/                           # ⑧ 版本与活动（时效性内容）
│  ├─ versions/<4.7>.md            # 版本更新摘要/机制调整
│  ├─ events/<event-slug>.yaml     # 版本活动（时间/玩法/奖励）
│  └─ banners/<4.7-上半>.yaml      # 卡池/复刻
│
├─ quiz/weeks/<2026-W47>.yaml      # ⑨ 帕姆问问题库（现有不变）
├─ persona/pampam.yaml             # ⑩ 人设（现有不变）
└─ aliases.yaml                    # ⑪ 别名/黑话（现有不变）
```

**为什么二级目录是"内容类型"而不是"实体 id"**：贡献者按"我要补一个敌人/一本书"就能找到位置；按 id 分目录会让跨实体内容（配队、机制）无处安放。

---

## 3. 板块清单、内容边界与体量（BWIKI 实测）

| 板块 | 二级目录 | 收录 | 不收录 | 可获取体量（实测） |
| --- | --- | --- | --- | --- |
| 角色 | profiles / stories / builds | 设定、故事、语音、配装 | 玩家强度排行（放 guides） | 角色 102 页；`模板:角色`（信息/故事/星魂/技能） |
| 世界观 | cosmology / regions / factions / history / glossary | 星神命途、地区、阵营、编年史、名词 | 剧透玩法攻略 | 地区 34 页；阵营/星神需人工整理 |
| 局内文本 | books / messages / quests / achievements / items / lightcones / relics / curios / events | 书、短信、任务、成就、道具/光锥/遗器文案、奇物祝福 | 大段剧情全文转载 | 书籍 500+、任务 500+、消耗品 219、材料 203、光锥 172、遗器 64、奇物 292、事件 201 |
| 敌人 | common / elites / bosses / mechanics | 敌人属性/弱点/技能/机制 | 伤害计算表 | 敌人 303 页；`模板:敌人/敌人技能` |
| NPC | crew / planets / organizations | 身份/位置/对话要点 | 完整对话树 | NPC 443 页；`模板:NPC` |
| 玩法系统 | 6 个二级 | 机制解释/公式/规则 | 具体角色推荐 | `模板:祝福/奇物/事件`、说明页 |
| 攻略 | teams / materials / newbie / endgame / faq | 可执行结论（谁带什么、去哪刷） | 纯数据罗列 | `模板:角色攻略头`（87 页）、`模板:关卡`（91） |
| 版本活动 | versions / events / banners | 版本内容/活动/卡池 | 前瞻猜测 | `模板:活动一览/活动信息/版本内容` |
| 题库 | weeks | 10 题/周 + 讲解 | — | 现有 1 周 |
| 人设 | pampam.yaml | 语气/规则/few-shot | — | 现有 |
| 别名 | aliases.yaml | 黑话→官名 | — | 现有 116 条 |

**还可以补充的候选（按价值排序）**

1. **地图/点位**：`world/regions/<region>/maps/` 或 `ingame/maps/`——刷取点、宝箱、传送锚点（`模板:地图/地图数据` 有数据）；回答"材料在哪刷"时能贴地图链接。
2. **剧情时间线**：`world/history/timeline.md`——版本主线/活动先后顺序，避免剧透/时间错乱。
3. **中英术语表**：`meta/glossary/zh-en.yaml`——角色/地区/系统名的官方英文，方便以后做多语言。
4. **常见问题 FAQ**：`guides/faq/`——"为什么遗器主属性不对""为什么抽卡保底这样算"。
5. **模拟宇宙/差分宇宙内容**：`ingame/curios/` + `systems/universe/`——奇物 292、祝福、事件 201 体量很大。
6. **成就/彩蛋**：`ingame/achievements/`——"这个成就怎么拿"是高频问答。
7. **版本卡池历史**：`live/banners/`——回答"XX 什么时候复刻"。
8. **数据来源登记**：`meta/sources.md`——每个来源的许可/抓取礼仪（已在做，规范化）。

---

## 4. Frontmatter schema v2

所有文件（`.yaml` / `.md`）统一：

```yaml
id: characters/builds/1310        # 稳定 id = <block>/<subtype>/<slug>（不再用数据源 id 当唯一键）
type: character                   # 一级板块（taxonomy 注册）
subtype: build                    # 二级目录
title: 流萤 · 配装与配队
entity:                           # 可选：关联实体（用于实体检索/卡片）
  kind: character
  id: "1310"
  name: 流萤
  aliases: [萨姆, 火萤]
game_version: "4.7"
valid_from: "4.6"                 # 可选：从哪个版本开始有效
valid_until: null                 # 可选：哪个版本后过期（如 4.2 下线的功能）
confidence: curated               # curated | community | derived
sources:
  - url: https://wiki.biligame.com/sr/流萤/攻略
    note: 事实提炼（未整篇转载）
license: CC-BY-SA-4.0
updated: 2026-11-17
tags: [击破, 火, 主C]
related:                          # 可选：跨板块引用（不复制正文）
  - characters/profiles/1310
  - guides/teams/super-break
# —— 以下为按 subtype 的扩展字段（由 schema 校验） ——
relics: { ... }                   # build
tier: boss                        # enemy
weaknesses: [火, 冰]              # enemy
item_id: "110141"                 # item
quest: { chapter: 匹诺康尼, act: ... }
```

`corpus/taxonomy.yaml`（代码唯一入口）：

```yaml
version: 2
blocks:
  characters:
    label: 角色
    subtypes:
      profiles: { index: text, render: character, retrieval: [chat, cards] }
      stories:  { index: text }
      builds:   { index: structured, render: [relic, lightcone, team], retrieval: [cards] }
  world:    { label: 世界观, subtypes: { cosmology: { index: text }, regions: { index: text }, ... } }
  ingame:   { label: 局内文本, subtypes: { books: { index: text }, messages: { index: text }, ... } }
  enemies:  { label: 敌人, subtypes: { common: { index: text }, bosses: { index: text }, mechanics: { index: text } } }
  # …其余同理
retrieval:
  chat_sources: [guides, systems, characters, world, ingame, enemies, npcs]
  cards: [characters, guides]
  quiz: [quiz, world, ingame]
```

> 新增一个板块/二级目录 = 改 `taxonomy.yaml` + 加文件，**不改 TypeScript**；`corpus:check` / `corpus:index` / 检索过滤都按 registry 走。

---

## 5. 解耦设计（"不要和那个仓库强绑定"）

### 5.1 内容包与 app 仓库解耦（推荐：语料独立成仓库）

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A. 独立仓库（推荐）** | 新建 `pom-pom-help-corpus`，app 里用 **git submodule** 挂在 `corpus/`；或部署时 `git clone` 到 `corpus/` | 语料 PR/CI 独立、体积/权限分离、可被其他项目复用 | 多一个仓库要维护；submodule 更新需手动 |
| B. 同仓库 + `CORPUS_DIR` | 仍放 `corpus/`，但代码支持 `CORPUS_DIR`（环境变量/符号链接） | 零迁移成本 | 仍与 app 生命周期绑定 |
| C. npm 包 | 语料打包成 `@zlh124/pom-pom-corpus`，app 安装后读取包内目录 | 版本化清晰 | 内容更新要发版，PR 流程重 |

**推荐 A**：内容仓库独立 CI（`corpus:check` + taxonomy 校验），app 仓库 CI 加一步「submodule 存在性检查」；本地开发 `CORPUS_DIR=./corpus` 默认值不变，所以不影响现在。

### 5.2 数据源与内容解耦

```
scripts/adapters/
├─ starrailres.ts   # 拉 index_min/cn/*.json → data/derived/starrailres/*.json + manifest
├─ bwiki.ts         # POST api.php（角色/敌人/NPC/书籍/任务/成就…模板）→ data/derived/bwiki/*.md
└─ types.ts         # Adapter 接口：fetchEntities() / buildCards() / buildTextChunks()
```

- 适配器产物落在 **`data/derived/`**（gitignore），**不写进 corpus**；
- `corpus:index` 合并两路：`source: curated`（corpus）+ `source: derived`（data/derived）；
- 回答/卡片显示 `来源：人工校对 / 派生数据（4.7）`，缺失时诚实降级；
- 数据源可替换（StarRailRes → hakush → 官方），只要实现同一 Adapter 接口，app 代码不动。

### 5.3 不绑定具体实体 id

- 内容里用 `entity: {kind, id}` 引用实体，id 来自适配器归一化后的实体表（现在 `characters.id` 是 StarRailRes id；未来换源只改适配器映射）；
- `id` 字段（文档 id）只用于引用/去重，格式 `block/subtype/slug`，与数据源 id 无关。

---

## 6. 检索 / 卡片 / 题库如何消费新结构

| 消费方 | 现在 | v2 |
| --- | --- | --- |
| 检索 | 全库 FTS | 按 `taxonomy.retrieval.chat_sources` 过滤板块；`source` 排序（curated 优先，derived 降权） |
| 卡片 | `findBuild` 扫 `corpus/builds` | `registry.get("characters","builds")` 按 `entity.id` 查 |
| 配队 | `findTeams` 扫 `corpus/teams` | `guides/teams` + 按 archetype/成员索引 |
| 帕姆问问 | `corpus/quiz` | `quiz/weeks`（不变） |
| 人设 | `persona` | `persona/pampam.yaml`（不变） |
| 别名 | `aliases.yaml` | 根 `aliases.yaml` + `meta/glossary` 合并（可选） |
| 版本门控 | 无 | `game_version` + `valid_until` 过滤/降权 |

---

## 7. 迁移映射（现有 33 文件 → 新结构）

| 现有路径 | 新路径 | 处理 |
| --- | --- | --- |
| `corpus/builds/<id>.yaml`（15） | `corpus/characters/builds/<id>.yaml` | `git mv` + id 前缀更新 + 加 `type/subtype/entity` |
| `corpus/teams/*.yaml`（9） | `corpus/guides/teams/*.yaml` | 同上 |
| `corpus/guides/*.md`（5） | `corpus/systems/{combat,gearing,gacha,progression,endgame}/*.md` | 按内容拆分（如 break-and-dot → systems/combat；warp-pity → systems/gacha；relic-main-substats → systems/gearing；endgame-modes → systems/endgame；progression-stamina → systems/progression） |
| `corpus/persona/pampam.yaml` | 不变 | 加 `type/subtype` |
| `corpus/quiz/weeks/2026-W47.yaml` | 不变 | 加 `type/subtype: quiz/week` |
| `corpus/aliases.yaml` | 不变 | 可拆分 `aliases/characters.yaml`、`aliases/items.yaml`（P2） |
| `corpus/README.md` | `corpus/meta/taxonomy.md` + `corpus/README.md`（导览） | 重写 |

迁移脚本：`scripts/migrate-corpus-v2.ts`（`--dry-run` 输出映射表，`--apply` 执行 `git mv` + frontmatter patch + id 改写 + 生成 `meta/sources.md` 索引）。

---

## 8. 代码改动清单

| 文件 | 改动 |
| --- | --- |
| `src/lib/corpus/taxonomy.ts`（新） | 加载 `taxonomy.yaml`，提供 `getBlocks()/getSubtypes()/classify(path)` |
| `src/lib/corpus/schemas.ts`（新） | 按 type/subtype 的 zod schema registry（`corpus:check` 与运行时共用） |
| `src/lib/corpus/load.ts` | 去掉 6 处硬编码；通用 `walkCorpus()`；`findBuild/findTeams` 走 registry |
| `scripts/build-index.ts` | 按 taxonomy 分类；分块策略按 subtype；新增列 `block/subtype/source`；derived 合并 |
| `scripts/check-corpus.ts` | 用 schema registry 校验；未知板块/子类型报错；校验 `entity` 引用存在 |
| `scripts/adapters/*`（新） | StarRailRes / BWIKI 适配器，产物 `data/derived/` + manifest |
| `src/lib/retrieval/search.ts` | 按 `retrieval.chat_sources` 过滤；curated 优先 |
| `src/lib/tools/index.ts` | build/team 查找改 registry 路径；材料/敌人等新工具按需 |
| `src/lib/quiz.ts` | quiz 块路径改 taxonomy |
| `src/lib/paths.ts` | 支持 `CORPUS_DIR` 环境变量覆盖 |
| `package.json` | 新增 `corpus:migrate`、`corpus:taxonomy:check`、`data:adapters` |
| `.gitignore` / README / CONTRIBUTING / corpus/README | 更新目录说明、贡献流程、submodule 说明 |

---

## 9. 分阶段实施

| 阶段 | 内容 | 产出/验收 | 预估 |
| --- | --- | --- | --- |
| **P0** | 定 schema v2 + taxonomy.yaml + 迁移脚本（dry-run） | 迁移映射表评审通过；`corpus:check` 支持 v1/v2 双读 | 0.5 天 |
| **P1** | 迁移现有 33 文件；代码改 registry；索引/检索/卡片/题库适配 | `corpus:check` 0 error；`corpus:index` 正常；`npm run eval` 通过率不降；旧功能回归 | 1 天 |
| **P2** | 新板块试点内容：`characters/profiles`（15 角色）、`world/{regions,cosmology}`（15 条）、`enemies/bosses`（20）、`npcs/crew`（10）、`ingame/books`（15） | 检索能回答"XX 是谁/哪个星球/这怪怎么打/这本书讲什么"；卡片不受影响 | 1.5 天 |
| **P3** | 适配器：BWIKI 敌人/书籍/任务/NPC/成就模板抓取（POST+限速）+ StarRailRes 派生事实；索引合并 derived | 派生数据覆盖率报告；回答标注 curated/derived；抓取礼仪记录 | 1.5 天 |
| **P4** | 语料独立仓库（可选）：submodule + 独立 CI + PR 流程 | app 仓库 CI 通过；语料仓库可独立 clone 使用 | 0.5 天 |

> 关键：**P1 结束前不做内容扩张**，否则旧路径/新路径混用会更乱。

---

## 10. 风险与合规

| 风险 | 应对 |
| --- | --- |
| 版权：书籍/任务/短信是游戏原文，体量大 | 只存**事实摘要 + ≤100 字短引用 + 出处**，不整篇转载；`meta/sources.md` 登记 |
| 抓取：BWIKI 仅 POST 可用、有 WAF | 适配器限速 ≥2s、单日 ≤300、revid 缓存、失败退避（沿用现有规范） |
| 体量：书籍 500+/任务 500+/NPC 443，人工不可行 | 分层：人工 curated（摘要/要点）+ 派生 derived（模板字段），回答时标注来源 |
| 索引膨胀 | 分块策略按 subtype（书籍按 300-500 字、任务按 H2、敌人 1 条 1 块）；top-k 过滤板块 |
| 版本漂移 | `game_version`+`valid_until`；过期内容降权而非删除 |
| 迁移误伤 | 迁移脚本 dry-run + 全量备份分支；P1 完成后跑旧评测集对比 |

---

## 11. 待你拍板

1. **语料库是否独立成仓库**？（推荐 A：`pom-pom-help-corpus` + submodule；或 B：同仓库 + `CORPUS_DIR`）
2. **目录命名**：英文（推荐，`characters/world/ingame/enemies/npcs`）还是中文（`角色/世界观/局内文本`）？
3. **配装/配队归属**：builds 放 `characters/builds`（推荐）还是 `guides/builds`？teams 放 `guides/teams` 还是顶层 `teams/`？
4. **自动派生内容是否进语料仓库**？（推荐：不进，只写 `data/derived/`，索引时合并；语料仓库只放人工内容）
5. **P2 先试点哪两个板块**？（推荐 `world`（世界观）+ `enemies`（敌人），对"帕姆帮帮"问答提升最直接；也可以先 `characters/profiles`）
6. 是否保留现有 33 个文件的 id/引用方式（迁移后 `id` 会变成 `characters/builds/1310` 这类新格式，需要同步改引用）？
