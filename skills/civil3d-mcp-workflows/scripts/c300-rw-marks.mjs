#!/usr/bin/env node
// Evenly spaced, identically drawn R/W marks along every right-of-way run (user 2026-10-26, SEIDENSTEIN, after the survey's own marks and ours sat at irregular distances,
// one white and one gray). Every run between two R/W corners (or from a corner to the end of the survey line) gets one white `R/W` MLeader at the SAME distance from each end
// (--end 14 ft) and the interior marks equally spaced (about --spacing 125 ft, symmetric about the middle of the run). Every mark has the same shape: arrow on the line,
// strictly orthogonal leader on the sheet axes (the EOP / EXIST R/W signature), 8 ft long, text beyond its end on the outside of the street. A station whose pocket is taken is first retried on the street side / farther out / tighter
// clearance / slid up to 20 ft; only a station with no room at all is omitted (the user wants the marks present, never overlapping). The survey's own R/W marks are hidden first (topo-white-rw.mjs --hide) so the sheet carries one style only.
//
//   node c300-rw-marks.mjs --dump X-TOPO_dump.txt --host host_texts.json --twist 4.6755 [--box x0,y0,x1,y1] [--end 14] [--spacing 125] [--out payload.json] [--report r.json]
// --host  JSON from `plugin-rpc.mjs listTextEntities '{"space":"model","limit":500}'` taken AFTER the old "R/W" marks were erased (they would block the new ones)
// --extra payload.json from c300-rw-extend.mjs: the extension lines also get marks (their ends at the crossing street are R/W corners too)
// --box   only marks whose arrow falls inside this model window are created
// --frame sheet frame in model coordinates x0,y0,x1,y1: a mark that touches the frame must lie entirely inside it so the viewport never cuts one; marks fully outside it (plan corners in model space) are kept
//         (Seidenstein 500 ft frame: 893075,497637,893535,498137)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
if (!args.dump || !args.host || !args.twist) { console.error('usage: node c300-rw-marks.mjs --dump X-TOPO_dump.txt --host host_texts.json --twist rad [--box x0,y0,x1,y1] [--out payload.json]'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const std = JSON.parse(fs.readFileSync(path.join(here, '../references/standards/formtech-c300.json'), 'utf8'));
const EL = std.roles.existingUtilityLeader;
const T = Number(args.twist), rotation = (2 * Math.PI - T) % (2 * Math.PI);
const u = [Math.cos(-T), Math.sin(-T)], up = [-u[1], u[0]];            // sheet right / up in model axes
const TH = Number(args.height ?? 2.4), TW = Number(args.width ?? 8), END = Number(args.end ?? 14), SPACING = Number(args.spacing ?? 125), CLEAR = Number(args.clear ?? 3);
const OUT = Number(args.outside ?? 8);   // leader length
const frame = args.frame ? args.frame.split(',').map(Number) : [-1e12, -1e12, 1e12, 1e12];
const win = args.box ? args.box.split(',').map(Number) : [-1e12, -1e12, 1e12, 1e12];
const inWin = (p) => p[0] >= win[0] && p[0] <= win[2] && p[1] >= win[1] && p[1] <= win[3];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]), unit = (a) => mul(a, 1 / len(a)), r4 = (v) => Math.round(v * 1e4) / 1e4, cross = (a, b) => a[0] * b[1] - a[1] * b[0];

// ---- survey dump ----
const rows = fs.readFileSync(args.dump, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('ENT|')).map((l) => {
  const p = l.split('|'), kv = {};
  p.slice(5).forEach((s) => { const i = s.indexOf('='); if (i > 0) kv[s.slice(0, i)] = s.slice(i + 1); });
  const nums = (kv.p2 ?? '').replace(/[()]/g, '').trim().split(/\s+/).map(Number);
  return { type: p[1], layer: p[3], x: +kv.x, y: +kv.y, p2: kv.p2 ? [nums[0], nums[1]] : null, h2: +kv.h || 1.6, w: +kv.w, att: +kv.att || 1, rot: +kv.rot || 0, txt: kv.txt ?? '' };
});
const FROZEN = new Set(['ELV', 'TREES', 'INVERTS & MANHOLES', 'HIDE-ANGLE-LABELS', 'HIDE-PAVEMENT-LABELS']);
const clean = (t) => t.replace(/\\[A-Za-z][^;]*;/g, '').replace(/\\P/g, '\n').replace(/[{}]/g, '').replace(/%%[A-Za-z]/g, '').trim();

