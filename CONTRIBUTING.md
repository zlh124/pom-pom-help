# 贡献指南

感谢你愿意帮帕姆补充知识库！

> **语料 PR 请提到独立语料仓库**：[zlh124/pom-pom-help-corpus](https://github.com/zlh124/pom-pom-help-corpus)
> 本仓库只接受代码/文档 PR；`corpus/` 是挂载该语料仓库的 git submodule。
> 本地开发：`git submodule update --init --recursive` 后再 `npm run corpus:check && npm run corpus:index`。

## 一、可以贡献什么

| 类型 | 目录 | 内容 |
| --- | --- | --- |
| 角色配装 | `characters/builds/<角色id>.yaml`（语料仓库） | 遗器套装/主副词条/光锥/配队模板 |
| 角色设定/语音 | `characters/profiles/`、`stories/`（语料仓库） | 小传、故事、台词 |
| 配队 | `guides/teams/<slug>.yaml`（语料仓库） | 队伍流派（4 人位 + 思路 + 变体） |
| 机制指南 | `systems/<subtype>/*.md`（语料仓库） | 战斗/养成/终局/模拟宇宙/抽卡机制 |
| 世界观 | `world/{cosmology,regions,factions,history,glossary}/`（语料仓库） | 星神命途、星球、阵营、编年史、名词 |
| 局内文本 | `ingame/{books,messages,quests,...}/`（语料仓库） | 书籍、短信、任务、成就、道具文案 |
| 敌人 / NPC | `enemies/*`、`npcs/*`（语料仓库） | 弱点机制、NPC 身份位置 |
| 版本/活动 | `live/{versions,events,banners}/`（语料仓库） | 版本内容、活动、卡池 |
| 别名/黑话 | `aliases.yaml`（语料仓库） | 玩家简称 → 官名（如「龙丹 → 丹恒·饮月」） |
| 题库 | `quiz/weeks/<年-周>.yaml`（语料仓库） | 帕姆问问 10 题（可考据、带讲解） |
| 人设改进 | `persona/card/pampam.yaml`（语料仓库） | 帕姆语气/规则/few-shot |

## 二、硬性规则（CI 会校验）

1. 每条语料必须有 **`sources`**（可点开的 URL）、**`version`**、**`license: CC-BY-SA-4.0`**、`updated`。
2. **禁止**整篇转载攻略正文、**禁止**图片、**禁止**无出处数值。
3. 允许事实性提炼、短引用（每段 ≤100 字）、以及你自己实测的经验（标 `confidence: community`）。
4. 文件 `id` 必须唯一；`builds` 用 StarRailRes 角色 id（见 `corpus/builds/1310.yaml` 示例）。
5. 拿不准的数据用「推荐档位 + 说明」表达，并标 `confidence: community`，不要编造精确数值。

## 三、本地流程

```bash
npm install
cp .env.example .env.local        # 填 DEEPSEEK_API_KEY（跑问答才需要）
npm run data:sync                 # 拉游戏数据（构建索引前需要）
npm run corpus:check              # ✅ 校验语料
npm run corpus:index              # 重建检索索引
npm run build && npm start        # 本地验证
```

## 四、提交 PR

1. Fork → 新建分支 `corpus/<简述>`；
2. 语料改动请提到语料仓库；本仓库只改代码/文档；
3. PR 描述里写：改了哪些角色/条目、数据来源、你如何验证；
4. 维护者会检查：来源是否真实、版本是否匹配当前游戏版本、是否有版权风险；
5. 合并后重建索引发布。

## 五、Review 清单

- [ ] `corpus:check` 通过（0 error）
- [ ] 每个新文件有 sources / version / license
- [ ] 角色名、光锥名、遗器名与官方一致（可从 StarRailRes 中文索引核对）
- [ ] 无整篇转载、无图片
- [ ] 版本信息正确（当前 4.7，过时内容请标明）

## 六、行为准则

- 尊重其他贡献者；不发布未上线的剧透内容（如需要请标注剧透并折叠）；
- 不提交账号数据、外挂相关内容；
- 本项目是非官方粉丝项目，请勿冒充官方。
