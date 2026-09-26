// Neighbor-lot annotation for the C-300 plan (phase 1), from lots.json (neighbor-lots.mjs output).
//  - Goulds Ests Sec 1 (P.B. 46-94) lots: the county GIS polygons sit 0.1-13 ft off the survey R/W and do not
//    match the PA legal sizes, so each lot is rebuilt from the PA legal "LOT SIZE W X D", anchored at the block
//    corner = intersection of the survey R/W lines (same rule as the U.E.): width along the street R/W, side
//    lines parallel to SW 118th Ave R/W, rear line at D from the street.
//  - Southland II/III lots (P.B. 172-14 / 173-30): GIS polygon (on the survey R/W within 0.75 ft, area = PA).
// Output: acad_create_entities payload (lot dims, LOT/BLK/FOLIO labels, PL symbols, non-plot QC notes) + report.
const fs = require('fs');
// Inputs and outputs live in the working folder (cwd): lots.json, fase1-site.json, fase1-exist.json,
// pkg-planlabels-villa.json -> fase1-lots.json, fase1-lots-report.json. Configure RW / ROWS per site.
const W = process.cwd();
const lots = JSON.parse(fs.readFileSync(W + '/lots.json', 'utf8'));
const std = JSON.parse(fs.readFileSync(__dirname + '/../references/standards/formtech-c300.json', 'utf8'));
const PL = std.roles.plSymbol;

