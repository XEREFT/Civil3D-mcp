#!/usr/bin/env node
// Utility SEPARATION dims for the C-300 Fase 1 sheet: where an EXISTING water main and an EXISTING sewer main run parallel, one aligned dim gives their
// horizontal separation (VILLA ONE FASE 1 has 8.00' and 6.00' by hand). Geometry comes from asbuilt.json (X-UTIL segments snapped by asbuilt-build.mjs), never
// from a guide, so both dim ends lie on the X-UTIL lines and fase1-qc can verify the value ("dimension values = geometry").
//   node c300-utility-separation.mjs --asbuilt asbuilt.json --spec spec.json [--out sep.json] [--standard formtech-c300.json]
// Rule (standards roles.utilitySeparationDimension): parallel <= 5 deg, overlap >= 40 ft, <= 15 ft apart, inside the C-300 viewport; the dim sits
// stepBackFromIntersectionFt (22) back from the intersection manhole along the overlap. Node 18, no deps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const here = path.dirname(fileURLToPath(import.meta.url));
if (!args.asbuilt || !args.spec) { console.error('usage: node c300-utility-separation.mjs --asbuilt asbuilt.json --spec spec.json [--out sep.json]'); process.exit(2); }
const std = JSON.parse(fs.readFileSync(args.standard || path.join(here, '../references/standards/formtech-c300.json'), 'utf8'));
const R = std.roles.utilitySeparationDimension;
const asb = JSON.parse(fs.readFileSync(args.asbuilt, 'utf8'));
const spec = JSON.parse(fs.readFileSync(args.spec, 'utf8'));

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]), unit = (a) => mul(a, 1 / (len(a) || 1)), dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

// viewport rectangle (sheet +x in model = frontage direction): 25 x 23 in at 1" = 20' -> 500 x 460 ft, twist from the spec
const [vw, vh] = std.viewport.size, scale = 20;
const twistDeg = spec.twist.resultingTwistDeg ?? (360 - spec.twist.streetAngleDegrees);
const T = (twistDeg * Math.PI) / 180, ux = Math.cos(-T), uy = Math.sin(-T);
const centre = [spec.twist.centerX, spec.twist.centerY];
const inView = (p, margin = 8) => { const d = sub(p, centre); return Math.abs(dot(d, [ux, uy])) <= (vw * scale) / 2 - margin && Math.abs(-d[0] * uy + d[1] * ux) <= (vh * scale) / 2 - margin; };
const sheetAngle = (p, q) => { const ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI + twistDeg; return ((ang % 360) + 540) % 360 - 180; };

const mh = Object.fromEntries((asb.manholes ?? []).map((m) => [m.id, [m.x, m.y]]));
const sans = (asb.sewerMains ?? []).filter((s) => mh[s.from] && mh[s.to]).map((s) => ({ a: mh[s.from], b: mh[s.to], id: `${s.from}->${s.to}` }));
const wms = (asb.waterMains ?? []).map((w, i) => ({ a: w.a, b: w.b, id: `WM${i + 1}` }));
const node = asb.intersectionMh ? mh[asb.intersectionMh] : null;
const sinMax = Math.sin((R.maxParallelAngleDeg * Math.PI) / 180);

const entities = [], report = [], cands = [];
for (const w of wms) {
  const wu = unit(sub(w.b, w.a)), wn = [-wu[1], wu[0]], wL = len(sub(w.b, w.a));
  for (const s of sans) {
    const su = unit(sub(s.b, s.a));
    if (Math.abs(cross(wu, su)) > sinMax) continue;                          // not parallel
    // overlap along the water main
    const ta = dot(sub(s.a, w.a), wu), tb = dot(sub(s.b, w.a), wu);
    const lo = Math.max(0, Math.min(ta, tb)), hi = Math.min(wL, Math.max(ta, tb));
    if (hi - lo < R.minParallelOverlapFt) continue;
    const sep = Math.abs(dot(sub(mul(add(s.a, s.b), 0.5), w.a), wn));
    if (sep > R.maxSeparationFt || sep < 1) continue;
    // 22 ft back from the intersection manhole, along the overlap (middle of the overlap when there is no node or it is short)
    let t = (lo + hi) / 2;
    if (node && hi - lo >= 2 * R.stepBackFromIntersectionFt) {
      const tn = dot(sub(node, w.a), wu);
      t = Math.abs(tn - lo) < Math.abs(tn - hi) ? lo + R.stepBackFromIntersectionFt + Math.max(0, tn - lo) : hi - R.stepBackFromIntersectionFt - Math.max(0, hi - tn);
      t = Math.min(hi - 1, Math.max(lo + 1, t));
    }
    const pw = add(w.a, mul(wu, t));
    const off = dot(sub(s.a, pw), wn);                                       // signed distance of the sewer line from the water main
    let p1 = pw, p2 = add(pw, mul(wn, off));
    if (!inView(p1) || !inView(p2)) { report.push(`${w.id} / ${s.id}: ${sep.toFixed(2)} ft apart but outside the viewport: no dim`); continue; }
    cands.push({ wm: w, wu, san: s, sep, overlap: hi - lo, p1, p2, id: `${w.id} / ${s.id}` });
  }
}
// ONE dim per street and separation: the water mains / sewer tramos of one street come in several pieces (split at manholes, tee); keep the longest overlap of each group
cands.sort((x, y) => y.overlap - x.overlap);
const kept = [];
for (const c of cands) {
  const dup = kept.find((k) => Math.abs(k.sep - c.sep) < 0.1 && Math.abs(cross(k.wu, c.wu)) <= sinMax && Math.abs(dot(sub(c.p1, k.p1), [-k.wu[1], k.wu[0]])) < 5);
  if (dup) { report.push(`${c.id}: ${c.sep.toFixed(2)} ft apart over ${c.overlap.toFixed(0)} ft: same street/separation as ${dup.id}, no second dim`); continue; }
  kept.push(c);
}
for (const c of kept) {
  let { p1, p2 } = c;
  const ang = sheetAngle(p1, p2); if (ang > 90 || ang <= -90) [p1, p2] = [p2, p1];   // text reads upright on the twisted sheet
  const line = add(mul(add(p1, p2), 0.5), mul(c.wu, R.textOffsetFromLineFt ?? 0.3));
  entities.push({ kind: 'aligned_dimension', layer: R.layer, dimStyle: R.dimStyle, dimTad: R.dimTad ?? 4, dimTxtDirection: R.dimTxtDirection ?? true,
    x1: r4(p1[0]), y1: r4(p1[1]), x2: r4(p2[0]), y2: r4(p2[1]), dimLineX: r4(line[0]), dimLineY: r4(line[1]) });
  report.push(`${c.id}: ${c.sep.toFixed(2)} ft apart over ${c.overlap.toFixed(0)} ft, dim at ${r4(p1[0])},${r4(p1[1])}`);
}
const out = { createEntities: { entities }, summary: { dims: entities.length, report } };
if (args.out) fs.writeFileSync(args.out, JSON.stringify(out));
console.log(`utility separation dims: ${entities.length}` + (report.length ? `\n  ${report.join('\n  ')}` : ''));
