#!/usr/bin/env node
// FASE 1 FROM SCRATCH, ONE COMMAND (no guide, no Claude credits): payload -> build -> plot + QC -> MLeader declutter loop -> report.
//
//   node fase1-from-scratch.mjs --dir "<project folder>" --dwg "<NAME> FASE1-BUILD-TESTn.dwg" --template "<template.dwg>"
//        [--asbuilt <asbuilt.json>] [--blocks-from <package C-300.dwg>] [--no-labels] [--no-pl] [--no-titleblock] [--road-labels mleader]
//        [--max-rounds 3] [--deliver] [--dry-run]
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
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

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

if (existsSync(target)) die(`${target} already exists: choose a new --dwg name (never builds over a delivered file)`);

// ---- 1. payload ----
log("\n== 1. payload");
const pass = ["template", "asbuilt", "blocks-from", "topo", "spec", "road-labels"].flatMap((n) => (flag(n) ? [`--${n}`, flag(n)] : []))
  .concat(["no-labels", "no-pl", "no-titleblock", "no-template", "no-road-labels"].filter(has).map((n) => `--${n}`));
let r = run(node, [join(here, "fase1-build-payload.mjs"), "--dir", dir, "--dwg", dwgName, ...pass]);
log(tail(r.stdout, 18)); if (r.status !== 0) die(`payload failed:\n${tail(r.stderr || r.stdout)}`, 1);
if (has("dry-run")) { log("\nDRY RUN: payload built, nothing sent to Civil 3D."); process.exit(0); }

// ---- 2. build ----
log("\n== 2. build (runner)");
r = run(node, [join(here, "fase1-build-run.mjs"), "--dir", dir, "--build", "--confirm", targetBase]);
const buildLines = String(r.stdout).split("\n").filter((l) => /^ (OK|FAIL|SKIPPED|WARN)|Fase 1 build|NOT READY/.test(l));
log(buildLines.map((l) => l.slice(0, 150)).join("\n"));
if (r.status !== 0) die("\nBUILD FAILED: nothing after the failing step ran. Trash the half-built target, fix, rerun.", 1);

// ---- 3 + 4. plot + QC, then the declutter loop ----
const qcJson = join(work, "qc.json"), planJson = join(work, "plan.json");
const finish = (extra = []) => run(node, [join(here, "fase1-finish.mjs"), "--dwg", target, "--qc-json", qcJson, ...extra]);
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
const qcLine = String(f?.stdout ?? "").split("\n").find((l) => /FASE 1 QC/.test(l)) ?? "(no QC line)";
if (has("deliver")) { log("\n== 5. deliver (PDF to _QC + project.json)"); const d = finish(); log(tail(d.stdout, 6)); }
log(`\nDONE ${targetBase}: ${qcLine.replace(/^.*FASE 1 QC/, "FASE 1 QC")} | declutter rounds applied: ${round}${has("deliver") ? " | delivered" : " | not delivered (test build)"}`);
const clean = /: 0 FAIL, 0 WARN/.test(qcLine);
process.exit(clean ? 0 : 1);
