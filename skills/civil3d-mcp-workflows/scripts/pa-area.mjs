#!/usr/bin/env node
// PA AREA: the user's manual Property Appraiser routine, automated (user, 2026-10-02):
//   1. read the street names the plans show (SW 118 AVE vertical, SW 227 ST horizontal) -> search "11800 227" (avenue number x 100 = the
//      house-number block, the other street = street name; two cross streets = two searches);
//   2. the PA answers "exact match not found, 5 possible matches": folios with owner / address / subdivision (nearest house numbers);
//   3. open each folio: map position + Full Legal Description (LOT 12 BLK 8, LOT SIZE 113.740 X 100, P.B. 46 PG 94);
//   4. click the OTHER lots on the map for their sizes -> compare with the plans / PDFs.
// Here: every parcel inside the survey window (GIS PaParcel, SR 2236 = drawing coordinates) gets its PA record + legal lot size and its
// polygon's measured size; legal vs measured is checked (a mismatch = wrong lot or a different plat); the subject lot is the parcel that
// contains site.lotPoint; and the lot lines the subject shares with each neighbour are listed as U.E. CANDIDATES (firm recipe: 5 ft each
// side of the shared lot line). The recorded plat decides which line really carries the easement, so candidates are only PROPOSALS.
//   node pa-area.mjs --dir "<project folder>" [--near "11800 227"] [--streets "SW 118TH AVENUE,SW 227TH STREET"] [--window x0,y0,x1,y1]
//                    [--xy X,Y] [--out file.json] [--write] [--no-neighbors]
//   node pa-area.mjs --near "11800 227" --xy 859875,444854 --window 859600,444400,860000,445000        (no project folder)
// Streets: --streets, else <TEMP>\c3d-fase1-build\<slug>\spec.json (streets), else a dump of <dir>\X-TOPO.dwg (street labels).
// --write puts site.paArea (date, queries, subject folio, report file) in project.json. Read-only web queries. Node 18+, no deps.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getJson } from "./lib/gis.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const here = fileURLToPath(new URL(".", import.meta.url));
const dir = flag("dir") ? resolve(flag("dir")) : null;
const project = dir && existsSync(join(dir, "project.json")) ? JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) : null;
const slug = dir ? basename(dir).replace(/[^\w\-]/g, "_") : null;

const PA = "https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx";
const GIS = "https://gisfs.miamidade.gov/mdarcgis/rest/services/MD_PA_PropertySearch/MapServer";
const get = (url, opt) => getJson(url, opt);
const fmtFolio = (f) => String(f).replace(/\D/g, "").replace(/^(\d{2})(\d{4})(\d{3})(\d{4})$/, "$1-$2-$3-$4");
const notes = [];
const num = (v, d = 1) => (Number.isFinite(v) ? +v.toFixed(d) : null);

// ---------------------------------------------------------------- 1. streets -> searches
const xy = flag("xy") ? flag("xy").split(",").map(Number) : project?.site?.lotPoint ?? null;
let win = flag("window") ? flag("window").split(",").map(Number) : project?.site?.window ?? null;
if (!win && xy) win = [xy[0] - 300, xy[1] - 300, xy[0] + 300, xy[1] + 300];
const ORD = (n) => `${n}${[11, 12, 13].includes(n % 100) ? "TH" : ["TH", "ST", "ND", "RD"][n % 10 < 4 ? n % 10 : 0]}`;
const TYPE = { STREET: "ST", ST: "ST", AVENUE: "AVE", AVE: "AVE", COURT: "CT", CT: "CT", TERRACE: "TER", TER: "TER", PLACE: "PL", PL: "PL", ROAD: "RD", RD: "RD", LANE: "LN", LN: "LN", DRIVE: "DR", DR: "DR", WAY: "WAY", PATH: "PATH" };
const parseStreet = (s) => { const m = /\b(N|S|E|W|NE|NW|SE|SW)\.?\s*(?:W\.)?\s*(\d+)\s*(?:ST|ND|RD|TH)?\s+(STREET|ST|AVENUE|AVE|COURT|CT|TERRACE|TER|PLACE|PL|ROAD|RD|LANE|LN|DRIVE|DR|WAY|PATH)\b/i.exec(String(s).replace(/\./g, "").replace(/\bS W\b/i, "SW"));
  return m ? { dir: m[1].toUpperCase(), n: Number(m[2]), type: TYPE[m[3].toUpperCase()] } : null; };
