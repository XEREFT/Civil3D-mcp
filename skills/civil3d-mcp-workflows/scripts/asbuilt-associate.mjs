#!/usr/bin/env node
// AS-BUILT ASSOCIATE: ties each item of an asbuilt-extract.mjs draft to the X-UTIL feature it describes, and uses X-UTIL to CHECK the OCR.
//   node asbuilt-associate.mjs --draft <scan.draft.json> --util <X-UTIL_dump.txt> [--out <scan.assoc.json>] [--tol 15]
// X-UTIL (dwg-dump.ps1 of X-UTIL.dwg) gives the drawn utilities: SAN manholes (ELLIPSE centres, plus junction nodes where 2+ SAN
// segments meet, e.g. VILLA ONE MH#5), SAN/WAT segments (LINE / LWPOLYLINE). Each draft item with N/E is matched to the nearest node
// (sewer items: RIM/INV/MH) or segment (water items: TEE/GV/FH/...) of its own system:
//   match  <= 1 ft   the printed/computed N/E agrees with the drawing
//   near   <= --tol  same feature, but the N/E is off: an OCR digit error is likely (VILLA ONE MH#6: N 444513 read for 444518, 4.8 ft)
//           -> the X-UTIL position is offered as the suggested value; the review sheet shows the scan crop to decide
//   none   >  --tol  nothing drawn there (a feature outside X-UTIL, or a misread): needs the user
// Items without N/E get no association (the review sheet still lists them). Nothing is ever written to a drawing. Node 18+, no deps.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const draftPath = flag("draft"), utilPath = flag("util");
if (!draftPath || !utilPath) { console.error("usage: node asbuilt-associate.mjs --draft <scan.draft.json> --util <X-UTIL_dump.txt> [--out assoc.json] [--tol 15]"); process.exit(2); }
const tol = Number(flag("tol") ?? 15);
const draft = JSON.parse(readFileSync(draftPath, "utf8"));

// ---------- X-UTIL features ----------
const segs = { SAN: [], WAT: [] };
const nodes = [];
const pt = (s) => { const m = /\(([-\d.]+)\s+([-\d.]+)/.exec(s ?? ""); return m ? [Number(m[1]), Number(m[2])] : null; };
const systemOf = (layer) => (/SAN|SEW|SS\b/i.test(layer) ? "SAN" : /WAT|WM|WTR/i.test(layer) ? "WAT" : null);
for (const line of readFileSync(utilPath, "utf8").split(/\r?\n/)) {
  const f = line.split("|");
  if (f[0] !== "ENT") continue;
  const sys = systemOf(f[3]);
  if (!sys) continue;
  const kv = Object.fromEntries(f.slice(4).map((x) => { const i = x.indexOf("="); return [x.slice(0, i), x.slice(i + 1)]; }));
  const p0 = [Number(kv.x), Number(kv.y)];
  if (f[1] === "ELLIPSE" || f[1] === "CIRCLE") nodes.push({ sys, kind: "MH", p: p0, handle: f[2], source: `${f[1]} ${f[2]}` });
  else if (f[1] === "LINE") segs[sys].push({ a: p0, b: pt(kv.p2), handle: f[2] });
  else if (f[1] === "LWPOLYLINE") {
    const v = (kv.v ?? "").split(";").filter(Boolean).map((s) => s.split(",").map(Number));
    for (let i = 0; i + 1 < v.length; i++) segs[sys].push({ a: v[i], b: v[i + 1], handle: f[2] });
  }
}
// junction nodes: a segment end shared by >= 2 SAN segments and not already a drawn MH
const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
const ends = new Map();
for (const s of segs.SAN) for (const p of [s.a, s.b]) { const k = key(p); ends.set(k, { p, n: (ends.get(k)?.n ?? 0) + 1 }); }
for (const { p, n } of ends.values()) {
  if (n >= 2 && !nodes.some((m) => Math.hypot(m.p[0] - p[0], m.p[1] - p[1]) < 2)) nodes.push({ sys: "SAN", kind: "MH (junction)", p, source: "SAN segment junction" });
}
const distToSeg = (p, s) => {
  const [ax, ay] = s.a, [bx, by] = s.b, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
  const q = [ax + t * dx, ay + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
};

// ---------- associate ----------
const WATER_KINDS = new Set(["TEE", "GV", "FH", "FLUSHING VALVE", "CV", "SERVICE", "PLUG"]);
for (const it of draft.items) {
  if (it.N == null || it.E == null) { it.assoc = null; continue; }
  const p = [it.E, it.N];
  const sewer = it.kind === "MH" || it.rim != null || it.inv?.length;
  const water = !sewer && (WATER_KINDS.has(it.kind) || /WM|WATER|DIP/i.test(it.text));
  let best = null;
  if (!water) for (const n of nodes) { const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]); if (!best || d < best.d) best = { d, type: n.kind, at: n.p, ref: n.source }; }
  if (!sewer) for (const s of segs.WAT) { const r = distToSeg(p, s); if (!best || r.d < best.d) best = { d: r.d, type: "WM segment", at: r.q, ref: `WAT ${s.handle}` }; }
  if (!best) { it.assoc = { status: "none", note: "no X-UTIL feature of this system" }; continue; }
  const status = best.d <= 1 ? "match" : best.d <= tol ? "near" : "none";
  it.assoc = { status, distanceFt: +best.d.toFixed(2), feature: best.type, ref: best.ref, featureE: +best.at[0].toFixed(4), featureN: +best.at[1].toFixed(4) };
  if (status === "near") {
    const dN = it.N - best.at[1], dE = it.E - best.at[0];
    it.issues.push(`N/E is ${best.d.toFixed(2)} ft from X-UTIL ${best.type} (dN ${dN.toFixed(2)}, dE ${dE.toFixed(2)}): likely OCR digit error — compare the scan crop`);
    // the WATER segment is a line, not a point: an offset from it is expected (valves, FH laterals), so only sewer nodes suggest a value
    if (best.type.startsWith("MH")) it.assoc.suggested = { N: it.assoc.featureN, E: it.assoc.featureE };
  }
}
const outPath = flag("out") ?? draftPath.replace(/\.draft\.json$/, ".assoc.json");
writeFileSync(outPath, JSON.stringify({ ...draft, util: { nodes: nodes.length, segments: segs.SAN.length + segs.WAT.length } }, null, 1));
const withNE = draft.items.filter((i) => i.assoc);
const by = (s) => withNE.filter((i) => i.assoc.status === s).length;
console.log(`X-UTIL: ${nodes.length} SAN node(s), ${segs.SAN.length} SAN + ${segs.WAT.length} WAT segment(s)`);
console.log(`${withNE.length} item(s) with N/E: ${by("match")} match, ${by("near")} near (check), ${by("none")} none -> ${outPath}`);
for (const it of withNE.filter((i) => i.assoc.status !== "none" || i.rim != null)) {
  console.log(`  ${(it.assoc.status ?? "").padEnd(5)} ${String(it.kind ?? "").padEnd(6)} N ${it.N} E ${it.E}${it.rim != null ? ` RIM ${it.rim}` : ""} -> ${it.assoc.feature ?? "-"} ${it.assoc.distanceFt ?? ""} ft`);
}
