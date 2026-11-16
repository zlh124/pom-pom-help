# 帕姆帮帮 · 语料库（corpus）

> 「帕姆帮帮」非官方网页复刻的**语料层**：帕姆人设、别名词典、角色 build、配队模板、机制/新手 FAQ、每周「帕姆问问」题组。
> **本目录属于公开仓库，接受社区 PR。** 所有内容必须可核对、可追溯、可校验。
>
> 免责声明：本项目为非官方粉丝复刻，与米哈游 / HoYoverse 无关。语料仅供参考，数值与机制以游戏内为准。

## 0. 一句话规则

**每条语料都必须有**：`sources`（能点开的 URL）、`version`、`license: CC-BY-SA-4.0`。
**三禁止**：禁止整篇转载、禁止图片、禁止编造数值。

---

## 1. 目录结构

```
corpus/
├── README.md                  # 本文件：贡献规范 + 校验方法
├── aliases.yaml               # 别名词典增量（黑话/繁简/错字 → 标准名）
├── persona/pampam.yaml        # 帕姆人设卡（口癖/语气/边界/few-shot）
├── builds/<角色id>.yaml       # 单角色配装与配队，渲染为「角色卡片」
├── teams/<archetype-slug>.yaml# 配队模板，渲染为「配队卡片」
├── guides/*.md                # 机制 / 新手 FAQ
├── quiz/weeks/<YYYY-Www>.yaml # 每周「帕姆问问」题组
└── scripts/check_corpus.py    # 自检脚本（仅依赖 PyYAML）
```

命名约定：

- `builds/` 文件名 = StarRailRes 角色 id（如 `1310.yaml` = 流萤），`character_id` 必须与文件名一致。
- `teams/` 文件名 = 英文 archetype slug（如 `super-break.yaml`），`archetype` 字段写中文名（如「超击破」）。
- `guides/` 文件名 = slug；`quiz/` 文件名 = ISO 周（如 `2026-W47.yaml`）。

---

## 2. frontmatter（所有 `*.yaml` 与 `*.md` 必填，缺一不可）

```yaml
id: builds/1310            # builds/<角色id> | teams/<slug> | guides/<slug> | quiz/<week> | aliases | persona/pampam
type: build                # build | team | guide | world | faq | quiz | persona | aliases
title: 流萤 · 配装与配队
character_id: "1310"       # 仅 build：StarRailRes 角色 id 字符串
version: "4.7"             # 语料目标游戏版本（不是单页 wiki 的更新时间）
tags: [击破, 火, 主C]
confidence: curated        # curated | community | derived
sources:                   # 至少一条，必须是能点开的 http(s) URL
  - https://wiki.biligame.com/sr/流萤/攻略
updated: 2026-11-16        # ISO 日期 YYYY-MM-DD
license: CC-BY-SA-4.0      # 固定值，不允许改
```

| 字段 | 取值 / 要求 |
| --- | --- |
| `id` | 字符串；build 用角色 id，team 用 slug，guide 用 slug，quiz 用周编号 |
| `type` | 见上方枚举；guide 类文件用 `guide`，问答类用 `faq` |
| `version` | 字符串，当前基线 **"4.7"**；单页 wiki 更新时间写进正文说明 |
| `tags` | 非空字符串列表，中文标签优先 |
| `confidence` | `curated`（有攻略页/官方统计直证）/ `community`（社区共识，需正文说明）/ `derived`（跨来源推导） |
| `sources` | 非空；wiki 页面 → `https://wiki.biligame.com/sr/<页面名>` |
| `updated` | 修改当天日期 |
| `license` | 固定 `CC-BY-SA-4.0` |

---

## 3. 正文 schema

> 卡片渲染依赖以下**键名**，请勿改名；可以额外加字段（如 `alternatives`、`notes`、`variants`）。

### 3.1 `builds/<角色id>.yaml`（角色卡片）

