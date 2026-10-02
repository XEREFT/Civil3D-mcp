#!/usr/bin/env node
// NEW PROJECT BOOTSTRAP: everything about a new Fase 1 project that does not need a live Civil 3D session, in one command.
//   node new-project.mjs --name "VILLA ONE" [--project-no 26-04.047] [--agr 33810] [--root "<...>\AUTOCAD @XEREFT"]
//        [--poc <POC.pdf>] [--topo <X-TOPO.dwg>] [--util <X-UTIL.dwg>] [--arch <X-ARCH.dwg>]
//        [--template-from <previous project's C-300.dwg>] [--xy 859852,444852] [--dry-run]
// Creates <root>\<NAME> @XEREFT\ with _QC, _backup and _reports; copies the base xrefs in as X-TOPO/X-UTIL/X-ARCH.dwg (never moves them);
// builds _template.dwg from the previous project's C-300 (c300-prep-template.ps1, Core Console on a copy); writes project.json;
// reads the POC (poc-extract.mjs -> subject data) and ALWAYS the Property Appraiser (pa-site.mjs: cross-checks the POC folio, the address and
// --xy; writes project.json only on an OK verdict, else lists the candidates — read-only web queries);
// then prints the exact MCP steps that remain (they need the live Civil 3D session).
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const here = dirname(fileURLToPath(import.meta.url));
const ps = await import(pathToFileURL(join(here, "project-state.mjs")).href);
const dry = has("dry-run");
const name = flag("name");
if (!name) { console.error("usage: node new-project.mjs --name \"<PROJECT>\" [--project-no ..] [--agr ..] [--poc ..] [--topo ..] [--util ..] [--arch ..] [--template-from ..] [--xy x,y] [--dry-run]"); process.exit(2); }
const root = (flag("root") ?? ps.DEFAULT_ROOT).replace(/\\/g, "/");
const folderName = name.toUpperCase().endsWith("@XEREFT") ? name : `${name.toUpperCase()} @XEREFT`;
const dir = join(root, folderName).replace(/\\/g, "/");
const done = [];
const doStep = (label, fn) => { if (dry) { console.log(`[dry-run] ${label}`); return; } fn(); console.log(`ok   ${label}`); done.push(label); };

if (existsSync(join(dir, "project.json"))) { console.error(`${dir}/project.json already exists: this project was already bootstrapped (use project-state.mjs).`); process.exit(2); }

doStep(`folders ${dir} (+ _QC, _backup, _reports)`, () => { for (const d of ["", "_QC", "_backup", "_reports"]) mkdirSync(join(dir, d), { recursive: true }); });

for (const [key, target] of [["topo", "X-TOPO.dwg"], ["util", "X-UTIL.dwg"], ["arch", "X-ARCH.dwg"]]) {
  const src = flag(key);
  if (!src) continue;
  if (!existsSync(src)) { console.error(`WARN --${key} not found: ${src}`); continue; }
  doStep(`copy ${basename(src)} -> ${target}`, () => copyFileSync(src, join(dir, target)));
}

const templateFrom = flag("template-from");
if (templateFrom) {
  if (!existsSync(templateFrom)) console.error(`WARN --template-from not found: ${templateFrom}`);
  else doStep("build _template.dwg (c300-prep-template.ps1 on a copy: model space emptied, xrefs detached, layouts renamed, C-301 deleted = Fase 1)", () => {
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "c300-prep-template.ps1"), "-Source", templateFrom, "-Out", join(dir, "_template.dwg"), "-DeleteLayouts", "C-301"], { encoding: "utf8", timeout: 600000 });
    if (r.status !== 0 || !existsSync(join(dir, "_template.dwg"))) throw new Error("c300-prep-template.ps1 failed: " + ((r.stdout ?? "") + (r.stderr ?? "")).slice(-300));
  });
}

doStep("project.json", () => {
  ps.saveProject(dir, {
    schema: ps.SCHEMA, name: name.replace(/\s*@XEREFT\s*$/i, "").toUpperCase(), projectNo: flag("project-no"), agrNo: flag("agr"),
    phase: 1, status: "new",
    deliverables: { dwg: `${folderName} FASE 1.dwg`, pdf: "_QC/C-300 FASE 1.pdf", layout: "C-300" },
    subject: {}, site: {}, sources: {}, decisions: [
      { date: new Date().toISOString().slice(0, 10), text: "Fase 1 = existing conditions only: no PROP/PROPOSED wording, alignment BCC - ALIGNMENT, existing SAN/WM as X-UTIL layers, C-TINN-BNDY frozen (firm standard)" },
    ], history: [{ date: new Date().toISOString().slice(0, 10), event: "bootstrapped by new-project.mjs" }], lastVerified: {},
  });
});

