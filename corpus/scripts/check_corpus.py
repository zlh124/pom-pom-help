#!/usr/bin/env python3
"""corpus 自检脚本（仅依赖 PyYAML）。

用法（仓库根目录）：
    python3 corpus/scripts/check_corpus.py
    python3 corpus/scripts/check_corpus.py --verbose

退出码：0 = 全部通过；1 = 有错误。警告不阻塞。
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import os
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("需要 PyYAML：pip install pyyaml（或 python3 -m pip install --target /tmp/pyyaml pyyaml）")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CORPUS = os.path.join(ROOT, "corpus")

FRONTMATTER_KEYS = ["id", "type", "title", "version", "tags", "confidence", "sources", "updated", "license"]
TYPES = {"build", "team", "guide", "world", "faq", "quiz", "persona", "aliases"}
CONFIDENCE = {"curated", "community", "derived"}
LICENSE = "CC-BY-SA-4.0"
POSITIONS = {"主C", "副C", "辅助", "生存"}
RANKS = {"S", "A", "B"}
URL_RE = re.compile(r"^https?://\S+$")

errors: list[str] = []
warnings: list[str] = []
stats: dict[str, int] = {}


def err(path: str, msg: str) -> None:
    errors.append(f"{path}: {msg}")


def warn(path: str, msg: str) -> None:
    warnings.append(f"{path}: {msg}")


def rel(path: str) -> str:
    return os.path.relpath(path, ROOT)


def load_yaml(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f)
    except Exception as exc:  # noqa: BLE001
        err(rel(path), f"YAML 解析失败: {exc}")
        return None


def load_frontmatter(path: str):
    """解析 md 的 YAML frontmatter（首行 --- 到下一个 ---）。"""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if not text.startswith("---\n"):
        err(rel(path), "缺少 frontmatter（文件需以 --- 开头）")
        return None, text
    end = text.find("\n---\n", 4)
    if end < 0:
        err(rel(path), "frontmatter 未闭合")
        return None, text
    raw = text[4:end]
    try:
        fm = yaml.safe_load(raw)
    except Exception as exc:  # noqa: BLE001
        err(rel(path), f"frontmatter YAML 解析失败: {exc}")
        return None, text
    return fm, text[end + 5 :]


def check_frontmatter(path: str, fm) -> None:
    if not isinstance(fm, dict):
        err(rel(path), "frontmatter 必须是映射")
        return
    for key in FRONTMATTER_KEYS:
        if key not in fm:
            err(rel(path), f"frontmatter 缺少必填字段 `{key}`")
    if fm.get("type") not in TYPES:
        err(rel(path), f"type 非法: {fm.get('type')!r}（允许 {sorted(TYPES)}）")
    if fm.get("confidence") not in CONFIDENCE:
        err(rel(path), f"confidence 非法: {fm.get('confidence')!r}")
    if fm.get("license") != LICENSE:
        err(rel(path), f"license 必须是 {LICENSE}")
    if not isinstance(fm.get("version"), str) or not fm.get("version"):
        err(rel(path), "version 必须是非空字符串（如 \"4.7\"）")
    tags = fm.get("tags")
    if not isinstance(tags, list) or not tags or not all(isinstance(t, str) for t in tags):
        err(rel(path), "tags 必须是非空字符串列表")
    sources = fm.get("sources")
    if not isinstance(sources, list) or not sources:
        err(rel(path), "sources 必须是非空列表（每条一个可点开的 URL）")
    else:
        for s in sources:
            if not isinstance(s, str) or not URL_RE.match(s):
                err(rel(path), f"sources 含非法 URL: {s!r}")
    updated = fm.get("updated")
    if isinstance(updated, dt.date):
        pass
    elif isinstance(updated, str):
        try:
            dt.date.fromisoformat(updated)
        except ValueError:
            err(rel(path), f"updated 必须是 ISO 日期（YYYY-MM-DD）: {updated!r}")
    else:
        err(rel(path), "updated 缺失或格式错误")


def check_no_images(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if re.search(r"!\[[^\]]*\]\(", text) or re.search(r"\.(png|jpe?g|webp|gif)\b", text, re.I):
        warn(rel(path), "疑似包含图片引用（语料禁止图片，请删除）")


# ---------------------------------------------------------------------------
# 各类语料
# ---------------------------------------------------------------------------
def check_builds() -> None:
    files = sorted(glob.glob(os.path.join(CORPUS, "builds", "*.yaml")))
    stats["builds"] = len(files)
    if not 12 <= len(files) <= 15:
        err("corpus/builds", f"build 数量应为 12~15，当前 {len(files)}")
    for path in files:
        data = load_yaml(path)
        if not isinstance(data, dict):
            continue
        check_frontmatter(path, data)
        if data.get("type") != "build":
            err(rel(path), "type 应为 build")
        cid = data.get("character_id")
        if not isinstance(cid, str) or not cid.isdigit():
            err(rel(path), "character_id 必须是 StarRailRes 角色 id 字符串")
        elif not os.path.basename(path).startswith(cid):
            err(rel(path), f"文件名应以角色 id 开头（{cid}.yaml）")
        if not isinstance(data.get("character_name"), str) or not data.get("character_name"):
            err(rel(path), "character_name 缺失")
        if data.get("position") not in POSITIONS:
            err(rel(path), f"position 非法: {data.get('position')!r}")
        relics = data.get("relics") or {}
        sets = relics.get("sets")
        if not isinstance(sets, list) or not sets:
            err(rel(path), "relics.sets 必须是非空列表")
        else:
            for item in sets:
                if not isinstance(item, dict) or not item.get("name"):
                    err(rel(path), "relics.sets 每项需含 name")
                if item.get("pieces") not in (2, 4):
                    err(rel(path), f"relics.sets.pieces 应为 2 或 4: {item}")
        main = relics.get("main_stats")
        if not isinstance(main, list):
            err(rel(path), "relics.main_stats 必须是列表")
        else:
            slots = [m.get("slot") for m in main if isinstance(m, dict)]
            if not all(s in {"躯干", "脚部", "位面球", "连结绳"} for s in slots):
                err(rel(path), f"relics.main_stats.slot 非法: {slots}")
            if len(slots) != len(set(slots)):
                err(rel(path), "relics.main_stats 部位重复")
            for m in main:
                if not isinstance(m, dict) or not isinstance(m.get("stats"), list) or not m["stats"]:
                    err(rel(path), f"relics.main_stats 每项需含非空 stats 列表: {m}")
        sub = relics.get("sub_stats")
        if not isinstance(sub, list) or not sub:
            err(rel(path), "relics.sub_stats 必须是非空列表")
        lcs = data.get("light_cones")
        if not isinstance(lcs, list) or not lcs:
            err(rel(path), "light_cones 必须是非空列表")
        else:
            for lc in lcs:
                if not isinstance(lc, dict) or not lc.get("name"):
                    err(rel(path), "light_cones 每项需含 name")
                if lc.get("rank") not in RANKS:
                    err(rel(path), f"light_cones.rank 应为 S/A/B: {lc}")
                if not isinstance(lc.get("obtain"), str) or not lc.get("obtain"):
                    err(rel(path), "light_cones.obtain 缺失（拿不到时请省略该键，但不要瞎写）")
        teams = data.get("teams")
        if not isinstance(teams, list) or not teams:
            err(rel(path), "teams 必须是非空列表")
        else:
            for t in teams:
                if not isinstance(t, dict) or not t.get("archetype"):
                    err(rel(path), "teams 每项需含 archetype")
                slots = t.get("slots")
                if not isinstance(slots, list) or len(slots) != 4:
                    err(rel(path), f"teams.slots 必须是 4 个位置: {t.get('archetype')}")
                else:
                    for s in slots:
                        if not isinstance(s, dict) or not s.get("name") or not s.get("role"):
                            err(rel(path), f"teams.slots 每项需含 name/role: {s}")
        if not isinstance(data.get("body"), str) or not data.get("body").strip():
            err(rel(path), "body 不能为空")
        check_no_images(path)


def check_teams() -> None:
    files = sorted(glob.glob(os.path.join(CORPUS, "teams", "*.yaml")))
    stats["teams"] = len(files)
    if not 8 <= len(files) <= 12:
        err("corpus/teams", f"team 数量应为 8~12，当前 {len(files)}")
    for path in files:
        data = load_yaml(path)
        if not isinstance(data, dict):
            continue
        check_frontmatter(path, data)
        if data.get("type") != "team":
            err(rel(path), "type 应为 team")
        if not isinstance(data.get("archetype"), str) or not data.get("archetype"):
            err(rel(path), "archetype 缺失")
        if not isinstance(data.get("core"), str) or not data.get("core"):
            err(rel(path), "core 缺失（一句话核心思路）")
        slots = data.get("slots")
        if not isinstance(slots, list) or len(slots) != 4:
            err(rel(path), "slots 必须是 4 个位置")
        else:
            for s in slots:
                if not isinstance(s, dict) or not s.get("name") or not s.get("role"):
                    err(rel(path), f"slots 每项需含 name/role: {s}")
        variants = data.get("variants")
        if not isinstance(variants, list) or not variants:
            err(rel(path), "variants 必须是非空列表（写清替换位）")
        else:
            for v in variants:
                if not isinstance(v, dict) or not v.get("note"):
                    err(rel(path), f"variants 每项需含 note: {v}")
        if not isinstance(data.get("body"), str) or not data.get("body").strip():
            err(rel(path), "body 不能为空")
        check_no_images(path)


def check_guides() -> None:
    files = sorted(glob.glob(os.path.join(CORPUS, "guides", "*.md")))
    stats["guides"] = len(files)
    if not 4 <= len(files) <= 6:
        err("corpus/guides", f"guide 数量应为 4~6，当前 {len(files)}")
    for path in files:
        fm, body = load_frontmatter(path)
        if fm is None:
            continue
        check_frontmatter(path, fm)
        if fm.get("type") not in {"guide", "faq", "world"}:
            err(rel(path), f"guide 的 type 应为 guide/faq/world，当前 {fm.get('type')!r}")
        if not body.strip():
            err(rel(path), "正文为空")
        if "## " not in body and "#" not in body:
            warn(rel(path), "正文没有标题结构")
        check_no_images(path)


def check_quiz() -> None:
    files = sorted(glob.glob(os.path.join(CORPUS, "quiz", "weeks", "*.yaml")))
    stats["quiz_weeks"] = len(files)
    if not files:
        err("corpus/quiz", "缺少题组文件")
    for path in files:
        data = load_yaml(path)
        if not isinstance(data, dict):
            continue
        check_frontmatter(path, data)
        if data.get("type") != "quiz":
            err(rel(path), "type 应为 quiz")
        qs = data.get("questions")
        if not isinstance(qs, list) or len(qs) != 10:
            err(rel(path), f"questions 应为 10 题，当前 {len(qs) if isinstance(qs, list) else 'N/A'}")
            continue
        dist = {"easy": 0, "normal": 0, "hard": 0}
        ids = set()
        for q in qs:
            if not isinstance(q, dict):
                err(rel(path), "题目必须是映射")
                continue
            if not q.get("id") or q["id"] in ids:
                err(rel(path), f"题目 id 缺失或重复: {q.get('id')!r}")
            ids.add(q.get("id"))
            d = q.get("difficulty")
            if d not in dist:
                err(rel(path), f"题目 {q.get('id')} difficulty 非法: {d!r}")
            else:
                dist[d] += 1
            opts = q.get("options")
            if not isinstance(opts, list) or len(opts) != 3:
                err(rel(path), f"题目 {q.get('id')} options 必须是 3 个")
            ans = q.get("answer")
            if not isinstance(ans, int) or not 0 <= ans <= 2:
                err(rel(path), f"题目 {q.get('id')} answer 必须是 0/1/2")
            if not isinstance(q.get("question"), str) or not q.get("question"):
                err(rel(path), f"题目 {q.get('id')} 缺 question")
            if not isinstance(q.get("explanation"), str) or not q.get("explanation"):
                err(rel(path), f"题目 {q.get('id')} 缺 explanation")
            if not isinstance(q.get("tags"), list) or not q.get("tags"):
                err(rel(path), f"题目 {q.get('id')} 缺 tags")
            qs_sources = q.get("sources")
            if not isinstance(qs_sources, list) or not qs_sources:
                err(rel(path), f"题目 {q.get('id')} 缺 sources")
        if dist != {"easy": 3, "normal": 4, "hard": 3}:
            err(rel(path), f"难度分布应为 3/4/3，当前 {dist}")
        if not isinstance(data.get("week"), str):
            err(rel(path), "week 缺失")
        if not isinstance(data.get("theme"), str) or not data.get("theme"):
            err(rel(path), "theme 缺失")


def check_persona() -> None:
    files = sorted(glob.glob(os.path.join(CORPUS, "persona", "*.yaml")))
    stats["persona"] = len(files)
    if not files:
        err("corpus/persona", "缺少人设卡")
    for path in files:
        data = load_yaml(path)
        if not isinstance(data, dict):
            continue
        check_frontmatter(path, data)
        if data.get("type") != "persona":
            err(rel(path), "type 应为 persona")
        if not data.get("name"):
            err(rel(path), "name 缺失")
        if not data.get("role_title"):
            err(rel(path), "role_title 缺失")
        tic = data.get("tic") or {}
        if not isinstance(tic, dict) or tic.get("char") != "帕":
            err(rel(path), "tic.char 应为「帕」")
        if "0~2" not in str(tic.get("rule", "")):
            err(rel(path), "tic.rule 必须写明每条回复 0~2 次的限制")
        length = data.get("length") or {}
        if length.get("max_chars") != 120:
            err(rel(path), "length.max_chars 必须是 120")
        shots = data.get("few_shots")
        if not isinstance(shots, list) or not 3 <= len(shots) <= 5:
            err(rel(path), "few_shots 应为 3~5 条")
        else:
            for i, s in enumerate(shots):
                if not isinstance(s, dict) or not s.get("user") or not s.get("assistant"):
                    err(rel(path), f"few_shots[{i}] 需含 user/assistant")
                    continue
                ans = s["assistant"]
                if len(ans) > 120:
                    err(rel(path), f"few_shots[{i}] assistant 超过 120 字（{len(ans)}）")
                tic_count = ans.count("帕") - ans.count("帕姆")  # 自称「帕姆」不计入口癖
                if tic_count > 2:
                    err(rel(path), f"few_shots[{i}] 语气词「帕」超过 2 次（{tic_count}）")
                if tic_count < 0:
                    err(rel(path), f"few_shots[{i}] 语气词计数异常")
        boundaries = data.get("boundaries") or {}
        if not boundaries.get("off_limits"):
            err(rel(path), "boundaries.off_limits 缺失")
        if not boundaries.get("handling"):
            err(rel(path), "boundaries.handling 缺失")
        check_no_images(path)


def check_aliases() -> None:
    path = os.path.join(CORPUS, "aliases.yaml")
    data = load_yaml(path)
    if not isinstance(data, dict):
        return
    check_frontmatter(path, data)
    if data.get("type") != "aliases":
        err(rel(path), "type 应为 aliases")
    entries = data.get("aliases")
    if not isinstance(entries, list):
        err(rel(path), "aliases 必须是列表")
        return
    stats["aliases"] = len(entries)
    if len(entries) < 60:
        err(rel(path), f"别名至少 60 条，当前 {len(entries)}")
    seen = set()
    for i, e in enumerate(entries):
        if not isinstance(e, dict):
            err(rel(path), f"aliases[{i}] 必须是映射")
            continue
        for k in ("alias", "canonical", "kind"):
            if not isinstance(e.get(k), str) or not e.get(k):
                err(rel(path), f"aliases[{i}] 缺 {k}")
        alias = e.get("alias")
        if alias:
            if alias in seen:
                err(rel(path), f"别名重复: {alias}")
            seen.add(alias)
        cid = e.get("id")
        if cid is not None and cid != "" and (not isinstance(cid, str) or not cid.isdigit()):
            err(rel(path), f"aliases[{i}] id 必须为角色 id 字符串或空字符串: {cid!r}")
        if e.get("canonical") in {"丹恒·饮月", "阮·梅"}:
            warn(rel(path), f"aliases[{i}] 使用了「·」，StarRailRes 标准名使用「•」")
    check_no_images(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if not os.path.isdir(CORPUS):
        sys.exit(f"未找到 corpus 目录：{CORPUS}")

    check_persona()
    check_aliases()
    check_builds()
    check_teams()
    check_guides()
    check_quiz()

    if args.verbose:
        print("统计：")
        for k, v in stats.items():
            print(f"  {k}: {v}")
        if warnings:
            print(f"\n警告 {len(warnings)} 条：")
            for w in warnings:
                print(f"  - {w}")

    print()
    if errors:
        print(f"✗ 自检失败：{len(errors)} 个错误")
        for e in errors:
            print(f"  - {e}")
        if warnings:
            print(f"\n另有 {len(warnings)} 条警告")
        return 1
    print("✓ corpus 自检通过：")
    print(f"  builds {stats.get('builds', 0)} · teams {stats.get('teams', 0)} · guides {stats.get('guides', 0)} · "
          f"quiz {stats.get('quiz_weeks', 0)} 周 · persona {stats.get('persona', 0)} · aliases {stats.get('aliases', 0)} 条")
    if warnings:
        print(f"  警告 {len(warnings)} 条（不阻塞）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