```yaml
character_id: "1310"     # 必须是 StarRailRes characters.json 里存在的 id
character_name: 流萤     # 必须与 characters.json 的 name 完全一致（注意「•」间隔号）
position: 主C            # 主C | 副C | 辅助 | 生存
relics:
  sets:                  # 外圈 4 件 + 内圈 2 件；或 2+2 组合
    - {name: 荡除蠹灾的铁骑, pieces: 4, note: 毕业套装}
    - {name: 劫火莲灯铸炼宫, pieces: 2, note: 内圈位面饰品}
  main_stats:
    - {slot: 躯干, stats: [攻击力百分比]}
    - {slot: 脚部, stats: [速度]}
    - {slot: 位面球, stats: [攻击力百分比]}
    - {slot: 连结绳, stats: [击破特攻]}
  sub_stats: [速度, 击破特攻, 攻击力百分比]
  alternatives:          # 可选字段：替代套装
    - {name: 盗贼公国塔利亚, pieces: 2, note: 过渡}
light_cones:
  - {name: 梦应归于何处, rank: S, obtain: 限定跃迁（专武）, note: 期望最高}
  - {name: 铭记于心的约定, rank: B, obtain: 4星跃迁}
teams:
  - archetype: 超击破
    slots:
      - {name: 流萤, role: 主C}
      - {name: 开拓者•同谐, role: 增益}
      - {name: 阮•梅, role: 辅助}
      - {name: 加拉赫, role: 生存}
    note: 一句话思路
variants:                # 可选字段：多流派（如卡芙卡/缇宝）
  - {name: 引爆辅C, note: ...}
body: |
  ## 定位
  ……
```

硬性要求：

- `position` ∈ {主C, 副C, 辅助, 生存}；`relics.sets[].pieces` ∈ {2, 4}。
- `main_stats` 固定 4 个部位：躯干 / 脚部 / 位面球 / 连结绳，每项 `stats` 非空。
- `light_cones[].rank` ∈ {S, A, B}（S=毕业，A=五星替代，B=四星/低成本）。
- `light_cones[].obtain` 写获取途径；**拿不到就省略该键，不要瞎写**。
- `teams[].slots` 固定 4 个位置，每项含 `name` / `role`。
- `body` 用 Markdown，写「定位 / 遗器 / 光锥 / 配队 / 注意」，不写死毕业面板。

### 3.2 `teams/<slug>.yaml`（配队卡片）

```yaml
archetype: 超击破        # 中文名
core: 一句话核心思路
slots:                   # 固定 4 个位置
  - {name: 流萤, role: 主C}
  - {name: 开拓者•同谐, role: 增益}
  - {name: 阮•梅, role: 辅助}
  - {name: 加拉赫, role: 生存}
variants:                # 非空；写清「把 X 换成 Y，适合 Z」
  - {note: 通用高金：……}
body: |
  ## 核心思路
  ……
```

### 3.3 `guides/*.md`（Markdown + frontmatter）

- `type` 用 `guide`（机制）或 `faq`（问答）。
- 建议结构：问题 → 结论 → 细节 → 「参考来源」。
- 允许短引用（每段 ≤100 字）并注明来源页；**不允许整篇转载 wiki 攻略**。

### 3.4 `quiz/weeks/<YYYY-Www>.yaml`（帕姆问问题组）

```yaml
week: 2026-W47
theme: 味觉故障的天才
difficulty_distribution: {easy: 3, normal: 4, hard: 3}
questions:
  - id: q1
    difficulty: easy            # easy | normal | hard
    question: 题干
    options: ["A", "B", "C"]    # 固定三选一
    answer: 0                   # 正确项下标 0/1/2
    explanation: 1~2 句讲解
    tags: [世界观]
    sources: ["https://wiki.biligame.com/sr/…"]
```

- 每题必须 3 个选项、`answer` 为 0/1/2、带 `explanation` 与 `sources`。
- 每题单源可考据；拿不准的题宁可不放。
- 每周期 10 题，难度分布 3/4/3。

### 3.5 `persona/pampam.yaml`（人设卡）

- `tic.rule` 必须写明语气词「帕」每条 0~2 次（自称「帕姆」不计入）。
- `length.max_chars: 120`；`few_shots` 3~5 条，每条回答 ≤120 字且语气词「帕」≤2 次。
- 必须包含 `knowledge`（知道/不知道/不编造）与 `boundaries`（禁止事项 + 拒绝方式）。

### 3.6 `aliases.yaml`（别名词典）

```yaml
aliases:
  - {alias: "龙丹", canonical: "丹恒•饮月", kind: character, id: "1213", note: "社区黑话"}
```

