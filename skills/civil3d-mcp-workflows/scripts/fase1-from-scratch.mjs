#!/usr/bin/env node
// FASE 1 FROM SCRATCH, ONE COMMAND (no guide, no Claude credits): payload -> build -> plot + QC -> MLeader declutter loop -> report.
//
//   node fase1-from-scratch.mjs --dir "<project folder>" --dwg "<NAME> FASE1-BUILD-TESTn.dwg" --template "<template.dwg>"
//        [--asbuilt <asbuilt.json>] [--blocks-from <package C-300.dwg>] [--no-labels] [--no-pl] [--no-titleblock] [--road-labels mleader]
//        [--max-rounds 3] [--deliver] [--dry-run] [--rebuild] [--no-preview]
//   ITERATING (user, 2026-10-25: "keep rewriting the same file"): use ONE working name, e.g. --dwg "<NAME> FASE1-BUILD.dwg" --rebuild. It overwrites that file
//   (closing/restarting Civil 3D if it is open there) and refreshes "C-300 PREVIEW.pdf" + "(color).pdf" in --dir. Cheaper still, when only survey
//   look/labels change and not the engine: edit in place (fase1-xref-style.mjs / updateTextContent) and rerun fase1-finish.mjs --no-copy.
//
// Steps (each one is the script of the same name; see references/automation-backlog.md §B):
//   1. fase1-build-payload.mjs   X-TOPO dump + spec + PL symbols + R/W dims + utility labels (asbuilt.json) + title block (project.json)
//   2. fase1-build-run.mjs --build --confirm <target name>   template -> xrefs -> alignment -> entities -> twists -> notes -> save -> audit
//   3. fase1-finish.mjs --no-copy --qc-json q.json            plot (Core Console on a %TEMP% copy) + audit + QC without a guide
//   4. while QC reports problems with OUR MLeaders (under the asphalt, cut by the viewport, overlapping text):
//        fase1-declutter.py -> plan.json -> fase1-declutter-apply.mjs (acad_update_text_content on the open target, saves) -> step 3 again
//      (max --max-rounds; PL symbols, survey text and anything with no owner are only reported)
// Safety: the target must NOT exist (the runner refuses); the declutter apply refuses a drawing that is not the target and any "... FASE 1.dwg"
// unless the run is a deliberate --deliver of a new project (then pass the final name yourself; never over an existing delivered file).
// --deliver runs fase1-finish WITHOUT --no-copy at the end (PDF to _QC, project.json updated). Default = a throwaway/test build, nothing delivered.
// Needs Civil 3D open with the plugin (port 8080), Python with pymupdf + numpy, the three DWGs + project.json in --dir.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { profileByName } from "./lib/survey-profile.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const here = dirname(fileURLToPath(import.meta.url));
const die = (m, c = 2) => { console.error(m); process.exit(c); };
const dir = flag("dir") ? resolve(flag("dir")) : die('usage: node fase1-from-scratch.mjs --dir "<project folder>" --dwg "<name>.dwg" --template "<template.dwg>" [--asbuilt f] [--blocks-from f] [--max-rounds 3] [--deliver] [--dry-run]');
const dwgName = flag("dwg") ?? die("--dwg <target file name> is required (a NEW name: the runner refuses an existing file)");
const target = join(dir, dwgName);
const targetBase = basename(dwgName).replace(/\.dwg$/i, "");
const maxRounds = Number(flag("max-rounds") ?? 3);
const work = join(tmpdir(), "c3d-fase1-build", basename(dir).replace(/[^\w\-]/g, "_"));
const node = process.execPath;
const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000, env: { ...process.env, PYTHONIOENCODING: "utf-8" }, ...opts });
const log = (m) => console.log(m);
const tail = (s, n = 12) => String(s ?? "").trim().split("\n").slice(-n).join("\n");

