#!/usr/bin/env node
// FASE 1 BATCH AUDIT: audits every project under a root WITHOUT Civil 3D open (AutoCAD Core Console on %TEMP% copies via
// dwg-dump.ps1, reading the last SAVED state) and prints/writes a table "project -> what is missing". Read-only.
//   node fase1-batch.mjs [--root "C:/Users/camil/OneDrive/Documents/AUTOCAD @XEREFT"] [--only villa] [--report] [--json] [--reuse-dump]
//   --report      also writes <root>\_reports\fase1-batch_<yyyy-mm-dd>.md (+ .json)
//   --reuse-dump  reuse the previous dump of a DWG when it is newer than the DWG (fast re-runs)
// Headless checks (cannot see Civil objects, so pressure/gravity networks, profile views and the alignment style are NOT covered here:
// the live civil3d_workflow_fase1_audit / fase1-audit.mjs does that when the file is open):
//   layouts = Model + <layout> only · PROP/PROPOSED wording (Model + paper space) · hand-drawn geometry left on C-SAN / C-WATR-PIPE /
//   V-SITE-FNCE in the host DWG · C-TINN-BNDY frozen · xrefs resolve · PDF present and newer than the DWG · project.json validity.
// Exit 1 if any project has a FAIL.
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const here = dirname(fileURLToPath(import.meta.url));
const ps = await import(pathToFileURL(join(here, "project-state.mjs")).href);
const root = (flag("root") ?? ps.DEFAULT_ROOT).replace(/\\/g, "/");
const only = flag("only")?.toLowerCase();
const dumpDir = join(process.env.TEMP ?? ".", "c3d-dwg-dump");

const strip = (t) => String(t ?? "").replace(/\\P/g, " ").replace(/\\[A-Za-z][^;\\]*;/g, "").replace(/[{}]/g, "");
const isProp = (t) => /\bPROP\b|\bPROPOSED\b/i.test(strip(t));

function dumpFor(dwg) {
  const base = basename(dwg, ".dwg").replace(/[^\w-]/g, "_");
  const cached = join(dumpDir, `${base}_dump.txt`);
  if (has("reuse-dump") && existsSync(cached) && statSync(cached).mtimeMs > statSync(dwg).mtimeMs) return cached;
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "dwg-dump.ps1"), dwg], { encoding: "utf8", timeout: 600000 });
  const out = (r.stdout ?? "").trim().split("\n").pop()?.trim();
  return out && existsSync(out) ? out : null;
}

