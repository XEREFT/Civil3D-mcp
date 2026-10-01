#!/usr/bin/env node
// FASE 1 BUILD RUN — no Claude, no credits: runs the SAME code as civil3d_workflow_fase1_build (the plugin repo's compiled
// build/tools/domains/fase1Build.js) straight against the live Civil 3D plugin (port 8080), then the native Fase 1 audit
// (build/tools/domains/fase1Audit.js, same as civil3d_workflow_fase1_audit). The whole C-300 Fase 1 path from a terminal:
//
//   node fase1-build-payload.mjs --dir "<project folder>"        -> %TEMP%\c3d-fase1-build\<folder>\payload.json (no Civil 3D)
//   node fase1-build-run.mjs     --dir "<project folder>" --build -> opens the template, builds, cleans PROP notes, saves, audits
//   node fase1-finish.mjs        --dwg "<target .dwg>"            -> dump audit + plot + PDF checks + PDF to _QC (or add --finish here)
//
//   node fase1-build-run.mjs (--dir "<project folder>" | --payload <payload.json>) [--build [--confirm "<target name>"]]
//                            [--finish [--no-copy]] [--repo <Civil3D-mcp>]
//
// Without --build it only prints the plan (dry run, nothing sent to Civil 3D). With --build you confirm the target file name: typed
// at an interactive terminal, or --confirm "<target name>" (that confirmation replaces the MCP approval token, which exists for
// Claude's calls; Claude may use --confirm only because the user allowed this script in .claude/settings.local.json). The tool's own guards all still run: the template opens as a NEW drawing,
// expectedDocument is checked after opening, before the first write and before the save, and saveAs refuses an existing file unless
// the payload says overwrite (fase1-build-payload.mjs only sets that with --overwrite). This script also refuses up front when the
// target already exists. Civil 3D must be running with the plugin loaded (better with NO drawing open: a build once hung in
// attachXref with another drawing that referenced the same X-TOPO open).
// Exit 1 on any FAIL: later steps are SKIPPED and nothing before the failure is undone — read the failing step, trash the
// half-built target, fix, rerun. The step list is also written to result.json next to the payload.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const here = dirname(fileURLToPath(import.meta.url));
const die = (m, code = 2) => { console.error(m); process.exit(code); };
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp").replace(/\\/g, "/");

// ---------- payload ----------
let payloadPath = flag("payload");
if (!payloadPath && flag("dir")) {
  // same work folder as fase1-build-payload.mjs
  payloadPath = join(tmpdir(), "c3d-fase1-build", basename(resolve(flag("dir"))).replace(/[^\w\-]/g, "_"), "payload.json");
}
if (!payloadPath) die('usage: node fase1-build-run.mjs (--dir "<project folder>" | --payload payload.json) [--yes] [--finish [--no-copy]] [--repo <Civil3D-mcp>]');
if (!existsSync(payloadPath)) die(`${payloadPath} not found: run fase1-build-payload.mjs --dir "<project folder>" first`);
const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
const target = payload.saveAs ?? payload.expectedDocument;
if (!payload.expectedDocument && !payload.saveAs) die("payload has neither expectedDocument nor saveAs: the build would refuse to write anything");
if (payload.saveAs && existsSync(payload.saveAs) && !payload.overwrite) {
  die(`${payload.saveAs} already exists: refusing to build over it (a delivered FASE 1?). Rebuild the payload with another --dwg name, or trash the old test copy.`);
}

console.log(`payload    ${payloadPath}
 target    ${target}${payload.templatePath ? `\n template  ${payload.templatePath}` : "\n template  (none: the target must already be the ACTIVE drawing)"}
 xrefs     ${(payload.xrefs ?? []).map((x) => basename(x.filePath)).join(", ") || "none"}
 alignment ${payload.alignment ? `${payload.alignment.name}, style ${payload.alignment.style ?? "(default)"}` : "none"}
 entities  ${(payload.entities ?? []).length}${payload.clImport ? ` (+ ${payload.clImport.blockName} block definition from ${basename(payload.clImport.sourceFilePath)})` : ""}
 twists    ${(payload.twists ?? []).map((t) => `${t.layout} ${t.streetAngleDegrees ?? t.twistDegrees}°`).join(", ") || "none"}
 freeze    ${(payload.freezeLayers ?? []).join(", ") || "none"}
 notes     ${payload.stripPropNotes === false ? "left as they are (stripPropNotes:false)" : "PROP/PROPOSED removed + orphaned glyphs moved"}
 save      ${payload.save === false ? "NO (review and save yourself)" : "yes"}`);