// ---- shapes: convex quads (SAT) ----
const quad = (o, d, w, h) => { const n = [-d[1], d[0]]; return [o, add(o, mul(d, w)), add(add(o, mul(d, w)), mul(n, h)), add(o, mul(n, h))]; };
const axesOf = (q) => [0, 1].map((i) => { const e = sub(q[i + 1], q[i]); return unit([-e[1], e[0]]); });
const projOn = (q, a) => { const v = q.map((p) => dot(p, a)); return [Math.min(...v), Math.max(...v)]; };
const hit = (a, b, m = 0) => [...axesOf(a), ...axesOf(b)].every((ax) => { const [a0, a1] = projOn(a, ax), [b0, b1] = projOn(b, ax); return a1 + m >= b0 && b1 + m >= a0; });
const segQuad = (p, q) => [p, add(p, [0.001, 0]), add(q, [0.001, 0.001]), q];
const segSeg = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); };
const distSeg = (p, a, b) => { const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab))); return len(sub(p, add(a, mul(ab, t)))); };

// ---- obstacles: visible texts (survey + host), dimensions, survey lines ----
const obstacles = [];
for (const r of rows) {
  if (FROZEN.has(r.layer) || !(r.type === 'TEXT' || r.type === 'MTEXT') || clean(r.txt) === 'R/W') continue;       // the survey's R/W marks are hidden
  const ls = clean(r.txt).split('\n'), h = r.h2, w = Math.max(...ls.map((s) => s.length)) * 0.85 * h, d = [Math.cos(r.rot), Math.sin(r.rot)];
  if (r.type === 'MTEXT') {
    const ux = [0, .5, 1][(r.att - 1) % 3], vy = [0, .5, 1][Math.floor((r.att - 1) / 3)], H = ls.length * h * 1.4, down = [d[1], -d[0]];
    const tl = sub(sub([r.x, r.y], mul(d, ux * w)), mul(down, vy * H));
    obstacles.push({ q: quad(add(tl, mul(down, H)), d, w, H), what: ls[0].slice(0, 20) });
  } else obstacles.push({ q: quad([r.x, r.y], d, w, h), what: ls[0].slice(0, 20) });
}
for (const r of rows) {                                                      // dimensions: the text sits between the two definition points (offset a few ft), so a short dim blocks its whole span
  if (r.type !== 'DIMENSION' || FROZEN.has(r.layer) || !r.p2) continue;
  const a = [r.x, r.y], b = r.p2, L = len(sub(b, a)), d = L > 0.01 ? unit(sub(b, a)) : [1, 0], mid = mul(add(a, b), 0.5);
  const span = Math.min(L, 60), o = sub(mid, mul(d, span / 2 + 3));
  obstacles.push({ q: quad(add(o, mul([-d[1], d[0]], -5)), d, span + 6, 10), what: `dim ${r.txt || L.toFixed(1)}` });
}
for (const e of JSON.parse(fs.readFileSync(args.host, 'utf8')).entities ?? []) {
  if (e.minX === undefined || /^R\/W$/.test(clean(e.text))) continue;
  obstacles.push({ q: [[e.minX - 1, e.minY - 1], [e.maxX + 1, e.minY - 1], [e.maxX + 1, e.maxY + 1], [e.minX - 1, e.maxY + 1]], what: e.text.slice(0, 20) });
}
const lines = rows.filter((r) => r.type === 'LINE' && r.p2 && !FROZEN.has(r.layer)).map((r) => ({ a: [r.x, r.y], b: r.p2, layer: r.layer }));

// R/W lines drawn by c300-rw-extend.mjs (host layer R-W, beyond the survey limit): obstacles / "line under the arrow" like the survey's, but their own runs (crossing-street edge -> red line end)
const extraRuns = [];
if (args.extra) for (const e of JSON.parse(fs.readFileSync(args.extra, 'utf8')).entities ?? []) {
  const a = [e.points[0].x, e.points[0].y], b = [e.points[1].x, e.points[1].y], L = len(sub(b, a));
  lines.push({ a, b, layer: 'R-W', extra: true });
  if (L >= 20) extraRuns.push({ from: a, to: b, d: unit(sub(b, a)), total: L, toCorner: false });
}

