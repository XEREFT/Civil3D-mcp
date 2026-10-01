#!/usr/bin/env node
// FASE 1 BUILD PAYLOAD: everything civil3d_workflow_fase1_build needs, from the project folder, in one command (no Civil 3D needed).
//
//   node fase1-build-payload.mjs --dir "<...>\AUTOCAD @XEREFT\<NAME> @XEREFT"
//        [--dwg "<NAME> @XEREFT FASE 1.dwg"]   target file name (default: "<folder name> FASE 1.dwg")
//        [--template <.dwg>]                   default <dir>\_template.dwg (new-project.mjs builds it); --no-template = the target
//                                              drawing is already open and active (then only expectedDocument guards the writes)
//        [--topo <X-TOPO dump.txt> | --spec <spec.json>]   default: dwg-dump.ps1 on <dir>\X-TOPO.dwg + c300-build-spec.mjs
//        [--out payload.json] [--overwrite]
//        [--asbuilt asbuilt.json] [--blocks-from <package C-300.dwg>] [--no-labels]   existing-utility labels (default asbuilt.json in the
//                                              folder or project.json sources.asbuilt; blocks FH / EXIST ARROW imported from --blocks-from
//                                              or sources.blocksFrom when the template lacks them)
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
// PL symbols (etapa 1.6, 2026-10-01): one per lot line shared by two county plat lots inside the C-300 viewport, from the
// Property Appraiser's Lot_poly (c300-pl-symbols.mjs) -> appended to the same createEntities batch. --no-pl skips; a web failure
// only warns (the build still runs, the summary says PL 0).
let plCount = 0, plNote = "";
if (!has("no-pl")) {
  const plOut = join(work, "pl.json");
  // etapa 1.5: the symbols keep clear of the annotation already in the payload (R/W dim texts = their midpoints, street labels,
  // the subject label) — c300-pl-symbols.mjs slides a clashing symbol along its own lot line
  const avoid = payload.entities.flatMap((e) =>
    e.kind === "aligned_dimension" ? [[(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2]] : e.kind === "mtext" && e.x != null ? [[e.x, e.y]] : [])
    .map((p) => p.map((v) => v.toFixed(2)).join(",")).join(";");
  const r = spawnSync("node", [join(here, "c300-pl-symbols.mjs"), "--frontage", String(spec.twist.streetAngleDegrees),
    "--center", `${spec.twist.centerX},${spec.twist.centerY}`, "--out", plOut, ...(avoid ? ["--avoid", avoid] : [])], { encoding: "utf8" });
  const movedPl = (r.stdout ?? "").split("\n").filter((l) => /moved|STILL ON/.test(l));
  if (movedPl.length) plNote = ` (${movedPl.length} slid clear of other annotation: ${movedPl.map((l) => l.trim()).join(" | ")})`;
  if (r.status === 0 && existsSync(plOut)) {
    const pl = JSON.parse(readFileSync(plOut, "utf8")).createEntities?.entities ?? [];
    payload.entities = [...payload.entities, ...pl];
    plCount = pl.length;
  } else plNote += ` (NOT added: ${(r.stderr || r.stdout || "c300-pl-symbols failed").trim().split("\n").pop()})`;
}
// Existing-utility labels (etapa 3, 2026-10-01): when the as-built chain produced an asbuilt.json (scan-ocr -> asbuilt-extract -> -associate ->
// asbuilt-review (user confirms) -> asbuilt-build), c300-utility-labels.mjs turns it into the sewer/water/MH/FH MLeaders + FH + EXIST ARROW
// blocks, appended to the SAME entity batch. The two block definitions come from --blocks-from (a package C-300 that has them; never the
// guide) through the build's blockImports. No asbuilt.json = no labels (fase1-qc then FAILs the unlabeled X-UTIL items, which is the point).
let labelNote = "none (no asbuilt.json: pass --asbuilt, or put it in the project folder / project.json sources.asbuilt)";
const asbuiltPath = flag("asbuilt") ?? [project.sources?.asbuilt, join(dir, "asbuilt.json")].filter(Boolean).map((p) => resolve(dir, p)).find((p) => existsSync(p));
if (!has("no-labels") && asbuiltPath && existsSync(asbuiltPath)) {
  const labelsOut = join(work, "labels.json");
  const r = spawnSync("node", [join(here, "c300-utility-labels.mjs"), "--asbuilt", asbuiltPath, "--out", labelsOut], { encoding: "utf8" });
  if (r.status !== 0 || !existsSync(labelsOut)) die(`c300-utility-labels.mjs failed:\n${(r.stderr || r.stdout || "").trim()}`);
  const labels = JSON.parse(readFileSync(labelsOut, "utf8"));
  const asb = JSON.parse(readFileSync(asbuiltPath, "utf8"));
  const warn = [];
  if (Math.abs((asb.frontageAngleDeg ?? NaN) - spec.twist.streetAngleDegrees) > 0.5) warn.push(`asbuilt frontage ${asb.frontageAngleDeg} deg vs sheet ${spec.twist.streetAngleDegrees} deg: label rotation will not match the sheet`);
  const blocksFrom = flag("blocks-from") ?? project.sources?.blocksFrom;
  const labelEntities = [...Object.values(labels.firstBlocks ?? {}), ...(labels.createEntities?.entities ?? [])];
  const blockNames = [...new Set(labelEntities.filter((e) => e.kind === "block").map((e) => e.blockName))];
  if (blocksFrom && existsSync(resolve(dir, blocksFrom))) {
    if (!underRoots(resolve(dir, blocksFrom))) die(`--blocks-from ${blocksFrom} is outside the plugin's file roots`);
    payload.blockImports = blockNames.map((blockName) => ({ blockName, sourceFilePath: win(resolve(dir, blocksFrom)) }));
  } else warn.push(`no --blocks-from / project.json sources.blocksFrom: ${blockNames.join(", ")} must already be in the template`);
  payload.entities = [...payload.entities, ...labelEntities];
  payload.layers = { ...payload.layers, ...Object.fromEntries([...new Set(labelEntities.map((e) => e.layer))].filter((n) => n && std.layers[n] && !(n in payload.layers)).map((n) => [n, std.layers[n]])) };
  const kinds = {}; for (const e of labelEntities) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  labelNote = `${labelEntities.length} entities ${JSON.stringify(kinds)} from ${asbuiltPath}${warn.length ? "  WARN: " + warn.join("; ") : ""}`;
}
if (Array.isArray(project.titleBlock) && project.titleBlock.length) payload.titleBlock = project.titleBlock;
// xref layers that print duplicated on the sheet (survey R/W dims on X-TOPO|DIM): frozen by the build right after the xrefs
payload.freezeLayers = std.roles?.fase1?.freezeXrefLayers?.layers ?? ["X-TOPO|DIM"];
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
 freeze      ${payload.freezeLayers.join(", ")}
 PL symbols  ${plCount}${plNote}${has("no-pl") ? " (--no-pl)" : ""}
 utility labels ${labelNote}${payload.blockImports ? `\n block imports ${payload.blockImports.map((b) => b.blockName).join(", ")} <- ${basename(payload.blockImports[0].sourceFilePath)}` : ""}
NEXT (Claude session): civil3d_request_approval {toolName:"civil3d_workflow_fase1_build", action:"fase1_build", parameters:<file contents>}
 -> civil3d_workflow_fase1_build {<file contents>, approvalToken} -> civil3d_workflow_fase1_audit -> /fase1 (fase1-finish.mjs)
NEXT (your terminal, no Claude): node "${join(here, "fase1-build-run.mjs")}" --dir "${dir}" --build [--finish]`);
