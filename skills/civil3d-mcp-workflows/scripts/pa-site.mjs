#!/usr/bin/env node
// PA SITE: picks THE subject parcel on the Miami-Dade Property Appraiser by cross-checking every source a project has, instead of
// trusting one: the folio printed on the documents (POC), the address written on them, and where the lot is in the survey (X-TOPO).
//   node pa-site.mjs --dir "<project folder>" [--address "..."] [--folio 30-6913-003-0830] [--xy X,Y] [--write]
//   node pa-site.mjs --address "12300 SW 232 ST"                       (no project: just ranks the candidates)
// Candidates: the folio (project.json subject.folio / --folio) + every parcel GetAddress returns for the address (vacant "227XX"
// addresses do not geocode: skipped with a note) + the parcels whose PA centroid is within 80 ft of site.lotPoint / --xy.
// For each: PA record (folio, site address, subdivision, plat P.B./PG, legal, lot size, use, zoning) + parcel polygon (GIS PaParcel,
// SR 2236 = drawing coordinates). Score: folio = document folio +3, polygon contains the lot point +3, centroid inside site.window +1,
// site address = document address (house number may be "XX") +2. Never picks blindly: a tie, or a winner that contradicts the document
// folio, is reported as AMBIGUOUS and nothing is written. Conflicts (e.g. VILLA ONE's POC "Location" = folio + 2109 N 66 AVE, not the
// site) are listed. --write fills project.json: subject.folio/pb/legal/subdivision only when EMPTY (else reported as a conflict),
// site.lotPoint = parcel centroid when missing, sources.pa = {date, folio}. Read-only web queries. Node 18+, no deps.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getJson } from "./lib/gis.mjs";

const PA = "https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx";
const PARCELS = "https://gisfs.miamidade.gov/mdarcgis/rest/services/MD_PA_PropertySearch/MapServer/6/query";
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const dir = flag("dir") ? resolve(flag("dir")) : null;
const projPath = dir ? join(dir, "project.json") : null;
const project = projPath && existsSync(projPath) ? JSON.parse(readFileSync(projPath, "utf8")) : null;
const docFolio = (flag("folio") ?? project?.subject?.folio ?? "").replace(/\D/g, "") || null;
const docAddress = flag("address") ?? project?.subject?.address ?? null;
const xy = flag("xy") ? flag("xy").split(",").map(Number) : project?.site?.lotPoint ?? null;
const win = project?.site?.window ?? null;
if (!docFolio && !docAddress && !xy) { console.error('usage: node pa-site.mjs --dir "<project>" | --address "..." | --folio N | --xy X,Y  [--write]'); process.exit(2); }

const get = (url) => getJson(url, { expectFeatures: /MapServer/.test(url) });  // county GIS: retried when it answers with an empty feature list (first-hit hiccup)
const fmtFolio = (f) => String(f).replace(/\D/g, "").replace(/^(\d{2})(\d{4})(\d{3})(\d{4})$/, "$1-$2-$3-$4");
const notes = [];

// "Possible matches" the way the PA web page offers them, from the county address points (GeoProp, layer 8): same pre-direction,
// street and type, nearest house numbers (h_num is a STRING there; st_name is "232ND" padded; the type is in st_type2).
const ADDRESSES = "https://gisfs.miamidade.gov/mdarcgis/rest/services/MD_PA_PropertySearch/MapServer/8/query";
async function nearbyOnStreet(address) {
  const m = /^\s*(\d+)\s+(N|S|E|W|NE|NW|SE|SW)?\s*(\w+?)(?:ST|ND|RD|TH)?\s+(ST|STREET|AVE|AVENUE|AV|CT|COURT|TER|TERRACE|PL|PLACE|RD|ROAD|DR|DRIVE|WAY|LN|LANE|BLVD|CIR)\b/i.exec(address);
  if (!m) { notes.push(`could not split "${address}" into number / direction / street / type`); return; }
  const [, num, pre, name, typeRaw] = m;
  const type = { STREET: "ST", AVENUE: "AVE", AV: "AVE", COURT: "CT", TERRACE: "TER", PLACE: "PL", ROAD: "RD", DRIVE: "DR", LANE: "LN" }[typeRaw.toUpperCase()] ?? typeRaw.toUpperCase();
  const where = [pre ? `pre_dir='${pre.toUpperCase()}'` : null, `st_name LIKE '${name.toUpperCase()}%'`, `(st_type2 LIKE '${type}%' OR st_type LIKE '${type}%')`].filter(Boolean).join(" AND ");
  const q = new URLSearchParams({ where, outFields: "FOLIO,address,h_num", returnGeometry: "false", f: "json" });
  try {
    const rows = ((await get(`${ADDRESSES}?${q}`)).features ?? []).map((f) => f.attributes).map((a) => ({ ...a, d: Math.abs(Number(a.h_num) - Number(num)) }))
      .filter((a) => Number.isFinite(a.d) && a.d <= 300).sort((x, y) => x.d - y.d).slice(0, 5);
    if (!rows.length) notes.push(`no address within 300 house numbers of ${num} on ${pre ?? ""} ${name} ${type}`);
    for (const a of rows) addCand(a.FOLIO, `nearby address ${a.address.replace(/\s+/g, " ").trim()} (${a.d} from ${num})`);
  } catch (e) { notes.push(`nearby-address search failed: ${e.message}`); }
}

