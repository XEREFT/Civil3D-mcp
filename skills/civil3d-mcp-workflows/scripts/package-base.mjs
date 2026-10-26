#!/usr/bin/env node
// Keeps the ONE project folder "<NAME> @XEREFT BASE" ready to hand to the design engineer (user rule 2026-10-25: per project only the client's untouched intake
// folder, "<NAME> @XEREFT BASE" and, when we design, "<NAME> @XEREFT PROPOSED"). The BASE folder is both the working folder and the hand-off folder:
//   <NAME> @XEREFT BASE\  <NAME> @XEREFT BASE.dwg, X-TOPO.dwg, X-ARCH.dwg (+X-UTIL.dwg), <NAME> @XEREFT BASE.pdf, SOURCE FILES\ (client's originals)
//                         + our working files, marked Hidden: project.json, _template.dwg, _reports\, _backup\  (never extra visible documents: no README/log)
//   node package-base.mjs --dir "<...\<NAME> @XEREFT BASE>" [--no-verify] [--zip]   tidy: sync SOURCE FILES from project.json sources.intakeDir, hide working files, check the PDF is fresh, plot-test
//   node package-base.mjs --dir "<...\<NAME> @XEREFT BASE>" --phase PROPOSED        start the design folder: copies BASE -> "<NAME> @XEREFT PROPOSED" (files renamed, project.json phase set); refuses if it exists
//   --zip  also writes "<NAME> @XEREFT BASE.zip" in %TEMP% with ONLY the visible deliverables (what to e-mail) and prints its path
// Runs from fase1-from-scratch.mjs when project.json has "package": {"base": true} (or --package).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const here = dirname(fileURLToPath(import.meta.url));
const dir = flag("dir") ? resolve(flag("dir")) : die('usage: node package-base.mjs --dir "<...\\<NAME> @XEREFT BASE>" [--phase PROPOSED] [--zip] [--no-verify]');
if (!/ @XEREFT (BASE|PROPOSED)$/i.test(basename(dir))) die(`"${dir}" is not a "<NAME> @XEREFT BASE|PROPOSED" folder`);
const pjPath = join(dir, "project.json");
if (!existsSync(pjPath)) die(`no project.json in ${dir}`);
const pj = JSON.parse(readFileSync(pjPath, "utf8"));
const name = String(pj.name ?? "").replace(/\s*@XEREFT.*$/i, "").trim().toUpperCase() || die("project.json has no name");
const stem = basename(dir);
const hide = (p) => spawnSync("attrib", ["+h", p, ...(statSync(p).isDirectory() ? ["/d"] : [])]);
const WORK = ["project.json", "_template.dwg", "_reports", "_backup"];

// ---- --phase PROPOSED: clone the BASE folder into the design folder ----
if (flag("phase")?.toUpperCase() === "PROPOSED") {
  if (!/ BASE$/i.test(stem)) die("--phase PROPOSED starts from a BASE folder");
  const propName = stem.replace(/ BASE$/i, (m) => (m === " BASE" ? " PROPOSED" : " proposed")); // keeps the folder's case: "Goulds @xereft base" -> "Goulds @xereft proposed"
  const to = join(dirname(dir), propName);
  if (existsSync(to)) die(`${to} already exists: work in it (never overwrite a design folder)`);
  cpSync(dir, to, { recursive: true, filter: (s) => !/\.(bak|dwl2?)$/i.test(s) });
  for (const ext of [".dwg", ".pdf"]) if (existsSync(join(to, `${stem}${ext}`))) renameSync(join(to, `${stem}${ext}`), join(to, `${propName}${ext}`));
  const j = JSON.parse(readFileSync(join(to, "project.json"), "utf8"));
  j.phase = "PROPOSED"; j.deliverables = { ...j.deliverables, dwg: `${propName}.dwg`, pdf: `${propName}.pdf` }; j.package = { base: true, phase: "PROPOSED" };
  (j.history ??= []).push({ date: new Date().toISOString().slice(0, 10), event: `design folder created from ${stem}` });
  writeFileSync(join(to, "project.json"), JSON.stringify(j, null, 2));
  for (const w of WORK) if (existsSync(join(to, w))) hide(join(to, w));
  console.log(`design folder: ${to}\n  next: design inside it (project.json deliverables.dwg = ${j.deliverables.dwg})`);
  process.exit(0);
}

const dwg = join(dir, `${stem}.dwg`), pdf = join(dir, `${stem}.pdf`);
if (!existsSync(dwg)) die(`working DWG not found: ${dwg}`);
const problems = [];
if (!existsSync(join(dir, "X-TOPO.dwg"))) problems.push("X-TOPO.dwg missing");

// ---- SOURCE FILES = client's originals (only what is missing is copied; the intake folder is never touched) ----
const intake = pj.sources?.intakeDir;
let nSrc = 0;
if (intake && existsSync(intake)) {
  cpSync(intake, join(dir, "SOURCE FILES"), { recursive: true, force: false, errorOnExist: false, filter: (s) => !/\.(bak|dwl2?|sv\$|ac\$)$/i.test(s) && !/[\\/](qc|_backup|ErrorReports)$/i.test(s) });
  const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
  nSrc = count(join(dir, "SOURCE FILES"));
} else problems.push("project.json sources.intakeDir not set / not found: no SOURCE FILES");

