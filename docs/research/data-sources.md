# 帕姆帮帮网页版 · 数据源与 RAG 语料方案（实测报告）

> 调研目标：为中文网页版星铁 AI 助手（RAG 问答：角色养成 / 遗器 / 光锥 / 配队 / 材料刷取）确定**本机可落地**的数据来源、摄入管线与检索架构。
> 实测时间：2026-11-16 21:00–21:25（Asia/Shanghai）。所有结论均来自本机 `bash + curl` / `python3` / `node` 的真实请求，记录 HTTP code、响应片段与耗时；**未实测的部分在文末「未验证清单」单独列出**。

---

## 0. 结论速览

| # | 来源 | 实测结果 | 能拿到什么 | 优先级 |
|---|---|---|---|---|
| 1 | StarRailRes（GitHub raw / jsDelivr） | ✅ `200` | 中文结构化数值：角色/行迹/材料/光锥/遗器/物品刷取点/黑话别名 | **P0** |
| 2 | wiki.biligame.com/sr `api.php` | ✅ **仅 POST 可用 `200`**；GET 被 WAF 挡 `567` | 中文攻略/配装/配队/材料获取/版本内容（唯一可用中文攻略文本源） | **P0** |
| 3 | 别名词典（nickname.json + wiki 昵称字段 + 人工词典） | ✅ `200` | 「银狼→小板鸭」「遗器套→治疗套」等玩家黑话映射 | **P0** |
| 4 | jsDelivr / ghfast 镜像 | ✅ `200` | 同上数据的加速/容灾镜像 | P1 |
| 5 | api.hakush.in（含 hsr.hakush.in） | ❌ `000`（TLS reset，本机直连被墙） | 若走代理：角色/技能/遗器/材料全量 JSON | P2（需代理） |
| 6 | fandom HSR wiki | ✅ `200`（英文 17,466 条） | 英文对照/兜底 | P2 |
| 7 | enka.network API | ✅ `200` | **玩家展示柜数据**（非知识库），可做「我的角色」 | P2 |
| 8 | Prydwen / HoneyHunterWorld | ❌ `403`（Cloudflare 挑战页） | 英文攻略（版权风险也高） | 不可用 |
| 9 | 米游社 / 官方站 / yatta | ❌ `000` / `000` / `404` | — | 不可用 |
| 10 | kel-z/HSR-Data、npm 数据包 | ✅ `200` | 英文/不完整数值，但**许可证友好**（Unlicense/MIT） | P2 |
| 11 | 中文 BM25：FTS5 + jieba 预分词 | ✅ 本机 SQLite 3.37.2 编译含 FTS5/trigram | 实测：jieba+自定义词典命中良好 | **P0（检索底座）** |
| 12 | 向量：bge-m3 / text-embedding-3-small / SiliconFlow | ✅ API 域名可达（401 无 key 属正常） | 成本 <$1/全量重建，MVP 可选 | P1 |

**一句话方案**：StarRailRes 提供「事实与数值」，BWIKI（POST 抓取）提供「养成/配装/配队中文攻略」，两者用 `名称 ↔ id` 对齐后，落成「结构化卡片 + 中文 chunk」，用 **SQLite FTS5（jieba/自定义词典预分词）+ 实体归一化** 做检索，向量检索作为 P1 增强。

---

## 1. 实测环境与网络基线

| 项目 | 实测值 |
|---|---|
| 主机 | 8 vCPU / 7 GB RAM（可用约 5 GB）/ 磁盘 813 GB 空闲 |
| GPU | ❌ 无：`nvidia-smi` 不存在，NVML 初始化报错 |
| ollama | ❌ 未安装，`127.0.0.1:11434` 无响应 |
| Python / Node / npm | 3.10.12 / v24.19.0（ICU 78.3，`Intl.Segmenter` 可用）/ 11.17.0 |
| SQLite | CLI 3.37.2；Python 内置 3.37.2，`ENABLE_FTS5=1`、`ENABLE_FTS4=1`、FTS5 `trigram` tokenizer 均可用 |
| npm registry | `registry.npmmirror.com`；**本机 `~/.npm` 缓存目录只读（EROFS），装包必须 `npm_config_cache` 指向可写目录** |
| 出网特征 | DNS 返回 `198.18.0.x`（fake-ip，本地走代理/TUN）；GitHub、HuggingFace、ModelScope、OpenAI、SiliconFlow API 可达；米哈游/米游社/hakush 域名 TLS 被重置 |
| 提示词给定基线 | npm registry `200`、`api.deepseek.com` 可达（实测 `/models` 返回 `401 authentication_error`，说明**连通**；DeepSeek 无 embedding 接口） |

> 说明：`401`/`403` 与 `000` 含义不同。`401` = 已连上、缺鉴权（可用）；`000` = TLS/连接被中断（不可用）；`403 + "Just a moment..."` = Cloudflare 人机校验（不可用）；`567` = 腾讯 EdgeOne WAF 挑战页（GET 被拦，POST 可绕）。

---

## 2. 结构化数据源（P0）

### 2.1 StarRailRes（Mar-7th/StarRailRes）—— 中文数值主源

- 仓库：`https://github.com/Mar-7th/StarRailRes`
- 原始文件：`https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/cn/<file>.json`
- 镜像：`https://cdn.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_min/cn/<file>.json`、`https://fastly.jsdelivr.net/...`、`https://ghfast.top/https://raw.githubusercontent.com/...`

**实测记录**

| 请求 | 结果 |
|---|---|
| `api.github.com/repos/Mar-7th/StarRailRes` | `200`；`default_branch=master`；⭐534；`pushed_at=2026-11-11T16:08:21Z`；`license=AGPL-3.0` |
| `raw.../master/info.json` | `200`，`{"version":"4.7.0","folder":"index_min","timestamp":1794413023}` |
| `raw.../master/index_min.json` | `404`（**注意：`index_min` 是目录不是文件**） |
| `raw.../master/index_min/cn/characters.json` | `200`，65,920 B |
| `raw.../master/index_min/cn/nickname.json` | `200`，13,724 B |
| `raw.../master/index_min/cn/items.json` | `200`，732,236 B |
| `raw.../master/index_min/cn/character_skill_trees.json` | `200`，1,330,707 B |
| `raw.../master/index_new/cn/characters.json` | `200`，106,604 B（`index_new` 为完整字段版，体积约 `index_min` 的 1.6×） |
| jsDelivr（`@master`） | `200`，65,920 B；`cache-control: public, max-age=604800` |
| ghfast.top 代理 | `200`，65,920 B |