function streetNames() {
  if (flag("streets")) return flag("streets").split(",").map((s) => s.trim()).filter(Boolean);
  const spec = slug && existsSync(join(tmpdir(), "c3d-fase1-build", slug, "spec.json")) ? JSON.parse(readFileSync(join(tmpdir(), "c3d-fase1-build", slug, "spec.json"), "utf8")) : null;
  if (spec?.streets?.length) return spec.streets.map((s) => s.name);
  if (dir && existsSync(join(dir, "X-TOPO.dwg"))) {                       // street labels of the survey itself
    const work = join(tmpdir(), "c3d-pa-area", slug); mkdirSync(work, { recursive: true });
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "dwg-dump.ps1"), join(dir, "X-TOPO.dwg"), "-OutDir", work], { encoding: "utf8", timeout: 600000 });
    const dump = (r.stdout ?? "").trim().split(/\r?\n/).pop();
    if (dump && existsSync(dump)) {
      const names = new Set();
      for (const line of readFileSync(dump, "utf8").split(/\r?\n/)) if (/^ENT\|M?TEXT\|/.test(line)) { const mx = /\|x=([-\d.]+)\|y=([-\d.]+)/.exec(line); if (win && mx && (+mx[1] < win[0] || +mx[1] > win[2] || +mx[2] < win[1] || +mx[2] > win[3])) continue; /* the survey file covers several sites: only labels inside the window */ const t = line.slice(line.indexOf("|txt=") + 5).replace(/\\P/g, " "); const p = parseStreet(t); if (p) names.add(`${p.dir} ${p.n}${p.type === "AVE" ? " AVENUE" : p.type === "ST" ? " STREET" : " " + p.type}`); }
      return [...names];
    }
  }
  return [];
}
let queries = [];
if (flag("near")) {                                                       // the user's shorthand: "11800 227" (+ optional direction/type)
  const m = /^\s*(\d+)\s+(?:(N|S|E|W|NE|NW|SE|SW)\s+)?(\d+)(?:ST|ND|RD|TH)?(?:\s+(\w+))?\s*$/i.exec(flag("near"));
  if (!m) { console.error('--near must look like "11800 227" or "11800 SW 227 ST"'); process.exit(2); }
  queries.push({ text: `${m[1]} ${(m[2] ?? "SW").toUpperCase()} ${m[3]} ${TYPE[(m[4] ?? "ST").toUpperCase()] ?? "ST"}`, number: Number(m[1]), dir: (m[2] ?? "SW").toUpperCase(), street: Number(m[3]), type: TYPE[(m[4] ?? "ST").toUpperCase()] ?? "ST" });
} else {
  const parsed = streetNames().map(parseStreet).filter(Boolean);
  const avenues = parsed.filter((p) => p.type === "AVE" || p.type === "CT" || p.type === "PL" && false), streets = parsed.filter((p) => p.type === "ST" || p.type === "TER" || p.type === "LN");
  for (const a of avenues) for (const s of streets) queries.push({ text: `${a.n * 100} ${s.dir} ${s.n} ${s.type}`, number: a.n * 100, dir: s.dir, street: s.n, type: s.type });
  if (!queries.length) notes.push("no avenue + street pair found in the survey labels (pass --near \"11800 227\" or --streets)");
}

