#!/usr/bin/env node
// AS-BUILT GEOREFERENCE FROM SURVEY SYMBOLS: places the callouts of a scanned as-built that print only a STATION (no N/E, no baseline letter: Goulds 33809) by pairing
// them with the symbols the surveyor drew in X-TOPO (manholes "MH-SS-flat-2" / "SMH", clean-outs, valves, hydrants, meters) and the X-UTIL line they belong to.
//
//   node asbuilt-georef-symbols.mjs --draft <scan.draft.json> --topo <X-TOPO_dump.txt> --util <X-UTIL_dump.txt> [--out <draft.json>] [--tol 8]
//
// 1. SYMBOL INVENTORY (X-TOPO INSERTs, dwg-dump.ps1 exports the text inside anonymous blocks as btxt=): sewer manholes (block MH / SMH / MANHOLE, text SAN, or a
//    MH on an X-UTIL SAN line), clean-outs, water valves, hydrants, meters. Printed in the log so it is clear what the survey does and does not hold.
// 2. ANCHOR: the as-built callout "STA 0+00 / EXIST MH" is paired with the survey sewer-manhole symbol that sits ON the X-UTIL SAN line (nearest to a SAN vertex /
//    end within --tol ft); the baseline is the X-UTIL SAN polyline walked away from that manhole (straight on past its last vertex).
// 3. STATIONS: the callouts of the same image column as the anchor (the same main on the plan: |dx| <= 450 px, below the anchor, stations growing with y) get
//    N/E = the point at that station on the baseline. They are SUGGESTIONS (item.source = "paired with survey symbol", item.pairing = {...}); the review sheet shows
//    them and the user confirms or corrects. Items already located (printed N/E) are never touched.
// 4. OTHER CLASSES (valves, hydrants, tees, meters): paired only when the as-built has exactly as many callouts of the class as the survey has symbols of it inside the
//    window (matched in order along the street) -- otherwise left unplaced and reported.
// Output: the same draft with N/E, source and pairing filled where it could; a summary of what was paired / left. Node 18, no deps.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const draftPath = flag("draft"), topoPath = flag("topo"), utilPath = flag("util");
if (!draftPath || !topoPath || !utilPath) { console.error("usage: node asbuilt-georef-symbols.mjs --draft d.json --topo X-TOPO_dump.txt --util X-UTIL_dump.txt [--out d.json] [--tol 8]"); process.exit(2); }
const tol = Number(flag("tol") ?? 8);
const draft = JSON.parse(readFileSync(draftPath, "utf8"));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const kvOf = (fields) => Object.fromEntries(fields.filter((f) => f.includes("=")).map((f) => [f.slice(0, f.indexOf("=")), f.slice(f.indexOf("=") + 1)]));
const pt = (s) => { const m = /\(([-\d.]+)\s+([-\d.]+)/.exec(s ?? ""); return m ? [Number(m[1]), Number(m[2])] : null; };

// ---- X-UTIL SAN polylines / lines (as ordered vertex lists) ----
const sanLines = [];
for (const line of readFileSync(utilPath, "utf8").split(/\r?\n/)) {
  const f = line.split("|"); if (f[0] !== "ENT" || !/SAN|SEW/i.test(f[3] ?? "")) continue;
  const kv = kvOf(f.slice(4));
  if (f[1] === "LINE") { const q = pt(kv.p2); if (q) sanLines.push([[Number(kv.x), Number(kv.y)], q]); }
  else if (f[1] === "LWPOLYLINE") { const v = (kv.v ?? "").split(";").filter(Boolean).map((s) => s.split(",").map(Number)); if (v.length > 1) sanLines.push(v); }
}
const segDist = (p, a, b) => { const d = [b[0] - a[0], b[1] - a[1]], l2 = d[0] ** 2 + d[1] ** 2 || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2)); return dist(p, [a[0] + d[0] * t, a[1] + d[1] * t]); };
const distToSan = (p) => Math.min(Infinity, ...sanLines.flatMap((v) => v.slice(1).map((q, i) => segDist(p, v[i], q))));