const D2R = Math.PI / 180, theta = 91.5109, C = [859789.19, 444700.69], HALF = [250, 230];
const u = [Math.cos(theta * D2R), Math.sin(theta * D2R)], v = [-u[1], u[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1], len = (a) => Math.hypot(a[0], a[1]), unit = (a) => mul(a, 1 / len(a));
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const local = (p) => { const d = sub(p, C); return [dot(d, u), dot(d, v)]; };
const inWin = (p, m = 0) => { const [a, b] = local(p); return Math.abs(a) < HALF[0] - m && Math.abs(b) < HALF[1] - m; };
const X = (p, dp, q, dq) => add(p, mul(dp, cross(sub(q, p), dq) / cross(dp, dq)));
const r4 = (x) => Math.round(x * 1e4) / 1e4, P = (p) => ({ x: r4(p[0]), y: r4(p[1]) });

// Survey R/W lines (X-TOPO PROPERTY_LINE), straight parts only.
const RW = {
  e118_N: [[859807.930, 444938.372], [859810.945, 444824.088]],   // 118th east R/W, north of 227th (block 8)
  n227_E: [[859836.372, 444799.751], [859903.362, 444800.920]],   // 227th north R/W, east (block 8)
  w118_N: [[859757.950, 444936.969], [859760.939, 444823.661]],   // 118th west R/W, north of 227th (block 7)
  n227_W: [[859736.383, 444798.006], [859682.071, 444797.058]],   // 227th north R/W, west (block 7)
  s227_E: [[859838.137, 444749.774], [859904.235, 444750.927]],   // 227th south R/W, east (block 10)
  e118_M: [[859813.581, 444724.119], [859817.537, 444574.165]],   // 118th east R/W, between 227th and 228th (block 10)
  n228_E: [[859842.964, 444549.828], [859907.724, 444550.958]],   // 228th north R/W, east (block 10)
  w118_M: [[859763.575, 444723.692], [859767.530, 444573.738]],   // 118th west R/W, between (block 9)
  s227_W: [[859738.148, 444748.029], [859682.943, 444747.066]],   // 227th south R/W, west (block 9)
  n228_W: [[859742.975, 444548.083], [859686.432, 444547.096]],   // 228th north R/W, west (block 9)
};
// Rows of plat lots: [corner lot, next lot]; off = rear-line distance of the row's front line from the street.
const ROWS = [
  { blk: '8', side: 'e118_N', street: 'n227_E', off: 0, lots: ['12', '11'] },
  { blk: '8', side: 'e118_N', street: 'n227_E', off: 100, lots: ['1', '2'] },
  { blk: '7', side: 'w118_N', street: 'n227_W', off: 0, lots: ['4', '5'] },
  { blk: '7', side: 'w118_N', street: 'n227_W', off: 100, lots: ['3'] },
  { blk: '10', side: 'e118_M', street: 's227_E', off: 0, lots: ['1', '2'] },
  { blk: '10', side: 'e118_M', street: 'n228_E', off: 0, lots: ['12', '11'] },
  { blk: '9', side: 'w118_M', street: 's227_W', off: 0, lots: ['4', '3'] },
  { blk: '9', side: 'w118_M', street: 'n228_W', off: 0, lots: ['5', '6'] },
];
const byId = new Map(lots.map((l) => [`${l.blk}/${l.lot}`, l]));
const legalOf = (l) => {
  if (!l.legalSize) return null;
  // "LOT 10 & 11 ... 100 X 200": two lots side by side along the street -> one lot is 100 x 100.
  if (/LOT 10 & 11/.test(l.legal.join(' '))) return [100, 100];
  return l.legalSize;
};

const geom = new Map();     // lot key -> { poly:[A,B,C,D], rowInfo }
const dims = [], closures = [];
for (const row of ROWS) {
  const [s0, s1] = RW[row.side], [t0, t1] = RW[row.street];
  const ds = unit(sub(s1, s0)), dt = unit(sub(t1, t0));
  const P0 = X(s0, ds, t0, dt);
  const e = unit(sub(dot(sub(t0, P0), dt) > dot(sub(t1, P0), dt) ? t0 : t1, P0));
  const first = byId.get(`${row.blk}/${row.lots[0]}`);
  let n = ds; if (dot(sub(first.centroid, P0), n) < 0) n = mul(n, -1);
  const perp = Math.abs(cross(e, n));                                  // sin(angle street / 118th)
  const base = add(P0, mul(n, row.off / perp));
  let along = 0;
  row.lots.forEach((id, i) => {
    const l = byId.get(`${row.blk}/${id}`);
    const lg = legalOf(l);
    const [W, Dp] = lg;
    const A = add(base, mul(e, along)), B = add(A, mul(e, W));
    const Dd = add(A, mul(n, Dp / perp)), Cc = add(B, mul(n, Dp / perp));
    geom.set(`${row.blk}/${id}`, { poly: [A, B, Cc, Dd], W, Dp, e, n, row, index: i });
    const inward = unit(sub(add(mul(add(A, Cc), 0.5), [0, 0]), mul(add(A, B), 0.5)));
    // width: street side for rows on a street, the front (shared) side for offset rows; dim line 4 ft inside the lot
    dims.push({ a: A, b: B, into: n, text: W, lot: l.id, inset: row.off === 0 ? 14 : 4 });
    // side lines: the far side of every lot (shared with the next lot). The 118th side is the survey R/W line.
    dims.push({ a: B, b: Cc, into: mul(e, -1), text: Dp, lot: l.id });
    along += W;
  });
}
// Blocks rebuilt from both streets must close: rear lines of the two rows should coincide.
for (const [a, b] of [['10/1', '10/12'], ['9/4', '9/5']]) {
  const ga = geom.get(a), gb = geom.get(b);
  closures.push(`${a} rear vs ${b} rear: ${len(sub(ga.poly[3], gb.poly[3])).toFixed(2)} ft at the 118th side`);
}

// Southland lots: GIS polygon, straight edges >= 20 ft.
const polyArea = (r) => Math.abs(r.reduce((s, p, i) => s + cross(p, r[(i + 1) % r.length]), 0)) / 2;
const centroidOf = (r) => { let a = 0, x = 0, y = 0; r.forEach((p, i) => { const q = r[(i + 1) % r.length], c = cross(p, q); a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c; }); return [x / (3 * a), y / (3 * a)]; };
for (const l of lots) {
  if (geom.has(`${l.blk}/${l.lot}`) || l.legalSize) continue;
  if (!l.lot) continue;                                                 // TR A (private road)
  const poly = l.edges.map((e2) => e2.a);
  geom.set(`${l.blk}/${l.lot}`, { poly, gis: true });
  const c = centroidOf(poly);
  for (const e2 of l.edges) if (e2.length >= 20) {
    const mid = mul(add(e2.a, e2.b), 0.5), dir = unit(sub(e2.b, e2.a));
    let nn = [-dir[1], dir[0]]; if (dot(sub(c, mid), nn) < 0) nn = mul(nn, -1);
    dims.push({ a: e2.a, b: e2.b, into: nn, text: e2.length, lot: l.id, gis: true });
  }
}

// Clip a polygon to the viewport window shrunk by m (Sutherland-Hodgman in the window frame).
const clip = (poly, m) => {
  let pts = poly.map(local);
  const edges = [[1, 0, HALF[0] - m], [-1, 0, HALF[0] - m], [0, 1, HALF[1] - m], [0, -1, HALF[1] - m]];
  for (const [ax, ay, lim] of edges) {
    const inside = (p) => ax * p[0] + ay * p[1] <= lim, out = [];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const ip = inside(p), iq = inside(q);
      if (ip) out.push(p);
      if (ip !== iq) { const t = (lim - (ax * p[0] + ay * p[1])) / (ax * (q[0] - p[0]) + ay * (q[1] - p[1])); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    });
    pts = out;
    if (!pts.length) return [];
  }
  return pts.map(([a, b]) => add(C, add(mul(u, a), mul(v, b))));
};