// ---------- candidates ----------
const cands = new Map(); // folio(13 digits) -> {from:Set}
const addCand = (f, from) => { const k = String(f).replace(/\D/g, ""); if (k.length !== 13) return; if (!cands.has(k)) cands.set(k, { from: new Set() }); cands.get(k).from.add(from); };
if (docFolio) addCand(docFolio, "document folio");
if (docAddress) {
  if (/^\s*\d*X+/i.test(docAddress)) notes.push(`address "${docAddress}" is a vacant-lot range (XX): the PA does not geocode it — folio / lot point used instead`);
  else {
    try {
      const j = await get(`${PA}?Operation=GetAddress&clientAppName=PropertySearch&myUnit=&from=1&to=200&myAddress=${encodeURIComponent(docAddress)}`);
      const list = j.MinimumPropertyInfos ?? [];
      if (!list.length) {
        notes.push(`address "${docAddress}" not found exactly on the PA (${j.Message ?? "no match"}) — trying nearby numbers on the same street`);
        await nearbyOnStreet(docAddress);
      }
      for (const m of list) addCand(m.Strap, "address search");
    } catch (e) { notes.push(`address search failed: ${e.message}`); }
  }
}
if (xy) {
  const q = new URLSearchParams({ geometry: `${xy[0]},${xy[1]}`, geometryType: "esriGeometryPoint", inSR: "2236", spatialRel: "esriSpatialRelIntersects",
    outFields: "FOLIO", returnGeometry: "false", f: "json" });
  try { for (const f of (await get(`${PARCELS}?${q}`)).features ?? []) addCand(f.attributes.FOLIO, "lot point inside parcel"); }
  catch (e) { notes.push(`parcel-at-point query failed: ${e.message}`); }
}

// ---------- details + polygons ----------
const inPoly = (p, rings) => rings.some((ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
  const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; });
const centroid = (rings) => { const r = rings[0]; let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; }
  return a ? [cx / (3 * a), cy / (3 * a)] : r[0]; };
const normAddr = (s) => String(s ?? "").toUpperCase().replace(/\b(AVENUE)\b/g, "AVE").replace(/\b(STREET)\b/g, "ST").replace(/\b(\d+)(ST|ND|RD|TH)\b/g, "$1").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const sameStreet = (a, b) => { const A = normAddr(a).split(" "), B = normAddr(b).split(" ");
  const numOk = /X/.test(A[0]) || /X/.test(B[0]) ? A[0].replace(/X+$/, "") === B[0].slice(0, A[0].replace(/X+$/, "").length) : A[0] === B[0];
  return numOk && A.slice(1).join(" ") === B.slice(1).join(" "); };