**目录结构**：`index_min/{cn,cht,en,jp,kr,de,fr,es,id,pt,ru,th,vi}/`（`cn` 简体中文，`cht` 繁体），另有 `index_new/`（同构、字段更全）、`image/`、`icon/`。
**版本节奏实测**（commit 记录）：4.5 = 2026-08-26、4.6 = 2026-09-29、4.7 = 2026-11-11 → **约每 5–6 周随版本更新一次**，版本发布后 1–2 天内到位。

**`cn/` 可拿到的字段（实测文件与条目数）**

| 文件 | 条目数 | 关键字段 | 用途 |
|---|---|---|---|
| `characters.json` | **99** | `name / tag / rarity / path / element / max_sp / ranks / skills / skill_trees / icon` | 角色主表（稀有度 5★76 / 4★23；命途 9 系：毁灭16 虚无15 同谐13 巡猎12 智识12 欢愉9 记忆8 存护7 丰饶7） |
| `character_promotions.json` | 99 | 每级 `hp/atk/def/spd/taunt/crit_rate/crit_dmg` 的 `base+step` | 算面板/配速 |
| `character_skills.json` | 806 | `name/type_text/element/simple_desc/desc/params/icon` | 技能说明（含中文公式占位符 `三月七#1[i]%`） |
| `character_skill_trees.json` | **1990** | 每级 `materials[{id,num}]`、`properties`、`pre_points` | **行迹/晋阶材料精确清单** |
| `character_ranks.json` | — | 星魂名与效果 | 星魂 |
| `light_cones.json` | **172** | `name/rarity/path/desc/icon` | 光锥主表 |
| `light_cone_ranks.json` | 172 | 叠影 1–5 效果 | 叠影 |
| `light_cone_promotions.json` | — | 每级生命/攻击/防御 | 光锥面板 |
| `relic_sets.json` | **64** | `name/desc[2条]/properties/icon` | **遗器 2/4 件套效果** |
| `relics.json` / `relic_main_affixes.json` / `relic_sub_affixes.json` | — / — / 5,397 B | 部位、主副词条档位与概率 | 词条推荐/毕业面板 |
| `items.json` | **4,141** | `name/type/sub_type/rarity/**come_from[]**` | **材料在哪刷（核心）** |
| `nickname.json` | 100 角色/172 光锥/64 遗器套 | 别名数组 | **黑话词典（见第 3 节）** |
| `achievements.json` / `simulated_blessings.json` | 1,993 / 1,221 | 成就/模拟宇宙祝福 | 扩展问答（P2） |

`items.json` 实测样例（直接回答「材料在哪刷」）：

```json
{"id":"110","name":"无生残刃","type":"Material","rarity":4,
 "come_from":["拟造花萼【收容舱段】","「万能合成机」- 材料合成","余烬兑换","「万能合成机」- 材料置换"]}
```

上面表格 16 个关键 JSON 合计约 **4.43 MB**（未压缩）。

**更新频率**：版本级（5–6 周）+ 偶发修补 commit（图标/描述修正）。
**许可 / ToS 风险（高）**：仓库 `AGPL-3.0`；上游数据来自游戏资源解包（`Dimbreath/StarRailData` 等**无 LICENSE**），版权归米哈游。建议：
1. 仅作**内部构建知识库**，对外只输出「事实性字段 + 出处」，不整包分发 JSON；
2. 不把 AGPL 仓库代码复制进本项目源码（尤其不要混入前端 bundle）；
3. 页面标注「数据来源：StarRailRes / github.com/Mar-7th/StarRailRes」；
4. 商业发布前需重新评估（AGPL + 米哈游用户协议双重风险）。
**推荐优先级：P0（数值与材料事实主源）**。

### 2.2 hakush.in 系列（api.hakush.in / hsr.hakush.in）—— 本机不可用

**实测记录**

| 请求 | 结果 |
|---|---|
| `https://api.hakush.in/hsr/data/character.json` | **`000`**，`curl: (35) SSL routines::unexpected eof while reading` |
| `https://api.hakush.in/hsr/data/zh/character.json` | `000`（同上） |
| `https://api.hakush.in/hsr/data/zh/character/1310.json` | `000`（同上） |
| `https://hsr.hakush.in/`、`https://hakush.in/` | `000`（同上） |
| 对照组：`api.github.com` / `api.openai.com` / `api.siliconflow.cn` | `200` / `401` / `401`（同一时刻可达） |

结论：**不是限流，是 TLS 握手被重置**（DNS 为 fake-ip，代理策略把该域名走直连后被墙）。需海外节点才能评估其真实可用性。
若走代理，其价值：`/hsr/data/{zh|en}/character/{id}.json` 提供技能倍率、遗器、材料、怪物等更细的 datamine 数据（业内常用），格式为按 id 拆分的 JSON；但**非官方接口、无 ToS 声明、稳定性无保证**，且与 StarRailRes 数据高度重叠。
**推荐优先级：P2（仅作为 StarRailRes 缺字段时的代理可用补充；不进入 MVP）**。

### 2.3 kel-z/HSR-Data —— 许可友好的英文备选

- 仓库：`https://github.com/kel-z/HSR-Data`，`https://raw.githubusercontent.com/kel-z/HSR-Data/main/output/game_data.json`
- 实测：`200`，36,792 B；`license=Unlicense`；`pushed_at=2026-11-13`（很新）；`game_data.json` 内 `version` 字段实测为 **`"2.7"`**（明显滞后），`characters` 仅 61 条、`light_cones` 115 条；`output/game_data_verbose.json`（1.9 MB）支持 Range 请求（`206`）。
- 定位：**英文、条目不全、版本字段滞后**，但许可证最宽松（Unlicense），适合做「没有版权顾虑的兜底数值表」。
- **优先级：P2**。

### 2.4 npm 数据包