- `canonical` 必须与 StarRailRes `characters.json` 的 `name` 一致（含「•」）。
- `id` 优先用 StarRailRes 角色 id；不确定或未收录时用 `""` 并写 `note`。
- 歧义别名（如「火花」vs「花火」、「冷面小青龙」）必须写 `note`，禁止静默合并。
- `alias` 全局唯一；至少 60 条。

---

## 4. 允许 / 禁止

**允许**

- 事实提炼 + 短引用（每段 ≤100 字），并注明来源。
- 「推荐档位 + 说明」的写法（如 S/A/B 光锥档位），不写死数值。
- 社区共识，但必须标 `confidence: community` 并在正文说明依据与时效。
- 4.x 世界观、角色故事、活动/道具的考据（带来源）。

**禁止**

- 整篇转载 wiki / 攻略组文章（包括大段逐字复制）。
- 图片、立绘、图标、UI 切图（本仓库不分发任何官方美术素材）。
- 编造数值（伤害期望、叠影收益、卡池时间）与未公开信息。
- 把社区观点写成官方结论；不标来源的「最优解」。
- 涉政 / 涉黄 / 账号交易 / 代练 / 外挂 / 私服 / 破解 / 现实人物评价。
- 医疗、法律、投资等专业建议。

---

## 5. 数据来源与合规