// --rebuild = ONE working file reused for every iteration (no TEST1..N pile): only for throwaway names (…BUILD…/TEST/PRUEBA), never a "… FASE 1.dwg".
// If the file is open in Civil 3D (the plugin cannot close a document) the app is closed and restarted with close-civil3d.ps1 / start-civil3d-mcp.ps1;
// that script stops at any other dialog ("Save changes?" of the user's own drawing) and this run aborts without touching it.
const pwsh = (script, a = []) => run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, script), ...a]);
if (existsSync(target)) {
  if (!has("rebuild")) die(`${target} already exists: choose a new --dwg name, or pass --rebuild to overwrite a throwaway build file`);
  if (/ FASE 1\.dwg$/i.test(dwgName) || !/BUILD|TEST|@XEREFT (BASE|PROPOSED)\.dwg$/i.test(dwgName)) die(`--rebuild refuses "${dwgName}": only the working file ("<NAME> @XEREFT BASE.dwg") or a BUILD/TEST file, never "… FASE 1.dwg"`);
  const ol = run(node, [join(here, "plugin-rpc.mjs"), "listOpenDocuments", "{}"]);
  const isOpen = ol.status === 0 && String(ol.stdout).toLowerCase().includes(basename(dwgName).toLowerCase());
  if (isOpen) {
    log(`\n== 0. ${basename(dwgName)} is open in Civil 3D: closing and restarting Civil 3D`);
    const c = pwsh("close-civil3d.ps1", ["-AllowSave", "none.dwg", "-Discard", `${targetBase};Drawing1${flag("discard") ? ";" + flag("discard") : ""}`]);   // --discard "<other drawing name;...>": only what the user agreed to discard in this run
    const co = `${c.stdout}${c.stderr}`;
    if (c.status !== 0 || /STOP/.test(co)) die(`Civil 3D has another dialog/drawing open (probably yours): answer it, then rerun.\n${tail(co, 4)}`, 1);
    const s = pwsh("start-civil3d-mcp.ps1"); log(tail(s.stdout, 1));
    run("powershell", ["-NoProfile", "-Command", "Start-Sleep 20"]);   // the first newDrawing right after start times out otherwise
  }
  for (const ext of ["", ".bak", ".dwl", ".dwl2"]) rmSync(target.replace(/\.dwg$/i, "") + (ext || ".dwg"), { force: true });
}

// ---- 0b. survey/architecture preparation (offline, Core Console; only when the project asks for it) ----
{
  const pj = existsSync(join(dir, "project.json")) ? JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) : {};
  const src = pj.sources ?? {};
  // survey colors must be ByLayer for the xref look to apply (once per project: the backup file is the marker)
  if (src.xrefStyle === "gray" && existsSync(join(dir, "X-TOPO.dwg")) && !existsSync(join(dir, "_backup", "X-TOPO_antes_color_bylayer.dwg"))) {
    const b = pwsh("topo-bylayer.ps1", ["-Topo", join(dir, "X-TOPO.dwg")]); log(`\n== 0b. topo ByLayer: ${tail(b.stdout, 2)}`);
  }
  // survey texts that share a layer with texts we keep (e.g. lot-corner angles, absent from the VILLA ONE / Goulds sheets): moved to a layer the profile freezes (once per rule)
  {
    let prof = {}; try { prof = pj.sources?.surveyProfile ? profileByName(pj.sources.surveyProfile) : {}; } catch { /* no profile */ }
    for (const [i, rule] of (prof.hideXrefText ?? []).entries()) {
      const marker = `X-TOPO_antes_ocultar_texto${i ? i + 1 : ""}.dwg`;
      if (!existsSync(join(dir, "X-TOPO.dwg")) || existsSync(join(dir, "_backup", marker))) continue;
      const h = pwsh("topo-hide-text.ps1", ["-Topo", join(dir, "X-TOPO.dwg"), "-Layer", rule.layer, "-Match", rule.match, "-NewLayer", rule.newLayer, "-BackupName", marker]);
      log(`\n== 0b. hide survey text (${rule.layer} ${rule.match}): ${tail(h.stdout, 2)}`);
    }
  }
  // pavement/landscape callouts (SOD, PAVERS, CONC., PARKWAY, ASPHALT) + their arrows: hidden by profile `hidePavementLabels` (project.json sources.pavementLabels all|property|none overrides; once: the backup file is the marker)
  {
    let prof = {}; try { prof = pj.sources?.surveyProfile ? profileByName(pj.sources.surveyProfile) : {}; } catch { /* no profile */ }
    const pm = src.pavementLabels ?? prof.hidePavementLabels?.mode ?? "none";
    if (pm !== "none" && existsSync(join(dir, "X-TOPO.dwg")) && !existsSync(join(dir, "_backup", "X-TOPO_antes_ocultar_etiquetas_pavimento_v2.dwg"))) {
      const k = src.pavementKeep ?? {};
      const h = run(node, [join(here, "topo-hide-pavement-labels.mjs"), "--topo", join(dir, "X-TOPO.dwg"), "--mode", pm, ...(prof.hidePavementLabels?.layer ? ["--layer", prof.hidePavementLabels.layer] : []),
        ...(pm === "property" ? ["--keep-x", String(k.x), "--keep-y0", String(k.y0), "--keep-y1", String(k.y1)] : [])]);
      log(`
== 0b. hide pavement labels (${pm}): ${tail(h.stdout, 3)}`);
    }
  }
  // architecture: georeference the architect's drawings to the survey when X-ARCH.dwg does not exist yet (project.json sources.architect {site, floor}) or on --georef-arch
  if (src.architect?.site && src.architect?.floor && (!existsSync(join(dir, "X-ARCH.dwg")) || has("georef-arch"))) {
    const g = run(node, [join(here, "xarch-georef.mjs"), "--dir", dir, "--site", src.architect.site, "--floor", src.architect.floor]); log(`\n== 0b. X-ARCH georeference:\n${tail(g.stdout, 4)}`);
    if (g.status !== 0) die(`xarch-georef failed:\n${tail(`${g.stdout}${g.stderr}`, 8)}`, 1);
  }
}
// Civil 3D must answer on port 8080 before the build (start it when it is closed)
if (run(node, [join(here, "plugin-rpc.mjs"), "listOpenDocuments", "{}"]).status !== 0) {
  log("\n== 0c. Civil 3D is not running: starting it");
  const s = pwsh("start-civil3d-mcp.ps1"); log(tail(s.stdout, 1));
  run("powershell", ["-NoProfile", "-Command", "Start-Sleep 20"]);
}