const results = [];
for (const [folio, c] of cands) {
  let info = {}, rings = null;
  try {
    const j = await get(`${PA}?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch&folioNumber=${folio}`);
    const pi = j.PropertyInfo ?? {};
    info = {
      folio: pi.FolioNumber ?? fmtFolio(folio), siteAddress: (j.SiteAddress ?? []).map((s) => s.Address?.replace(/, .*$/, "")).filter(Boolean),
      subdivision: pi.SubdivisionDescription ?? null, pb: pi.PlatBook ? `${pi.PlatBook} PG-${pi.PlatPage}` : null,
      legal: (j.LegalDescription?.Description ?? "").split("|").map((s) => s.trim()).filter(Boolean),
      lotSizeSf: pi.LotSize ?? null, landUse: pi.DORDescription ?? null, zoning: pi.PrimaryZoneDescription ?? null,
    };
  } catch (e) { notes.push(`PA record ${fmtFolio(folio)} failed: ${e.message}`); }
  try {
    const q = new URLSearchParams({ where: `FOLIO='${folio}'`, outFields: "FOLIO", returnGeometry: "true", outSR: "2236", f: "json" });
    rings = (await get(`${PARCELS}?${q}`)).features?.[0]?.geometry?.rings ?? null;
  } catch (e) { notes.push(`parcel polygon ${fmtFolio(folio)} failed: ${e.message}`); }
  const cen = rings ? centroid(rings) : null;
  const score = [];
  if (docFolio && folio === docFolio) score.push(["folio = document folio", 3]);
  if (xy && rings && inPoly(xy, rings)) score.push(["lot point inside the parcel", 3]);
  if (win && cen && cen[0] >= win[0] && cen[0] <= win[2] && cen[1] >= win[1] && cen[1] <= win[3]) score.push(["parcel centre inside the site window", 1]);
  if (docAddress && (info.siteAddress ?? []).some((a) => sameStreet(docAddress, a))) score.push(["site address = document address", 2]);
  else if ([...c.from].some((f) => f.startsWith("nearby address"))) score.push(["nearby number on the document's street", 1]);
  results.push({ ...info, folio: info.folio ?? fmtFolio(folio), from: [...c.from], centroid: cen && cen.map((v) => +v.toFixed(2)), score: score.reduce((s, [, v]) => s + v, 0), why: score.map(([w]) => w) });
}
// tie-break: the nearest house number on the street (the PA page's own "possible match" order)
const numDist = (r) => Math.min(...r.from.map((f) => Number((/\((\d+) from/.exec(f) ?? [])[1])).filter(Number.isFinite), Infinity);
results.sort((a, b) => b.score - a.score || numDist(a) - numDist(b));
const [best, second] = results;
const conflicts = [];
const pocLoc = project?.sources?.pocData?.location;
if (pocLoc && best?.siteAddress?.length && !best.siteAddress.some((a) => normAddr(pocLoc).includes(normAddr(a)))) {
  const tail = pocLoc.replace(/^\d{13}\d{0,4}?/, "").trim();
  conflicts.push(`POC "Location" ends in "${tail}", which is not the parcel's site address (${best.siteAddress.join(" / ")}): use the folio, not that address`);
}
let verdict;
if (!best) verdict = "NO CANDIDATE";
else if (best.why.every((w) => w.startsWith("nearby number"))) verdict = "NEEDS THE LOT POINT OR THE FOLIO (only nearby addresses on the street; nearest listed first)";
else if (second && second.score === best.score) verdict = "AMBIGUOUS (tie)";
else if (docFolio && fmtFolio(docFolio) !== best.folio) verdict = "AMBIGUOUS (winner contradicts the document folio)";
else if (best.score < 3) verdict = "WEAK (only one weak signal)";
else verdict = "OK";

console.log(`verdict: ${verdict}`);
for (const r of results) console.log(`  ${r.score.toString().padStart(2)}  ${r.folio}  ${(r.siteAddress ?? []).join(" / ") || "-"}  P.B. ${r.pb ?? "-"}  [${r.from.join(", ")}]  ${r.why.join("; ")}`);
for (const n of notes) console.log(`  note: ${n}`);
for (const c of conflicts) console.log(`  CONFLICT: ${c}`);
if (best) console.log(`  chosen: ${best.folio} | ${best.subdivision ?? "-"} | P.B. ${best.pb ?? "-"} | ${best.legal.join(" | ")}`);

if (has("write")) {
  if (!project) { console.error("--write needs --dir with a project.json"); process.exit(2); }
  if (verdict !== "OK") { console.log("NOT written: verdict is not OK (resolve it first)"); process.exit(1); }
  const s = (project.subject ??= {});
  const fill = (k, v) => { if (v == null || v === "") return; if (s[k] == null || s[k] === "") s[k] = v; else if (String(s[k]) !== String(v)) conflicts.push(`subject.${k} is "${s[k]}" in project.json, PA says "${v}" (left as is)`); };
  fill("folio", best.folio); fill("pb", best.pb); fill("subdivision", best.subdivision); fill("legal", best.legal.join(" | "));
  project.site ??= {};
  if (!project.site.lotPoint && best.centroid) project.site.lotPoint = best.centroid;
  project.sources ??= {};
  project.sources.pa = { date: new Date().toISOString().slice(0, 10), folio: best.folio, siteAddress: best.siteAddress, lotSizeSf: best.lotSizeSf };
  (project.history ??= []).push({ date: new Date().toISOString().slice(0, 10), event: `pa-site: ${best.folio} (${best.why.join("; ")})` });
  project.updated = new Date().toISOString();
  writeFileSync(projPath, JSON.stringify(project, null, 2) + "\n");
  for (const c of conflicts.slice(-5)) console.log(`  CONFLICT: ${c}`);
  console.log(`written: ${projPath}`);
}
