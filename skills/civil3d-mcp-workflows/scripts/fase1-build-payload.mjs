#!/usr/bin/env node
// FASE 1 BUILD PAYLOAD: everything civil3d_workflow_fase1_build needs, from the project folder, in one command (no Civil 3D needed).
//
//   node fase1-build-payload.mjs --dir "<...>\AUTOCAD @XEREFT\<NAME> @XEREFT"
//        [--dwg "<NAME> @XEREFT FASE 1.dwg"]   target file name (default: "<folder name> FASE 1.dwg")
//        [--template <.dwg>]                   default <dir>\_template.dwg (new-project.mjs builds it); --no-template = the target
//                                              drawing is already open and active (then only expectedDocument guards the writes)
//        [--topo <X-TOPO dump.txt> | --spec <spec.json>]   default: dwg-dump.ps1 on <dir>\X-TOPO.dwg + c300-build-spec.mjs
//        [--out payload.json] [--overwrite]
//
// Chain: X-TOPO.dwg -> dwg-dump.ps1 -> c300-build-spec.mjs (project.json schema 1, window derived when missing) -> this payload.
// Payload = { templatePath, saveAs, overwrite, expectedDocument, xrefs (roles.xref of standards/formtech-c300.json), alignment,
//             clImport (_cl from X-TOPO), entities, layers, twists (C-300 largest viewport + Model tab, centre = alignment midpoint),
//             titleBlock (project.json "titleBlock" array, if any), save:true }  -- stripPropNotes is on by default in the tool.
// Then, in the Claude session (validated on VILLA ONE 2026-09-28, 9/9 OK):
//   civil3d_request_approval { toolName:"civil3d_workflow_fase1_build", action:"fase1_build", parameters:<payload> }
//   civil3d_workflow_fase1_build { ...<payload>, approvalToken }    <- the SAME JSON, byte for byte (read it from the file)
// Safety: refuses to target an existing file unless --overwrite (never overwrite a delivered FASE 1 without the user), and refuses a
// template outside the plugin's file roots (Documents, or CIVIL3D_IMPORT_ROOTS / CIVIL3D_FILE_ROOTS): civil3d_drawing new would.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const here = dirname(fileURLToPath(import.meta.url));
const die = (m) => { console.error(m); process.exit(2); };
const win = (p) => resolve(p).replace(/\//g, "\\");

const dirArg = flag("dir");
if (!dirArg) die('usage: node fase1-build-payload.mjs --dir "<project folder>" [--dwg name.dwg] [--template t.dwg | --no-template] [--topo dump | --spec spec.json] [--out payload.json] [--overwrite]');
const dir = resolve(dirArg);
if (!existsSync(join(dir, "project.json"))) die(`${dir}\\project.json not found (bootstrap with new-project.mjs / project-state.mjs init)`);
const std = JSON.parse(readFileSync(join(here, "../references/standards/formtech-c300.json"), "utf8"));
const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
const work = join(tmpdir(), "c3d-fase1-build", basename(dir).replace(/[^\w\-]/g, "_"));
mkdirSync(work, { recursive: true });

// ---------- plugin file roots (FileBoundary.cs: CIVIL3D_IMPORT_ROOTS, else CIVIL3D_FILE_ROOTS, else MyDocuments) ----------
function pluginRoots() {
  const env = process.env.CIVIL3D_IMPORT_ROOTS || process.env.CIVIL3D_FILE_ROOTS;
  if (env) return env.split(/[;|]/).map((r) => r.trim()).filter(Boolean).map(win);
  const r = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"], { encoding: "utf8" });
  return [win((r.stdout ?? "").trim() || join(process.env.USERPROFILE ?? "", "Documents"))];
}
const underRoots = (p) => pluginRoots().some((root) => win(p).toLowerCase().startsWith(root.toLowerCase().replace(/\\?$/, "\\")));

// ---------- spec ----------
let spec;
if (flag("spec")) {
  spec = JSON.parse(readFileSync(flag("spec"), "utf8"));
} else {
  let dump = flag("topo");
  if (!dump) {
    const topo = join(dir, "X-TOPO.dwg");
    if (!existsSync(topo)) die(`${topo} not found`);
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "dwg-dump.ps1"), topo, "-OutDir", work], { encoding: "utf8", timeout: 600000 });
    dump = (r.stdout ?? "").trim().split(/\r?\n/).pop();
    if (r.status !== 0 || !dump || !existsSync(dump)) die(`dwg-dump.ps1 failed: ${((r.stdout ?? "") + (r.stderr ?? "")).slice(-300)}`);
  }
  const specPath = join(work, "spec.json");
  const r = spawnSync("node", [join(here, "c300-build-spec.mjs"), "--topo", dump, "--project", join(dir, "project.json"), "--out", specPath], { encoding: "utf8" });
  if (r.status !== 0) die(`c300-build-spec.mjs failed:\n${(r.stderr || r.stdout || "").trim()}`);
  console.log(r.stdout.trim());
  spec = JSON.parse(readFileSync(specPath, "utf8"));
}

