#!/usr/bin/env node
// Survey-first merge for asbuilt.json (design audit 2026-10-25). The designer labels what the SURVEY measured (manhole R.E./I.E., catch-basin R.E.) and keeps the
// as-built only for what the survey cannot see (pipe size/material/slope, laterals). This script reads the X-TOPO dump (dwg-dump.ps1 pipe format), and writes
//   manholes[].survey {rim, inv:[[dir, v]]}   (c300-utility-labels.mjs then prints the survey values, "(PER SURVEY)" + the as-built ref + "(FIELD VERIFY)" if the gap > 0.10 ft)
//   storm [{kind:"CB", x, y, rim}]            (one "EXIST STORM CB RIM: n (TO REMAIN)" label each)
//   node asbuilt-survey-merge.mjs --asbuilt asbuilt.json --dump X-TOPO_dump.txt [--dump more.txt] [--window xmin,ymin,xmax,ymax] [--radius 6] [--dry-run]
// Idempotent: reruns replace manholes[].survey and storm. A manhole with no survey text within --radius ft keeps no survey block (as-built values stand).
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const all = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
const one = (n) => all(n)[0];
const has = (n) => argv.includes(`--${n}`);
const abFile = one("asbuilt"), dumps = all("dump");
if (!abFile || !dumps.length) { console.error("usage: node asbuilt-survey-merge.mjs --asbuilt asbuilt.json --dump X-TOPO_dump.txt [--dump ..] [--window x0,y0,x1,y1] [--radius 6] [--dry-run]"); process.exit(2); }
const win = (one("window") ?? "").split(",").map(Number);
const radius = Number(one("radius") ?? 6);
const inWin = (x, y) => win.length !== 4 || (x >= win[0] && x <= win[2] && y >= win[1] && y <= win[3]);

// paragraph breaks first: "\P(S)8"PVC.PIPE;" must not be read as a ';'-terminated format code; then only the codes that carry a value (\C6; \pxl1; \f..; \H..;)
const clean = (t) => String(t).replace(/\\P/g, "\n").replace(/\\[CcFfHhQqTtWwAap][^;\\\n]*;/g, "").replace(/\\[LlOoKk]/g, "").replace(/[{}]/g, "");
const rows = dumps.flatMap((f) => readFileSync(f, "utf8").split(/\r?\n/)).filter((l) => /^ENT\|(MTEXT|TEXT|MULTILEADER)\|/.test(l)).map((l) => {
  const kv = Object.fromEntries(l.split("|").slice(1).map((p) => { const i = p.indexOf("="); return i < 0 ? [p, ""] : [p.slice(0, i), p.slice(i + 1)]; }));
  const arrow = kv.arrows ? kv.arrows.split(";")[0].split(",").map(Number) : [];
  const x = Number.isFinite(arrow[0]) ? arrow[0] : Number(kv.x), y = Number.isFinite(arrow[1]) ? arrow[1] : Number(kv.y);
  return { x, y, t: clean(l.slice(l.indexOf("txt=") + 4)) };
}).filter((r) => Number.isFinite(r.x) && inWin(r.x, r.y));

const f2 = (s) => Math.round(Number(s) * 100) / 100;
const mhTexts = rows.filter((r) => /(MH|MANHOLE)/i.test(r.t) && /R\.E\.:/.test(r.t)).map((r) => ({
  x: r.x, y: r.y, rim: f2(/R\.E\.:\s*([\d.]+)/.exec(r.t)[1]),
  inv: [...r.t.matchAll(/\(([A-Z]{1,2})\)[^;\n]*;\s*I\.E\.:\s*([\d.]+)/g)].map((m) => [m[1], f2(m[2])]),
}));
const cbs = rows.filter((r) => /C\.B\.?/.test(r.t) && /R\.E\.:/.test(r.t)).map((r) => ({ kind: "CB", x: Math.round(r.x * 1e3) / 1e3, y: Math.round(r.y * 1e3) / 1e3, rim: f2(/R\.E\.:\s*([\d.]+)/.exec(r.t)[1]) }));
const uniq = (arr) => arr.filter((c, i) => arr.findIndex((d) => Math.hypot(d.x - c.x, d.y - c.y) < 1) === i);

const ab = JSON.parse(readFileSync(abFile, "utf8"));
const report = [];
for (const m of ab.manholes ?? []) {
  const best = mhTexts.map((t) => ({ t, d: Math.hypot(t.x - m.x, t.y - m.y) })).filter((c) => c.d <= radius).sort((a, b) => a.d - b.d)[0];
  // m.preferAsBuilt (user decision per manhole, e.g. Goulds 2026-10-26): the as-built prints; the survey values are kept only as m.surveyIgnored for the record
  if (best && m.preferAsBuilt) { delete m.survey; m.surveyIgnored = { rim: best.t.rim, inv: best.t.inv, note: m.surveyIgnored?.note ?? "preferAsBuilt" }; report.push(`${m.id}: preferAsBuilt, survey RIM ${best.t.rim} ignored (as-built RIM ${m.rim}, gap ${Math.abs(m.rim - best.t.rim).toFixed(2)})`); }
  else if (best) { m.survey = { rim: best.t.rim, inv: best.t.inv }; report.push(`${m.id}: survey RIM ${best.t.rim} INV ${best.t.inv.map(([d, v]) => `${d} ${v}`).join(", ") || "-"}${m.rim != null ? ` (as-built RIM ${m.rim}, gap ${Math.abs(m.rim - best.t.rim).toFixed(2)})` : ""}`); }
  else { delete m.survey; report.push(`${m.id}: no survey text within ${radius} ft (as-built values stand)`); }
}
ab.storm = uniq(cbs);
report.push(`storm: ${ab.storm.length} catch basin(s) ${ab.storm.map((c) => c.rim).join(", ")}`);
console.log(report.join("\n"));
if (has("dry-run")) console.log("(dry-run: nothing written)");
else { writeFileSync(abFile, JSON.stringify(ab, null, 2)); console.log(`wrote ${abFile}`); }
