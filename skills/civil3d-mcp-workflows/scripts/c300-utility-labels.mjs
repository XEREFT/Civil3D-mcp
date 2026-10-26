#!/usr/bin/env node
// Existing-utility labels for the C-300 sheet, as one acad_create_entities payload:
// sewer-main / water-main MLeaders on each X-UTIL tramo, MLeaders for every MH the survey does not
// already label, FH blocks + MLeaders at the as-built hydrant coordinates, and EXIST ARROW flow
// arrows. Values come from the as-builts (transcribed into asbuilt.json); properties and placement
// rules from references/standards/formtech-c300.json. Node 18, no deps.
//
//   node c300-utility-labels.mjs --asbuilt asbuilt.json [--standard formtech-c300.json] [--out labels.json] [--wrap 26]
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

// The delivered sheets print these labels in an MText ~25 characters wide (it wraps by itself: "EXIST 8" PVC (SDR-35) SAN / MAIN @ 0.38% SLOPE /
// (PER ES9467-2) / (TO REMAIN)"). acad_create_mleader has no width, so a long line would print 46 characters wide and run over lots, text and the
// asphalt: break every line longer than WRAP characters at a space, greedy, exactly where the narrow MText would.
const WRAP = Number(args.wrap ?? std.roles.existingUtilityLeader.wrapChars ?? 26);
const wrapText = (text) => text.split('\\P').flatMap((line) => {
  const out = []; let cur = '';
  for (const w of line.split(' ')) { if (cur && (cur + ' ' + w).length > WRAP) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  out.push(cur); return out;
}).join('\\P');

const leader = (role, text, arrow, textPt) => entities.push({
  kind: 'mleader', layer: role.layer, colorIndex: role.colorIndex, mLeaderStyle: role.mLeaderStyle, height: role.height,
  ...(role.annotative ? {} : { scale: role.scale }), rotation: rot, text: wrapText(text), leaderX: r4(arrow[0]), leaderY: r4(arrow[1]), x: r4(textPt[0]), y: r4(textPt[1]),
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

// (PER <as-built>) line: only when the project has that as-built (a project with no water as-built must not print "(PER null)")
const per = (ref) => (ref ? `\\P(PER ${ref})` : '');

// 1) Sewer mains: label + flow arrows
const EL = R.existingUtilityLeader;
for (const s of ab.sewerMains) {
  const A = mh[s.from].p, B = mh[s.to].p, d = unit(sub(B, A));
  const away = -nearestWaterSide(A, d);
  const touchesHub = s.from === ab.intersectionMh || s.to === ab.intersectionMh;
  const arrow = touchesHub
    ? (s.to === ab.intersectionMh ? add(B, mul(d, -40)) : add(A, mul(d, 40)))
    : add(A, mul(d, 15));
  // the as-built prints each run with its length ("337'- 8" PVC SDR-35@ 0.40%"): print it too (standards existingUtilityLeader.printScanLength; the QC reads s.text inside the label)
  // design audit 2026-10-25: the designer prints no length, the user's rule (2026-10-02) keeps it -- kept; the Goulds "303'" was wrong only because the run came from
  // the wrong as-built. s.asBuilt overrides the project sewerRef for a main covered by another as-built (the POC names the governing one per main)
  const lenPrefix = EL.printScanLength !== false && s.scanLengthFt ? `${s.scanLengthFt}'- ` : '';
  leader(EL, `${lenPrefix}${s.text}${per(s.asBuilt ?? ab.sewerRef)}\\P(TO REMAIN)`, arrow, add(add(arrow, mul(perp(d), 12 * away)), mul(d, 8)));
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
  leader(EL, `${w.text}${per(w.asBuilt ?? ab.waterRef)}\\P(TO REMAIN)`, arrow, add(add(arrow, mul(perp(d), -14 * sewerSide)), mul(d, 8)));
}

// 3) Manholes not labeled by the survey
for (const m of Object.values(mh).filter((x) => !x.labeledBySurvey && !x.outsideXUtil)) {
  const main = ab.sewerMains.find((s) => s.from === m.id || s.to === m.id);
  const other = main.from === m.id ? mh[main.to].p : mh[main.from].p;
  const d = unit(sub(other, m.p));
  const away = -nearestWaterSide(m.p, d);
  // elevations always with 2 decimals, as the as-builts print them ("12.20'", never "12.2'")
  const el = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : v);
  // SURVEY GOVERNS a measured structure (design audit 2026-10-25: the designer labels the survey's R.E./I.E., Goulds MH 9.39/4.09/3.99 and VILLA ONE 10.82, not
  // the as-built). m.survey {rim, inv:[[dir,v]]} (asbuilt-survey-merge.mjs) -> survey values + "(PER SURVEY)" + the as-built ref; a gap > 0.10 ft between the two
  // adds "(FIELD VERIFY)" so the engineer sees the conflict instead of a silently chosen number.
  const src = m.survey ?? m;
  const invLines = (src.inv ?? []).map(([dir, v]) => `INV: ${el(v)}'${!dir || dir === 'ND' ? '' : ` (${dir})`}`).join('\\P');
  // a manhole whose as-built prints no RIM (the user waived it with N/D in the review) is labeled with its INV only
  const rimLine = src.rimNA || src.rim == null ? '' : `RIM: ${el(src.rim)}'\\P`;
  const ref = m.asBuilt ?? ab.sewerRef;
  let tail = `(${ref})`;
  if (m.survey) {
    const gaps = [];
    if (m.rim != null && m.survey.rim != null) gaps.push(Math.abs(m.rim - m.survey.rim));
    const abInv = (m.inv ?? []).map(([, v]) => Number(v)).filter(Number.isFinite), svInv = (m.survey.inv ?? []).map(([, v]) => Number(v)).filter(Number.isFinite);
    if (abInv.length && svInv.length) gaps.push(Math.min(...abInv.flatMap((a) => svInv.map((b) => Math.abs(a - b)))));
    tail = `(PER SURVEY)\\P(${ref})${gaps.some((g) => g > 0.10) ? '\\P(FIELD VERIFY)' : ''}`;
  }
  leader(EL, `EXIST. SAN MH \\P${rimLine}${invLines}\\P${tail}`, m.p, add(add(m.p, mul(perp(d), 22 * away)), mul(d, 12)));
}

// 3b) Storm structures and pipes the survey shows (asbuilt.json `storm` [{kind:"CB", x, y, rim}], `stormPipes` [{a:[x,y], b:[x,y]}]): the designer labels them
//     on every sheet (Goulds 08-03: "EXIST STORM CB RIM: 9.34 (TO REMAIN)", "EXIST STORM PIPE (TO REMAIN) (CONTRACTOR TO FIELD VERIFY SIZE, MATERIAL AND INV)").
for (const [i, c] of (ab.storm ?? []).entries()) {
  const p = [c.x, c.y];
  const rim = Number.isFinite(Number(c.rim)) ? ` RIM: ${Number(c.rim).toFixed(2)}` : '';
  leader(EL, `EXIST STORM ${c.kind ?? 'CB'}${rim} (TO REMAIN)`, p, add(p, [-14 - (i % 2) * 6, 10 + (i % 2) * 6]));
}
for (const sp of ab.stormPipes ?? []) {
  const d = unit(sub(sp.b, sp.a)), m = add(sp.a, mul(sub(sp.b, sp.a), 0.5));
  leader(EL, 'EXIST STORM PIPE (TO REMAIN) (CONTRACTOR TO FIELD VERIFY SIZE, MATERIAL AND INV)', m, add(add(m, mul(perp(d), 16)), mul(d, 6)));
}

// 4) Hydrants: block + label, text 12 ft further from the street CL (the hub street line)
const FH = R.existFireHydrant;
for (const h of ab.hydrants) {
  const p = [h.x, h.y];
  const e = { kind: 'block', blockName: FH.blockName, layer: FH.layer, scale: FH.scale, rotation: FH.rotation, x: r4(h.x), y: r4(h.y) };
  if (!firsts.fh) firsts.fh = e; else entities.push(e);
  const out = unit(sub(p, [p[0], hub[1] + (p[0] - hub[0]) * Math.tan(1.0 * D2R)]));
  leader(EL, `EXIST FH${per(ab.waterRef)}\\P(TO REMAIN)`, p, add(add(p, mul(out, 12)), [6, 0]));
}

// 5) Existing appurtenances (asbuilt.json `appurtenances`, 2026-10-02): tees, G.V./C.V., plugs, corp stops, CPO, sewer laterals + clean-outs.
//    One MLeader each, arrow on the as-built point, text with the station/offset as the scan prints it; text 14-26 ft off to the side of the nearest
//    main (water items north of their main, sewer laterals south), staggered so neighbours do not stack; fase1-qc + the declutter loop finish the placement.
// --spec spec.json: only the appurtenances inside the C-300 viewport (+ 25 ft) get a label -- a plan-and-profile as-built lists laterals along 400+ ft of main (Goulds 33809)
let specIn = () => true, skippedOut = 0;
if (args.spec) {
  const sp = JSON.parse(fs.readFileSync(args.spec, 'utf8'));
  const T = ((sp.twist.resultingTwistDeg ?? (360 - sp.twist.streetAngleDegrees)) * Math.PI) / 180, uxv = [Math.cos(-T), Math.sin(-T)], uyv = [-uxv[1], uxv[0]];
  const [vw, vh] = std.viewport.size, ctr = [sp.twist.centerX, sp.twist.centerY];
  specIn = (q) => { const d = sub(q, ctr); return Math.abs(dot(d, uxv)) <= (vw * 20) / 2 + 25 && Math.abs(dot(d, uyv)) <= (vh * 20) / 2 + 25; };
}
const apps = (ab.appurtenances ?? []).filter((a) => { const ok = specIn([a.x, a.y]); if (!ok) skippedOut++; return ok; }).sort((p, q) => p.x - q.x);
if (skippedOut) console.log(`${skippedOut} appurtenance(s) outside the C-300 viewport: not labeled`);
apps.forEach((a, i) => {
  const ref = a.asBuilt ?? (a.ref === 'sewer' ? ab.sewerRef : ab.waterRef);
  const head = a.noExist ? a.label : `EXIST ${a.label}`;
  const lines = [head, a.stationText, a.detail, ref ? (a.noExist ? `(PER ${ref})` : `(PER ${ref})\\P(TO REMAIN)`) : (a.noExist ? null : '(TO REMAIN)')].filter(Boolean);
  const north = a.ref === 'sewer' ? -1 : 1;
  const text = add([a.x, a.y], [6 + (i % 2) * 8, north * (16 + (i % 3) * 5)]);
  leader(EL, lines.join('\\P'), [a.x, a.y], text);
});

const spec = { firstBlocks: firsts, createEntities: { entities } };
const out = JSON.stringify(spec, null, 1);
if (args.out) fs.writeFileSync(args.out, out);
const c = {}; for (const e of entities) c[e.kind] = (c[e.kind] || 0) + 1;
console.log(args.out ? `${entities.length} entities (+2 first blocks) -> ${args.out} ${JSON.stringify(c)}` : out);