// ---- 1. payload ----
log("\n== 1. payload");
// project.json sources.roadLabels:"mleader" = plain MLeaders for EOP / R/W / alignment ends: native Civil 3D labels with overridden text show the big orange "i" glyph on the recipient's screen
let projRoadLabels; try { projRoadLabels = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).sources?.roadLabels; } catch { /* no project.json */ }
const pass = ["template", "asbuilt", "blocks-from", "topo", "spec", "road-labels"].flatMap((n) => (flag(n) ? [`--${n}`, flag(n)] : n === "road-labels" && projRoadLabels ? [`--${n}`, projRoadLabels] : []))
  .concat(["no-labels", "no-pl", "no-titleblock", "no-template", "no-road-labels", "no-ue", "no-sep", "allow-simulated"].filter(has).map((n) => `--${n}`));
let r = run(node, [join(here, "fase1-build-payload.mjs"), "--dir", dir, "--dwg", dwgName, ...pass]);
log(tail(r.stdout, 18)); if (r.status !== 0) die(`payload failed:\n${tail(r.stderr || r.stdout)}`, 1);
if (has("dry-run")) { log("\nDRY RUN: payload built, nothing sent to Civil 3D."); process.exit(0); }

// ---- 2. build ----
log("\n== 2. build (runner)");
r = run(node, [join(here, "fase1-build-run.mjs"), "--dir", dir, "--build", "--confirm", targetBase]);
if (r.status !== 0 && /open template.*timed out/s.test(String(r.stdout)) && !existsSync(target)) {   // known: the first newDrawing right after Civil 3D starts
  log("first newDrawing timed out (Civil 3D just started): retrying once");
  run("powershell", ["-NoProfile", "-Command", "Start-Sleep 10"]);
  r = run(node, [join(here, "fase1-build-run.mjs"), "--dir", dir, "--build", "--confirm", targetBase]);
}
const buildLines = String(r.stdout).split("\n").filter((l) => /^ (OK|FAIL|SKIPPED|WARN)|Fase 1 build|NOT READY/.test(l));
log(buildLines.map((l) => l.slice(0, 150)).join("\n"));
if (r.status !== 0) die("\nBUILD FAILED: nothing after the failing step ran. Trash the half-built target, fix, rerun.", 1);

// ---- 2b. short dimensions whose text DIMFIT threw off their line (e.g. the 6.00' SAN-WM separation dim): put the text back, save ----
{ const fx = run(node, [join(here, "fase1-fix-dims.mjs"), "--expect", targetBase]); log(`\n== 2b. dimension texts: ${tail(fx.stdout, 3)}`); }

// ---- 2c. survey look (opt-in: project.json sources.xrefStyle = "gray"): X-TOPO layers to ACI 8 like the firm's GUIA, lot lines ACI 4, spot elevations + trees frozen ----
{
  let xs; try { xs = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).sources?.xrefStyle; } catch { /* no project.json: nothing to do */ }
  if (xs === "gray") { const st = run(node, [join(here, "fase1-xref-style.mjs"), "--expect", targetBase, "--dir", dir]); log(`\n== 2c. xref style: ${tail(st.stdout, 3)}`); }
}