const ents = [], report = [];
const LABEL = { layer: 'C-ANNO', colorIndex: 8, textStyle: 'BCC-1.0', height: 2, attachment: 5, rotation: 1.5972 };
// Dimensions: dim line 4 ft inside the lot; keep those whose midpoint shows in the viewport.
const seen = new Set(), dimText = [];
for (const d of dims) {
  const mid = mul(add(d.a, d.b), 0.5);
  const key = mid.map((x) => Math.round(x)).join(',');
  if (seen.has(key) || !inWin(mid, 6)) continue;
  seen.add(key);
  const dl = add(mid, mul(unit(d.into), d.inset ?? 4));
  dimText.push(dl);
  ents.push({ kind: 'aligned_dimension', layer: 'C-ANNO', dimStyle: 'BCC-1.0', x1: r4(d.a[0]), y1: r4(d.a[1]), x2: r4(d.b[0]), y2: r4(d.b[1]), dimLineX: r4(dl[0]), dimLineY: r4(dl[1]) });
}
const dimCount = ents.length;

// Existing annotation to keep clear of (text anchors in model space).
const obstacles = [];
const dump = fs.readFileSync(process.env.LOCALAPPDATA + '/Temp/c3d-dwg-dump/X-TOPO_dump.txt', 'utf8').split('\n');
// Sample each existing text along its reading direction (anchor + extent), shifted down by its height.
const sampleText = (x, y, rot, w, h, att) => {
  const r = [Math.cos(rot), Math.sin(rot)], dn = [Math.sin(rot), -Math.cos(rot)];
  const W = w > 0 ? w : 20, col = (att - 1) % 3, rowA = Math.floor((att - 1) / 3);
  const [a0, a1] = col === 0 ? [0, W] : col === 1 ? [-W / 2, W / 2] : [-W, 0];
  const [d0, d1] = rowA === 0 ? [0, 2.5 * h] : rowA === 1 ? [-1.25 * h, 1.25 * h] : [-2.5 * h, 0];
  const ni = Math.ceil((a1 - a0) / 2), nk = Math.ceil((d1 - d0) / 1.5);   // every 2 ft along, 1.5 ft across
  for (let i = 0; i <= ni; i++) for (let k = 0; k <= nk; k++)
    obstacles.push(add([x, y], add(mul(r, a0 + (a1 - a0) * i / ni), mul(dn, d0 + (d1 - d0) * k / nk))));
};
for (const ln of dump) {
  const m = ln.match(/^ENT\|(MTEXT|TEXT)\|.*?\|x=([\d.]+)\|y=([\d.]+)/);
  if (!m || +m[2] < 859400) continue;
  const g2 = (k) => { const q = ln.match(new RegExp('\\|' + k + '=([-\\d.]+)')); return q ? +q[1] : 0; };
  sampleText(+m[2], +m[3], g2('rot'), g2('w'), g2('h') || 2.5, g2('att') || 1);
}
for (const f of ['fase1-exist.json', 'fase1-site.json']) for (const e2 of JSON.parse(fs.readFileSync(W + '/' + f, 'utf8')).entities) {
  if (e2.kind === 'mleader') sampleText(e2.x, e2.y, e2.rotation, 26, 2.8, 1);
  else if (e2.kind === 'mtext' && !/U\+214A/.test(e2.text)) sampleText(e2.x, e2.y, e2.rotation, e2.width || 30, e2.height, e2.attachment);
}
for (const l2 of JSON.parse(fs.readFileSync(W + '/pkg-planlabels-villa.json', 'utf8'))) sampleText(l2.labelLocation.x, l2.labelLocation.y, 1.5972, 14, 2, 5);
const inPoly = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const edgeDist = (p, r) => Math.min(...r.map((a, i) => { const b = r[(i + 1) % r.length], d = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), d) / dot(d, d))); return len(sub(p, add(a, mul(d, t)))); }));
// Label box: reads along u, half-length ~0.45 h per character, two lines (half-height ~3.5 ft at h 2).
// Placement: the whole box inside the visible lot, clear of existing text and dim text; nearest to the centroid.
const placeLabel = (vis, fitPoly, chars) => {
  const obs = [...obstacles, ...dimText.flatMap((q) => [q, ...[-6, -3, 3, 6].map((k) => add(q, mul(u, k))), ...[-6, 6].map((k) => add(q, mul(v, k)))])];
  const c0 = centroidOf(vis);
  for (const h of [LABEL.height, 1.6]) {
    const Lh = 0.45 * h * chars + 1, Hh = 1.9 * h;
    const clearance = (p) => Math.min(...obs.map((q) => { const d = sub(q, p); return Math.max(Math.abs(dot(d, u)) / Lh, Math.abs(dot(d, v)) / Hh); }));
    let best = null;
    for (let a = -120; a <= 120; a += 1.5) for (let b = -120; b <= 120; b += 1.5) {
      const p = add(c0, add(mul(u, a), mul(v, b)));
      if (!inPoly(p, vis)) continue;
      const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([i, k]) => add(p, add(mul(u, i * Lh), mul(v, k * Hh))));
      if (!corners.every((q) => inPoly(q, fitPoly))) continue;
      const score = Math.min(clearance(p), 1.3) - len([a, b]) / 1000;
      if (!best || score > best.score) best = { p, score };
    }
    if (best && best.score > 0.9) return { p: best.p, h };
  }
  return null;
};

