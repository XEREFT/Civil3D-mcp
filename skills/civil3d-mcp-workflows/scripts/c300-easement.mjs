#!/usr/bin/env node
// U.E. (utility easement) for the C-300 Fase 1 sheet (etapa 1.4), built from what the project CONFIRMED + the real lot geometry — never copied from a guide:
//   project.json site.ue = { "folio": "30-6913-003-0720", "widthFt": 5, ... }   the neighbour that shares the easement lot line (user-confirmed; the recorded
//   plat decides which line) and the width on each side; geometry = the subject lot's edge shared with that neighbour (pa-area.mjs report, Property Appraiser
//   lot polygons in drawing coordinates, from the frontage R/W side to the rear line).
// Recipe (standards roles.easementLine + easementCornerDimension + existingUtilityLeader, verified on VILLA ONE):
//   * two DASHED2 polylines on C-ANNO, W ft each side of the lot line, over the whole shared edge;
//   * one aligned 5.00' dim on each side at ~58 and ~64 ft from the street end of the edge (BCC-1.0, explicit dimLineX/Y at the midpoint + 0.3 ft: short-dimension rule);
//   * an MLeader "EXIST 5' U.E." (Formtech-1.0) with its arrow on the lot line, text on the neighbour's side.
//   node c300-easement.mjs --project project.json --report pa-area.json --spec spec.json [--out ue.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const here = path.dirname(fileURLToPath(import.meta.url));
if (!args.project || !args.report || !args.spec) { console.error('usage: node c300-easement.mjs --project project.json --report pa-area.json --spec spec.json [--out ue.json]'); process.exit(2); }
const std = JSON.parse(fs.readFileSync(args.standard || path.join(here, '../references/standards/formtech-c300.json'), 'utf8'));
const project = JSON.parse(fs.readFileSync(args.project, 'utf8'));
const report = JSON.parse(fs.readFileSync(args.report, 'utf8'));
const spec = JSON.parse(fs.readFileSync(args.spec, 'utf8'));
const ue = project.site?.ue;
if (!ue) { console.log('no site.ue in project.json: no easement drawn'); process.exit(0); }
const W = Number(ue.widthFt ?? 5);

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]), unit = (a) => mul(a, 1 / (len(a) || 1)), dot = (a, b) => a[0] * b[0] + a[1] * b[1];

// ---- the confirmed edge (shared with the confirmed neighbour)
const key = String(ue.folio ?? '').replace(/\D/g, '');
const cand = (report.ueCandidates ?? []).find((c) => (ue.edge != null ? c.edge === ue.edge : c.kind === 'shared lot line' && (c.sharedWith ?? []).some((s) => key && s.replace(/\D/g, '').includes(key))));
if (!cand) { console.error(`site.ue (${JSON.stringify(ue)}) matches no shared lot line of the subject in ${args.report}: nothing drawn`); process.exit(3); }
let [a, b] = [cand.from, cand.to];
// street end = the end of the edge nearest the frontage alignment (the alignment runs along the frontage street CL)
const [s0, e0] = spec.alignment.points.map((q) => [q.x, q.y]);
const dirA = unit(sub(e0, s0));
const distToAlign = (p) => Math.abs(dot(sub(p, s0), [-dirA[1], dirA[0]]));
if (distToAlign(b) < distToAlign(a)) [a, b] = [b, a];
const L = len(sub(b, a)), u = unit(sub(b, a)), n = [-u[1], u[0]];
const subject = (report.lots ?? []).find((l) => l.subject);
const subjSide = subject ? Math.sign(dot(sub(subject.centroid, a), n)) || 1 : 1;     // which side of the line the subject lot is on
const at = (t, off = 0) => add(add(a, mul(u, t)), mul(n, off));

const entities = [];
const R = std.roles.easementLine, DIM = std.roles.easementCornerDimension, LD = std.roles.existingUtilityLeader;
for (const side of [1, -1]) {
  const p = [at(0, W * side), at(L, W * side)];
  entities.push({ kind: 'polyline', layer: R.layer, colorIndex: R.colorIndex, linetype: R.linetype, points: p.map((q) => ({ x: r4(q[0]), y: r4(q[1]) })) });
}
// 5.00' dims ~58 / ~64 ft from the street end (shorter edges: 55 % of the length), text upright on the twisted sheet
const twistDeg = spec.twist.resultingTwistDeg ?? (360 - spec.twist.streetAngleDegrees);
const sheetAngle = (p, q) => { let ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI + twistDeg; return ((ang % 360) + 540) % 360 - 180; };
// recipe: one dim per side at ~58 ft and ~64 ft from the street end, so the two '5.00'' texts do not stack on each other
const dimT0 = Math.min(58, L * 0.55);
for (const side of [1, -1]) {
  const dimT = dimT0 + (side === 1 ? 0 : 6);
  let p1 = at(dimT, 0), p2 = at(dimT, W * side);
  const sAng = sheetAngle(p1, p2); if (sAng > 90 || sAng <= -90) [p1, p2] = [p2, p1];
  const mid = mul(add(p1, p2), 0.5), line = add(mid, mul(u, DIM.textOffsetFromLineFt ?? 0.3));
  entities.push({ kind: 'aligned_dimension', layer: DIM.layer, dimStyle: DIM.dimStyle, dimTad: DIM.dimTad ?? 4, dimTxtDirection: DIM.dimTxtDirection ?? true,
    x1: r4(p1[0]), y1: r4(p1[1]), x2: r4(p2[0]), y2: r4(p2[1]), dimLineX: r4(line[0]), dimLineY: r4(line[1]) });
}
// label: arrow on the lot line at 35 % of the edge, text 18 ft into the NEIGHBOUR's side (the subject lot has the house / its own label)
const arrow = at(L * 0.35, 0), textPt = at(L * 0.35 + 6, -subjSide * (W + 18));
entities.push({ kind: 'mleader', layer: LD.layer, colorIndex: LD.colorIndex, mLeaderStyle: LD.mLeaderStyle, height: LD.height, ...(LD.annotative ? {} : { scale: LD.scale }),
  rotation: r4((spec.twist.streetAngleDegrees * Math.PI) / 180), text: "EXIST 5' U.E.", leaderX: r4(arrow[0]), leaderY: r4(arrow[1]), x: r4(textPt[0]), y: r4(textPt[1]) });

const out = { createEntities: { entities }, summary: { edge: cand.edge, lengthFt: cand.lengthFt, sharedWith: cand.sharedWith, widthFt: W, from: a.map(r4), to: b.map(r4) } };
if (args.out) fs.writeFileSync(args.out, JSON.stringify(out));
console.log(`U.E.: ${W} ft each side of the lot line shared with ${cand.sharedWith.join(', ')} (${cand.lengthFt} ft): 2 polylines, 2 dims, 1 MLeader`);
