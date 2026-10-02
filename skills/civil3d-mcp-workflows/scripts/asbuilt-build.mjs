#!/usr/bin/env node
// AS-BUILT BUILD: writes the asbuilt.json that c300-utility-labels.mjs consumes, from the user's CONFIRMED review + X-UTIL geometry.
//   node asbuilt-build.mjs --confirmed <asbuilt.confirmed.json> --assoc <sewer.assoc.json> [--assoc <water.assoc.json>]
//        --util <X-UTIL_dump.txt> --frontage <deg> [--sewer-ref ES9467-2] [--water-ref E14611-2] [--tol 15] [--out asbuilt.json]
// Chain: scan-ocr.ps1 -> asbuilt-extract.mjs -> asbuilt-associate.mjs -> asbuilt-review.py (user confirms) -> THIS -> c300-utility-labels.mjs
//   manholes    X-UTIL SAN nodes (ELLIPSE centres + junctions of 2+ segments), positioned where X-UTIL draws them; RIM/INV from the
//               confirmed sewer item nearest to the node (<= --tol). Ids from the scan text ("MH#5"), else MH-1, MH-2...
//   sewerMains  X-UTIL SAN segments split at every node lying on them; pipe + slope matched BY LENGTH to the confirmed pipe callouts
//               ("132'- 8" PVC SDR-35@ 0.39%" = the 132 ft MH#5->MH#7 tramo): scans are not to scale, lengths are. No match -> no label.
//   waterMains  X-UTIL WAT segments; text from the confirmed water-main callout ("8" DIP WM") else the standard default.
//   hydrants    confirmed FH items (their N/E).
// Only CONFIRMED values are used (as-builts are scans: never an unconfirmed OCR number). Prints what it could not resolve. Node 18+.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const all = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const confirmedPath = flag("confirmed"), utilPath = flag("util"), frontage = Number(flag("frontage"));
if (!confirmedPath || !utilPath || !Number.isFinite(frontage)) {
  console.error("usage: node asbuilt-build.mjs --confirmed asbuilt.confirmed.json --assoc a.assoc.json [--assoc b.assoc.json] --util X-UTIL_dump.txt --frontage <deg> [--sewer-ref ..] [--water-ref ..] [--out asbuilt.json]");
  process.exit(2);
}
const tol = Number(flag("tol") ?? 15);
const confirmedDoc = JSON.parse(readFileSync(confirmedPath, "utf8"));
const confirmed = confirmedDoc.items ?? [];
// A review that was only SIMULATED (a test of the chain, not the user's confirmation) must never feed a deliverable (user rule: only confirmed values).
if (confirmedDoc.simulated === true && !process.argv.includes("--allow-simulated")) {
  console.error(`REFUSED: ${confirmedPath} is marked "simulated": true (not the user's confirmation). Review the scans in the as-builts review sheet (fase1-studio) and export the real asbuilt.confirmed.json, or pass --allow-simulated for a throwaway test build.`);
  process.exit(3);
}
const assoc = Object.fromEntries(all("assoc").map((p) => { const d = JSON.parse(readFileSync(p, "utf8")); return [basename(d.scan), d]; }));
const textOf = (c) => assoc[c.scan]?.items?.[c.item]?.text ?? "";
const refOf = (scan) => basename(scan).replace(/\.[^.]+$/, "");
const sewerRef = flag("sewer-ref") ?? (Object.keys(assoc).map(refOf).find((r) => /^ES/i.test(r)) ?? null);
const waterRef = flag("water-ref") ?? (Object.keys(assoc).map(refOf).find((r) => /^E\d/i.test(r)) ?? null);