// Labels + QC notes + report rows.
const fmt = (x) => Number(x).toFixed(2);
for (const l of lots) {
  if (!l.lot) continue;
  const g = geom.get(`${l.blk}/${l.lot}`);
  const subject = l.folio === '30-6913-003-0830';
  const poly = g ? g.poly : l.edges.map((e2) => e2.a);
  const vis = clip(poly, 6);
  const visArea = vis.length ? polyArea(vis) : 0;
  const gisDims = l.edges.filter((e2) => e2.length >= 20).map((e2) => fmt(e2.length));
  const lg = legalOf(l);
  const gisSides = lg ? l.edges.filter((e2) => e2.length >= 20).map((e2) => e2.length) : [];
  const lotsName = /LOT 10 & 11/.test(l.legal.join(' ')) ? `LOTS 10 & 11 BLK ${l.blk}` : `LOT ${l.lot} BLK ${l.blk}`;
  const row = {
    lot: lotsName, folio: l.folio, plat: l.plat, legal: lg ? `${fmt(lg[0])} x ${fmt(lg[1])}` : `${l.lotSizeSf} SF (legal sin medidas)`,
    paLotSf: l.lotSizeSf, gisAreaSf: l.lotPolyAreaSf, gisSides: gisDims.join(' / '),
    drawn: g ? (g.gis ? 'GIS del PA' : 'legal PA desde R/W del survey') : 'no dibujado',
    visibleSf: Math.round(visArea), labeled: !subject && visArea >= 600,
  };
  if (lg) {
    const legalArea = lg[0] * lg[1];
    row.flag = [
      Math.abs(l.lotPolyAreaSf - legalArea) > 0.02 * legalArea ? `área GIS ${l.lotPolyAreaSf} vs legal ${Math.round(legalArea)} (${(100 * (l.lotPolyAreaSf / legalArea - 1)).toFixed(1)}%)` : null,
      l.lotSizeSf && Math.abs(l.lotSizeSf - legalArea) > 0.01 * legalArea ? `PA LotSize ${l.lotSizeSf} vs legal ${Math.round(legalArea)}` : null,
    ].filter(Boolean).join('; ');
  } else if (l.lotSizeSf) {
    row.flag = Math.abs(l.lotPolyAreaSf - l.lotSizeSf) > 0.02 * l.lotSizeSf ? `área GIS ${l.lotPolyAreaSf} vs PA ${l.lotSizeSf}` : '';
  }
  report.push(row);
  if (!row.labeled) continue;
  const placed = placeLabel(vis, clip(poly, 1.5), Math.max(lotsName.length, `FOLIO: ${l.folio}`.length));
  if (!placed) { row.labeled = false; row.note = 'sin espacio libre para el rótulo dentro de la vista'; continue; }
  const at = placed.p;
  row.labelHeight = placed.h;
  ents.push({ kind: 'mtext', ...LABEL, height: placed.h, text: `${lotsName}\\PFOLIO: ${l.folio}`, x: r4(at[0]), y: r4(at[1]) });
  if (row.flag) {
    const below = add(at, mul(v, -7));                                  // v = sheet "up" for text read along u
    ents.push({ kind: 'mtext', layer: '_NPLT', colorIndex: 1, textStyle: 'BCC-1.0', height: 1.2, attachment: 5, rotation: 1.5972,
      text: `QC PA: GIS ${gisDims.join('/')}\\P${row.flag}`, x: r4(below[0]), y: r4(below[1]) });
  }
}

