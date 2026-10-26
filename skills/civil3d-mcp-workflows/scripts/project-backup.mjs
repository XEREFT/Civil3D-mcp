#!/usr/bin/env node
// PRIVATE BACKUP of the projects (user decision 2026-10-25): the public repo XEREFT/Civil3D-mcp only holds skill + scripts; client data goes ONLY to the PRIVATE repo XEREFT/projects.
//   git (small, diffable files): per project folder  project.json, _reports\*.json, the PDF, the sources list;  NEVER DWG/TIF/zip (binary, 6-130 MB, no useful diff)
//   releases (what was delivered): --release makes "<NAME> @xereft base.zip" (visible deliverables only, via package-base.mjs --zip) and REPLACES it in the ONE release per folder (tag <project>-base / <project>-proposed, no dates)
//   node project-backup.mjs [--projects "<...\Proyectos>"] [--clone C:\Users\camil\XEREFT-projects] [--only "Villa one"] [--release] [--tag <tag>] [--dry]
// Safe to run any time: refuses to push if the remote is not PRIVATE.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const here = dirname(fileURLToPath(import.meta.url));
const projects = resolve(flag("projects", "C:/Users/camil/OneDrive/Documents/AUTOCAD @XEREFT/Proyectos"));
const clone = resolve(flag("clone", "C:/Users/camil/XEREFT-projects"));
const REPO = "XEREFT/projects", only = flag("only"), dry = has("dry"), stamp = new Date().toISOString().slice(0, 10);
const run = (cmd, a, cwd) => spawnSync(cmd, a, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: false });

const vis = run("gh", ["repo", "view", REPO, "--json", "visibility", "-q", ".visibility"]);
if (vis.stdout.trim() !== "PRIVATE") die(`${REPO} is not PRIVATE (got "${vis.stdout.trim() || vis.stderr.trim()}"): refusing to back up client data`);
if (!existsSync(join(clone, ".git"))) die(`no clone at ${clone} (gh repo clone ${REPO} "${clone}")`);
run("git", ["pull", "--rebase", "--autostash"], clone);

const bases = [];
for (const p of readdirSync(projects)) {
  if (only && p.toLowerCase() !== only.toLowerCase()) continue;
  const pd = join(projects, p);
  if (!statSync(pd).isDirectory()) continue;
  for (const f of readdirSync(pd)) if (/ @xereft (base|proposed)$/i.test(f) && statSync(join(pd, f)).isDirectory() && existsSync(join(pd, f, "project.json"))) bases.push({ project: p, folder: f, dir: join(pd, f) });
}
if (!bases.length) die(`no "<Name> @xereft base|proposed" folders under ${projects}`);

for (const b of bases) {
  const out = join(clone, b.project, b.folder);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const take = (rel, filter) => { const s = join(b.dir, rel); if (existsSync(s)) cpSync(s, join(out, rel), { recursive: true, filter }); };
  take("project.json");
  take("_reports", (s) => statSync(s).isDirectory() || /\.(json|md|txt)$/i.test(s));            // data reports, not the as-built scans
  for (const f of readdirSync(b.dir)) if (/\.pdf$/i.test(f)) take(f);                           // the C-300 PDF
  const src = join(b.dir, "SOURCE FILES");                                                      // list only: the originals stay with the client / in the intake folder
  if (existsSync(src)) {
    const list = []; const walk = (d, rel = "") => { for (const e of readdirSync(d)) { const p = join(d, e), r = rel ? `${rel}/${e}` : e; statSync(p).isDirectory() ? walk(p, r) : list.push(`${r}  (${statSync(p).size} bytes)`); } };
    walk(src); writeFileSync(join(out, "SOURCE FILES.txt"), `Originals received from the client (kept in the BASE folder, not in git):\n${list.join("\n")}\n`);
  }
  console.log(`  ${b.project} / ${b.folder}: backed up`);
}
const st = run("git", ["status", "--porcelain"], clone).stdout.trim();
if (st && !dry) {
  run("git", ["add", "-A"], clone);
  const c = run("git", ["commit", "-m", `Project backup ${stamp}${only ? ` (${only})` : ""}`], clone);
  if (c.status) die(`git commit failed: ${c.stderr || c.stdout}`);
  const p = run("git", ["push"], clone); if (p.status) die(`git push failed: ${p.stderr}`);
  console.log("pushed to " + REPO);
} else console.log(st ? "changes found (dry run, not pushed)" : "nothing changed");

if (has("release") && !dry) {
  for (const b of bases) {
    const r = run(process.execPath, [join(here, "package-base.mjs"), "--dir", b.dir, "--zip", "--no-verify"]);
    const m = /zip \(deliverables only\): (.+\.zip)/.exec(r.stdout); if (!m) { console.error(`  ${b.folder}: no zip produced: ${(r.stdout + r.stderr).slice(-200)}`); continue; }
    // ONE release per folder, fixed tag (user rule 2026-10-26: files are REPLACED in place, never versioned by date): <project>-base / <project>-proposed
    const tag = flag("tag", `${b.project.toLowerCase().replace(/\W+/g, "-")}-${b.folder.toLowerCase().includes("proposed") ? "proposed" : "base"}`);
    const title = `${b.project} - ${b.folder}`, notes = `Deliverables-only zip of "${b.folder}", last replaced ${stamp} by project-backup.mjs`;
    const exists = run("gh", ["release", "view", tag, "--repo", REPO]).status === 0;
    const g = exists
      ? run("gh", ["release", "upload", tag, m[1].trim(), "--clobber", "--repo", REPO])
      : run("gh", ["release", "create", tag, m[1].trim(), "--repo", REPO, "--title", title, "--notes", notes]);
    if (exists && !g.status) run("gh", ["release", "edit", tag, "--repo", REPO, "--title", title, "--notes", notes]);
    console.log(g.status ? `  ${tag}: release failed: ${g.stderr.trim()}` : `  ${tag}: ${exists ? "zip replaced in the existing release" : "release created"}`);
  }
}
