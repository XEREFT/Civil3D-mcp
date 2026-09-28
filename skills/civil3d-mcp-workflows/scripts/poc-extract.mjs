#!/usr/bin/env node
// POC EXTRACT: reads a Miami-Dade WASD "POINT OF CONNECTION" PDF and returns the data that goes into the C-300 subject label,
// title block and project.json (agreement no., GPD, folio, units, use, zoning, atlas page).
//   node poc-extract.mjs <POC.pdf> [--project "<project dir>"] [--json]
//   --project merges into <dir>\project.json: fills EMPTY subject fields only, never overwrites a value someone set; reports conflicts.
// Needs python + pymupdf (already used by qc-compare.py). Nothing is written without --project.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const pdf = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!pdf || !existsSync(pdf)) { console.error("usage: node poc-extract.mjs <POC.pdf> [--project <dir>] [--json]"); process.exit(2); }

const py = spawnSync("python", ["-c", "import sys,pymupdf; d=pymupdf.open(sys.argv[1]); sys.stdout.buffer.write('\\n'.join(p.get_text() for p in d).encode('utf-8'))", pdf], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
if (py.status !== 0) { console.error("python/pymupdf failed: " + py.stderr.toString().slice(-300)); process.exit(1); }
const text = py.stdout.toString("utf8").replace(/\s+/g, " ");

const m = (re) => re.exec(text)?.[1]?.trim();
const location = m(/PROJECT LOCATION:\s*(.+?)\s+PROJECT DESCRIPTION/i);
const description = m(/PROJECT DESCRIPTION:\s*(.+?)\s+EXISTING ZONING/i);
const folioRaw = /^(\d{13})/.exec(location ?? "")?.[1];
const USE = [[/\bSFR\b|SINGLE[- ]FAMILY/i, "SINGLE FAMILY RESIDENCE"], [/DUPLEX/i, "DUPLEX"], [/TOWNHOUSE|TOWN HOME/i, "TOWNHOUSES"], [/COMMERCIAL|RETAIL|OFFICE/i, "COMMERCIAL"]];
const use = USE.find(([re]) => re.test(description ?? ""))?.[1];

const poc = {
  file: resolve(pdf),
  date: m(/(\d{2}-\d{2}-\d{4})/),
  projectName: m(/PROJECT NAME:\s*(.+?)\s+AGREEMENT/i),
  agreementNo: m(/AGREEMENT\s+NUMBER:\s*(\d+)/i),
  waterGpd: Number(m(/WATER GALLONS PER DAY:?\s*(\d+)/i)) || undefined,
  sewerGpd: Number(m(/SEWER GALLONS PER DAY:?\s*(\d+)/i)) || undefined,
  location,
  folio: folioRaw ? `${folioRaw.slice(0, 2)}-${folioRaw.slice(2, 6)}-${folioRaw.slice(6, 9)}-${folioRaw.slice(9)}` : undefined,
  pocAddress: location && folioRaw ? location.slice(13).replace(/^\d{0,4}?(?=\d{1,5}\s)/, "").trim() : undefined,
  description,
  units: Number(/(\d+)\s+UNITS?/i.exec(description ?? "")?.[1]) || undefined,
  sf: Number((/([\d,]+)\s*SQFT/i.exec(description ?? "")?.[1] ?? "").replace(/,/g, "")) || undefined,
  gpdPerUnit: Number(/\((\d+)\s*gpd\s*\/\s*unit\)/i.exec(description ?? "")?.[1]) || undefined,
  use,
  zoning: m(/EXISTING ZONING:\s*(.+?)\s+ATLAS/i),
  atlasPage: m(/ATLAS\s+PAGE:\s*([A-Z0-9-]+)/i),
  connectionOptions: [...text.matchAll(/Option\s+(\d):\s*To an existing\s+(.+?)\s+water main\s+\(([A-Z0-9 -]+)\)/gi)].map((o) => ({ option: Number(o[1]), main: o[2], asBuilt: o[3].trim() })),
};

if (!poc.agreementNo || !poc.waterGpd) console.error("WARN: the PDF does not look like a WASD POC (no agreement number / GPD found).");

if (flag("project")) {
  const { loadProject, saveProject } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "project-state.mjs")).href);
  const dir = flag("project");
  const p = loadProject(dir);
  if (!p) { console.error(`no project.json in ${dir} (run project-state.mjs init first)`); process.exit(2); }
  p.subject ??= {}; p.sources ??= {};
  const conflicts = [];
  const fill = (obj, key, value) => {
    if (value === undefined) return;
    if (obj[key] === undefined || obj[key] === "") obj[key] = value;
    else if (String(obj[key]) !== String(value)) conflicts.push(`${key}: project.json has ${obj[key]}, POC says ${value}`);
  };
  fill(p, "agrNo", poc.agreementNo);
  fill(p.subject, "folio", poc.folio); fill(p.subject, "gpd", poc.waterGpd); fill(p.subject, "units", poc.units);
  fill(p.subject, "sf", poc.sf); fill(p.subject, "use", poc.use); fill(p.subject, "zoning", poc.zoning); fill(p.subject, "atlasPage", poc.atlasPage);
  p.sources.poc = poc.file; p.sources.pocData = { date: poc.date, projectName: poc.projectName, location: poc.location, gpdPerUnit: poc.gpdPerUnit, connectionOptions: poc.connectionOptions };
  (p.history ??= []).push({ date: new Date().toISOString().slice(0, 10), event: `POC ${poc.agreementNo ?? "?"} read (${poc.waterGpd ?? "?"} GPD)` });
  saveProject(dir, p);
  console.error(`merged into ${dir}/project.json` + (conflicts.length ? `\nCONFLICTS (kept the existing value):\n - ${conflicts.join("\n - ")}` : ""));
}
console.log(JSON.stringify(poc, null, 2));