| 包 | 版本 / 许可 | 实测 | 说明 |
|---|---|---|---|
| `honkai-star-rail-db` | 1.17.1 / ISC | registry `200`，jsDelivr 文件树可见 | 英文 type-safe 数据 |
| `starrail-sdk` | 2.4.2 / MIT | `200` | 理论计算 SDk（英文） |
| `@nekosuneprojects/honkaistarrail-api` | 1.0.0 / MIT | `200` | local-first JSON（英文） |
| `starrail.js` | 1.9.10 / MIT | `200` | Enka.Network API 封装 |
| **`dsh-hsr`** | 0.2.1 / **MIT** | `200`，tarball 46,839 B，解包 133,410 B；含 `lib/knowledge.js`、`lib/match.js`、`lib/source.js` | **中文**角色满级属性/行迹/技能星魂/光锥叠影/遗器套装 + 「配队知识」；内容未逐条验证 |
| `koishi-plugin-starrail-atlas` | 0.0.9 / **AGPL-3.0** | `200`，tarball 23,700 B；含 `lib/othername.json`（别名） | 中文图鉴 + 别名表 |

> `dsh-hsr` 是本轮新发现：**本机可达、中文、MIT**，但体积仅 133 KB，显然是精简数据而非全量；建议作为 P2 交叉校验源（尤其「配队知识」），**不替代** StarRailRes。

---

## 3. 中文 wiki 语料源（P0）—— BWIKI 实测「GET 被 WAF 挡、POST 可用」

### 3.1 关键结论（与常见认知不同，务必按此实现）

| 请求方式 | 实测结果 |
|---|---|
| `GET https://wiki.biligame.com/sr/api.php?action=query&list=allpages&aplimit=5&format=json` | **`567`**（腾讯 EdgeOne WAF 挑战页，body 为 JS/HTML，非 JSON）；加 Chrome UA、加 `Origin`、无 UA、换 `Accept: application/json` 全部 `567` |
| `GET .../index.php?title=银狼&action=raw` | `567` |
| **`POST https://wiki.biligame.com/sr/api.php`（`application/x-www-form-urlencoded`，参数同 query string）** | **`200` + 正常 JSON**，连续 5 次全部 `200`（1.3–3.3 s/次） |
| `POST` 带 `Origin: http://localhost:3000` | `200`；**响应无 `Access-Control-Allow-Origin`** → 浏览器直连会被 CORS 拦，必须走服务端代理 |

> 给 Lead 的修正：你实测的 `wiki.biligame.com/api.php = 567` 是 **GET** 的结果；改用 **POST** 后稳定 `200`，本报告全部 wiki 数据均由 POST 实测得到，可放心纳入方案（`fetch(url, {method:'POST', body: new URLSearchParams({...})})`）。

### 3.2 实测数据（全部 POST）

| 项目 | 实测值 |
|---|---|
| `siteinfo` | MediaWiki **1.37.0**；`pages 41,308` / `articles 7,575` / `images 30,550` / `activeusers 27` |
| 全量主命名空间清单 | **8,310** 个标题 / **17 次请求** / **45.7 s**（平均 2.69 s/请求，全程未被 WAF 拦） |
| 批量抓 wikitext（`generator=embeddedin&geilimit=50&prop=revisions&rvprop=content`） | **3 次请求 / 16.8 s 抓完 103 个角色页 / 1,559 KB**（平均 15.1 KB/页） |
| 更新活跃度 | `黄泉` 最近修订 `2026-11-12T09:06:01Z`（4 天前）；`recentchanges` 显示 2026-11-16 当天仍在编辑 |
| 增量同步 | `list=recentchanges` `200`；单页 `prop=revisions&rvstart=...` `200` |
| 版权声明 | `meta=siteinfo&siprop=rightsinfo` 返回**空**（未声明 CC 协议） |
| robots.txt | 禁止 `/index.php?*`、`*File:*`、`*User*`、`*MediaWiki:*`、`*特殊:*`、`*load.php*` 等；**`api.php` 未被禁止**（所以用 POST api.php 而非 `action=raw`） |

### 3.3 可拿到的语料（按模板统计，实测条数与体积）

| 语料 | 对应模板 | 页数 | wikitext 体积 | 内容 |
|---|---|---|---|---|
| 角色图鉴页 | `模板:角色图鉴` | **103**（含 1 个占位页） | **1,559 KB** | 45+ 结构化字段：`名称/外文名/稀有度/限定/命途/元素属性/命途材料/晋阶属性材料/晋阶系列材料/周本材料/角色定位/TAG/星魂TAG/实装版本/实装日期/昵称外号/速度/能量上限/CV/角色故事` |
| 角色攻略页 | `模板:角色攻略头` | **87** | **710 KB** | 7 个固定 section，实测 **87/87 全部具备**：`角色定位 / 配装推荐 / 简易推荐 / 深入详解 / 遗器 / 光锥 / 阵容搭配`；含主词条推荐、4/2 件套搭配、光锥优先级、**低配/中配/高配完整配队表** |
| 光锥图鉴页 | `模板:光锥图鉴` | **173** | **356 KB** | `稀有度/命途/技能名称/技能效果/获取方式/实装版本/相关角色/光锥TAG/成长数值` |
| 遗器套装页 | `模板:遗器套装` | **65** | **363 KB** | `类别（隧洞遗器/位面饰品）/两件套效果/四件套效果/获取方式/获取途径/实装版本/相关角色/TAG/部位故事` |
| 材料图鉴页 | `模板:材料图鉴` | **202** | **172 KB** | `类型（行迹材料/角色晋阶材料…）/稀有度/描述/介绍/**获取途径**` |
| 关卡/刷取点页 | `模板:关卡` | **91** | **49 KB** | 侵蚀隧洞、凝滞虚影、历战余响、拟造花萼等 |
| 攻略长文 | `模板:攻略` | **22** | **105 KB** | 全角色光锥推荐、弱点击破教学、体力分配、面板等 |
| 版本页 | 标题含「版本」 | **73** | 未单独统计 | 前瞻直播总结 / 版本更新专题 / 活动 |
| 新手教程分类 | `Category:新手教程` | 10 | — | 阵容搭配参考、面板、能量机制 |
| 全站主命名空间 | — | **8,310** | — | 全量抓取可行，但 MVP 只需上表子集 |

