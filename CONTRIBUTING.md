# 贡献指南

感谢你愿意帮帕姆补充知识库！本项目采用「语料即代码」：`corpus/` 下的每个文件都是一条可检索的知识，修改后跑一遍索引即可生效。

## 一、可以贡献什么

| 类型 | 目录 | 内容 |
| --- | --- | --- |
| 角色配装 | `corpus/builds/<角色id>.yaml` | 遗器套装/主副词条/光锥/配队模板 |
| 配队 | `corpus/teams/<slug>.yaml` | 队伍流派（4 人位 + 思路 + 变体） |
| 机制指南 | `corpus/guides/*.md` | 系统机制、新手 FAQ、资源规划 |
| 别名/黑话 | `corpus/aliases.yaml` | 玩家简称 → 官名（如「龙丹 → 丹恒·饮月」） |
| 题库 | `corpus/quiz/weeks/<年-周>.yaml` | 帕姆问问 10 题（可考据、带讲解） |
| 人设改进 | `corpus/persona/pampam.yaml` | 帕姆语气/规则/few-shot |

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
2. 只改 `corpus/**`（如需改代码请另开 PR）；
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