if (flag("poc") && !dry) {
  const r = spawnSync("node", [join(here, "poc-extract.mjs"), flag("poc"), "--project", dir], { encoding: "utf8", timeout: 120000 });
  console.log(r.status === 0 ? "ok   POC read -> project.json (subject/agr/GPD/folio)" : `WARN POC read failed: ${(r.stderr ?? "").slice(-200)}`);
  if (r.stderr?.includes("CONFLICTS")) console.log(r.stderr.trim());
} else if (flag("poc")) console.log("[dry-run] read the POC into project.json");

// Property Appraiser — ALWAYS (user rule): pa-site.mjs cross-checks the document folio (from the POC above), the address and the lot
// point (--xy), writes project.json only when the verdict is OK, and otherwise prints the candidates to choose from.
if (!dry) {
  const paArgs = [join(here, "pa-site.mjs"), "--dir", dir, "--write", ...(flag("xy") ? ["--xy", flag("xy")] : [])];
  const r = spawnSync("node", paArgs, { encoding: "utf8", timeout: 120000 });
  const lines = (r.stdout ?? "").trim().split("\n");
  console.log(`${r.status === 0 ? "ok  " : "WARN"} Property Appraiser (pa-site.mjs): ${lines[0] ?? ""}`);
  for (const l of lines.slice(1).filter((l) => /^\s+(\d|note|CONFLICT|chosen)/.test(l))) console.log(`     ${l.trim()}`);
  if (r.status !== 0 && !lines.length) console.log(`     ${(r.stderr ?? "").slice(-200)}`);
} else console.log("[dry-run] Property Appraiser: node scripts/pa-site.mjs --dir <project> --write [--xy X,Y]");

// Property Appraiser AREA (user's manual routine, automated): streets of the survey -> "11800 227" search -> possible folios -> every lot of the window with
// its legal size vs its GIS polygon (R/W dedications) + U.E. candidates on the shared lot lines. Non fatal; report in <project>\_reports\pa-area_<date>.json.
if (!dry) {
  const r = spawnSync("node", [join(here, "pa-area.mjs"), "--dir", dir, "--write"], { encoding: "utf8", timeout: 600000 });
  const out = (r.stdout ?? "").trim().split("\n");
  console.log(`${r.status === 0 ? "ok  " : "WARN"} Property Appraiser area (pa-area.mjs): ${out.filter((l) => /^search|^lots inside|^report/.test(l)).join(" | ")}`);
  if (r.status !== 0) console.log(`     ${(r.stderr ?? "").slice(-200)}`);
} else console.log("[dry-run] Property Appraiser area: node scripts/pa-area.mjs --dir <project> --write");

const rel = (f) => `${dir}/${f}`;
console.log(`
NEXT (recipe = skill references/c300-water-sewer-plan.md section 7 + 9 "Receta Fase 1"; shortcut: /fase1-build):
 1. site.lotPoint: pa-site.mjs above fills it with the parcel centroid when its verdict is OK; if it asked for the lot point or
    the folio, rerun: node scripts/pa-site.mjs --dir "${dir}" --xy X,Y --write   (U.E.: download the plat P.B./PG it printed from the Clerk)
 2. node scripts/fase1-build-payload.mjs --dir "${dir}"   (X-TOPO dump + spec + PL symbols + survey R/W dims + payload for "${folderName} FASE 1.dwg" from ${existsSync(join(dir, "_template.dwg")) ? "_template.dwg" : "<pass --template: no _template.dwg yet>"})
 2b. EVERYTHING IN ONE COMMAND (payload + build + plot + QC + MLeader declutter): node scripts/fase1-from-scratch.mjs --dir "${dir}" --dwg "<NEW name>.dwg" --template "<template>.dwg" [--asbuilt asbuilt.json --blocks-from <package C-300.dwg>]
    (title block comes from project.json: name, subject.address, projectNo, agrNo (POC), date, JH; the template is almost always the Goulds C-300)
 3. build only (no credits, Civil 3D open with NO drawing): node scripts/fase1-build-run.mjs --dir "${dir}" --build [--finish]
    (= civil3d_workflow_fase1_build + audit: template, xrefs, freeze X-TOPO|DIM, alignment BCC, _cl, entities, twists, no-PROP notes, save)
 4. as-builts (scans): scan-ocr.ps1 -> asbuilt-extract -> asbuilt-associate -> asbuilt-review.py (YOU confirm) -> asbuilt-build -> c300-utility-labels
    still by hand: U.E. (plat PDF from the Clerk); EOP / EXIST R/W / ALIGNMENT START labels are generated by the build (c300-road-labels.mjs)
 5. /fase1 (civil3d_workflow_fase1_audit, then node scripts/fase1-finish.mjs) -> READY
 Then: node scripts/project-state.mjs log "${dir}" "<what you did>" and keep decisions with 'decide'.`);