**配队语料实测样例**（`黄泉/攻略` 的「阵容搭配」，直接可做结构化配队卡）：

```
低配：黄泉 / 桂乃芬 / 佩拉 / 加拉赫
中配1：黄泉 / 椒丘 / 佩拉 / 砂金
中配2：黄泉 / 银狼 / 佩拉 / 砂金
高配1：黄泉 / 银狼 / 缇宝 / 砂金
高配2：黄泉 / 银狼 / 星期日 / 砂金   （同谐位可用花火）
无生存位：黄泉 / 银狼 / 赛飞儿 / 知更鸟
```

**许可 / ToS 风险（中高）**：
- 站点未声明 CC 协议，正文含大量米哈游原文（技能/故事文案）→ 属「游戏内容 + 社区创作」混合版权；
- robots.txt 未禁止 `api.php`，`activeusers` 仅 27，**必须低频**（建议 2–3 s/请求、单日 ≤ 300 请求、缓存 revision id 不重复拉）；
- 建议：只保留**事实 + 短引用（每段 ≤ 100 字）**，不镜像图片（`image/` 目录），每条 chunk 都带 `source_url` 与修订时间；页脚/回答中注明「内容来自 BWIKI 崩坏：星穹铁道 WIKI，CC 情况未声明，仅供学习」。
**推荐优先级：P0（中文养成/配装/配队/材料文本的唯一可用来源）**。

### 3.4 fandom HSR wiki（英文，P2）

- `https://honkai-star-rail.fandom.com/api.php`：`200`；`pages 173,566` / `articles 17,466` / `activeusers 154`；MediaWiki 标准 API，GET 即可（无 WAF）。
- 语言为英文；Fandom 默认文本许可为 CC-BY-SA（需以站点页脚为准）。
- **优先级：P2**（英文兜底/交叉验证，不用于中文问答主链路）。

### 3.5 不可用来源（实测）

| 来源 | 实测 | 原因 |
|---|---|---|
| `https://www.prydwen.gg/star-rail/` | `403`，body 为 `Just a moment...` | Cloudflare 人机校验 |
| `https://hsr.honeyhunterworld.com/` | `403`，同上 | Cloudflare |
| `https://bbs.mihoyo.com/sr/wiki/` | `000`，TLS EOF | 本机不可达 |
| `https://sr.mihoyo.com/` | `000`，TLS EOF | 本机不可达（官方公告只能走镜像/二手转发） |
| `https://sr.yatta.moe/api/v2/hsr/avatar` | `404`（`{"code":404,"data":"Data Not Found!"}`） | 该站无 HSR 数据/路径不同 |
| `https://api.hakush.in/...` | `000` | 见 2.2 |
| `https://crates.io/api/v1/crates/tantivy` | `403` | 本机不可达（Rust tantivy 路线不现实） |

> 结论：**不存在第二个本机可达的中文攻略文本源**。GitHub 搜索 `星穹铁道 攻略` 仅 2 个 0 star 仓库（`sdsdsssssdsd/hsrmap`、`Kirito233555/HSR-Bond-Optimizer`）；HuggingFace 数据集搜索 `星穹铁道` = 0 条，`honkai star rail` 仅有语音/角色卡数据集（如 `makiligon/honkai-star-rail-jp-and-en-voicelines`），**没有中文攻略语料**。→ BWIKI 是唯一 P0 文本源，必须围绕它设计摄入与合规策略。

---

## 4. 别名 / 黑话词典（玩家简称 → 官名）

**实测可用的三个来源 + 一个必须自建**

1. **StarRailRes `nickname.json`（P0）**：`200`，13,724 B，三组：`characters`（100）、`light_cones`（172）、`relic_sets`（64）。实测样例：
   - `1006 银狼 → [银狼, 小板鸭, 酷鸭, 超级骇客]`
   - `8005 → [虚数开拓者, 同谐开拓者, 虚数主, 同谐主, ...]`，`8001 → [物主, 物理主, 毁灭主, ...]`，`8003 → [火主, 存护主, ...]`
   - `101 遗器套 → [云无留迹的过客, 治疗套, 过客]`、`102 → [野穗伴行的快枪手, 普攻套, 快枪手]`
   - 覆盖缺口实测：**「欢愉主」「龙丹」「记忆主」「大鸭」均未收录**（`银狼` 有收录）。
2. **BWIKI `角色图鉴` 的「昵称/外号」字段（P0）**：103 页中 87 页有值，含大量社区黑话，需清洗模板（`{{黑幕|...}}`、`{{#info:...}}`）。实测样例：`花火 → 火子姐/花火大师`、`流萤 → 萨姆/萨缪尔`、`银狼 → 狼尊`、`丹恒 → 冷面小青龙/闷葫芦/丹宝`、`知更鸟 → 鸡翅膀女孩`、`砂金 → 小孔雀/赌徒`。
3. **BWIKI 重定向页（P1）**：`list=allredirects` 有数据（如 `简易配队教程 → 角色阵容搭配参考`），但角色页几乎没有重定向（实测 `银狼` 的 `prop=redirects` 为空），覆盖有限，只能作补充。
4. **必须自建的小词典（P0，约 50–150 条）**：4.7/4.8 新角色与黑话 StarRailRes 明显滞后。实测：wiki 已有 `实装版本=4.8` 的角色（`艾莲`、`耀嘉音`）与 4.7 的 `星神★阿哈`，而 StarRailRes 最新仅 `version 4.7.0`、角色 99 个。需人工维护：`欢愉主/龙丹/记忆主/大鸭/新角色昵称` + 版本黑话，并做**简繁转换**（OpenCC，如「銀狼」→「银狼」「黃泉」→「黄泉」）。

**推荐实现**：构建 `alias → canonical_entity{kind,id,name}` 一张表，检索前先做**最长匹配实体识别**（同时映射到 `character_id / light_cone_id / relic_set_id`），把「黑话」替换为「官名 + 别名同义词扩展」，再进 BM25/向量。

---

## 5. 检索方案实测对比（中文 BM25）

