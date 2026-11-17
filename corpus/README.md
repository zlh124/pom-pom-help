# 帕姆帮帮 · 语料库（corpus v2）

> 「帕姆帮帮」非官方网页复刻的**语料层**：按游戏内容领域分块（角色 / 世界观 / 局内文本 / 敌人 / NPC / 玩法系统 / 攻略 / 版本 / 题库 / 人设 / 别名）。
> **本目录属于公开仓库，接受社区 PR。** 所有内容必须可核对、可追溯、可校验。
>
> 免责声明：非官方粉丝复刻，与米哈游 / HoYoverse 无关；语料仅供参考，数值与机制以游戏内为准。

## 0. 一句话规则

**每条语料都必须有**：`sources`（能点开的 URL）、`game_version`、`license: CC-BY-SA-4.0`、`confidence`。
**三禁止**：禁止整篇转载、禁止图片、禁止编造数值。

---

## 1. 目录结构（taxonomy 驱动）

```
corpus/
├── taxonomy.yaml               # ★ 唯一"目录 → 类型/子类型/用途"注册表（改这里即可加板块）
├── meta/                       # schema.md / taxonomy.md / sources.md（数据源与许可）
├── characters/                 # 角色
│   ├── profiles/               #   角色小传/设定
│   ├── stories/                #   角色故事/语音
│   └── builds/                 #   配装（卡片数据源，文件名=角色id）
├── world/                      # 世界观
│   ├── cosmology/              #   星神/命途
│   ├── regions/                #   星球/地区
│   ├── factions/               #   阵营/组织
│   ├── history/                #   编年史/时间线
│   └── glossary/               #   专有名词
├── ingame/                     # 局内文本
│   ├── books/ messages/ quests/ achievements/
│   ├── items/ lightcones/ relics/ curios/ events/
├── enemies/                    # 敌人：common / elites / bosses / mechanics
├── npcs/                       # NPC：crew / planets/<region>/ / organizations/
├── systems/                    # 玩法系统：progression / combat / gearing / endgame / universe / gacha
├── guides/                     # 攻略：teams / materials / newbie / endgame / faq
├── live/                       # 版本活动：versions / events / banners
├── quiz/weeks/<YYYY-Www>.yaml  # 帕姆问问每周题组
├── persona/card/pampam.yaml    # 帕姆人设卡
├── aliases.yaml                # 别名/黑话（根级别，单独加载）
└── README.md
```

**加一个新板块/子目录**：只改 `corpus/taxonomy.yaml`（`blocks.<name>.subtypes.<sub>`），然后 `npm run corpus:check`。代码不需要改。

命名约定：
- 文档 `id` = `<block>/<subtype>/<slug>`（如 `characters/builds/1310`、`systems/combat/break-and-dot`）；
- `characters/builds/` 文件名 = StarRailRes 角色 id；`guides/teams/` 文件名 = 英文 archetype slug；
- `quiz/weeks/` 文件名 = ISO 周（如 `2026-W47.yaml`）。

---

## 2. frontmatter（所有 `*.yaml` 与 `*.md` 必填）

完整字段说明见 [meta/schema.md](meta/schema.md)，最小示例：

```yaml
id: characters/builds/1310
type: characters            # 必须等于目录一级 block
subtype: builds             # 必须等于目录二级
title: 流萤 · 配装与配队
game_version: "4.7"
confidence: curated         # curated | community | derived
sources:
  - https://wiki.biligame.com/sr/流萤/攻略
license: CC-BY-SA-4.0
updated: 2026-11-17
tags: [击破, 火, 主C]
entity: { kind: character, id: "1310", name: 流萤, aliases: [萨姆] }
```

按 subtype 的扩展字段（build 的 relics/light_cones、team 的 archetype/slots、敌人 weaknesses 等）见 `meta/schema.md`。

---

## 3. 校验与索引

```bash
npm run corpus:check      # taxonomy/schema/id/来源/许可/禁图片（0 error 才可提交）
npm run corpus:index      # 重建检索索引（data/index.sqlite）
npm run typecheck         # 代码类型检查
npm test:ui               # 浏览器冒烟（需服务已启动）
```

`corpus:check` 会校验：目录是否在 taxonomy 内、`type/subtype` 与目录一致、id 前缀、必填字段、重复 id、正文是否含图片。

---

## 4. 允许 / 禁止

**允许**
- 事实提炼、摘要、短引用（每段 ≤100 字）、自己的实测结论（标 `confidence: community`）；
- 引用社区攻略的观点并标注来源；
- 用 `related` 引用其它文档，而不是复制正文。

**禁止**
- 整篇转载攻略/剧情原文；图片/截图（受版权保护）；
- 未标注来源的数值、编造的机制/版本信息；
- 账号数据、外挂/私服内容、未上线剧透（如需收录请标注剧透提示）。

---

## 5. 提交 PR

1. Fork 本仓库，新建分支 `corpus/<简述>`；
2. 只改 `corpus/**`（代码请另开 PR）；
3. 必须通过 `npm run corpus:check`（CI 会跑）；
4. PR 描述写清楚：改了哪些条目、来源、验证方式；
5. 维护者检查来源真实性、版本匹配、版权风险后合并。

Issue 模板见 `.github/ISSUE_TEMPLATE/corpus.yml`（语料纠错/补充）。

---

## 6. 独立语料仓库（规划中）

语料库计划拆分为独立仓库 `pom-pom-help-corpus`，本仓库通过 git submodule 挂载；语料目录也可用环境变量 `CORPUS_DIR` 指向任意位置。拆分后本 README 会迁移过去。
