# 语料 Frontmatter Schema v2

所有语料文件（`.md` 带 frontmatter / `.yaml` 纯 YAML）必须包含以下字段：

```yaml
id: characters/builds/1310      # 稳定 id：<block>/<subtype>/<slug>
title: 流萤 · 配装与配队        # 中文标题（检索/展示用）
type: character                 # 一级板块，必须存在于 taxonomy.yaml
subtype: build                  # 二级目录，必须存在于 taxonomy.yaml 对应板块下
game_version: "4.7"             # 内容对应的游戏版本
confidence: curated             # curated | community | derived
sources:                        # 必须非空
  - url: https://wiki.biligame.com/sr/流萤/攻略
    note: 事实提炼（未整篇转载）
license: CC-BY-SA-4.0
updated: 2026-11-17
tags: [击破, 火, 主C]
entity:                         # 可选：关联实体（检索/卡片用）
  kind: character               # character | light_cone | relic_set | item | enemy | npc | region
  id: "1310"                    # 来自适配器归一化后的实体表
  name: 流萤
  aliases: [萨姆, 火萤]
valid_from: "4.6"               # 可选
valid_until: null               # 可选（例如 4.2 下线功能填 "4.2"）
related:                        # 可选：跨文档引用（不复制正文）
  - characters/profiles/1310
```

## 按 subtype 的扩展字段

| block/subtype | 扩展字段 | 说明 |
| --- | --- | --- |
| `characters/builds` | `relics.sets[]` `relics.main_stats[]` `relics.sub_stats[]` `light_cones[]` `teams[]` | 卡片数据源 |
| `guides/teams` | `archetype` `slots[]` `variants[]` `core` | 配队卡 |
| `enemies/*` | `tier`(common/elite/boss) `weaknesses[]` `mechanics[]` `hp_class` | 敌人卡/问答 |
| `ingame/items` | `item_id` `rarity` `item_type` | 道具 |
| `ingame/quests` | `chapter` `act` `region` | 任务 |
| `live/events` | `start_at` `end_at` `rewards[]` | 活动 |
| `quiz/weeks` | `week` `theme` `questions[]`（10 题） | 帕姆问问 |

## 收录红线

- 只做**事实提炼 + 短引用（每段 ≤100 字）**，禁止整篇转载、禁止图片；
- 必须有可点开的 `sources`；数值不确定时标 `confidence: community` 并在正文说明；
- 角色/光锥/遗器/敌人名使用官方中文名；别名放 `aliases.yaml` 或 `entity.aliases`；
- 剧透内容在正文顶部标注 `> 剧透提示`。
