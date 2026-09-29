#!/usr/bin/env node
// NEW PROJECT BOOTSTRAP: everything about a new Fase 1 project that does not need a live Civil 3D session, in one command.
//   node new-project.mjs --name "VILLA ONE" [--project-no 26-04.047] [--agr 33810] [--root "<...>\AUTOCAD @XEREFT"]
//        [--poc <POC.pdf>] [--topo <X-TOPO.dwg>] [--util <X-UTIL.dwg>] [--arch <X-ARCH.dwg>]
//        [--template-from <previous project's C-300.dwg>] [--xy 859852,444852] [--dry-run]
// Creates <root>\<NAME> @XEREFT\ with _QC, _backup and _reports; copies the base xrefs in as X-TOPO/X-UTIL/X-ARCH.dwg (never moves them);
// builds _template.dwg from the previous project's C-300 (c300-prep-template.ps1, Core Console on a copy); writes project.json;
// reads the POC (poc-extract.mjs -> subject data) and, only with --xy, the Property Appraiser (pa-lookup.mjs -> folio/plat, a read-only web query);
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

if (flag("xy") && !dry) {
  const r = spawnSync("node", [join(here, "pa-lookup.mjs"), "--xy", flag("xy")], { encoding: "utf8", timeout: 60000 });
  try {
    const pa = JSON.parse(r.stdout);
    const hit = (pa.parcels ?? pa.results ?? [pa])[0] ?? {};
    const p = ps.loadProject(dir);
    p.sources.pa = pa; p.subject.folio ??= hit.folio; p.subject.pb ??= (hit.plat ?? hit.pb)?.replace?.(/^P\.B\.\s*/i, "");
    ps.saveProject(dir, p);
    console.log(`ok   Property Appraiser lookup -> folio ${p.subject.folio ?? "?"}`);
  } catch { console.log(`WARN Property Appraiser lookup gave no usable JSON (${(r.stderr ?? r.stdout ?? "").slice(-120)})`); }
}

const rel = (f) => `${dir}/${f}`;
console.log(`
NEXT (recipe = skill references/c300-water-sewer-plan.md section 7 + 9 "Receta Fase 1"; shortcut: /fase1-build):
 1. site.lotPoint (PA centroid; --xy above or node scripts/pa-lookup.mjs --xy X,Y): node scripts/project-state.mjs set "${dir}" site.lotPoint=[x,y]
    (site.window is optional: c300-build-spec.mjs derives it from the X-TOPO cluster around lotPoint and prints it)
 2. node scripts/fase1-build-payload.mjs --dir "${dir}"   (X-TOPO dump + spec + payload for "${folderName} FASE 1.dwg" from ${existsSync(join(dir, "_template.dwg")) ? "_template.dwg" : "<pass --template: no _template.dwg yet>"})
 3. Claude: civil3d_request_approval {toolName:"civil3d_workflow_fase1_build", action:"fase1_build", parameters:<payload>}
    -> civil3d_workflow_fase1_build {<payload>, approvalToken}: template, xrefs, alignment BCC, _cl, entities, twists, no-PROP notes, save
 4. still by hand (other scripts): utility labels (c300-utility-labels.mjs), PL symbols (c300-pl-symbols.mjs), U.E., package replay, title block
 5. /fase1 (civil3d_workflow_fase1_audit, then node scripts/fase1-finish.mjs) -> READY
 Then: node scripts/project-state.mjs log "${dir}" "<what you did>" and keep decisions with 'decide'.`);