// ---- R/W corners and runs ----
const rw = lines.filter((l) => l.layer === 'R-W' && !l.extra);
const near = (p, q) => len(sub(p, q)) < 0.6;
const ends = rw.flatMap((l) => [{ p: l.a, d: unit(sub(l.b, l.a)) }, { p: l.b, d: unit(sub(l.a, l.b)) }]);
const groups = [];
for (const e of ends) { const g = groups.find((g) => near(g.p, e.p)); if (g) g.legs.push(e); else groups.push({ p: e.p, legs: [e] }); }
const corners = groups.filter((g) => g.legs.some((a, i) => g.legs.some((b, j) => j > i && Math.abs(dot(a.d, b.d)) < Math.cos(30 * Math.PI / 180))));
const isCorner = (p) => corners.some((c) => near(c.p, p));
const cl = lines.filter((l) => l.layer === 'CL');
const clDist = (p) => Math.min(...cl.map((l) => distSeg(p, l.a, l.b)));
// from a corner, along a leg, to the nearest corner on the same ray (through the gap of the lot frontage) or else to the farthest collinear end of R-W geometry
const runs = [], seen = new Set();
for (const c of corners) for (const leg of c.legs) {
  const cand = groups.map((g) => g.p).filter((q) => { const v = sub(q, c.p); return dot(v, leg.d) > 1 && Math.abs(cross(v, leg.d)) < 3; });
  if (!cand.length) continue;
  const cs = cand.filter(isCorner).sort((a, b) => len(sub(a, c.p)) - len(sub(b, c.p)));
  const to = cs[0] ?? cand.sort((a, b) => len(sub(b, c.p)) - len(sub(a, c.p)))[0];
  const key = [c.p, to].map((p) => p.map((v) => v.toFixed(0)).join(',')).sort().join('|');
  if (seen.has(key)) continue; seen.add(key);
  runs.push({ from: c.p, to, d: unit(sub(to, c.p)), total: len(sub(to, c.p)), toCorner: isCorner(to) });
}
runs.push(...extraRuns);
console.log(`R-W lines ${rw.length}${extraRuns.length ? ` (+${extraRuns.length} extension lines)` : ''}, corners ${corners.length}, runs ${runs.length}`);

