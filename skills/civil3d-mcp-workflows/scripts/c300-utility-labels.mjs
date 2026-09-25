#!/usr/bin/env node
// Existing-utility labels for the C-300 sheet, as one acad_create_entities payload:
// sewer-main / water-main MLeaders on each X-UTIL tramo, MLeaders for every MH the survey does not
// already label, FH blocks + MLeaders at the as-built hydrant coordinates, and EXIST ARROW flow
// arrows. Values come from the as-builts (transcribed into asbuilt.json); properties and placement
// rules from references/standards/formtech-c300.json. Node 18, no deps.
//
//   node c300-utility-labels.mjs --asbuilt asbuilt.json [--standard formtech-c300.json] [--out labels.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const here = path.dirname(fileURLToPath(import.meta.url));
const std = JSON.parse(fs.readFileSync(args.standard || path.join(here, '../references/standards/formtech-c300.json'), 'utf8'));
const ab = JSON.parse(fs.readFileSync(args.asbuilt, 'utf8'));

const D2R = Math.PI / 180;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / len(a));
const perp = (d) => [-d[1], d[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

const R = std.roles;
const rot = r4(ab.frontageAngleDeg * D2R);
const mh = Object.fromEntries(ab.manholes.map((m) => [m.id, { ...m, p: [m.x, m.y] }]));
const hub = mh[ab.intersectionMh].p;
const entities = [];
const firsts = {};

const leader = (role, text, arrow, textPt) => entities.push({
  kind: 'mleader', layer: role.layer, colorIndex: role.colorIndex, mLeaderStyle: role.mLeaderStyle, height: role.height,
  ...(role.annotative ? {} : { scale: role.scale }), rotation: rot, text, leaderX: r4(arrow[0]), leaderY: r4(arrow[1]), x: r4(textPt[0]), y: r4(textPt[1]),
});

// side of a point relative to a directed line (+1 left, -1 right)
const sideOf = (p, a, d) => Math.sign(dot(sub(p, a), perp(d))) || 1;
const waterPts = ab.waterMains.flatMap((w) => [w.a, w.b]);
const nearestWaterSide = (a, d) => {
  const mid = add(a, mul(d, 30));
  const w = ab.waterMains.map((wm) => { const wd = unit(sub(wm.b, wm.a)); const t = Math.max(0, Math.min(len(sub(wm.b, wm.a)), dot(sub(mid, wm.a), wd))); return add(wm.a, mul(wd, t)); })
    .sort((p, q) => len(sub(p, mid)) - len(sub(q, mid)))[0];
  return sideOf(w, a, d);
};

// 1) Sewer mains: label + flow arrows
const EL = R.existingUtilityLeader;
for (const s of ab.sewerMains) {
  const A = mh[s.from].p, B = mh[s.to].p, d = unit(sub(B, A));
  const away = -nearestWaterSide(A, d);
  const touchesHub = s.from === ab.intersectionMh || s.to === ab.intersectionMh;
  const arrow = touchesHub
    ? (s.to === ab.intersectionMh ? add(B, mul(d, -40)) : add(A, mul(d, 40)))
    : add(A, mul(d, 15));
  leader(EL, `${s.text}\\P(PER ${ab.sewerRef})\\P(TO REMAIN)`, arrow, add(add(arrow, mul(perp(d), 12 * away)), mul(d, 8)));
  // flow arrows 20 ft inside each end, only where the pipe is drawn in X-UTIL
  const flowRot = Math.atan2(d[1], d[0]) + 3.8636;
  const ends = [add(A, mul(d, 20))];
  if (!s.drawnUntilX && !mh[s.to].outsideXUtil) ends.push(add(B, mul(d, -20)));
  for (const p of ends) {
    const e = { kind: 'block', blockName: R.existArrow.blockName, layer: R.existArrow.layer, scale: R.existArrow.scale, rotation: r4(flowRot), x: r4(p[0]), y: r4(p[1]) };
    if (!firsts.arrow) firsts.arrow = e; else entities.push(e);
  }
}

// 2) Water mains: label 90 ft from the intersection (or mid-tramo if shorter)
for (const w of ab.waterMains) {
  const d = unit(sub(w.b, w.a)), L = len(sub(w.b, w.a));
  const arrow = add(w.a, mul(d, Math.min(90, L / 2)));
  const sewerSide = sideOf(hub, w.a, d) || 1;
  leader(EL, `${w.text}\\P(PER ${ab.waterRef})\\P(TO REMAIN)`, arrow, add(add(arrow, mul(perp(d), -14 * sewerSide)), mul(d, 8)));
}

// 3) Manholes not labeled by the survey
for (const m of Object.values(mh).filter((x) => !x.labeledBySurvey && !x.outsideXUtil)) {
  const main = ab.sewerMains.find((s) => s.from === m.id || s.to === m.id);
  const other = main.from === m.id ? mh[main.to].p : mh[main.from].p;
  const d = unit(sub(other, m.p));
  const away = -nearestWaterSide(m.p, d);
  const invLines = m.inv.map(([dir, v]) => `INV: ${v}' (${dir})`).join('\\P');
  leader(EL, `EXIST. SAN MH \\PRIM: ${m.rim}'\\P${invLines}\\P(${ab.sewerRef})`, m.p, add(add(m.p, mul(perp(d), 22 * away)), mul(d, 12)));
}

// 4) Hydrants: block + label, text 12 ft further from the street CL (the hub street line)
const FH = R.existFireHydrant;
for (const h of ab.hydrants) {
  const p = [h.x, h.y];
  const e = { kind: 'block', blockName: FH.blockName, layer: FH.layer, scale: FH.scale, rotation: FH.rotation, x: r4(h.x), y: r4(h.y) };
  if (!firsts.fh) firsts.fh = e; else entities.push(e);
  const out = unit(sub(p, [p[0], hub[1] + (p[0] - hub[0]) * Math.tan(1.0 * D2R)]));
  leader(EL, `EXIST FH\\P(PER ${ab.waterRef})\\P(TO REMAIN)`, p, add(add(p, mul(out, 12)), [6, 0]));
}

const spec = { firstBlocks: firsts, createEntities: { entities } };
const out = JSON.stringify(spec, null, 1);
if (args.out) fs.writeFileSync(args.out, out);
const c = {}; for (const e of entities) c[e.kind] = (c[e.kind] || 0) + 1;
console.log(args.out ? `${entities.length} entities (+2 first blocks) -> ${args.out} ${JSON.stringify(c)}` : out);
