#!/usr/bin/env node
// C-300 TITLE BLOCK from project.json (etapa 1.7): the `titleBlock` replacement array civil3d_workflow_fase1_build applies, so a new project's sheet
// stops printing the template's project. The template is almost always the Goulds C-300 (user, 2026-10-01), so the "find" values are Goulds'
// (standards/formtech-c300.json titleBlock.templateFrom.goulds; override with project.json titleBlockFind for another template).
//
//   node c300-titleblock.mjs --dir "<project folder>" [--out titleblock.json] [--date MM/DD/YY] [--layout C-300]
//
// Fields that change per project (value <- source):
//   projectName   "VILLA ONE"                   <- project.json name (uppercase)
//   address       "227XX S.W. 118TH AVENUE"     <- project.json subject.address (POC / Property Appraiser site address), formatted like the sheets
//                                                  (SW -> S.W., ST -> STREET, AVE -> AVENUE, 232 -> 232ND)
//   projectNo     "26-04.047"                   <- project.json projectNo (firm number, given at new-project)
//   agr           "33810"                       <- project.json agrNo (the POC's CDP number: POC.pdf "VILLA ONE CDP-33810")
//   sheet         "C-300"                       <- the layout name (Fase 1 = C-300)
//   date          "MM/DD/YY"                    <- --date, else project.json titleBlockFields.date, else today
//   drawnBy       "JH"                          <- project.json titleBlockFields.drawnBy, else standards titleBlock drawnBy (firm standard: JH)
// Not touched: approved by (CF = the sealing engineer), scale 1"=20', sheet count, firm block, seal.
// Any value can be forced with project.json "titleBlockFields": { projectName, address, projectNo, agr, sheet, date, drawnBy }.
// A field with no value (e.g. no address yet) is skipped with a WARN, never replaced by an empty string. Node 18+, no deps.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const here = dirname(fileURLToPath(import.meta.url));
const die = (m) => { console.error(m); process.exit(2); };
const dir = flag("dir") ? resolve(flag("dir")) : die('usage: node c300-titleblock.mjs --dir "<project folder>" [--out titleblock.json] [--date MM/DD/YY] [--layout C-300]');
const projectPath = join(dir, "project.json");
if (!existsSync(projectPath)) die(`${projectPath} not found`);
const project = JSON.parse(readFileSync(projectPath, "utf8"));
const std = JSON.parse(readFileSync(join(here, "../references/standards/formtech-c300.json"), "utf8")).titleBlock ?? {};
const layout = flag("layout") ?? project.deliverables?.layout ?? "C-300";

// ---- address like the sheets print it: "227XX S.W. 118TH AVENUE" ----
const SUFFIX = { ST: "STREET", AVE: "AVENUE", AV: "AVENUE", RD: "ROAD", DR: "DRIVE", CT: "COURT", TER: "TERRACE", TERR: "TERRACE", BLVD: "BOULEVARD", LN: "LANE", PL: "PLACE", CIR: "CIRCLE", HWY: "HIGHWAY", PKWY: "PARKWAY", WAY: "WAY", TRL: "TRAIL" };
const DIR = { N: "N.", S: "S.", E: "E.", W: "W.", NE: "N.E.", NW: "N.W.", SE: "S.E.", SW: "S.W." };
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "TH" : { 1: "ST", 2: "ND", 3: "RD" }[n % 10] ?? "TH"}`;
export function formatAddress(raw) {
  const toks = String(raw).toUpperCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  return toks.map((t, i) => {
    if (i === 0) return t;                                   // house number ("227XX" stays)
    if (DIR[t] && !/\d/.test(t)) return DIR[t];
    if (/^\d+$/.test(t)) return ordinal(Number(t));          // "232" -> "232ND"
    return SUFFIX[t] ?? t;
  }).join(" ");
}

const f = project.titleBlockFields ?? {};
const goulds = std.templateFrom?.goulds ?? project.titleBlockFind ?? {};
const values = {
  projectName: f.projectName ?? (project.name ? String(project.name).toUpperCase() : null),
  address: f.address ?? (project.subject?.address ? formatAddress(project.subject.address) : null),
  projectNo: f.projectNo ?? project.projectNo ?? null,
  agr: f.agr ?? project.agrNo ?? null,
  sheet: f.sheet ?? layout,
  date: f.date ?? flag("date") ?? (() => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`; })(),
  drawnBy: f.drawnBy ?? std.drawnBy ?? null,
};
const find = { ...goulds, ...(project.titleBlockFind ?? {}) };
// field -> [fragment that identifies the ONE text holding it, substring to replace]
const spec = {
  projectName: [find.projectName, find.projectName],
  address: [find.address, find.address],
  projectNo: [find.projectNo, find.projectNo],
  agr: [`AGR. NO. ${find.agr}`, find.agr],
  sheet: [find.sheet, find.sheet],
  date: [find.date, find.date],
  drawnBy: [`;${find.drawnBy}}`, find.drawnBy],              // the initials sit alone in "{\C256;UB}": the closing brace makes it unique
};
const out = [], notes = [];
for (const [field, [contains, what]] of Object.entries(spec)) {
  if (!what) { notes.push(`WARN ${field}: the template value is unknown (standards titleBlock.templateFrom / project.json titleBlockFind): not replaced`); continue; }
  if (!values[field]) { notes.push(`WARN ${field}: no value in project.json: left as the template prints it (${what})`); continue; }
  if (String(values[field]) === String(what)) { notes.push(`OK   ${field}: already "${what}"`); continue; }
  out.push({ layout, contains, find: what, replace: String(values[field]) });
  notes.push(`SET  ${field}: "${what}" -> "${values[field]}"`);
}
if (flag("out")) writeFileSync(flag("out"), JSON.stringify(out, null, 1));
console.log(`${out.length} title block replacement(s) for ${layout}${flag("out") ? ` -> ${flag("out")}` : ""}\n  ${notes.join("\n  ")}`);
if (!flag("out")) console.log(JSON.stringify(out));