// "possible matches": county address points (GeoProp layer 8) on the same street, nearest house numbers (same logic as pa-site.mjs)
async function possibleMatches(q) {
  const where = [`pre_dir='${q.dir}'`, `st_name LIKE '${q.street}%'`, `(st_type2 LIKE '${q.type}%' OR st_type LIKE '${q.type}%')`].join(" AND ");
  const p = new URLSearchParams({ where, outFields: "FOLIO,address,h_num", returnGeometry: "false", f: "json" });
  const rows = ((await get(`${GIS}/8/query?${p}`)).features ?? []).map((f) => f.attributes).map((a) => ({ folio: fmtFolio(a.FOLIO), address: String(a.address).replace(/\s+/g, " ").trim(), d: Math.abs(Number(a.h_num) - q.number) }))
    .filter((a) => Number.isFinite(a.d) && a.d <= 300).sort((x, y) => x.d - y.d).slice(0, 8);
  return rows;
}

// ---------------------------------------------------------------- 2. window + parcels
const cache = join(tmpdir(), "c3d-pa-cache"); mkdirSync(cache, { recursive: true });
const centroid = (r) => { let a = 0, cx = 0, cy = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; } return a ? [cx / (3 * a), cy / (3 * a)] : r[0]; };
const area = (r) => Math.abs(r.reduce((s, p, i) => s + (r[(i + 1) % r.length][0] * p[1] - p[0] * r[(i + 1) % r.length][1]), 0)) / 2;
const inPoly = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
// measured size = the smallest rectangle (any rotation) around the polygon: [long side, short side]
const minRect = (r) => { let best = null; for (let i = 0; i < r.length - 1; i++) { const dx = r[i + 1][0] - r[i][0], dy = r[i + 1][1] - r[i][1], L = Math.hypot(dx, dy); if (L < 1) continue; const ux = dx / L, uy = dy / L;
  let a0 = 1e18, a1 = -1e18, b0 = 1e18, b1 = -1e18; for (const [x, y] of r) { const a = x * ux + y * uy, b = -x * uy + y * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  const w = a1 - a0, h = b1 - b0; if (!best || w * h < best.w * best.h) best = { w, h }; } return best ? [Math.max(best.w, best.h), Math.min(best.w, best.h)] : [0, 0]; };
async function paRecord(folio13) {
  const f = join(cache, `${folio13}.json`);
  if (existsSync(f)) try { return JSON.parse(readFileSync(f, "utf8")); } catch { /* refetch */ }
  const j = await get(`${PA}?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch&folioNumber=${folio13}`, { expectFeatures: false });
  const pi = j.PropertyInfo ?? {}, legal = (j.LegalDescription?.Description ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const text = legal.join(" | ");
  const ls = /LOT SIZE\s+([\d.]+)\s*X\s*([\d.]+)/i.exec(text), lb = /LOT\s+(\S+)\s+BLK\s+(\S+)/i.exec(text.replace(/\s+/g, " "));
  const rec = { folio: pi.FolioNumber ?? fmtFolio(folio13), address: (j.SiteAddress ?? []).map((s) => s.Address?.replace(/, .*$/, "")).filter(Boolean)[0] ?? null,
    owner: (j.OwnerInfos ?? []).map((o) => o.Name).filter(Boolean).join(" / ") || null, subdivision: pi.SubdivisionDescription ?? null, pb: pi.PlatBook ? `${pi.PlatBook} PG-${pi.PlatPage}` : null,
    lot: lb?.[1] ?? null, block: lb?.[2] ?? null, legalSize: ls ? [Number(ls[1]), Number(ls[2])] : null, lotSf: pi.LotSize ?? null, use: pi.DORDescription ?? null, zoning: pi.PrimaryZoneDescription ?? null, legal: text };
  writeFileSync(f, JSON.stringify(rec)); return rec;
}

// ---------------------------------------------------------------- run
const report = { date: new Date().toISOString().slice(0, 10), queries: [], window: win, lotPoint: xy, subject: null, lots: [], ueCandidates: [], notes };
for (const q of queries) {
  let rows = []; try { rows = await possibleMatches(q); } catch (e) { notes.push(`possible matches for "${q.text}" failed: ${e.message}`); }
  const recs = []; for (const r of rows) { try { const rec = await paRecord(r.folio.replace(/\D/g, "")); recs.push({ ...r, owner: rec.owner, subdivision: rec.subdivision }); } catch { recs.push(r); } }
  report.queries.push({ search: q.text, shorthand: `${q.number} ${q.street}`, possibleMatches: recs });
}
if (!win) notes.push("no survey window and no lot point (--window / --xy / site.window): neighbouring lots NOT listed");
else if (!has("no-neighbors")) {
  const p = new URLSearchParams({ geometry: win.join(","), geometryType: "esriGeometryEnvelope", inSR: "2236", spatialRel: "esriSpatialRelIntersects", outFields: "FOLIO", returnGeometry: "true", outSR: "2236", f: "json" });
  const feats = (await get(`${GIS}/6/query?${p}`)).features ?? [];
  const parcels = feats.map((f) => ({ folio13: String(f.attributes.FOLIO), ring: f.geometry?.rings?.[0] })).filter((x) => x.ring && x.ring.length > 3);
  const inWin = parcels.filter((x) => { const c = centroid(x.ring); return c[0] >= win[0] && c[0] <= win[2] && c[1] >= win[1] && c[1] <= win[3]; });
  let next = 0; const out = [];
  await Promise.all(Array.from({ length: 6 }, async () => { while (next < inWin.length) { const x = inWin[next++]; try { out.push({ x, rec: await paRecord(x.folio13) }); } catch (e) { notes.push(`PA record ${fmtFolio(x.folio13)} failed: ${e.message}`); } } }));
  for (const { x, rec } of out) {
    const [mw, mh] = minRect(x.ring), sf = area(x.ring), cen = centroid(x.ring);
    const l = rec.legalSize ? [Math.max(...rec.legalSize), Math.min(...rec.legalSize)] : null;
    const dLong = l ? mw - l[0] : null, dShort = l ? mh - l[1] : null;
    // The GIS polygon is the CURRENT parcel; the legal "LOT SIZE" is the PLATTED lot. A parcel smaller than its plat by ~5-10 ft on a side is usually a
    // right-of-way dedication on a street side (the street was widened after the plat); equal = untouched; larger = a merged / replatted parcel.
    const side = (d) => (d == null ? null : Math.abs(d) <= 3 ? "=" : d < 0 ? `-${Math.abs(d).toFixed(1)}` : `+${d.toFixed(1)}`);
    const agree = l ? Math.abs(dLong) <= 3 && Math.abs(dShort) <= 3 : null;
    const kind = l == null ? "no legal size" : agree ? "OK (polygon = plat)" : dLong > 3 || dShort > 3 ? `LARGER than the plat (${side(dLong)} x ${side(dShort)}): merged or replatted parcel?` : `smaller than the plat (${side(dLong)} x ${side(dShort)}): probable R/W dedication on the street side(s)`;
    report.lots.push({ folio: rec.folio, address: rec.address, owner: rec.owner, lot: rec.lot, block: rec.block, pb: rec.pb, legalSize: rec.legalSize, measuredSize: [num(mw), num(mh)], areaSf: num(sf, 0), paLotSf: rec.lotSf,
      sizeCheck: kind, delta: l ? [num(dLong), num(dShort)] : null, centroid: cen.map((v) => num(v, 2)), subject: !!(xy && inPoly(xy, x.ring)), ring: x.ring.map((q) => [num(q[0], 3), num(q[1], 3)]) });
  }
  report.lots.sort((a, b) => (b.subject - a.subject) || String(a.block).localeCompare(String(b.block)) || Number(a.lot) - Number(b.lot));
  const subj = report.lots.find((l) => l.subject);
  report.subject = subj ? { folio: subj.folio, lot: subj.lot, block: subj.block, legalSize: subj.legalSize } : null;
  if (!subj) notes.push(xy ? "the lot point is not inside any parcel of the window" : "no lot point: the subject lot is NOT identified (give --xy or run pa-site.mjs --write first)");
  // U.E. candidates: lot lines the subject shares with each neighbour (firm recipe: 5 ft each side of the shared lot line, frontage R/W to rear line)
  if (subj) {
    const S = subj.ring, near = (a, b, tol = 1.5) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
    const onSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)); return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) <= 1.5; };
    for (let i = 0; i < S.length - 1; i++) {
      const a = S[i], b = S[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 15) continue;
      const shared = report.lots.filter((o) => !o.subject && o.ring.slice(0, -1).filter((q) => onSeg(q, a, b)).length >= 2);
      report.ueCandidates.push({ edge: i, from: a, to: b, lengthFt: num(len), sharedWith: shared.map((o) => `B${o.block}L${o.lot} (${o.folio})`), kind: shared.length ? "shared lot line" : "street frontage / unshared edge", proposedWidthFt: shared.length ? 5 : null, confirmed: false });
    }
  }
}

