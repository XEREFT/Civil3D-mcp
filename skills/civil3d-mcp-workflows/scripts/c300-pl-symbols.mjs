#!/usr/bin/env node
// PL (property line, U+214A) symbols for the C-300 sheet, as an acad_create_entities payload.
// Lot lines come from the county plat lots (MD_PA_PropertySearch MapServer layer 7 = MDC.Lot_poly,
// same NAD83 FL East ftUS as the drawing). One symbol at the midpoint of every line shared by two
// lots (shared length >= 50 ft) that falls inside the C-300 viewport. Rotation: frontage angle for
// lot lines perpendicular to the frontage street, frontage + 90 for parallel ones (reads on the sheet).
// The glyph is centered on the line (TopLeft attachment offset by half the box width / glyph height).
//
//   node c300-pl-symbols.mjs --frontage 91.5109 --center 859789.19,444700.69 [--half 245,225] [--out pl.json]
//        [--avoid "x,y;x,y;..."] [--avoid-radius 8]
// --avoid (etapa 1.5, 2026-10-01): points the symbol must keep clear of (dim texts, labels, U.E. dims). A symbol within
// --avoid-radius ft of one slides ALONG its own lot line (inside the shared stretch, 10 ft from its ends) to the nearest clear
// spot; if none, it stays and is reported. VILLA ONE: the PL at the lot-12 U.E. corner sat on the 5.00' U.E. dim (fase1-qc.py).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const here = path.dirname(fileURLToPath(import.meta.url));
const std = JSON.parse(fs.readFileSync(args.standard || path.join(here, '../references/standards/formtech-c300.json'), 'utf8'));
const PL = std.roles.plSymbol;
const D = Math.PI / 180;
const theta = Number(args.frontage);
const C = args.center.split(',').map(Number);
const [halfU, halfV] = (args.half || '245,225').split(',').map(Number);
const u = [Math.cos(theta * D), Math.sin(theta * D)], v = [-u[1], u[0]];
const avoid = (args.avoid || '').split(';').map((s) => s.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
const avoidR = Number(args['avoid-radius'] || 8);
const inView = (p) => { const d = [p[0] - C[0], p[1] - C[1]]; return Math.abs(d[0] * u[0] + d[1] * u[1]) < halfU && Math.abs(d[0] * v[0] + d[1] * v[1]) < halfV; };

const reach = Math.hypot(halfU, halfV) + 50;
const q = new URLSearchParams({
  geometry: `${C[0] - reach},${C[1] - reach},${C[0] + reach},${C[1] + reach}`, geometryType: 'esriGeometryEnvelope', inSR: '2236',
  spatialRel: 'esriSpatialRelIntersects', outFields: 'BLK_TRT,LOT', returnGeometry: 'true', outSR: '2236', f: 'json',
});
const res = await fetch(`https://gisfs.miamidade.gov/mdarcgis/rest/services/MD_PA_PropertySearch/MapServer/7/query?${q}`);
const j = await res.json();
if (j.error) throw new Error(JSON.stringify(j.error));

const lots = j.features.map((f) => ({ id: `B${String(f.attributes.BLK_TRT).trim()}L${String(f.attributes.LOT).trim()}`, r: f.geometry.rings[0] }));
const edges = (l) => l.r.slice(0, -1).map((a, i) => ({ a, b: l.r[i + 1], L: Math.hypot(l.r[i + 1][0] - a[0], l.r[i + 1][1] - a[1]) })).filter((e) => e.L > 15);
const dist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.hypot(dx, dy); };
const proj = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy); };

const H = PL.height * 1.42857, halfBox = (PL.width ?? 0.6468) / 2;
const entities = [], seen = new Set(), report = [];
for (let i = 0; i < lots.length; i++) for (let k = i + 1; k < lots.length; k++) for (const e of edges(lots[i])) for (const f of edges(lots[k])) {
  if (dist(f.a, e.a, e.b) > 1.5 || dist(f.b, e.a, e.b) > 1.5) continue;
  const t = [proj(f.a, e.a, e.b), proj(f.b, e.a, e.b)].sort((x, y) => x - y), t0 = Math.max(0, t[0]), t1 = Math.min(1, t[1]);
  if ((t1 - t0) * e.L < 50) continue;
  let tm = (t0 + t1) / 2, P = [e.a[0] + (e.b[0] - e.a[0]) * tm, e.a[1] + (e.b[1] - e.a[1]) * tm];
  const key = P.map((x) => Math.round(x / 3)).join(',');
  if (!inView(P) || seen.has(key)) continue;
  seen.add(key);
  // keep clear of the --avoid points: slide along the shared stretch (steps of 2 ft, alternating sides, 10 ft from its ends)
  const clash = (Q) => avoid.some((A) => Math.hypot(Q[0] - A[0], Q[1] - A[1]) < avoidR);
  let moved = '';
  if (clash(P)) {
    const lo = t0 + 10 / e.L, hi = t1 - 10 / e.L;
    let found = null;
    for (let s = 2; s <= (t1 - t0) * e.L / 2 && !found; s += 2) {
      for (const sign of [1, -1]) {
        const t = tm + (sign * s) / e.L;
        if (t < lo || t > hi) continue;
        const Q = [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t];
        if (!clash(Q) && inView(Q)) { found = { t, Q, s: sign * s }; break; }
      }
    }
    if (found) { moved = ` moved ${found.s > 0 ? '+' : ''}${found.s} ft along the line (was on an avoid point)`; tm = found.t; P = found.Q; }
    else moved = ' STILL ON an avoid point (no clear spot on its line)';
  }
  const ed = [e.b[0] - e.a[0], e.b[1] - e.a[1]], parallel = Math.abs(ed[0] * u[0] + ed[1] * u[1]) / e.L > 0.7;
  const rot = (parallel ? theta + 90 : theta) * D, right = [Math.cos(rot), Math.sin(rot)], up = [-Math.sin(rot), Math.cos(rot)];
  const ins = [P[0] - right[0] * halfBox + up[0] * H / 2, P[1] - right[1] * halfBox + up[1] * H / 2];
  entities.push({ kind: 'mtext', layer: PL.layer, textStyle: PL.textStyle, height: PL.height, attachment: PL.attachment, width: PL.width ?? 0.6468,
    rotation: +rot.toFixed(4), text: PL.text, x: +ins[0].toFixed(4), y: +ins[1].toFixed(4) });
  report.push(`${lots[i].id}/${lots[k].id} @ ${P.map((x) => x.toFixed(2)).join(',')}${moved}`);
}
const out = JSON.stringify({ createEntities: { entities } }, null, 1);
if (args.out) fs.writeFileSync(args.out, out);
console.log(args.out ? `${entities.length} PL symbols -> ${args.out}\n${report.join('\n')}` : out);