// PL symbols at the midpoint of every shared lot line (>= 50 ft) that shows in the viewport.
const plEnts = [];
const UE = [[859872.995, 444897.905], [859866.909, 444902.799], [859875.451, 444900.448]];
const H = PL.height * 1.42857, halfBox = (PL.width ?? 0.6468) / 2;
const plAt = (Pm, lineDir) => {
  const parallel = Math.abs(dot(lineDir, u)) > 0.7;
  const rot = (parallel ? theta + 90 : theta) * D2R, right = [Math.cos(rot), Math.sin(rot)], up = [-Math.sin(rot), Math.cos(rot)];
  const ins = add(add(Pm, mul(right, -halfBox)), mul(up, H / 2));
  plEnts.push({ kind: 'mtext', layer: PL.layer, textStyle: PL.textStyle, height: PL.height, attachment: PL.attachment, width: PL.width ?? 0.6468,
    rotation: r4(rot), text: PL.text, x: r4(ins[0]), y: r4(ins[1]) });
};
const keys = [...geom.keys()];
const segsOf = (poly) => poly.map((a, i) => [a, poly[(i + 1) % poly.length]]);
const plReport = [];
for (let i = 0; i < keys.length; i++) for (let k = i + 1; k < keys.length; k++) {
  for (const [a, b] of segsOf(geom.get(keys[i]).poly)) for (const [c, d] of segsOf(geom.get(keys[k]).poly)) {
    const dir = unit(sub(b, a)), L = len(sub(b, a));
    const off1 = Math.abs(cross(sub(c, a), dir)), off2 = Math.abs(cross(sub(d, a), dir));
    if (off1 > 1.5 || off2 > 1.5) continue;
    const t = [dot(sub(c, a), dir), dot(sub(d, a), dir)].sort((x, y) => x - y), t0 = Math.max(0, t[0]), t1 = Math.min(L, t[1]);
    if (t1 - t0 < 50) continue;
    let Pm = add(a, mul(dir, (t0 + t1) / 2));
    if (obstacles.concat(UE).some((q) => len(sub(q, Pm)) < 9)) Pm = add(a, mul(dir, t0 + 0.72 * (t1 - t0)));
    if (!inWin(Pm, 5) || plReport.some((r) => len(sub(r.P, Pm)) < 3)) continue;
    plAt(Pm, dir);
    plReport.push({ pair: `${keys[i]}|${keys[k]}`, P: Pm });
  }
}

const layers = { 'C-ANNO': { colorIndex: 7, linetype: 'Continuous', lineweight: -3, plot: true }, '_NPLT': { colorIndex: 7, linetype: 'Continuous', lineweight: -3, plot: false } };
fs.writeFileSync(W + '/fase1-lots.json', JSON.stringify({ space: 'model', layers, entities: [...ents, ...plEnts] }));
fs.writeFileSync(W + '/fase1-lots-report.json', JSON.stringify({ closures, rows: report, pl: plReport.map((r) => `${r.pair} @ ${r.P.map((x) => x.toFixed(2))}`) }, null, 1));
console.log(`dims ${dimCount}, labels+qc ${ents.length - dimCount}, PL ${plEnts.length}`);
console.log(closures.join('\n'));
for (const r of report) console.log(`${r.lot.padEnd(18)} ${String(r.folio).padEnd(17)} ${String(r.plat).padEnd(16)} legal ${r.legal.padEnd(16)} GIS ${r.gisSides.padEnd(32)} vis ${String(r.visibleSf).padStart(6)} ${r.labeled ? 'LABEL' : '     '} ${r.drawn}  ${r.flag || ''}`);
console.log(plReport.map((r) => `PL ${r.pair} @ ${r.P.map((x) => x.toFixed(2))}`).join('\n'));