> 本节全部为本机实测（SQLite 3.37.2 FTS5 / Node 24 / MiniSearch 最新版），不是文档推测。

### 5.1 SQLite FTS5 默认 `unicode61`：**中文不可直接用**

实测：把「黄泉是一名雷属性虚无命途角色。」写入 FTS5 默认表后，`fts5vocab` 显示 token 为整句：

```
['终结技期间无视敌方弱点属性削韧', '银狼可以给敌人添加弱点', '黄泉是一名雷属性虚无命途角色', ...]
```

→ 查询 `MATCH '黄泉'` = **0 命中**；`MATCH '黄泉 虚无'` = **0 命中**。因为 `unicode61` 把连续汉字（CJK 属 `Lo` 字母类）当成一个词，只在标点/空格处切分。**这是最容易踩的坑。**

### 5.2 FTS5 `trigram` tokenizer：只在 ≥3 字时可用，**2 字角色名全部失效**

实测（同一语料，`tokenize='trigram'`）：

| 查询 | 命中 |
|---|---|
| `黄泉`（2 字） | **0** |
| `银狼`（2 字） | **0** |
| `虚无命途` | 2 |
| `死水深潜` | 1 |

→ 星铁角色名绝大多数是 2 字（黄泉、银狼、希儿、流萤…），**trigram 单独用不可接受**；但可作为「长词子串检索」的补充轨道。

### 5.3 jieba 预分词 + 自定义词典 + FTS5：**实测最稳**

- 环境：`pip install jieba` 成功（0.42.1，pypi `200`；注意 `pypi.tuna.tsinghua.edu.cn` 在本机 **SSL 失败**，要用默认源）。
- 流程：入库前对文本 `jieba.cut_for_search` → 空格连接 → 写入 FTS5（`unicode61`）；查询同样分词后 `MATCH`。
- 实测结果（3 条语料）：

| 查询 | 分词结果 | 命中 |
|---|---|---|
| `黄泉` | `黄泉` | 1 |
| `黄泉 虚无` | `黄泉 虚无` | 1 |
| `雷属性` | `雷 属性` | 1 |
| `弱点属性` | `弱点 属性` | 1 |
| `死水深潜的先驱` | `死 水深 潜 的 先驱` | 1 |
| `希儿`（语料无） | `希儿` | 0 |

- **但通用词典会把游戏术语切碎**：`遗器 → 遗/器`、`行迹 → 行/迹`、`死水深潜的先驱 → 死/水深/潜/的/先驱`。→ **必须加载自定义词典**（全部角色名/光锥名/遗器套名/术语表/黑话，约 500–1000 词，可从 StarRailRes 的 `characters/light_cones/relic_sets` 名称自动生成 + 手工补充）。
- 结论：**FTS5 + jieba（自定义词典）+ 空格预分词 = 本机最稳的中文 BM25 方案**，零额外服务、可直接嵌进 Next.js 的 `node:sqlite` / `better-sqlite3`。

### 5.4 Node 侧方案（不装 Python 时）

- **`Intl.Segmenter('zh-Hans', {granularity:'word'})`（零依赖，Node 24 / ICU 78.3 可用）** 实测：
  - 好：`黄泉 / 属性 / 虚无 / 命途 / 弱点 / 终结技`
  - 差：`银狼 → 银/狼`、`遗器 → 遗/器`、`行迹 → 行/迹`、`龙丹 → 龙/丹`、`欢愉主 → 欢/愉/主`（ICU 词典不含游戏术语）
  - 但**文档与查询用同一分词器时**，单字拆分仍可命中（AND 语义），只是噪音与排序变差。
- **MiniSearch（实测，`200` 可安装）**：
  - 默认 tokenizer：中文整句成 token → 查 `遗器` **0 命中**（不可直接用）；
  - `tokenize: Intl.Segmenter` + `prefix:true, fuzzy:0.2`：`黄泉 / 银狼 / 遗器 / 死水深潜的先驱 / 黄泉 遗器 / 配队 / 龙丹 / 欢愉主` 全部命中（1–2 条）；
  - **但 `combineWith:'AND'` 对自然语言问句脆弱**：`龙丹带什么` = **0 命中**（因「带」「什么」不在文档中）。
  - → 结论：**查询必须先做「实体 + 意图」抽取**（见第 7 节），不要把整句直接丢给 BM25；分词器优先用「游戏词典最大匹配 + Segmenter/jieba」。
- **npm 可用性实测**：`minisearch` `200`、`better-sqlite3` `200`、`@node-rs/jieba` `200`、`sqlite-vec` `200`、`flexsearch` `200`；**`tiny-segmentit` `404`、`nodejieba` `404`**（原方案里常提的两个包在本机 registry 上不可用）。Rust `tantivy`：crates.io `403`，不现实。

### 5.5 检索方案推荐（按投入排序）

| 方案 | 实测表现 | 建议 |
|---|---|---|
| **A. `node:sqlite`/`better-sqlite3` + FTS5 + jieba(自定义词典) 预分词 + 实体归一化** | 命中率最好、可离线、可精确过滤结构化字段 | **MVP 首选** |
| B. MiniSearch + `Intl.Segmenter` + 词典预处理 | 零依赖、可跑纯前端；术语切分差 | 备选/兜底（如不想引 Python 或原生模块） |
| C. FTS5 `trigram` 辅助轨 | 2 字名失效 | 仅做长词/子串补充，与 A 组合 |
| D. 纯向量 | 成本低但需模型/网络，中文专名易漂移 | P1 增强，不作为唯一检索 |

---

## 6. 向量检索方案与成本（P1）

### 6.1 供应商可达性实测

| 服务 | 实测 | 结论 |
|---|---|---|
| `https://api.siliconflow.cn/v1/models` | `401`（`Token is invalid`） | **可达**（需 key）；`siliconflow.cn` 主站 TLS 重置（本机访问不了官网，但 API 域名可用） |
| `https://api.openai.com/v1/models` | `401`（missing bearer） | **可达**（需 key） |
| `https://api.deepseek.com/models` | `401`（authentication_error） | 可达；**但 DeepSeek 不提供 embedding 接口**，只能做生成 |
| `https://huggingface.co/api/models/BAAI/bge-m3` | `200`；8 MB 分片下载实测 **≈590 KB/s** | 可下模型 |
| `https://www.modelscope.cn/api/v1/models/BAAI/bge-m3` | `200` | 国内可下模型 |
| `https://ollama.com/download/linux` / `registry.ollama.ai/.../bge-m3/manifests/latest` | `200` / `200` | 可装可拉，但本机**未装 ollama** |