// ---- marks ----
const report = [], out = [];
const LX = TH + 0.1, LY = TH / 2 + 0.02;   // landing end vs text point (see the geometry comment in mark())
const SHIFTS = [0, 6, -6, 12, -12, 20, -20], DISTS = [OUT, OUT + 3, OUT + 7], CLEARS = [CLEAR, CLEAR / 2];
const insideFrame = (p, m) => p[0] >= frame[0] + m && p[0] <= frame[2] - m && p[1] >= frame[1] + m && p[1] <= frame[3] - m;
// marks outside the sheet frame are fine (model-space corners of the plan); a mark that touches the frame must lie entirely inside it so the viewport never cuts one
const frameOk = (pts) => pts.every((p) => insideFrame(p, 4)) || !pts.some((p) => insideFrame(p, -6));
const mark = (station, dir, label, inward = 0) => {   // inward: sign of the run's interior direction for end stations (corner marks may also slide 28-60 ft into the run)
  if (!inWin(station)) return;
  // the station is fixed by the rhythm (END ft from each end, equal spacing); only when its pocket is taken does the mark try the street side, a longer offset, a lower
  // clearance and finally a slide of up to 20 ft along the line; a station that still has no room is omitted and reported (never overlap)
  const n0 = unit([-dir[1], dir[0]]), why = [];
  for (const shift of inward ? [...SHIFTS, inward * 28, inward * 36, inward * 48, inward * 60] : SHIFTS) {
    const tip = add(station, mul(dir, shift));
    const own = lines.filter((l) => distSeg(tip, l.a, l.b) < 0.8);
    if (!own.some((l) => l.layer === 'R-W')) continue;
    const nOut = clDist(add(tip, mul(n0, 6))) > clDist(sub(tip, mul(n0, 6))) ? n0 : mul(n0, -1);                              // outside the street
    for (const clear of CLEARS) for (const [side, n] of [['outside', nOut], ['street side', mul(nOut, -1)]]) for (const dist of DISTS) {
      // geometry = the EOP / EXIST R/W signature: the leader is strictly orthogonal on the SHEET axes (vertical for a line that runs across the sheet, horizontal for one that
      // runs up it), arrow on the line, `dist` ft long, text beyond its end (right of a vertical leader) -- never a diagonal (user 2026-10-26: "geometricamente estetica").
      // Measured on style Formtech-1.0: the leader's last vertex (landing end) sits (h+0.1) ft inboard of the text point and h/2 below it (the text point is the TOP corner
      // on the attachment side), so the text point is offset by those amounts to make the landing end fall exactly in line with the arrow.
      const horizontal = Math.abs(dot(n, u)) < Math.abs(dot(n, up));
      const sg = Math.sign(horizontal ? dot(n, up) : dot(n, u));
      const anchor = horizontal ? add(add(tip, mul(up, sg * dist + LY)), mul(u, LX)) : add(add(tip, mul(u, sg * (dist + LX))), mul(up, LY));
      const right = horizontal || sg > 0, w = TW, h = TH + 1.2;
      const box = quad(right ? add(anchor, mul(up, -LY - h / 2)) : add(add(anchor, mul(u, -w)), mul(up, -LY - h / 2)), u, w, h);
      if (!frameOk([...box, tip])) { if (!shift && dist === OUT) why.push(`${side} would be cut by the frame`); continue; }
      const blocker = obstacles.find((ob) => hit(box, ob.q, clear)) ?? (lines.some((l) => hit(box, segQuad(l.a, l.b), 1)) ? { what: 'a survey line' } : null)
        ?? obstacles.find((ob) => hit(segQuad(tip, anchor), ob.q, 0.5)) ?? (lines.some((l) => !own.includes(l) && segSeg(tip, anchor, l.a, l.b)) ? { what: 'a line crossed by the arrow' } : null)
        ?? out.map((o) => ({ q: o.box, what: 'another R/W mark' })).find((ob) => hit(box, ob.q, 2));
      if (blocker) { if (!shift && dist === OUT && clear === CLEAR) why.push(`${side} touches ${blocker.what}`); continue; }
      out.push({ tip, anchor, box });
      report.push(`${label}: arrow ${tip.map(r4)} text ${anchor.map(r4)} (${side}${dist !== OUT ? `, ${dist} ft off` : ''}${clear !== CLEAR ? ', tight' : ''}${shift ? `, slid ${shift} ft` : ''})`); return;
    }
  }
  report.push(`${label}: omitted, no room (${why.join('; ') || 'frontage gap'})`);
};
for (const r of runs) {
  const L = r.total, inner = L - 2 * END, tag = `run ${r.from.map((v) => v.toFixed(0))}->${r.to.map((v) => v.toFixed(0))} (${L.toFixed(0)} ft)`;
  if (inner < 10) { mark(add(r.from, mul(r.d, L / 2)), r.d, `${tag} middle`); continue; }
  const k = Math.max(1, Math.round(inner / SPACING));
  for (let i = 0; i <= k; i++) mark(add(r.from, mul(r.d, END + (inner * i) / k)), r.d, `${tag} mark ${i + 1}/${k + 1}`, i === 0 ? 1 : i === k ? -1 : 0);
}
console.log(report.join('\n'));
const entities = out.map(({ tip, anchor }) => ({
  kind: 'mleader', layer: EL.layer, colorIndex: 7, mLeaderStyle: EL.mLeaderStyle, height: TH, ...(EL.annotative ? {} : { scale: EL.scale }),
  rotation: r4(rotation), text: 'R/W', leaderX: r4(tip[0]), leaderY: r4(tip[1]), x: r4(anchor[0]), y: r4(anchor[1]),
}));
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ entities }));
if (args.report) fs.writeFileSync(args.report, JSON.stringify({ out, corners: corners.map((c) => c.p), runs, obstacles: obstacles.map((o) => o.q) }));
console.log(`${entities.length} R/W mark(s), ${report.filter((r) => /omitted|no R-W/.test(r)).length} omitted`);