// ---------------------------------------------------------------- print + write
console.log(`PA area — ${report.date}${dir ? ` — ${basename(dir)}` : ""}`);
for (const q of report.queries) { console.log(`\nsearch "${q.shorthand}" -> ${q.search}   (the PA page says "exact match not found, possible matches:")`);
  for (const r of q.possibleMatches) console.log(`   ${r.folio}  ${r.address.padEnd(18)} ${String(r.subdivision ?? "").padEnd(16)} ${String(r.owner ?? "").slice(0, 34)}  [${r.d} from ${q.shorthand.split(" ")[0]}]`); }
if (report.lots.length) {
  console.log(`\nlots inside the window (${report.lots.length}); * = subject lot; legal size = "Full Legal Description", measured = GIS polygon`);
  console.log("   folio             lot/blk   legal size        measured          check");
  for (const l of report.lots) console.log(` ${l.subject ? "*" : " "} ${l.folio}  L${String(l.lot ?? "?").padEnd(3)}B${String(l.block ?? "?").padEnd(3)}  ${String(l.legalSize ? l.legalSize.join(" x ") : "-").padEnd(16)}  ${l.measuredSize.join(" x ").padEnd(16)}  ${l.sizeCheck}`);
  const dedic = report.lots.filter((l) => /^smaller/.test(l.sizeCheck)).length, big = report.lots.filter((l) => /^LARGER/.test(l.sizeCheck)).length; console.log(`   ${dedic} lot(s) smaller than their plat (probable R/W dedications), ${big} larger (merged / replatted?)`);
}
if (report.ueCandidates.length) { console.log(`\nU.E. candidates for the subject lot (PROPOSALS: the recorded plat says which line carries the easement; recipe = 5 ft each side of the line):`);
  for (const c of report.ueCandidates) console.log(`   edge ${c.edge}  ${String(c.lengthFt).padStart(6)} ft  ${c.kind}${c.sharedWith.length ? " with " + c.sharedWith.join(", ") : ""}`); }
for (const n of notes) console.log(`note: ${n}`);
if (flag("out") || dir) {
  const file = flag("out") ?? join(dir, "_reports", `pa-area_${report.date}.json`); mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, JSON.stringify(report, null, 1)); console.log(`\nreport -> ${file}`);
  if (has("write") && dir && project) { project.site = { ...(project.site ?? {}), paArea: { date: report.date, queries: report.queries.map((q) => q.search), subjectFolio: report.subject?.folio ?? null, lots: report.lots.length, file } }; writeFileSync(join(dir, "project.json"), JSON.stringify(project, null, 2)); console.log("project.json site.paArea updated"); }
}