if (!has("build")) {
  console.log("\nDRY RUN: nothing sent to Civil 3D. Add --build to build (it asks you to type the target file name).");
  process.exit(0);
}
// The human-approval step that replaces Claude's approval token: the target name, typed at an interactive terminal or passed as
// --confirm "<name>" (a Claude session uses --confirm only because the user allowed it in .claude/settings.local.json, 2026-10-01).
const expectedName = basename(String(target)).replace(/\.dwg$/i, "");
let typed = flag("confirm");
if (typed === undefined) {
  if (!process.stdin.isTTY) die(`--build needs the target name: type it at an interactive terminal, or pass --confirm "${expectedName}".`);
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  typed = await rl.question(`\nTo build, type the target name (${expectedName}): `);
  rl.close();
}
if (String(typed).trim().replace(/\.dwg$/i, "").toLowerCase() !== expectedName.toLowerCase()) die("name does not match: nothing sent to Civil 3D.");

// ---------- build (same code as the MCP tool) ----------
process.env.CIVIL3D_LOG_LEVEL ??= "warn"; // the repo logger prints "[INFO] Connected" on every call; keep warnings/errors only
const mod = (p) => import(pathToFileURL(join(repo, p)).href);
const { withApplicationConnection } = await mod("build/utils/ConnectionManager.js");
const { runFase1Build, summarizeFase1Build } = await mod("build/tools/domains/fase1Build.js");
const { runFase1Audit, summarizeFase1 } = await mod("build/tools/domains/fase1Audit.js");

const started = Date.now();
let steps, checks;
try {
  ({ steps, checks } = await withApplicationConnection(async (client) => {
    const send = async (method, params) => {
      const t = Date.now();
      process.stdout.write(`  .. ${method}`);
      try {
        const result = await client.sendCommand(method, params);
        process.stdout.write(` (${((Date.now() - t) / 1000).toFixed(1)} s)\n`);
        return result;
      } catch (error) {
        process.stdout.write(` FAILED after ${((Date.now() - t) / 1000).toFixed(1)} s\n`);
        throw error;
      }
    };
    console.log("\nbuild:");
    const steps = await runFase1Build(send, payload);
    const failed = steps.some((s) => s.status === "FAIL");
    console.log(failed ? "\naudit: skipped (the build failed)" : "\naudit:");
    const checks = failed ? [] : await runFase1Audit(send, {});
    return { steps, checks };
  }));
} catch (error) {
  die(`plugin not reachable or connection lost: ${error instanceof Error ? error.message : String(error)}\n(is Civil 3D open with the plugin loaded? node plugin-rpc.mjs listOpenDocuments)`, 1);
}

const pad = (s, n) => String(s).padEnd(n);
console.log("\nsteps:");
for (const s of steps) console.log(` ${pad(s.status, 7)} ${pad(s.name, 38)} ${String(s.detail ?? "").slice(0, 200)}`);
const totals = summarizeFase1Build(steps);
if (checks.length) {
  console.log("\naudit:");
  for (const c of checks) console.log(` ${pad(c.level, 7)} ${pad(c.what, 38)} ${String(c.detail ?? "").slice(0, 200)}`);
}
const audit = checks.length ? summarizeFase1(checks) : null;
const resultPath = join(dirname(payloadPath), "result.json");
writeFileSync(resultPath, JSON.stringify({ when: new Date().toISOString(), payloadPath, target, steps, totals, checks, audit }, null, 2));

const ok = totals.fail === 0 && (!audit || audit.fail === 0);
console.log(`\n${totals.summary}${audit ? ` | ${audit.summary}` : ""} | ${((Date.now() - started) / 1000).toFixed(0)} s | ${resultPath}`);
if (!ok) {
  console.log("NOT READY: fix the FAIL above (nothing before it was undone; trash a half-built target before rerunning).");
  process.exit(1);
}

// ---------- optional tail ----------
if (has("finish")) {
  console.log("\nfinish: fase1-finish.mjs (dump audit + plot + PDF to _QC)");
  const finishArgs = [join(here, "fase1-finish.mjs"), "--dwg", payload.saveAs ?? target, "--repo", repo];
  if (has("no-copy")) finishArgs.push("--no-copy");
  const r = spawnSync("node", finishArgs, { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
console.log(`NEXT: node "${join(here, "fase1-finish.mjs")}" --dwg "${payload.saveAs ?? target}"   (plot + PDF to _QC; or rerun with --finish)`);