function auditProject(entry) {
  const dir = entry.dir;
  const project = ps.loadProject(dir);
  const det = ps.detectDeliverables(dir);
  const dwgName = project?.deliverables?.dwg ?? det.dwg;
  const layout = project?.deliverables?.layout ?? det.layout ?? "C-300";
  const checks = [];
  const add = (level, what, detail = "") => checks.push({ level, what, detail });
  const name = project?.name ?? basename(dir);

  for (const i of ps.validateProject(dir)) add(i.level === "ERROR" ? "FAIL" : "WARN", "project.json", i.msg);
  if (!dwgName || !existsSync(join(dir, dwgName))) { add("FAIL", "dwg", `no deliverable DWG found in ${dir}`); return { name, dir, checks }; }
  const dwg = join(dir, dwgName);

  const dumpPath = dumpFor(dwg);
  if (!dumpPath) { add("FAIL", "dwg-dump", "Core Console produced no dump (file locked or corrupt?)"); return { name, dir, checks }; }
  const lines = readFileSync(dumpPath, "utf8").split(/\r?\n/);
  const rows = (tag) => lines.filter((l) => l.startsWith(tag + "|")).map((l) => l.split("|"));

  const layouts = rows("LAYOUT").map((r) => r[1]);
  const extra = layouts.filter((l) => l !== "Model" && l !== layout);
  if (!layouts.includes(layout)) add("FAIL", "layouts", `no ${layout} layout (found ${layouts.join(", ") || "none"})`);
  else if (extra.length) add("FAIL", "layouts", `extra layouts: ${extra.join(", ")} (fase 1 = Model + ${layout})`);
  else add("OK", "layouts", layouts.join(", "));

  const modelProp = rows("ENT").filter((r) => ["TEXT", "MTEXT", "MULTILEADER"].includes(r[1]) && isProp(r.slice(r.findIndex((c) => c.startsWith("txt="))).join("|").replace(/^txt=/, "")));
  const paperProp = rows("PTXT").filter((r) => isProp(r.slice(4).join("|").replace(/^txt=/, "")));
  if (modelProp.length) add("FAIL", "PROP text in Model", `${modelProp.length} item(s), e.g. handle ${modelProp[0][2]}`);
  else add("OK", "PROP text in Model", "none");
  if (paperProp.length) add("FAIL", "PROP/PROPOSED in paper space", `${paperProp.length} note(s): ${paperProp.slice(0, 4).map((r) => `${r[1]}:${r[3]}`).join(", ")}`);
  else add("OK", "PROP/PROPOSED in paper space", "none");

  const design = rows("ENT").filter((r) => /^(C-SAN|C-WATR-PIPE|V-SITE-FNCE)/i.test(r[3] ?? "") && ["LWPOLYLINE", "LINE", "POLYLINE", "MULTILEADER", "TEXT", "MTEXT"].includes(r[1]));
  if (design.length) add("FAIL", "design geometry on C-SAN / C-WATR-PIPE / V-SITE-FNCE", `${design.length} hand-drawn entit(ies) in the host DWG (laterals/C.O./service/fence?)`);
  else add("OK", "design geometry", "none on C-SAN / C-WATR-PIPE / V-SITE-FNCE");

  const bndy = rows("LAYER").find((r) => r[1] === "C-TINN-BNDY");
  if (!bndy) add("OK", "surface boundary", "no C-TINN-BNDY layer (no EG surface)");
  else if (Number(/fl=(\d+)/.exec(bndy.join("|"))?.[1] ?? 0) & 1) add("OK", "surface boundary", "C-TINN-BNDY frozen");
  else add("FAIL", "surface boundary", "C-TINN-BNDY not frozen: the green EG boundary shows");

  const missingXrefs = rows("XREF").filter((r) => !existsSync(join(dir, r[2].replace(/^\.[\\/]/, ""))) && !existsSync(r[2])).map((r) => r[1]);
  if (missingXrefs.length) add("FAIL", "xrefs", `not found next to the DWG: ${missingXrefs.join(", ")}`);
  else add("OK", "xrefs", `${rows("XREF").length} resolved`);

  const pdf = project?.deliverables?.pdf ?? det.pdf;
  if (!pdf || !existsSync(join(dir, pdf))) add("WARN", "pdf", "no PDF in _QC (run fase1-finish.mjs)");
  else if (statSync(join(dir, pdf)).mtimeMs + 2000 < statSync(dwg).mtimeMs) add("WARN", "pdf", "older than the DWG: re-plot (fase1-finish.mjs)");
  else add("OK", "pdf", pdf);

  add("INFO", "not covered headless", "networks, profile views and alignment style: run civil3d_workflow_fase1_audit with the file open");
  return { name, dir, checks };
}

const projects = ps.discoverProjects(root).filter((p) => !only || p.dir.toLowerCase().includes(only));
if (!projects.length) { console.log(`no projects under ${root}`); process.exit(0); }
const results = [];
for (const p of projects) { console.error(`auditing ${p.dir} ...`); results.push(auditProject(p)); }

const worst = (r) => r.checks.some((c) => c.level === "FAIL") ? "FAIL" : r.checks.some((c) => c.level === "WARN") ? "WARN" : "OK";
const md = [`# Fase 1 batch audit — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, "", `Root: \`${root}\` · ${results.length} project(s) · headless (Core Console, last SAVED state)`, "", "| Project | Result | Missing / to look at |", "|---|---|---|"];
for (const r of results) {
  const bad = r.checks.filter((c) => c.level === "FAIL" || c.level === "WARN");
  md.push(`| ${r.name} | ${worst(r)} | ${bad.length ? bad.map((c) => `${c.level} ${c.what}: ${c.detail}`).join("<br>") : "nothing"} |`);
}
const text = md.join("\n") + "\n";

if (has("json")) console.log(JSON.stringify(results, null, 2));
else console.log(text);
if (has("report")) {
  const dir = join(root, "_reports");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dir, `fase1-batch_${stamp}.md`), text);
  writeFileSync(join(dir, `fase1-batch_${stamp}.json`), JSON.stringify(results, null, 2));
  console.error(`report: ${join(dir, `fase1-batch_${stamp}.md`)}`);
}
process.exit(results.some((r) => worst(r) === "FAIL") ? 1 : 0);
