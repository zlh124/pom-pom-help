# 数据源登记（许可与抓取礼仪）

| 来源 | 地址 | 用途 | 许可/风险 | 抓取方式 |
| --- | --- | --- | --- | --- |
| StarRailRes | https://github.com/Mar-7th/StarRailRes | 角色/光锥/遗器/材料数值、别名 | AGPL-3.0，上游无 LICENSE；**只本地同步，不入语料仓库** | `npm run data:sync`（raw/jsDelivr/ghfast 多镜像） |
| BWIKI | https://wiki.biligame.com/sr | 中文攻略/图鉴/敌人/书籍/任务/NPC | 未声明 CC；只做事实提炼+短引用，不镜像图片 | 仅 **POST** `api.php`，限速 ≥2s、单日 ≤300、revid 缓存 |
| 官方公告 | https://www.miyoushe.com/sr/ | 版本/活动/卡池 | 反爬；通过 BWIKI 转录引用 | 低频、人工 |
| 社区实测 | 贴吧/NGA/小红书/巴哈 | 配队/手法经验 | 需标注 `confidence: community` | 人工整理 |

## 抓取礼仪（硬性）

1. BWIKI 只能 POST，GET 会被 EdgeOne WAF 拦（567）；
2. 间隔 ≥2s，单日 ≤300 请求，失败指数退避；
3. 不抓 `File:`/图片/用户页；缓存按 `revid` 去重；
4. 语料只保留摘要/短引用/出处，不整篇转载；
5. 派生数据写 `data/derived/`（gitignore），不进语料仓库。
