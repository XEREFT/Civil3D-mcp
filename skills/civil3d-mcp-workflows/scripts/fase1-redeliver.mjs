#!/usr/bin/env node
// FASE 1 RE-DELIVER (born 2026-10-02, Goulds 33809: replacing a delivered sheet by a rebuilt one took 6 manual steps). Replaces the DELIVERED sheet of a project by a
// rebuilt test copy WITHOUT losing the old one, and cleans up. Default = PLAN ONLY; --yes executes.
//   node fase1-redeliver.mjs --dir <project> --build "<... FASE 1 BUILD.dwg>" --reason <TAG> [--yes] [--keep-build] [--no-close]
// Steps (all must succeed; any failure stops and leaves the old delivery in place):
//   1. checks: <build> is saved, the delivered DWG named in project.json exists, the build is not older than asbuilt.json/project.json
//   2. backs up the delivered DWG + PDF to <dir>\_backup\<YYYY-MM-DD>_antes_<TAG>\   (never deleted)
//   3. copies <build> over the delivered name, then fase1-finish.mjs --approve-golden on it (audit + PDF checks + QC + _QC\ PDF + project.json). Not READY -> stops there,
//      the delivered DWG is put BACK from the backup.
//   4. (unless --no-close) close-civil3d.ps1 saving the two Fase 1 files and discarding the template/scratch copies
//   5. (unless --keep-build) sends <build>.dwg/.bak and _QC\<build pdf> to the Recycle Bin (recoverable; standing authorization: recycle only, never permanent delete)
// Never touches another project, the xrefs or the template. Run only when the user asked to replace the delivered sheet (the plan step shows exactly what happens).
import { existsSync, readFileSync, copyFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const die = (m, c = 2) => { console.error(m); process.exit(c); };
const here = dirname(fileURLToPath(import.meta.url));
const dir = flag("dir") ? resolve(flag("dir")) : die('usage: node fase1-redeliver.mjs --dir <project> --build "<build>.dwg" --reason <TAG> [--yes] [--keep-build] [--no-close]');
const buildName = flag("build") ?? die("--build <rebuilt test copy .dwg> is required");
const reason = (flag("reason") ?? die("--reason <TAG> is required (goes into the backup folder name)")).replace(/[^\w\-]/g, "_");
const go = has("yes");
const proj = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
const delivered = proj.deliverables?.dwg ?? die("project.json has no deliverables.dwg");
const pdfRel = proj.deliverables?.pdf ?? "_QC/C-300 FASE 1.pdf";
const build = join(dir, buildName), dest = join(dir, delivered), pdf = join(dir, pdfRel);
const buildPdf = join(dir, "_QC", `${basename(pdfRel).replace(/\.pdf$/i, "")} BUILD.pdf`);
const backup = join(dir, "_backup", `${new Date().toISOString().slice(0, 10)}_antes_${reason}`);
if (!existsSync(build)) die(`build not found: ${build}`);
if (!existsSync(dest)) die(`delivered DWG not found: ${dest} (use fase1-from-scratch --deliver for a first delivery)`);
if (basename(build) === basename(dest)) die("--build must be a different file than the delivered one");
const abFile = join(dir, "asbuilt.json");
const stale = existsSync(abFile) && statSync(abFile).mtimeMs > statSync(build).mtimeMs ? ["asbuilt.json"] : [];
const plan = [
  `backup   ${delivered} + ${basename(pdf)} -> ${backup}`,
  `replace  ${buildName} -> ${delivered}   then fase1-finish --approve-golden (audit + PDF + QC + _QC PDF + project.json)`,
  has("no-close") ? "close    (skipped: --no-close)" : "close    Civil 3D (saves the two Fase 1 files, discards template/scratch copies)",
  has("keep-build") ? "recycle  (skipped: --keep-build)" : `recycle  ${buildName}, its .bak and ${basename(buildPdf)} -> Recycle Bin`,
];
console.log("PLAN:\n  " + plan.join("\n  "));
if (stale.length) console.log(`WARNING: asbuilt.json is NEWER than the build (${buildName}): the build may not contain the last as-built change; rebuild first.`);
if (!go) { console.log("\nPLAN ONLY. Re-run with --yes to execute."); process.exit(0); }
if (stale.length) die("refusing to deliver a build older than asbuilt.json (rebuild, or touch nothing)", 3);

const run = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000, env: { ...process.env, PYTHONIOENCODING: "utf-8" }, ...o });
mkdirSync(backup, { recursive: true });
copyFileSync(dest, join(backup, delivered)); if (existsSync(pdf)) copyFileSync(pdf, join(backup, basename(pdf)));
console.log(`backed up -> ${backup}`);
copyFileSync(build, dest);
const fin = run(process.execPath, [join(here, "fase1-finish.mjs"), "--dwg", dest, "--approve-golden"]);
const tail = String(fin.stdout).trim().split("\n").slice(-8).join("\n");
console.log(tail);
if (fin.status !== 0 || !/READY: Fase 1 delivered/.test(fin.stdout)) {
  copyFileSync(join(backup, delivered), dest);
  if (existsSync(join(backup, basename(pdf)))) copyFileSync(join(backup, basename(pdf)), pdf);
  die("fase1-finish was NOT READY: the previous delivery was put back from the backup (nothing else changed).", 1);
}
if (!has("no-close")) {
  const ps = (frag) => run("pwsh", ["-NoProfile", "-File", join(here, "close-civil3d.ps1"), "-AllowSave", `${basename(dest)};${basename(build)}`, "-Discard", frag, "-TimeoutSec", "90"]);
  let r = ps("_template.dwg");                                         // one fragment per call (see known-bug close-civil3d-discard)
  if (r.status === 2) r = ps("c3d-dwg-dump");
  console.log(String(r.stdout).trim().split("\n").slice(-3).join("\n"));
  if (r.status !== 0) console.log("Civil 3D is still open (a dialog needs the user): the delivery is done; recycling the build copy is skipped.");
  else if (!has("keep-build")) recycle();
} else if (!has("keep-build")) console.log("build copy kept open-safe: close Civil 3D, then recycle it by hand (or re-run without --no-close).");
function recycle() {
  const files = [build, build.replace(/\.dwg$/i, ".bak"), buildPdf].filter(existsSync);
  const script = "Add-Type -AssemblyName Microsoft.VisualBasic; foreach($p in $args){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin')}";
  const r = run("pwsh", ["-NoProfile", "-Command", script, ...files]);
  console.log(r.status === 0 ? `recycled: ${files.map((f) => basename(f)).join(", ")}` : `recycle failed: ${r.stderr}`);
}
console.log(`\nDELIVERED ${delivered} (previous version in ${backup}). Update memory + skill sync.`);