// ---- survey symbol inventory (only the neighbourhood of THIS site: X-TOPO often holds other jobs; window = --window x0,y0,x1,y1 or the X-UTIL line extent + 500 ft) ----
const extent = sanLines.flat();
let win = flag("window")?.split(",").map(Number);
if (!win && extent.length) { const xs = extent.map((q) => q[0]), ys = extent.map((q) => q[1]); win = [Math.min(...xs) - 500, Math.min(...ys) - 500, Math.max(...xs) + 500, Math.max(...ys) + 500]; }
const inWin = (p) => !win || (p[0] >= win[0] && p[1] >= win[1] && p[0] <= win[2] && p[1] <= win[3]);
const symbols = [];
for (const line of readFileSync(topoPath, "utf8").split(/\r?\n/)) {
  const f = line.split("|"); if (f[0] !== "ENT" || f[1] !== "INSERT") continue;
  const kv = kvOf(f.slice(4)); const block = kv.block ?? "", btxt = kv.btxt ?? "", p = [Number(kv.x), Number(kv.y)];
  if (!Number.isFinite(p[0]) || (Math.abs(p[0]) < 1 && Math.abs(p[1]) < 1) || !inWin(p)) continue;
  const name = `${block} ${btxt}`;
  let cls = null;
  if (/\bMH\b|\bSMH\b|MH-|MANHOLE/i.test(name) && !/CATCH|\bCB\b|STORM|DMH/i.test(name)) cls = "SAN_MH";
  else if (/CLEAN-?OUT|\bC\/?O\b/i.test(name)) cls = "CLEANOUT";
  else if (/\bGV\b|VALVE|\bWV\b/i.test(name)) cls = "VALVE";
  else if (/\bFH\b|HYDRANT/i.test(name)) cls = "HYDRANT";
  else if (/\bWM\b|METER/i.test(name)) cls = "METER";
  if (cls) symbols.push({ cls, block, btxt, p });
}
const count = {}; for (const s of symbols) count[s.cls] = (count[s.cls] ?? 0) + 1;
console.log(`survey symbols (this site): ${Object.entries(count).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);

// manholes that sit ON an X-UTIL SAN line
const mhOnSan = symbols.filter((s) => s.cls === "SAN_MH").map((s) => ({ ...s, d: distToSan(s.p) })).filter((s) => s.d <= tol).sort((a, b) => a.d - b.d);
console.log(`sewer-manhole symbols on an X-UTIL SAN line (<= ${tol} ft): ${mhOnSan.length}${mhOnSan.length ? " -> " + mhOnSan.map((s) => `${s.block} at ${s.p.map((v) => v.toFixed(1))} (${s.d.toFixed(1)} ft)`).join("; ") : ""}`);

const items = draft.items ?? [];
const report = { anchor: null, placed: 0, classes: {} };
const bx = (it) => it.box.x + it.box.w / 2;

// ---- 2/3: anchor "STA 0+00 / EXIST MH" + stations of its column ----
const anchorItem = items.find((it) => it.sta === 0 && /MH|MANHOLE/i.test(it.text) && it.N == null);
if (anchorItem && mhOnSan.length) {
  const mh = mhOnSan[0];
  // baseline = the SAN polyline that holds the manhole, walked away from it (toward its farther end); straight on past the last vertex
  const v = sanLines.map((l) => ({ l, d: Math.min(...l.slice(1).map((q, i) => segDist(mh.p, l[i], q))) })).sort((a, b) => a.d - b.d)[0].l;
  const dStart = dist(mh.p, v[0]), dEnd = dist(mh.p, v.at(-1));
  const path = dStart <= dEnd ? [mh.p, ...v] : [mh.p, ...[...v].reverse()];            // from the manhole outward
  const cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
  const at = (s) => {
    for (let i = 1; i < path.length; i++) if (s <= cum[i] + 1e-6) { const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]; }
    const a = path.at(-2), b = path.at(-1), l = dist(a, b) || 1; const e = s - cum.at(-1);        // beyond the drawn end: straight on
    return [b[0] + ((b[0] - a[0]) / l) * e, b[1] + ((b[1] - a[1]) / l) * e];
  };
  anchorItem.N = +mh.p[1].toFixed(4); anchorItem.E = +mh.p[0].toFixed(4); anchorItem.source = "paired with survey symbol";
  anchorItem.pairing = { symbol: `${mh.block} at ${mh.p.map((x) => x.toFixed(2)).join(",")}`, method: "STA 0+00 EXIST MH = the surveyed sewer manhole on the X-UTIL SAN line" };
  anchorItem.issues = [...(anchorItem.issues ?? []), `paired with survey symbol ${mh.block} (${mh.d.toFixed(1)} ft from the X-UTIL SAN line): check`];
  report.anchor = anchorItem.pairing.symbol;
  const ax = bx(anchorItem), ay = anchorItem.box.y;
  const col = items.filter((it) => it !== anchorItem && it.sta != null && it.N == null && Math.abs(bx(it) - ax) <= 450 && it.box.y > ay && !/RIM|INV/i.test(it.text))
    .sort((a, b) => a.box.y - b.box.y);
  // stations must grow with y (down the plan): keep the longest increasing run
  let best = [], cur = [];
  for (const it of col) { if (cur.length && it.sta <= cur.at(-1).sta) { if (cur.length > best.length) best = cur; cur = []; } cur.push(it); }
  if (cur.length > best.length) best = cur;
  for (const it of best) {
    const p = at(it.sta);
    it.N = +p[1].toFixed(4); it.E = +p[0].toFixed(4); it.source = "paired with survey symbol";
    it.pairing = { symbol: anchorItem.pairing.symbol, method: `station ${it.sta} ft along the X-UTIL SAN line from the anchor manhole${it.sta > cum.at(-1) ? " (past the drawn end: straight on)" : ""}` };
    it.issues = [...(it.issues ?? []), `placed ${it.sta} ft from the surveyed manhole along the SAN line (suggestion): check against the plan`];
    report.placed++;
  }
  console.log(`anchor: ${anchorItem.pairing.symbol}; ${report.placed} station callout(s) placed along the SAN line (drawn length ${cum.at(-1).toFixed(0)} ft)`);
} else console.log(anchorItem ? "no survey sewer-manhole symbol on the X-UTIL SAN line: the STA 0+00 manhole is not anchored" : "no 'STA 0+00 EXIST MH' callout in this scan: no station anchor");

// ---- 4: other classes, only by equal counts ----
const CLASS_RULES = [["VALVE", /G\.?V\.?|GATE|BUTTERFLY|VALVE/i], ["HYDRANT", /F\.?H\.?|HYDRANT/i], ["METER", /METER|WATER SERV/i]];
for (const [cls, re] of CLASS_RULES) {
  const asb = items.filter((it) => it.N == null && re.test(it.text) && it.sta != null);
  const sv = symbols.filter((s) => s.cls === cls);
  report.classes[cls] = { asBuilt: asb.length, survey: sv.length, paired: 0 };
  if (asb.length && asb.length === sv.length) {
    const key = (p) => p[0] + p[1];            // order along the street
    asb.sort((a, b) => a.sta - b.sta); sv.sort((a, b) => key(a.p) - key(b.p));
    asb.forEach((it, i) => { it.N = +sv[i].p[1].toFixed(4); it.E = +sv[i].p[0].toFixed(4); it.source = "paired with survey symbol"; it.pairing = { symbol: `${sv[i].block} at ${sv[i].p.map((x) => x.toFixed(2)).join(",")}`, method: `${cls}: same count as-built / survey (${asb.length}), matched in order` }; it.issues = [...(it.issues ?? []), "paired in order with a survey symbol (suggestion): check"]; report.classes[cls].paired++; });
  }
}
for (const [cls, r] of Object.entries(report.classes)) if (r.asBuilt || r.survey) console.log(`${cls}: as-built callouts ${r.asBuilt}, survey symbols ${r.survey} -> ${r.paired ? `${r.paired} paired` : r.asBuilt && !r.survey ? "NO survey symbol to pair with" : "counts differ: not paired"}`);

const outPath = flag("out") ?? draftPath;
writeFileSync(outPath, JSON.stringify(draft, null, 1));
console.log(`-> ${outPath}`);