// ---------- X-UTIL geometry ----------
const nodes = [], seg = { SAN: [], WAT: [] };
const pt = (s) => { const m = /\(([-\d.]+)\s+([-\d.]+)/.exec(s ?? ""); return m ? [Number(m[1]), Number(m[2])] : null; };
for (const line of readFileSync(utilPath, "utf8").split(/\r?\n/)) {
  const f = line.split("|");
  if (f[0] !== "ENT") continue;
  const sys = /SAN|SEW/i.test(f[3]) ? "SAN" : /WAT|WM|WTR/i.test(f[3]) ? "WAT" : null;
  if (!sys) continue;
  const kv = Object.fromEntries(f.slice(4).map((x) => { const i = x.indexOf("="); return [x.slice(0, i), x.slice(i + 1)]; }));
  const p0 = [Number(kv.x), Number(kv.y)];
  if ((f[1] === "ELLIPSE" || f[1] === "CIRCLE") && sys === "SAN") nodes.push(p0);
  else if (f[1] === "LINE") seg[sys].push([p0, pt(kv.p2)]);
  else if (f[1] === "LWPOLYLINE") {
    const v = (kv.v ?? "").split(";").filter(Boolean).map((s) => s.split(",").map(Number));
    for (let i = 0; i + 1 < v.length; i++) seg[sys].push([v[i], v[i + 1]]);
  }
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const k = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
const endCount = new Map();
for (const [a, b] of seg.SAN) for (const p of [a, b]) endCount.set(k(p), { p, n: (endCount.get(k(p))?.n ?? 0) + 1 });
for (const { p, n } of endCount.values()) if (n >= 2 && !nodes.some((q) => dist(p, q) < 2)) nodes.push(p);
// split SAN segments at nodes lying on them (X-UTIL draws MH5 -> 860023.9 as ONE polyline through MH7)
const onSeg = (p, a, b) => {
  const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...d), t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (L * L);
  return t > 0.001 && t < 0.999 && Math.abs(((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / L) < 1.0 ? t : null;
};
const tramos = [];
for (const [a, b] of seg.SAN) {
  const cuts = nodes.map((p) => ({ p, t: onSeg(p, a, b) })).filter((c) => c.t != null).sort((x, y) => x.t - y.t).map((c) => c.p);
  const pts = [a, ...cuts, b];
  for (let i = 0; i + 1 < pts.length; i++) tramos.push([pts[i], pts[i + 1]]);
}

// ---------- manholes ----------
const sewerItems = confirmed.filter((c) => c.rim != null || c.inv?.length);
const nodeAt = (p) => nodes.findIndex((q) => dist(p, q) < 2);
let auto = 0;
const manholes = nodes.map((p) => {
  const near = sewerItems.filter((c) => c.N != null && c.E != null).map((c) => ({ c, d: dist([c.E, c.N], p) })).sort((x, y) => x.d - y.d)[0];
  const c = near && near.d <= tol ? near.c : null;
  const idText = c ? /MH\s*#\s*(\d+)/i.exec(textOf(c)) : null;
  return {
    id: c?.id || (idText ? `MH#${idText[1]}` : `MH-${++auto}`), x: +p[0].toFixed(4), y: +p[1].toFixed(4),
    rim: c?.rim ?? null, inv: (c?.inv ?? []).flatMap((iv) => (iv.dirs?.length ? iv.dirs : ["?"]).map((dir) => [dir.toUpperCase(), iv.value])),
    // the arrow always lands on the X-UTIL symbol (x,y); deltaFt = how far the as-built's own N/E is from it (> 0.5 ft = worth a look, survey and as-built disagree)
    deltaFt: c ? +dist([near.c.E, near.c.N], p).toFixed(2) : null,
    labeledBySurvey: false, outsideXUtil: false, ...(c ? {} : { unresolved: "no confirmed RIM/INV within tolerance" }),
  };
});
// tramo ends that are not manholes (X-UTIL stops drawing the main there) become unlabeled "END" nodes, so the tramo still gets its label
let endNo = 0;
for (const [a, b] of tramos) for (const p of [a, b]) {
  if (nodeAt(p) < 0) { nodes.push(p); manholes.push({ id: `END-${++endNo}`, x: +p[0].toFixed(4), y: +p[1].toFixed(4), rim: null, inv: [], labeledBySurvey: false, outsideXUtil: true }); }
}
const idOf = (p) => manholes[nodeAt(p)]?.id ?? null;

// ---------- sewer mains: pipe/slope by length, else by image order ----------
const boxOf = (c) => assoc[c.scan]?.items?.[c.item]?.box;
const centre = (b) => (b ? [b.x + b.w / 2, b.y + b.h / 2] : null);
// image position of each manhole = the box of the confirmed sewer item tied to it (scans keep the order along the street, not the scale)
const mhImage = new Map();
for (const m of manholes) {
  const near = sewerItems.filter((c) => c.N != null && c.E != null).map((c) => ({ c, d: dist([c.E, c.N], [m.x, m.y]) })).sort((x, y) => x.d - y.d)[0];
  if (near && near.d <= tol) mhImage.set(m.id, { scan: near.c.scan, p: centre(boxOf(near.c)) });
}
const pipeCalls = confirmed.filter((c) => (c.pipe || c.slope != null) && c.rim == null && !(c.inv?.length)).map((c) => ({
  c, scan: c.scan, p: centre(boxOf(c)),
  len: Number((/(\d{2,4})\s*['’]\s*[-–.]?\s*(?:\d{1,2}|[eU])\s*["”]/.exec(textOf(c)) ?? [])[1]),
}));
const used = new Set();
const pick = (cands) => { const best = cands.sort((x, y) => x.score - y.score)[0]; if (best) used.add(best.x); return best?.x; };
const sewerMains = [];
const unresolved = [];
const plan = tramos.map(([a, b]) => ({ a, b, from: idOf(a), to: idOf(b), L: dist(a, b) }));
const assign = (t, x, how) => {
  const pipe = (x.c.pipe ?? '8" PVC').replace(/^(\d+)"\s*PVC$/i, '$1" PVC (SDR-35)');
  if (x.c.slope == null) { unresolved.push(`SAN ${t.from}->${t.to}: matched callout has no slope`); return; }
  sewerMains.push({ from: t.from, to: t.to, text: `EXIST ${pipe} SAN MAIN @ ${x.c.slope.toFixed(2)}% SLOPE`, lengthFt: +t.L.toFixed(1), matchedBy: how });
  t.done = true;
};
// 1) by length (exact: scans keep lengths)
for (const t of plan) {
  const x = pick(pipeCalls.filter((x) => !used.has(x) && Number.isFinite(x.len) && Math.abs(x.len - t.L) <= 3).map((x) => ({ x, score: Math.abs(x.len - t.L) })));
  if (x) assign(t, x, "length");
}
// 2) by image order: the callout lying between the two manholes' callouts on the same scan
for (const t of plan.filter((t) => !t.done)) {
  const A = mhImage.get(t.from), B = mhImage.get(t.to);
  if (!A?.p || !B?.p || A.scan !== B.scan) continue;
  const d = [B.p[0] - A.p[0], B.p[1] - A.p[1]], L2 = d[0] ** 2 + d[1] ** 2, Lp = Math.sqrt(L2);
  const x = pick(pipeCalls.filter((x) => !used.has(x) && x.scan === A.scan && x.p).map((x) => {
    const v = [x.p[0] - A.p[0], x.p[1] - A.p[1]], tt = (v[0] * d[0] + v[1] * d[1]) / L2, perp = Math.abs(v[0] * d[1] - v[1] * d[0]) / Lp;
    return { x, tt, score: perp };
  }).filter((c) => c.tt > 0.05 && c.tt < 0.95 && c.score < Math.max(250, 0.35 * Lp)));
  if (x) assign(t, x, "between its manholes in the scan");
}
// 3) one known end (the other is where X-UTIL stops): nearest unused callout to that manhole's callout
for (const t of plan.filter((t) => !t.done)) {
  const known = [mhImage.get(t.from), mhImage.get(t.to)].find((m) => m?.p);
  if (!known) continue;
  const x = pick(pipeCalls.filter((x) => !used.has(x) && x.scan === known.scan && x.p).map((x) => ({ x, score: dist(x.p, known.p) })).filter((c) => c.score < 1500));
  if (x) assign(t, x, "nearest to its only known manhole in the scan");
}
for (const t of plan.filter((t) => !t.done)) unresolved.push(`SAN ${t.from}->${t.to} (${t.L.toFixed(1)} ft): no confirmed pipe callout matched`);
// ---------- water ----------
const wmCall = confirmed.map((c) => textOf(c)).map((t) => /(\d{1,2})\s*["”]\s*(DIP|PVC|C\.?I\.?|AC)\b[^|]*W\.?M/i.exec(t)).find(Boolean);
const wmText = wmCall ? `EXIST ${wmCall[1]}" ${wmCall[2].toUpperCase().replace(/\./g, "")} WATER MAIN` : "EXIST WATER MAIN";
const waterMains = seg.WAT.map(([a, b]) => ({ a: a.map((v) => +v.toFixed(4)), b: b.map((v) => +v.toFixed(4)), text: wmText }));
const hydrants = confirmed.filter((c) => /^FH$/i.test(c.kind ?? "") && c.N != null && c.E != null).map((c) => ({ x: c.E, y: c.N }));

// the node where most SAN tramos meet = the intersection manhole the labels lean on
const degree = manholes.map((m) => sewerMains.filter((s) => s.from === m.id || s.to === m.id).length);
const intersectionMh = manholes[degree.indexOf(Math.max(...degree))]?.id ?? null;
const out = { frontageAngleDeg: frontage, intersectionMh, sewerRef, waterRef, manholes, sewerMains, waterMains, hydrants, unresolved,
  source: { confirmed: confirmedPath, confirmedAt: confirmedDoc.confirmedAt ?? null, simulated: confirmedDoc.simulated === true, util: utilPath, builtAt: new Date().toISOString() } };
const outPath = flag("out") ?? "asbuilt.json";
writeFileSync(outPath, JSON.stringify(out, null, 1));
// Keep the confirmed review next to the project (the Studio keeps it in %TEMP%, which gets cleaned): <out dir>/_asbuilts/asbuilt.confirmed.json
{
  const keepDir = join(dirname(resolve(outPath)), "_asbuilts");
  mkdirSync(keepDir, { recursive: true });
  copyFileSync(confirmedPath, join(keepDir, "asbuilt.confirmed.json"));
  console.log(`confirmed review kept in ${keepDir}`);
}
console.log(`manholes ${manholes.length} (${manholes.filter((m) => m.rim != null).length} with RIM), sewer mains ${sewerMains.length}, water mains ${waterMains.length}, hydrants ${hydrants.length}, intersection ${intersectionMh} -> ${outPath}`);
for (const s of sewerMains) console.log(`  ${s.from} -> ${s.to} ${s.lengthFt} ft: ${s.text}  [${s.matchedBy}]`);
for (const u of [...unresolved, ...manholes.filter((m) => m.unresolved).map((m) => `${m.id} at ${m.x},${m.y}: ${m.unresolved}`)]) console.log("  UNRESOLVED " + u);
for (const m of manholes.filter((m) => m.deltaFt > 0.5)) console.log(`  NOTE ${m.id}: the as-built N/E is ${m.deltaFt} ft from the X-UTIL symbol; the label arrow follows the survey symbol`);