// ---- PDF freshness + hide our working files + report anything else visible ----
if (!existsSync(pdf)) problems.push(`${basename(pdf)} missing (run fase1-from-scratch --rebuild or replot)`);
else if (statSync(pdf).mtimeMs < statSync(dwg).mtimeMs - 120000) problems.push("the PDF is older than the DWG: replot before sending");
for (const w of WORK) if (existsSync(join(dir, w))) hide(join(dir, w));
const expected = new Set([`${stem}.dwg`, `${stem}.pdf`, "X-TOPO.dwg", "X-ARCH.dwg", "X-UTIL.dwg", "SOURCE FILES", ...WORK]);
const stray = readdirSync(dir).filter((f) => !expected.has(f) && !/\.(bak|dwl2?)$/i.test(f));
if (stray.length) problems.push(`extra items in the folder (the engineer should not get them): ${stray.join(", ")}`);

// ---- verify: the DWG plots from this folder (xrefs resolve) ----
let verdict = "verify skipped";
if (!has("no-verify")) {
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "qc-plot.ps1"), "-Dwg", dwg, "-Layouts", "C-300", "-Tag", "pkg-verify"], { encoding: "utf8", timeout: 600000 });
  const line = String(r.stdout).split("\n").find((l) => /c300\.pdf/i.test(l)) ?? "";
  const kb = Number((line.match(/(\d+) KB/) ?? [])[1] ?? 0);
  const ref = existsSync(pdf) ? statSync(pdf).size / 1024 : 0;
  if (kb > 100 && (!ref || kb > ref * 0.5)) verdict = `verified: plots from the folder (${kb} KB)`;
  else { verdict = `CHECK: the DWG plot looks wrong (${line.trim() || "no plot"})`; problems.push(verdict); }
}

// ---- attributes last (a rebuild/save can leave Hidden on the DWG, and Civil 3D recreates .bak/.dwl): deliverables visible, working files hidden ----
for (const f of [`${stem}.dwg`, `${stem}.pdf`, "X-TOPO.dwg", "X-ARCH.dwg", "X-UTIL.dwg", "SOURCE FILES"]) if (existsSync(join(dir, f))) spawnSync("attrib", ["-h", join(dir, f), ...(statSync(join(dir, f)).isDirectory() ? ["/d"] : [])]);
for (const f of readdirSync(dir)) if (/\.(bak|dwl2?)$/i.test(f)) hide(join(dir, f));
for (const w of WORK) if (existsSync(join(dir, w))) hide(join(dir, w));

if (has("zip")) {
  // Civil 3D keeps the open DWG locked: Compress-Archive silently SKIPPED it (2026-10-26: three delivery zips went out without the working DWG), copying it is allowed.
  // So the deliverables are copied to a staging folder first, zipped from there (forward-slash entries), and the zip is checked to contain every deliverable.
  const z = join(tmpdir(), `${stem}.zip`), stage = join(tmpdir(), `pkg-stage-${process.pid}`);
  const names = [`${stem}.dwg`, `${stem}.pdf`, "X-TOPO.dwg", "X-ARCH.dwg", "X-UTIL.dwg", "SOURCE FILES"].filter((f) => existsSync(join(dir, f)));
  rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
  for (const f of names) cpSync(join(dir, f), join(stage, f), { recursive: true });
  if (existsSync(z)) rmSync(z, { force: true });
  const zr = spawnSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${stage.replace(/'/g, "''")}', '${z.replace(/'/g, "''")}', 'Optimal', $false)`], { encoding: "utf8" });
  rmSync(stage, { recursive: true, force: true });
  const lr = spawnSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.IO.Compression.FileSystem; $a=[IO.Compression.ZipFile]::OpenRead('${z.replace(/'/g, "''")}'); $a.Entries | ForEach-Object { $_.FullName }; $a.Dispose()`], { encoding: "utf8" });
  const inZip = new Set(String(lr.stdout).split(/\r?\n/).map((s) => s.trim().split(/[\\/]/)[0]));
  const missing = names.filter((f) => !inZip.has(f));
  if (!existsSync(z) || missing.length) { console.error(`ZIP INCOMPLETE: missing ${missing.join(", ") || "everything"} ${String(zr.stderr).slice(0, 200)}`); process.exit(1); }
  console.log(`  zip (deliverables only): ${z}  (${names.length} items incl. ${stem}.dwg)`);
}
console.log(`folder: ${dir}\n  visible: ${readdirSync(dir).filter((f) => !WORK.includes(f) && !/\.(bak|dwl2?)$/i.test(f)).join("  |  ")}${nSrc ? `\n  SOURCE FILES: ${nSrc} file(s)` : ""}\n  ${verdict}`);
for (const p of problems) console.log(`  WARN ${p}`);
process.exit(problems.some((p) => /^CHECK/.test(p)) ? 1 : 0);