// ---------- target + template ----------
const dwgName = flag("dwg") ?? `${basename(dir)} FASE 1.dwg`;
const target = join(dir, dwgName);
const payload = {};
if (!has("no-template")) {
  const template = flag("template") ?? join(dir, "_template.dwg");
  if (!existsSync(template)) die(`template ${template} not found (new-project.mjs builds <dir>\\_template.dwg; or pass --template, or --no-template with the target already open)`);
  if (!underRoots(template)) die(`template ${template} is outside the plugin's file roots (${pluginRoots().join("; ")}): civil3d_drawing new would refuse it ("outside the configured roots")`);
  if (existsSync(target) && !has("overwrite")) die(`${target} already exists: refusing to build over it (a delivered FASE 1?). Use another --dwg name, or --overwrite only after the user confirms.`);
  Object.assign(payload, { templatePath: win(template), saveAs: win(target), overwrite: has("overwrite") });
}
payload.expectedDocument = dwgName;

// ---------- xrefs, alignment, block, entities, twists ----------
const xr = std.roles.xref;
payload.xrefs = xr.names.map((n) => join(dir, `${n}.dwg`)).filter((f) => existsSync(f)).map((f) => ({ filePath: win(f), layer: xr.layer, overlay: xr.overlay }));
const missingXrefs = xr.names.filter((n) => !existsSync(join(dir, `${n}.dwg`)));
const { lengthFt, ...alignment } = spec.alignment;
payload.alignment = alignment;
const entities = spec.createEntities.entities;
const clName = std.roles.clSymbol.blockName;
if (entities.some((e) => e.kind === "block" && e.blockName === clName)) payload.clImport = { blockName: clName, sourceFilePath: win(join(dir, "X-TOPO.dwg")) };
payload.entities = entities;
payload.layers = spec.createEntities.layers;
const [a, b] = spec.alignment.points;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
payload.twists = [
  { layout: spec.twist.layout, streetAngleDegrees: spec.twist.streetAngleDegrees, centerX: spec.twist.centerX, centerY: spec.twist.centerY },
  { layout: "Model", streetAngleDegrees: spec.twist.streetAngleDegrees, centerX: r4((a.x + b.x) / 2), centerY: r4((a.y + b.y) / 2) },
];
if (Array.isArray(project.titleBlock) && project.titleBlock.length) payload.titleBlock = project.titleBlock;
payload.save = true;

const out = flag("out") ?? join(work, "payload.json");
writeFileSync(out, JSON.stringify(payload));
console.log(`
payload -> ${out}
 target      ${payload.saveAs ?? `(already open) ${dwgName}`}${payload.templatePath ? `\n template    ${payload.templatePath}` : ""}
 xrefs       ${payload.xrefs.map((x) => basename(x.filePath)).join(", ")}${missingXrefs.length ? `   (MISSING in the folder: ${missingXrefs.join(", ")})` : ""}
 alignment   ${alignment.name} ${lengthFt} ft, style ${alignment.style}
 entities    ${entities.length}${payload.clImport ? ` (first ${clName} imported from X-TOPO)` : ""}
 twists      ${payload.twists.map((t) => `${t.layout} ${t.streetAngleDegrees}°`).join(", ")}
 titleBlock  ${payload.titleBlock ? `${payload.titleBlock.length} replacement(s)` : "none (project.json has no titleBlock array)"}
NEXT (Claude session): civil3d_request_approval {toolName:"civil3d_workflow_fase1_build", action:"fase1_build", parameters:<file contents>}
 -> civil3d_workflow_fase1_build {<file contents>, approvalToken} -> civil3d_workflow_fase1_audit -> /fase1 (fase1-finish.mjs)`);
