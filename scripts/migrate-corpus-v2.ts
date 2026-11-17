/**
 * 语料结构 v1 → v2 迁移
 *   tsx scripts/migrate-corpus-v2.ts --dry-run
 *   tsx scripts/migrate-corpus-v2.ts --apply
 *
 * v1: corpus/{builds,teams,guides,persona,quiz}
 * v2: corpus/<block>/<subtype>/...（taxonomy.yaml 驱动）
 * - builds   → characters/builds
 * - teams    → guides/teams
 * - guides   → systems/{combat,gearing,gacha,progression,endgame}
 * - persona  → persona/persona（原地，补字段）
 * - quiz     → quiz/weeks（原地，补字段）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { CORPUS_DIR } from "../src/lib/paths";

const apply = process.argv.includes("--apply");
const dryRun = !apply;

const GUIDE_MAP: Record<string, { dir: string; slug: string }> = {
  "break-and-dot.md": { dir: "combat", slug: "break-and-dot" },
  "endgame-modes.md": { dir: "endgame", slug: "endgame-modes" },
  "progression-stamina.md": { dir: "progression", slug: "progression-stamina" },
  "relic-main-substats.md": { dir: "gearing", slug: "relic-main-substats" },
  "warp-pity.md": { dir: "gacha", slug: "warp-pity" },
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function gitMv(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!dryRun) execFileSync("git", ["mv", from, to], { stdio: "pipe" });
}

function writeYaml(file: string, data: Record<string, unknown>) {
  if (dryRun) return;
  fs.writeFileSync(file, stringifyYaml(data, { lineWidth: 0 }));
}

function patchMarkdown(file: string, patch: Record<string, unknown>, sourceFile?: string) {
  const raw = fs.readFileSync(dryRun && sourceFile ? sourceFile : file, "utf8");
  const m = FRONTMATTER.exec(raw);
  if (!m) throw new Error(`${file} 缺少 frontmatter`);
  const meta = { ...(parseYaml(m[1]) as Record<string, unknown>), ...patch };
  const body = m[2].replace(/^\n+/, "");
  if (dryRun) return;
  fs.writeFileSync(file, `---\n${stringifyYaml(meta, { lineWidth: 0 })}---\n\n${body}`);
}

const plan: Array<{ from: string; to: string; action: string }> = [];

// 1) builds → characters/builds
const buildsDir = path.join(CORPUS_DIR, "builds");
if (fs.existsSync(buildsDir)) {
  for (const name of fs.readdirSync(buildsDir).filter((f) => f.endsWith(".yaml"))) {
    const from = path.join(buildsDir, name);
    const to = path.join(CORPUS_DIR, "characters", "builds", name);
    const data = parseYaml(fs.readFileSync(from, "utf8")) as Record<string, any>;
    const charId = String(data.character_id ?? "");
    const next = {
      ...data,
      id: `characters/builds/${name.replace(/\.yaml$/, "")}`,
      type: "characters",
      subtype: "build",
      entity: {
        kind: "character",
        id: charId,
        name: data.character_name ?? "",
        ...(Array.isArray(data.tags) ? { aliases: data.tags.filter((t: string) => t.length <= 6) } : {}),
      },
    };
    plan.push({ from, to, action: `id→characters/builds/…, entity=${charId}` });
    gitMv(from, to);
    writeYaml(to, next);
  }
}

// 2) teams → guides/teams
const teamsDir = path.join(CORPUS_DIR, "teams");
if (fs.existsSync(teamsDir)) {
  for (const name of fs.readdirSync(teamsDir).filter((f) => f.endsWith(".yaml"))) {
    const from = path.join(teamsDir, name);
    const to = path.join(CORPUS_DIR, "guides", "teams", name);
    const data = parseYaml(fs.readFileSync(from, "utf8")) as Record<string, any>;
    plan.push({ from, to, action: "type→guide/team" });
    gitMv(from, to);
    writeYaml(to, {
      ...data,
      id: `guides/teams/${name.replace(/\.yaml$/, "")}`,
      type: "guides",
      subtype: "team",
    });
  }
}

// 3) guides → systems/<subtype>
const guidesDir = path.join(CORPUS_DIR, "guides");
if (fs.existsSync(guidesDir)) {
  for (const name of fs.readdirSync(guidesDir).filter((f) => f.endsWith(".md"))) {
    const map = GUIDE_MAP[name];
    if (!map) {
      console.warn(`⚠ 未映射的 guide：${name}，跳过（请手动迁移到 systems/<subtype>/）`);
      continue;
    }
    const from = path.join(guidesDir, name);
    const to = path.join(CORPUS_DIR, "systems", map.dir, name);
    plan.push({ from, to, action: `type→system/${map.dir}` });
    gitMv(from, to);
    patchMarkdown(
      to,
      {
        id: `systems/${map.dir}/${map.slug}`,
        type: "systems",
        subtype: map.dir,
      },
      from,
    );
  }
}

// 4) persona / quiz 原地补字段
const personaFile = path.join(CORPUS_DIR, "persona", "pampam.yaml");
if (fs.existsSync(personaFile)) {
  const data = parseYaml(fs.readFileSync(personaFile, "utf8")) as Record<string, any>;
  plan.push({ from: personaFile, to: personaFile, action: "补 type/subtype/id" });
  writeYaml(personaFile, { ...data, id: "persona/card/pampam", type: "persona", subtype: "card" });
}

const quizDir = path.join(CORPUS_DIR, "quiz", "weeks");
if (fs.existsSync(quizDir)) {
  for (const name of fs.readdirSync(quizDir).filter((f) => f.endsWith(".yaml"))) {
    const file = path.join(quizDir, name);
    const data = parseYaml(fs.readFileSync(file, "utf8")) as Record<string, any>;
    plan.push({ from: file, to: file, action: "补 type/subtype" });
    writeYaml(file, {
      ...data,
      id: data.id ?? `quiz/weeks/${name.replace(/\.yaml$/, "")}`,
      type: "quiz",
      subtype: "weeks",
    });
  }
}

console.log(`${dryRun ? "DRY-RUN" : "APPLY"} 语料迁移计划（${plan.length} 项）\n`);
for (const item of plan) {
  const rel = (p: string) => path.relative(process.cwd(), p);
  console.log(`- ${rel(item.from)}`);
  console.log(`  → ${rel(item.to)}  [${item.action}]`);
}

if (dryRun) {
  console.log("\n这是 dry-run。确认无误后执行：npm run corpus:migrate -- --apply");
} else {
  console.log("\n✅ 迁移完成。请检查：git status；然后 npm run corpus:check && npm run corpus:index");
}