| 来源 | 用途 | 说明 |
| --- | --- | --- |
| [BWIKI 星穹铁道](https://wiki.biligame.com/sr/) | 角色攻略、机制、活动、道具 | **只能 POST** `https://wiki.biligame.com/sr/api.php`（GET 会被 WAF 拦）；限速 **≥2 秒/请求**；单日 ≤300 请求；只做事实提炼 |
| [StarRailRes](https://github.com/Mar-7th/StarRailRes) | 角色/光锥/遗器 id 与标准名、别名 | 中文索引 `index_min/cn/*.json`；名称以其为准 |
| 游戏内文本 | 校验 | 数值与机制以游戏内说明为准 |

- 引用 BWIKI 文本时保留 `sources` 链接（BWIKI 内容遵循 CC BY-SA 4.0，与本仓库语料协议一致）。
- 语料协议：**CC-BY-SA-4.0**；转载/改编本目录内容请保留署名与相同协议。
- 非官方作品：不打包、不分发米哈游官方美术素材；`assets/` 仅放自制占位资源。

---

## 6. 本地校验

### 6.1 一键自检（推荐）

```bash
python3 corpus/scripts/check_corpus.py --verbose
```

实际运行结果（2026-11-16）：

```text
统计：
  persona: 1
  aliases: 116
  builds: 15
  teams: 9
  guides: 5
  quiz_weeks: 1

✓ corpus 自检通过：
  builds 15 · teams 9 · guides 5 · quiz 1 周 · persona 1 · aliases 116 条
```

（脚本会校验：YAML 可解析、frontmatter 必填字段/枚举、sources URL 格式、builds/teams 卡片字段、
quiz 10 题与 3/4/3 难度、人设 few-shot 长度与口癖、别名数量/唯一性/ID 格式、图片引用告警。）

### 6.2 手动校验（不想装依赖时）

```bash
# PyYAML 缺失时，临时装到 /tmp（不要污染项目依赖）
python3 -m pip install --target /tmp/pyyaml pyyaml
PYTHONPATH=/tmp/pyyaml python3 -c "import yaml,glob; [yaml.safe_load(open(f,encoding='utf-8')) for f in glob.glob('corpus/**/*.yaml',recursive=True)]; print('all yaml ok')"
```

frontmatter 的交叉校验（字段/枚举/quiz 题数）已包含在 6.1 脚本里。

### 6.3 事实核对方式（维护者）

- 角色 id / 标准名 / 光锥名 / 遗器名：用 StarRailRes `index_min/cn/{characters,light_cones,relic_sets}.json` 比对。
- BWIKI 页面存在性：`action=query&titles=...`（POST）批量校验，见 §10。
- 本次 v1 已核对：15 个 build 的 `character_id`/`character_name`、全部光锥名、全部遗器名与 StarRailRes 4.7 中文索引 **0 差异**；
  33 条 BWIKI `sources` **全部存在**（重定向后 0 missing）。核对用的缓存不提交仓库。

---

## 7. PR Review 标准

提交前请确认：

- [ ] `python3 corpus/scripts/check_corpus.py` 通过、无新增警告。
- [ ] 每条结论/数值都有 `sources`，且链接能打开、内容对得上。
- [ ] 角色 id 与 `characters.json` 一致，名称用「•」而非「·」。
- [ ] 不确定内容标 `confidence: community`，并在正文写「以游戏内为准」。
- [ ] 没有整篇转载、没有图片/官方美术素材。
- [ ] `updated` 已更新，`version` 与当前语料基线一致（4.7）。
- [ ] 主观强度/环境评价（如「当前版本最强」）必须附来源与时间；否则请改成中性描述。

Reviewer 重点看三件事：**出处是否可核对、数值有没有编、有没有版权风险**。

---

## 8. 置信度与版本

- `curated`：BWIKI 角色攻略页 / 官方统计直证（如流萤、黄泉、知更鸟、砂金、卡芙卡、缇宝、白厄、遐蝶）。
- `community`：BWIKI 攻略页为空（施工中）时，用官方「角色遗器使用率」统计快照 + 社区通用共识；
  正文必须写明数据快照日期与「可能滞后于当前版本」。当前 7 个 build 属此类：
  花火、丹恒•饮月、银狼、阮•梅、符玄、镜流、黑天鹅。**欢迎带 sources 的 PR 补充当前版本依据。**
- `version` 是「语料目标版本」（4.7），不等于单页 wiki 更新时间；单页时效写在正文（如「攻略页更新于 3.8」）。

---

## 9. 当前覆盖 & 待贡献

- **builds（15）**：流萤 1310、黄泉 1308、花火 1306、丹恒•饮月 1213、银狼 1006、砂金 1304、知更鸟 1309、
  阮•梅 1303、符玄 1208、镜流 1212、卡芙卡 1005、黑天鹅 1307、缇宝 1403、白厄 1408、遐蝶 1407。
- **teams（9）**：超击破、持续伤害（DoT）、黄泉虚无、追击、记忆召唤、白厄三拐一、常规击破、直伤单核、黄泉卡芙卡混搭。
- **guides（5）**：遗器主副词条、击破与持续伤害、跃迁保底、开拓等级与体力、忘却之庭与虚构叙事。
- **quiz（1 周）**：2026-W47「味觉故障的天才」。
- **待补（欢迎认领）**：藿藿 / 忘归人 / 风堇 / 长夜月 / 飞霄 / 星期日 的 build；材料刷取与行迹攻略；
  更多周题组；繁中（繁体）语料与更多错字/黑话别名。

---

## 10. 维护者抓取规范（重要）

BWIKI 只能 **POST**，GET 会被 WAF 拦截；请严格限速，不要把 wiki 打挂：

```bash
curl -s -X POST https://wiki.biligame.com/sr/api.php \
  --data-urlencode 'action=query' --data-urlencode 'prop=revisions' \
  --data-urlencode 'rvprop=content|timestamp' --data-urlencode 'rvslots=main' \
  --data-urlencode 'titles=流萤/攻略' --data-urlencode 'format=json' --data-urlencode 'formatversion=2'
```

- 每次请求间隔 **≥2 秒**；单日 **≤300 请求**；批量取页时一次 `titles` 用 `|` 连接（≤12 个/次）。
- 只做**事实提炼 + 短引用（每段 ≤100 字）**；不整篇转载、不下载图片。
- 抓取缓存不要提交仓库（当前 `.gitignore` 已忽略 `corpus/.cache/`）。

---

## 11. 自检记录

| 日期 | 检查 | 结果 |
| --- | --- | --- |
| 2026-11-16 | `python3 corpus/scripts/check_corpus.py --verbose` | ✓ 通过（builds 15 / teams 9 / guides 5 / quiz 1 / persona 1 / aliases 116，0 错误 0 警告） |
| 2026-11-16 | 全部 YAML 解析（PyYAML `safe_load`） | ✓ 27 个 YAML 文件全部可解析（builds 15 + teams 9 + persona 1 + aliases 1 + quiz 1） |
| 2026-11-16 | frontmatter 必填字段 / 枚举 / sources URL | ✓ 全部合规 |
| 2026-11-16 | 名称与 id 对照 StarRailRes 4.7 中文索引 | ✓ 0 差异（角色名/光锥名/遗器名/id） |
| 2026-11-16 | BWIKI `sources` 页面存在性（POST `titles` 批量） | ✓ 33/33 存在 |

> 新增语料后，请把新的自检结果追加到上表；如果用了新的抓取规则，也请在 §10 补充。