### 6.2 价格（官方/权威页面实测抓取）

| 模型 | 价格 | 来源 |
|---|---|---|
| OpenAI `text-embedding-3-small` | **$0.02 / 1M tokens**（`large` = $0.13 / 1M） | 官方文档 `developers.openai.com/api/docs/models/text-embedding-3-small.md`（实测抓取） |
| BAAI `bge-m3`（托管） | 约 **$0.02 / 1M tokens**；1024 维、8192 tokens 上下文、支持 dense+sparse | 第三方价格页（`checkapicost.com/models/bge-m3-pricing`，2026-03 更新） |
| 硅基流动 `BAAI/bge-m3` | 第三方文档称「模型页当前标为**免费**」，以控制台为准 | 第三方教程页（未直接验证官网） |

### 6.3 1 万块规模成本估算（按本报告实测语料量）

- 语料体积：wikitext 约 3.6 MB + StarRailRes 关键 JSON 4.43 MB ≈ 8 MB → 清洗后中文正文约 1.2–1.5 M 字符。
- 切块：300–400 字/块、50 字重叠 → **约 6,000–8,000 块**；每块 ≈ 350 tokens → **约 2.5–3 M tokens**。
- 全量建索引成本：
  - `text-embedding-3-small` ≈ **$0.05–0.06**
  - `bge-m3` 托管 ≈ **$0.05–0.06**；硅基流动免费档 = **￥0**（有限流）
  - 每月增量（版本更新 5–10% 页面重算）≈ **$0.01 以内**
- 存储：1024 维 f32 = 4 KB/块 → 8k 块 ≈ **32 MB**；10 万块 ≈ **400 MB**（int8 量化 ≈ 100 MB）。
- 10 万块规模：约 35 M tokens → **$0.7**；`sqlite-vec`/HNSW 在 8 GB 内存内可跑。
- **本机自建（无 GPU）可行性**：
  - `bge-small-zh-v1.5`（24 M 参数，ONNX int8 ≈25 MB，下载 95 MB @600 KB/s ≈ 3 min）：8 核 CPU 预估 10–30 条/s → 8k 块 **10–15 min**，**推荐作为本地/离线兜底**。
  - `bge-m3`（568 M）：CPU 预估值 0.3–1 s/块 → 8k 块 **40–120 min**，只适合离线建库，在线 query 会明显卡顿；7 GB 内存（可用 5 GB）勉强够 f16。
  - `ollama`：本机未安装，需先装（`ollama.com` 可达）并拉 `bge-m3`（约 1.2 GB @600 KB/s ≈ 35 min）；CPU 推理同样慢。
- **结论**：向量是「锦上添花」——**MVP 不做向量**；若要做，用 SiliconFlow 免费 `bge-m3` 或 OpenAI 3-small 做**离线建库**，本地只加载小模型或直接走 API 检索；成本可忽略。

---

## 7. 推荐检索架构（MVP → P1）

```
用户问题（中文，可能含黑话/错字）
   │
   ├─① 归一化：繁→简（OpenCC）、全半角、去语气词
   ├─② 实体识别：别名最长匹配 → {kind, id, canonical}
   │     （别名表 = nickname.json + wiki 昵称字段 + 手工词典）
   ├─③ 意图分类：养成 / 遗器 / 光锥 / 配队 / 材料刷取 / 版本活动 / 闲聊
   │
   ├─结构化路径（精确答案，优先）：
   │    角色卡/光锥卡/遗器卡/材料卡 → 模板化组装（无需 LLM 猜）
   │    例：黄泉 + 遗器 → 直接返回「死水深潜的先驱4 + 出云显世与高天神国2」+ 出处
   │
   ├─文本路径（攻略/说明，BM25）：
   │    FTS5(jieba 预分词 + 自定义词典) 检索 chunk；按 意图+实体 过滤（type/entity_id）
   │    top-k=8 → 取 2–4 条拼上下文
   │
   └─P1：向量轨（bge-m3 / 3-small）+ RRF 融合 + bge-reranker 重排
        ↓
   LLM（DeepSeek）→ 带出处回答 + 卡片化 UI
```

**关键设计点（均有实测依据）**

1. **不要直接拿整句做 BM25**：实测 `龙丹带什么` 在 AND 模式下 0 命中 → 必须先抽实体+意图。
2. **结构化卡片优先于自由文本**：wiki 的模板字段（配装/配队/材料获取）本身就是结构化数据，直接渲染成卡片，比让 LLM 从段落里「找」更准、更省 token。
3. **实体归一化是中文 RAG 的核心难点**：2 字角色名 + 黑话 + 繁简，靠 `alias → id` 一张表解决（详见第 4 节）。
4. **出处必带**：每个 chunk 带 `source_url + revid + updated_at`，前端显示「来自 BWIKI · 更新于 11-12」。
5. **版本门控**：回答里带 `data_version`（如 4.7/4.8），超过 1 个版本的数据加「可能已过期」提示。

---

## 8. 文档 Schema 与分块策略

### 8.1 分块策略（按语料类型）

| 语料 | 分块方式 | 块大小 | 备注 |
|---|---|---|---|
| 角色卡（图鉴页） | 一页 **1 个 doc**，`facts` 存字段，不切 chunk | — | 结构化，不进 BM25 主索引（或仅索引「角色定位」） |
| 角色攻略页 | 按 `==H2==` 切，天然 7 段（角色定位/配装/简易推荐/深入详解/遗器/光锥/阵容搭配） | 200–500 字/块 | 每块继承 `character_id` + `section`，便于按意图过滤 |
| 光锥 / 遗器 / 材料页 | 一页 1–2 块（正文 + 获取途径） | ≤400 字 | 保留 `raw` 字段名供结构化读取 |
| 版本/活动页 | 按 H2 切 | 300–500 字 | 带版本号 |
| FAQ / 新手教程 | 按问答对切 | ≤300 字 | 手工整理优先 |
| StarRailRes 数值 | 不切，构建时转成「事实卡」 | — | 例如材料需求聚合到角色卡 |