// ---- 3 + 4. plot + QC, then the declutter loop ----
const qcJson = join(work, "qc.json"), planJson = join(work, "plan.json");
const finish = (extra = []) => run(node, [join(here, "fase1-finish.mjs"), "--dwg", target, "--qc-json", qcJson, ...(flag("asbuilt") ? ["--asbuilt", resolve(flag("asbuilt"))] : []), ...extra]);
let round = 0, f;
for (;;) {
  log(`\n== 3. plot + QC (round ${round})`);
  f = finish(["--no-copy"]);
  log(String(f.stdout).split("\n").filter((l) => /^(OK|WARN|FAIL|  qc:|READY|NOT READY)/.test(l)).map((l) => l.slice(0, 260)).join("\n"));
  if (!existsSync(qcJson)) { log("no qc.json (QC did not run): stopping the loop"); break; }
  const p = run("python", [join(here, "fase1-declutter.py"), "--qc", qcJson, "--out", planJson]);
  log(`\n== 4. declutter plan: ${tail(p.stdout, 8)}`);
  const plan = existsSync(planJson) ? JSON.parse(readFileSync(planJson, "utf8")) : { moves: [] };
  if (!plan.moves.length) break;
  if (round >= maxRounds) { log(`max rounds (${maxRounds}) reached with ${plan.moves.length} move(s) still planned`); break; }
  const a = run(node, [join(here, "fase1-declutter-apply.mjs"), "--plan", planJson, "--expect", targetBase]);
  log(tail(a.stdout, 8)); if (a.status !== 0) { log(`apply failed: ${tail(a.stderr)}`); break; }
  round++;
}
// ---- preview: the plotted C-300 (monochrome, what the delivered PDF looks like) + a color version, overwritten on every run, next to the build file ----
if (!has("no-preview")) {
  const plotRoot = join(tmpdir(), "c3d-dwg-dump", "plot");
  try {
    const last = readdirSync(plotRoot).map((n) => join(plotRoot, n, "c300.pdf")).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (last) { copyFileSync(last, join(dir, `${targetBase}.pdf`)); log(`\nPDF (monochrome, what the engineer gets): ${join(dir, `${targetBase}.pdf`)}`); }
    const cp = pwsh("qc-plot.ps1", ["-Dwg", target, "-Layouts", "C-300", "-Tag", "preview-color", "-Style", "acad.ctb"]);
    const colorPdf = join(plotRoot, "preview-color", "c300.pdf");
    if (existsSync(colorPdf)) { const cdst = join(tmpdir(), `${targetBase} (color preview).pdf`); copyFileSync(colorPdf, cdst); log(`color preview (temp, not in the folder): ${cdst}`); }
    else log(`color preview failed: ${tail(cp.stdout || cp.stderr, 2)}`);
  } catch (e) { log(`preview skipped: ${e instanceof Error ? e.message : e}`); }
}
// ---- REGEN: xref layer overrides (gray look) only show on the live screen after a regen; an unregenerated window kept the surveyor's orange/green/teal colors (2026-10-25) ----
try {
  const open = JSON.parse(run(node, [join(here, "plugin-rpc.mjs"), "listOpenDocuments", "{}"]).stdout.replace(/^\[[^\n]*\n/gm, "")).documents ?? [];
  const act = open.find((d) => d.isActive);
  if (act && basename(act.filePath ?? act.name).toLowerCase() === basename(target).toLowerCase()) {
    const cur = JSON.parse(run(node, [join(here, "plugin-rpc.mjs"), "getSystemVariable", '{"name":"HIGHLIGHT"}']).stdout.replace(/^\[[^\n]*\n/gm, "")).value ?? 1;
    run(node, [join(here, "plugin-rpc.mjs"), "setSystemVariable", JSON.stringify({ name: "HIGHLIGHT", value: cur, regen: true })]);   // same value: display regen only
    run(node, [join(here, "plugin-rpc.mjs"), "setSystemVariable", JSON.stringify({ name: "LABELOVERRIDEGLYPHS", value: 0, regen: true })]);   // hide the orange "i" override symbols in this session
    log("\nlive window regenerated (xref colors refreshed, label override glyphs off)");
  }
} catch (e) { log(`regen skipped: ${e instanceof Error ? e.message : e}`); }
// ---- package: the design engineer's hand-off folder "<NAME> @XEREFT BASE" (DWG + xrefs + PDF + original sources; no extra documents), rebuilt after every run ----
{
  let wantPkg = has("package");
  try { wantPkg ||= JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).package?.base === true; } catch { /* no project.json flags */ }
  if (wantPkg && !has("no-package")) { const k = run(node, [join(here, "package-base.mjs"), "--dir", dir]); log(`
== package
${tail(k.stdout || k.stderr, 6)}`); }
}
const qcLine = String(f?.stdout ?? "").split("\n").find((l) => /FASE 1 QC/.test(l)) ?? "(no QC line)";
if (has("deliver")) { log("\n== 5. deliver (PDF to _QC + project.json)"); const d = finish(); log(tail(d.stdout, 6)); }
log(`\nDONE ${targetBase}: ${qcLine.replace(/^.*FASE 1 QC/, "FASE 1 QC")} | declutter rounds applied: ${round}${has("deliver") ? " | delivered" : " | not delivered (test build)"}`);
const clean = /: 0 FAIL, 0 WARN/.test(qcLine);
process.exit(clean ? 0 : 1);
