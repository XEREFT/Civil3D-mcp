#!/usr/bin/env node
// Neighbor lots visible in the C-300 viewport: county plat lots (Lot_poly, MapServer/7) matched to PA
// parcels (PaParcel, MapServer/6, FOLIO) and the PA record of each folio (legal description, lot size).
// Owner names are never read out or written.
//
//   node neighbor-lots.mjs --frontage 91.5109 --center 859789.19,444700.69 [--half 250,230] --out lots.json
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const D = Math.PI / 180, theta = Number(args.frontage), C = args.center.split(',').map(Number);
const [halfU, halfV] = (args.half || '250,230').split(',').map(Number);
const u = [Math.cos(theta * D), Math.sin(theta * D)], v = [-u[1], u[0]];
const local = (p) => { const d = [p[0] - C[0], p[1] - C[1]]; return [d[0] * u[0] + d[1] * u[1], d[0] * v[0] + d[1] * v[1]]; };
const inView = (p) => { const [a, b] = local(p); return Math.abs(a) < halfU && Math.abs(b) < halfV; };

const MS = 'https://gisfs.miamidade.gov/mdarcgis/rest/services/MD_PA_PropertySearch/MapServer';
const PA = 'https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx';
const reach = Math.hypot(halfU, halfV) + 150;
const env = `${C[0] - reach},${C[1] - reach},${C[0] + reach},${C[1] + reach}`;
const query = async (layer, fields) => {
  const q = new URLSearchParams({ geometry: env, geometryType: 'esriGeometryEnvelope', inSR: '2236', spatialRel: 'esriSpatialRelIntersects',
    outFields: fields, returnGeometry: 'true', outSR: '2236', f: 'json' });
  const j = await (await fetch(`${MS}/${layer}/query?${q}`)).json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.features;
};

const area = (r) => Math.abs(r.slice(0, -1).reduce((s, p, i) => s + p[0] * r[i + 1][1] - r[i + 1][0] * p[1], 0)) / 2;
const centroid = (r) => { let a = 0, x = 0, y = 0; for (let i = 0; i < r.length - 1; i++) { const c = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; a += c; x += (r[i][0] + r[i + 1][0]) * c; y += (r[i][1] + r[i + 1][1]) * c; } return [x / (3 * a), y / (3 * a)]; };
const inside = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
// Merge nearly collinear consecutive vertices so a lot line split by a GIS vertex reads as one line.
const simplify = (r) => {
  let pts = r.slice(0, -1);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / len(a, c);
      if (cross < 0.3 || len(a, b) < 0.5) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
};

const lots = (await query(7, 'BLK_TRT,LOT,TTRRSS')).map((f) => ({ blk: String(f.attributes.BLK_TRT).trim(), lot: String(f.attributes.LOT).trim(), ring: f.geometry.rings[0] }));
const parcels = (await query(6, 'FOLIO')).map((f) => ({ folio: f.attributes.FOLIO, ring: f.geometry.rings[0] }));

const fmtFolio = (f) => String(f).replace(/^(\d{2})(\d{4})(\d{3})(\d{4})$/, '$1-$2-$3-$4');
const paCache = new Map();
const paRecord = async (folio) => {
  if (paCache.has(folio)) return paCache.get(folio);
  const j = await (await fetch(`${PA}?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch&folioNumber=${folio}`)).json();
  const pi = j.PropertyInfo || {};
  const rec = {
    legal: (j.LegalDescription?.Description || '').split('|').map((s) => s.trim()).filter(Boolean),
    lotSizeSf: pi.LotSize ?? null,
    plat: pi.PlatBook ? `P.B. ${pi.PlatBook} PG-${pi.PlatPage}` : null,
    subdivision: pi.SubdivisionDescription || null,
    siteAddress: (j.SiteAddress || []).map((s) => s.Address?.replace(/, .*$/, '')).filter(Boolean),
    landUse: pi.DORDescription || null,
  };
  paCache.set(folio, rec);
  return rec;
};

const out = [];
for (const L of lots) {
  const c = centroid(L.ring);
  const visible = inView(c) || L.ring.some(inView);
  if (!visible) continue;
  const pts = simplify(L.ring);
  const edges = pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; return { a, b, length: +len(a, b).toFixed(2) }; });
  const matches = parcels.filter((p) => inside(c, p.ring));
  const folio = matches[0]?.folio || null;
  const pa = folio ? await paRecord(folio) : null;
  const parcelArea = matches[0] ? area(matches[0].ring) : null;
  const lotArea = area(L.ring);
  const legalSize = pa?.legal.join(' ').match(/LOT SIZE\s+([\d.]+)\s*X\s*([\d.]+)/i);
  out.push({
    id: `LOT ${L.lot} BLK ${L.blk}`, blk: L.blk, lot: L.lot, centroid: c.map((x) => +x.toFixed(3)),
    centroidInView: inView(c), folio: folio ? fmtFolio(folio) : null,
    plat: pa?.plat || null, legal: pa?.legal || [], lotSizeSf: pa?.lotSizeSf ?? null,
    legalSize: legalSize ? [Number(legalSize[1]), Number(legalSize[2])] : null,
    lotPolyAreaSf: +lotArea.toFixed(0), parcelAreaSf: parcelArea ? +parcelArea.toFixed(0) : null,
    parcelsAtCentroid: matches.length,
    edges,
  });
}
out.sort((a, b) => (a.blk === b.blk ? Number(a.lot) - Number(b.lot) : Number(a.blk) - Number(b.blk)));
fs.writeFileSync(args.out || 'lots.json', JSON.stringify(out, null, 1));
for (const o of out) {
  console.log(`${o.id.padEnd(15)} folio ${o.folio ?? '-'}  ${o.plat ?? ''}  PA ${o.lotSizeSf ?? '-'} sf  Lot_poly ${o.lotPolyAreaSf} sf  PaParcel ${o.parcelAreaSf ?? '-'} sf  legalSize ${o.legalSize ?? '-'}  edges ${o.edges.map((e) => e.length).join('/')}  inView ${o.centroidInView}`);
  console.log(`   legal: ${o.legal.join(' | ')}`);
}