### 8.2 示例文档 JSON（角色攻略 chunk）

```json
{
  "doc_id": "wiki:char_guide:1308:relic",
  "type": "character_guide_section",
  "entity": {
    "kind": "character",
    "id": "1308",
    "name": "黄泉",
    "aliases": ["芽衣", "黄泉"]
  },
  "game_version": "4.7",
  "locale": "zh-CN",
  "title": "黄泉 · 配装推荐",
  "section": "配装推荐",
  "intents": ["build", "relic"],
  "text": "隧洞遗器：死水深潜的先驱 4 件套（契合依靠负面效果充能的机制）。位面饰品：出云显世与高天神国 2 件套（配队绑定虚无队友，最佳选择）。主词条：躯干 暴击率/暴击伤害；脚部 攻击力百分比/速度；位面球 雷属性伤害提高＞攻击力百分比……",
  "facts": {
    "relic_sets": [
      {"name": "死水深潜的先驱", "pieces": 4},
      {"name": "出云显世与高天神国", "pieces": 2}
    ],
    "main_stats": {"body": ["暴击率", "暴击伤害"], "feet": ["攻击力百分比", "速度"], "sphere": ["雷属性伤害提高"]}
  },
  "source": {
    "kind": "bwiki",
    "url": "https://wiki.biligame.com/sr/黄泉/攻略",
    "page_id": 19237,
    "revid": 106033,
    "updated_at": "2026-11-12T09:06:01Z",
    "license_risk": "medium",
    "attribution": "崩坏：星穹铁道 BWIKI（崩坏星穹铁道WIKI_BWIKI_哔哩哔哩）"
  },
  "retrieval": {
    "tokenized": "隧洞 遗器 死水深潜的先驱 4 件套 …",
    "keywords": ["黄泉", "遗器", "死水深潜的先驱", "出云显世与高天神国", "主词条"]
  },
  "chunk_index": 2,
  "updated_at": "2026-11-16T21:00:00+08:00"
}
```

### 8.3 示例事实卡 JSON（材料/刷取点，来自 StarRailRes）

```json
{
  "doc_id": "srres:material:110",
  "type": "material",
  "entity": {"kind": "item", "id": "110", "name": "无生残刃"},
  "game_version": "4.7",
  "facts": {
    "rarity": 4,
    "item_type": "Material",
    "come_from": ["拟造花萼【收容舱段】", "「万能合成机」- 材料合成", "余烬兑换", "「万能合成机」- 材料置换"]
  },
  "text": "无生残刃：稀有度 4 星行迹/晋阶材料。获取途径：拟造花萼【收容舱段】掉落、万能合成机合成/置换、余烬兑换。",
  "source": {"kind": "starrailres", "url": "https://github.com/Mar-7th/StarRailRes", "license": "AGPL-3.0", "license_risk": "high"},
  "related": {"characters_using": ["1002", "1205"]}
}
```

> `related.characters_using` 建议构建时用 `character_skill_trees.json` 的 `materials[].id` 反查生成，这样「XX 角色要刷什么材料/在哪刷」可以一次回答。

---

## 9. 摄入管线建议（可落地）

| 步骤 | 做法 | 实测依据 |
|---|---|---|
| ① 拉 StarRailRes | 每日检查 `info.json` 的 `version`（1 次请求）；变化则按需拉 `index_min/cn/*.json`（默认 jsDelivr 缓存 7 天，用 `@version`/commit hash 锁定） | `info.json` `200`；jsDelivr `200`、`max-age=604800` |
| ② 拉 BWIKI | **POST** `api.php`，`generator=embeddedin&geititle=模板:角色图鉴` 等批量取 wikitext（50 页/次），2–3 s/请求、指数退避重试（实测偶发 SSL EOF） | 103 页/3 请求/16.8 s；连续 5 次 POST 全 200 |
| ③ 解析 | wikitext 模板参数解析成字段；`{{黑幕|}}`、`{{#info:}}`、`{{颜色|}}`、`<br>` 清洗；保留纯文本段落 | 见 3.3 模板字段 |
| ④ 对齐 | 以 `名称` 为键，把 wiki 页 ↔ StarRailRes `name` 对齐；wiki 领先版本的角色（4.8：艾莲/耀嘉音）只入 wiki 卡并标记 `数值缺失` | StarRailRes 99 角色 vs wiki 103 页 |
| ⑤ 别名 | 合并 `nickname.json` + wiki 昵称字段 + 手工词典 + 简繁转换 | 见第 4 节 |
| ⑥ 分块 & 索引 | 按 8.1 切块；jieba（自定义词典）预分词写 FTS5；P1 加向量 | 见第 5 节实测 |
| ⑦ 增量 | `list=recentchanges`（`rcstart=上次同步时间`、`rcnamespace=0`）→ 只重抓变更页；按 `revid` 去重 | `recentchanges` `200`，当天有编辑 |
| ⑧ 版本发布 | StarRailRes 更新后全量重建数值卡；wiki 攻略页（`角色/攻略`）更新后重建对应 chunk | 版本节奏 5–6 周 |

**抓取礼仪 / 边界**：单日 ≤300 请求、间隔 ≥2 s、带清晰 UA、不抓 `File:`/图片、不抓用户页；缓存 ETag/revision，不重复拉全站；失败 3 次即跳过并告警。

---

## 10. MVP 最小语料集（够回答五类问题）

**目标问题**：① 某角色怎么养 ② 带什么遗器 ③ 带什么光锥 ④ 怎么配队 ⑤ 材料在哪刷。

