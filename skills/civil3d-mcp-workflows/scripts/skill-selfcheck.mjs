#!/usr/bin/env node
// SKILL SELF-CHECK: the parts of integrity-check that need NOTHING but the skill folder (no Civil 3D, no repo, no memory, no network),
// so they can run in CI on the fork's skill branch (ci/skill-check.yml, installed by sync-skill-to-fork.sh).
//   node skill-selfcheck.mjs            exit 1 on any problem
// Checks: every scripts/*.mjs|cjs passes `node --check` · every *.json parses · known-bugs.json <-> references/troubleshooting.md
// (each registry `match` appears in the table and each table row has an entry) · every references/... scripts/... path named in SKILL.md
// exists · commands-backup and subagents-backup carry the expected files.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const skill = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const ok = [];
const fail = (m) => problems.push(m);
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "ErrorReports") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const all = walk(skill);

// 1. syntax
const scripts = all.filter((p) => /[\\/]scripts[\\/][^\\/]+\.(mjs|cjs)$/.test(p));
for (const s of scripts) {
  const r = spawnSync(process.execPath, ["--check", s], { encoding: "utf8" });
  if (r.status !== 0) fail(`syntax error in ${relative(skill, s)}: ${(r.stderr ?? "").split("\n").find((l) => l.trim()) ?? ""}`);
}
ok.push(`${scripts.length} scripts pass node --check`);

// 2. json
const jsons = all.filter((p) => p.endsWith(".json"));
for (const j of jsons) { try { JSON.parse(readFileSync(j, "utf8").replace(/^﻿/, "")); } catch (e) { fail(`invalid JSON ${relative(skill, j)}: ${e.message}`); } }
ok.push(`${jsons.length} JSON files parse`);

// 3. registry <-> troubleshooting
const regPath = join(skill, "references/standards/known-bugs.json");
const trouble = readFileSync(join(skill, "references/troubleshooting.md"), "utf8");
if (existsSync(regPath)) {
  const bugs = JSON.parse(readFileSync(regPath, "utf8")).bugs;
  const ids = new Set();
  for (const b of bugs) {
    if (ids.has(b.id)) fail(`duplicate registry id ${b.id}`);
    ids.add(b.id);
    if (!trouble.includes(b.match)) fail(`registry entry ${b.id}: row text not found in troubleshooting.md (${b.match.slice(0, 50)})`);
    for (const c of b.checks ?? []) if (c.type === "skill-grep") {
      const p = join(skill, c.file);
      if (!existsSync(p)) fail(`registry ${b.id}: skill-grep file missing ${c.file}`);
      else if (!new RegExp(c.pattern).test(readFileSync(p, "utf8"))) fail(`registry ${b.id}: /${c.pattern}/ not found in ${c.file}`);
    }
  }
  const rows = trouble.split("\n").filter((l) => /^\| /.test(l) && !/^\|[-| ]+\|$/.test(l) && !/^\| (Síntoma|Síntoma \/ mensaje)/.test(l));
  const orphans = rows.filter((l) => !bugs.some((b) => l.includes(b.match)));
  for (const o of orphans) fail(`troubleshooting row without registry entry: ${o.slice(0, 70)}`);
  ok.push(`${bugs.length} registry entries <-> ${rows.length} troubleshooting rows`);
}

// 4. SKILL.md paths
const skillMd = readFileSync(join(skill, "SKILL.md"), "utf8");
const paths = [...new Set([...skillMd.matchAll(/\b((?:references|scripts|commands-backup|subagents-backup)\/[\w./-]+\.(?:md|mjs|ps1|py|cjs|json|sh|txt|yml))/g)].map((m) => m[1]))];
for (const p of paths) if (!existsSync(join(skill, p))) fail(`SKILL.md names a missing path: ${p}`);
ok.push(`${paths.length} paths named in SKILL.md exist`);

// 5. backups present
for (const f of ["commands-backup/fase1.md", "commands-backup/integridad.md", "commands-backup/SessionStart-hook.settings.json", "subagents-backup/civil3d-deploy.md", "subagents-backup/civil3d-new-project.md"]) {
  if (!existsSync(join(skill, f))) fail(`missing backup file ${f}`);
}
ok.push("command/agent backups present");

for (const m of ok) console.log(`OK   ${m}`);
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length ? `\nSKILL SELF-CHECK: ${problems.length} problem(s)` : "\nSKILL SELF-CHECK: clean");
process.exit(problems.length ? 1 : 0);
