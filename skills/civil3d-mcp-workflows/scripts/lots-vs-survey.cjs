// For each visible lot, compare every GIS (Lot_poly) edge that runs along a street with the survey R/W line
// (X-TOPO PROPERTY_LINE): perpendicular offset of both ends. Tells whether the PA geometry sits on the survey.
const fs = require('fs');
const dump = fs.readFileSync(process.env.LOCALAPPDATA + '/Temp/c3d-dwg-dump/X-TOPO_dump.txt', 'utf8').split('\n');
const segs = [];
for (const l of dump) {
  if (!l.startsWith('ENT|LWPOLYLINE|') || !l.includes('|PROPERTY_LINE|')) continue;
  const v = (l.match(/\|v=([^|]*)/) || [])[1];
  if (!v) continue;
  const pts = v.split(';').filter(Boolean).map((s) => s.split(',').map(Number));
  if (pts[0][0] < 859000) continue;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (L > 40) segs.push({ a: pts[i], b: pts[i + 1], L });
  }
}
const lots = JSON.parse(fs.readFileSync(process.cwd() + '/lots.json', 'utf8'));
const off = (p, s) => { const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1]; return ((p[0] - s.a[0]) * dy - (p[1] - s.a[1]) * dx) / s.L; };
const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const out = [];
for (const lot of lots) {
  const rows = [];
  for (const e of lot.edges) {
    if (e.length < 20) continue;
    let best = null;
    for (const s of segs) {
      let d = Math.abs(ang(e.a, e.b) - ang(s.a, s.b)) % Math.PI;
      d = Math.min(d, Math.PI - d);
      if (d > 0.05) continue;
      const o1 = off(e.a, s), o2 = off(e.b, s);
      if (Math.abs(o1) > 20 || Math.abs(o2) > 20) continue;
      if (!best || Math.abs(o1) + Math.abs(o2) < Math.abs(best.o1) + Math.abs(best.o2)) best = { o1, o2 };
    }
    if (best) rows.push(`${e.length.toFixed(2)}ft: off ${best.o1.toFixed(2)} / ${best.o2.toFixed(2)}`);
  }
  out.push(`${lot.id.padEnd(14)} ${lot.plat}  street edges vs survey R/W -> ${rows.join('; ') || 'none'}`);
}
console.log(out.join('\n'));
console.log('survey R/W segments:', segs.length);