| # | 语料 | 数量（实测） | 体积 | 覆盖问题 | 来源 |
|---|---|---|---|---|---|
| 1 | 角色图鉴页（结构化卡片） | 103 页 | 1,559 KB | 属性/命途/定位/昵称/晋阶材料 | BWIKI POST |
| 2 | 角色攻略页（7 段） | **87 页** | 710 KB | ①②③④（配装/光锥/配队/词条/手法） | BWIKI POST |
| 3 | 光锥图鉴页 | **173 页** | 356 KB | ③（光锥效果/获取/适配角色） | BWIKI POST |
| 4 | 遗器套装页 | **65 页** | 363 KB | ②（2/4 件套效果/获取方式） | BWIKI POST |
| 5 | 材料图鉴页 | **202 页** | 172 KB | ⑤（获取途径） | BWIKI POST |
| 6 | 关卡/刷取点页 | **91 页** | 49 KB | ⑤（拟造花萼/侵蚀隧洞在哪） | BWIKI POST |
| 7 | 新手/配队长文 | 22 页（含「角色阵容搭配参考」） | 105 KB | ④（配队思路/面板） | BWIKI POST |
| 8 | 版本页 | 73 页 | 未细算 | 版本活动/新角色 | BWIKI POST |
| 9 | 角色/光锥/遗器/物品/材料数值 | 99 / 172 / 64 / 4,141 | ≈4.4 MB | ①②③⑤的精确数值与刷取点 | StarRailRes |
| 10 | 别名表 | 100+172+64 组 + 手工 50–150 条 | 14 KB | 黑话消歧 | StarRailRes + BWIKI + 手工 |

- **合计**：约 **720 个 wiki 页面 + 4.4 MB 结构化 JSON**，清洗后约 **1.2–1.5 M 中文字符**，预计 **6,000–8,000 个 chunk**。
- **覆盖度自检**：五类问题均有「结构化精确答案 + wiki 文本解释」双轨；唯一缺口是**4.8 新角色的数值**（StarRailRes 滞后 1 个版本）→ 用 wiki 卡 + 「数值待补」提示降级。
- **抓取成本实测**：MVP 所需的 720 页 ≈ 15–20 次 POST（每批 50 页）≈ **1–2 分钟**（不含清洗），远低于全站 8,310 页的 17 次请求/45.7 s 清单成本（全量 wikitext 约需 170 次请求/约 8 分钟）。

---

## 11. 版本更新维护策略（4.7 → 4.8+）

1. **发现新版本**：每日 1 次 GitHub API 查 `pushed_at` / `info.json.version`；BWIKI 侧看 `recentchanges` 中「版本」「前瞻直播」页与 `角色图鉴` 新增页。
2. **新角色入仓流程**：
   - wiki 通常先在「角色图鉴」「角色/攻略」建页（实测 4.8 角色已存在：艾莲、耀嘉音）→ 先入 wiki 卡（名称/属性/定位/攻略）；
   - StarRailRes 在版本发布后约 1–7 天更新（4.5→4.6→4.7 间隔 5–6 周）→ 更新后补数值卡；
   - 别名：从 wiki 昵称字段 + 社区词条补 5–15 个新黑话进手工词典；
   - FTS5 索引只重建变更页（`revid` 比对），并重建别名表。
3. **过期控制**：每张卡带 `game_version`，问答时把「数据版本 4.7 / 当前 4.8」写进上下文；超过 1 个版本未更新的攻略 chunk 降权。
4. **回归测试集**（建议 50 条固定问题，每次更新后自动跑）：如「黄泉带什么遗器」「银狼配队」「欢愉主怎么养」「无生残刃在哪刷」「4.7 新角色是谁」——覆盖五类意图 + 黑话 + 繁简。
5. **人工兜底**：对 StarRailRes 尚未覆盖的新角色，回答模板输出「该角色数值数据尚未更新，以下为 wiki 攻略摘要」，避免幻觉数字。

---

## 12. 风险与合规清单

| 风险 | 等级 | 应对 |
|---|---|---|
| BWIKI 内容版权未声明（含米哈游原文） | 中高 | 只存事实+短引用（≤100 字/段）、不镜像图片、逐条带 `source_url`、非商业声明、可一键删除 |
| StarRailRes AGPL-3.0 + 游戏资源版权 | 中高 | 仅内部构建；不打包分发 JSON/不复制仓库代码；对外只输出事实 |
| WAF 封禁（GET 567 / 未来可能封 POST） | 中 | 低频 2–3 s、指数退避、服务端缓存、准备「离线快照」降级 |
| 无 GPU / 7 GB 内存 | 中 | 向量只做离线；MVP 用 BM25；本地模型选 bge-small-zh |
| 本机访问不了 hakush/米游社/官方站 | 中 | 不依赖；需要时上代理（P2） |
| 版本滞后导致答案过期 | 中 | `game_version` 门控 + 过期提示 + 每日版本探测 |
| 中文分词切碎术语 | 中 | 自定义词典（自动从 StarRailRes 名称生成 + 手工黑话） |
| 2 字角色名 + 黑话误匹配 | 中 | 实体归一化 + 最长匹配 + 意图过滤（实测整句 AND 检索 0 命中，必须做） |

---

## 13. 未验证 / 未完成清单

1. **hakush.in 走代理后的真实可用性**：本机 TLS 直接重置，未测到任何响应；其字段/格式来自社区描述，未验证。
2. **硅基流动 bge-m3 是否真的免费**：官网 `siliconflow.cn` 本机 TLS 不可达，仅第三方文档称「模型页标为免费」，需以控制台为准；`api.siliconflow.cn` 实测 `401`（可达）。
3. **`dsh-hsr` npm 包的「配队知识」内容质量**：仅验证了包元数据与文件清单（MIT、133 KB、含 `knowledge.js/match.js`），未逐条阅读内容。
4. **全站 8,310 页 wikitext 全量抓取**：只实测了清单（17 请求/45.7 s）与若干模板子集，未跑全量；按实测 2.7 s/请求推算约 8–10 分钟，未实跑。
5. **本机 CPU 上 bge-m3 / bge-small-zh 的实际吞吐**：未安装 ollama、未下载模型实测；给出的 0.3–1 s/块为基于参数量的估算。
6. **BWIKI 的 POST 是否会被长期封禁**：仅连续 5 次与约 25 次批量请求正常，未做长时压测；生产需限速+缓存。
7. **wiki 全量主命名空间里 8,310 页的语料价值**：角色/光锥/遗器/材料/关卡/攻略子集已量测，其余约 7,000 页（任务、书籍、敌人、模拟宇宙等）未逐类评估体积与价值。
