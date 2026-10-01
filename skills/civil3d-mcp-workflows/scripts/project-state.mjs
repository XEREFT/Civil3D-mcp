#!/usr/bin/env node
// PROJECT STATE (project.json per project folder): the machine-readable state of a project, replacing prose in memory.
// Scripts read/write it (fase1-finish.mjs updates it on READY, integrity-check.mjs validates ALL projects, fase1-batch.mjs reads it).
//   node project-state.mjs init  <dir> [--name "VILLA ONE"] [--project-no 26-04.047] [--agr 33810]   create (auto-detects DWG/PDF)
//   node project-state.mjs show  <dir>
//   node project-state.mjs set   <dir> key.path=value [key.path=value ...]      value is JSON when it parses (numbers, true, {...}), else text
//   node project-state.mjs log   <dir> "what happened"                           append to history
//   node project-state.mjs decide <dir> "decision the user made"                 append to decisions (with today's date)
//   node project-state.mjs list  [--root "<...>\AUTOCAD @XEREFT"] [--json]      table of every project under the root
//   node project-state.mjs validate [--root ...]                                 issues across projects (exit 1 on ERROR)
//   node project-state.mjs spec  <dir>                                           prints the flat input of c300-build-spec.mjs built from project.json (that script
//                                                                                also reads project.json directly). Needs site.lotPoint [x,y]; site.window
//                                                                                [xmin,ymin,xmax,ymax] is optional (derived from the X-TOPO cluster when missing)
// Schema (version 1) — every field optional except schema/name:
//   { schema, name, projectNo, agrNo, phase (1..4), status ("new"|"in-progress"|"delivered"),
//     deliverables:{ dwg, pdf, layout }, subject:{ address, folio, use, gpd, pb, units, sf },
//     sources:{ poc, asbuilts:[], guide }, decisions:[{date,text}], history:[{date,event}],
//     lastVerified:{ audit, pdf }, updated }
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ROOT = "C:/Users/camil/OneDrive/Documents/AUTOCAD @XEREFT";
export const SCHEMA = 1;
const FILE = "project.json";
const today = () => new Date().toISOString().slice(0, 10);
const IGNORED_DIRS = /^(_QC|_backup.*|_reports|\..*|node_modules|x-ref)$/i;

export function projectPath(dir) { return join(resolve(dir), FILE); }
export function loadProject(dir) {
  const p = projectPath(dir);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}
export function saveProject(dir, data) {
  data.updated = new Date().toISOString();
  writeFileSync(projectPath(dir), JSON.stringify(data, null, 2) + "\n");
  return data;
}

/** Folders under root (depth <= 2) that hold a project.json or a "* FASE n.dwg". */
export function discoverProjects(root = DEFAULT_ROOT) {
  const found = [];
  const visit = (dir, depth) => {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    const hasJson = entries.some((e) => e.isFile() && e.name === FILE);
    const dwg = entries.find((e) => e.isFile() && /FASE \d+\.dwg$/i.test(e.name));
    if (hasJson || dwg) found.push({ dir: dir.replace(/\\/g, "/"), hasJson, dwg: dwg?.name });
    // a folder with a project.json IS the project: its subfolders (Propuesta\, _backup_*, copies of the FASE 1 dwg) are not projects
    if (hasJson) return;
    if (depth < 2) for (const e of entries) if (e.isDirectory() && !IGNORED_DIRS.test(e.name)) visit(join(dir, e.name), depth + 1);
  };
  visit(resolve(root), 0);
  return found;
}

export function detectDeliverables(dir) {
  const files = readdirSync(dir);
  const dwg = files.filter((f) => /FASE \d+\.dwg$/i.test(f)).sort().pop();
  const qc = join(dir, "_QC");
  const pdf = existsSync(qc) ? readdirSync(qc).filter((f) => /^C-\d+ FASE \d+\.pdf$/i.test(f)).sort()[0] : undefined;
  const phase = Number(/FASE (\d+)\.dwg$/i.exec(dwg ?? "")?.[1]) || undefined;
  return { dwg, pdf: pdf ? `_QC/${pdf}` : undefined, layout: pdf ? /^(C-\d+)/i.exec(pdf)?.[1] : "C-300", phase };
}

export function validateProject(dir) {
  const issues = [];
  const add = (level, msg) => issues.push({ level, msg });
  let p;
  try { p = loadProject(dir); } catch (e) { return [{ level: "ERROR", msg: `project.json is not valid JSON: ${e.message}` }]; }
  if (!p) return [{ level: "WARN", msg: "no project.json (run: node project-state.mjs init <dir>)" }];
  if (p.schema !== SCHEMA) add("ERROR", `schema ${p.schema} != ${SCHEMA}`);
  if (!p.name) add("ERROR", "missing name");
  if (![1, 2, 3, 4].includes(p.phase)) add("WARN", `phase should be 1..4 (got ${p.phase})`);
  if (!["new", "in-progress", "delivered"].includes(p.status)) add("WARN", `status should be new|in-progress|delivered (got ${p.status})`);
  const d = p.deliverables ?? {};
  if (d.dwg && !existsSync(join(dir, d.dwg))) add("ERROR", `deliverables.dwg not found: ${d.dwg}`);
  if (d.pdf && !existsSync(join(dir, d.pdf))) add("ERROR", `deliverables.pdf not found: ${d.pdf}`);
  if (d.dwg && d.pdf && existsSync(join(dir, d.dwg)) && existsSync(join(dir, d.pdf)) && statSync(join(dir, d.pdf)).mtimeMs + 2000 < statSync(join(dir, d.dwg)).mtimeMs) {
    add("WARN", "the DWG was saved after its PDF was plotted: run fase1-finish.mjs");
  }
  if (p.status === "delivered") {
    if (!d.dwg || !d.pdf) add("WARN", "status delivered but deliverables.dwg/pdf are not both set");
    if (!p.lastVerified?.audit) add("WARN", "status delivered but never audited (lastVerified.audit empty): run fase1-finish.mjs");
  }
  const s = p.subject ?? {};
  if (s.folio && !/^\d{2}-\d{4}-\d{3}-\d{4}$/.test(s.folio)) add("WARN", `subject.folio '${s.folio}' is not NN-NNNN-NNN-NNNN`);
  if (s.gpd !== undefined && !(Number(s.gpd) > 0)) add("WARN", "subject.gpd should be a positive number");
  return issues;
}

const WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"];
export function c300Input(p) {
  const s = p.subject ?? {};
  return {
    name: p.name, address: s.address, window: p.site?.window, lotPoint: p.site?.lotPoint,
    pa: { folio: s.folio, plat: s.pb ? `P.B. ${s.pb}` : undefined },
    property: { units: s.units ? `${WORDS[s.units] ?? s.units} (${s.units})` : undefined, sf: s.sf ? Number(s.sf).toLocaleString("en-US") : undefined, use: s.use, gpd: s.gpd !== undefined ? String(s.gpd) : undefined },
  };
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) { if (typeof o[k] !== "object" || o[k] === null) o[k] = {}; o = o[k]; }
  o[keys.at(-1)] = value;
}
const parseValue = (v) => { try { return JSON.parse(v); } catch { return v; } };

// ------------------------------------------------------------------ CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
  const dir = positional[0];
  const root = flag("root") ?? DEFAULT_ROOT;
  const fail = (m) => { console.error(m); process.exit(2); };

  if (cmd === "init") {
    if (!dir || !existsSync(dir)) fail("usage: init <dir> [--name ..] [--project-no ..] [--agr ..]");
    if (loadProject(dir)) fail(`${projectPath(dir)} already exists (use set)`);
    const det = detectDeliverables(resolve(dir));
    const project = {
      schema: SCHEMA, name: flag("name") ?? basename(resolve(dir)).replace(/\s*@XEREFT\s*$/i, ""),
      projectNo: flag("project-no"), agrNo: flag("agr"),
      phase: det.phase ?? 1, status: det.pdf ? "delivered" : "new",
      deliverables: { dwg: det.dwg, pdf: det.pdf, layout: det.layout },
      subject: {}, sources: {}, decisions: [], history: [{ date: today(), event: "project.json created" }], lastVerified: {},
    };
    saveProject(dir, project);
    console.log(`created ${projectPath(dir)}`);
  } else if (cmd === "show") {
    const p = dir && loadProject(dir); if (!p) fail("no project.json"); console.log(JSON.stringify(p, null, 2));
  } else if (cmd === "set") {
    const p = dir && loadProject(dir); if (!p) fail("no project.json");
    for (const kv of positional.slice(1)) { const i = kv.indexOf("="); if (i < 1) fail(`bad pair ${kv}`); setPath(p, kv.slice(0, i), parseValue(kv.slice(i + 1))); }
    saveProject(dir, p); console.log("updated");
  } else if (cmd === "log" || cmd === "decide") {
    const p = dir && loadProject(dir); if (!p) fail("no project.json");
    const text = positional.slice(1).join(" "); if (!text) fail(`usage: ${cmd} <dir> "text"`);
    const key = cmd === "log" ? "history" : "decisions";
    (p[key] ??= []).push(cmd === "log" ? { date: today(), event: text } : { date: today(), text });
    saveProject(dir, p); console.log(`${key} +1`);
  } else if (cmd === "spec") {
    const p = dir && loadProject(dir); if (!p) fail("no project.json");
    const spec = c300Input(p);
    const missing = ["address", "lotPoint"].filter((k) => !spec[k]).concat(["pa.folio", "pa.plat", "property.use", "property.gpd"].filter((k) => !k.split(".").reduce((o, x) => o?.[x], spec)));
    if (missing.length) console.error(`WARN missing: ${missing.join(", ")} (set them: node project-state.mjs set <dir> subject.address=... site.lotPoint=[..]; site.window is optional)`);
    console.log(JSON.stringify(spec, null, 2));
  } else if (cmd === "list") {
    const rows = discoverProjects(root).map((f) => {
      const p = f.hasJson ? loadProject(f.dir) : null;
      return { dir: f.dir, name: p?.name ?? "(no project.json)", phase: p?.phase ?? "", status: p?.status ?? "", audit: p?.lastVerified?.audit?.slice(0, 10) ?? "", dwg: p?.deliverables?.dwg ?? f.dwg ?? "" };
    });
    if (has(rest, "json")) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) console.log(`${r.name.padEnd(24)} phase ${String(r.phase).padEnd(2)} ${r.status.padEnd(12)} audit ${(r.audit || "-").padEnd(10)} ${r.dwg}  (${r.dir})`);
    if (!rows.length) console.log(`no projects under ${root}`);
  } else if (cmd === "validate") {
    let errors = 0;
    for (const f of discoverProjects(root)) {
      for (const i of validateProject(f.dir)) { if (i.level === "ERROR") errors++; console.log(`${i.level.padEnd(5)} ${basename(f.dir)}: ${i.msg}`); }
    }
    process.exit(errors ? 1 : 0);
  } else {
    fail("commands: init | show | set | log | decide | list | validate   (see the header of this file)");
  }
}
function has(args, n) { return args.includes(`--${n}`); }
