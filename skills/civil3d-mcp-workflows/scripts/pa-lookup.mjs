#!/usr/bin/env node
// Miami-Dade Property Appraiser lookup -> compact JSON for the C-300 "SUBJECT PROPERTY" label.
// Node 18+, no deps.
//
//   node pa-lookup.mjs --xy 859852,444852 [--radius 60]   (drawing coords, NAD83 FL East ftUS = EPSG 2236)
//   node pa-lookup.mjs --folio 30-6913-003-0830
//   node pa-lookup.mjs --address "23175 SW 125 AVE"
//
// --xy is the preferred mode: pick a point INSIDE the lot in X-TOPO and it returns the
// parcel(s) whose PA centroid is within --radius ft, nearest first. Addresses like "227XX"
// (vacant lots) do not geocode on the PA site, so never rely on the address alone.

const PA = 'https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx';
const GIS = 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/PaGISView_gdb/FeatureServer/0/query';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) =>
  (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const fmtFolio = (f) => String(f).replace(/\D/g, '').replace(/^(\d{2})(\d{4})(\d{3})(\d{4})$/, '$1-$2-$3-$4');

async function byFolio(folio) {
  const f = String(folio).replace(/\D/g, '');
  const j = await get(`${PA}?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch&folioNumber=${f}`);
  const pi = j.PropertyInfo || {};
  const legal = (j.LegalDescription?.Description || '').split('|').map((s) => s.trim()).filter(Boolean);
  const site = (j.SiteAddress || []).map((s) => s.Address?.replace(/, .*$/, '')).filter(Boolean);
  return {
    folio: pi.FolioNumber || fmtFolio(f),
    siteAddress: site,
    owner: (j.OwnerInfos || []).map((o) => o.Name),
    subdivision: pi.SubdivisionDescription,
    plat: pi.PlatBook ? `P.B. ${pi.PlatBook} PG-${pi.PlatPage}` : null,
    legal,
    lotSizeSf: pi.LotSize,
    landUse: pi.DORDescription,
    zoning: pi.PrimaryZoneDescription,
    municipality: pi.Municipality,
    buildingSf: pi.BuildingActualArea || 0,
    yearBuilt: pi.YearBuilt,
  };
}

async function byXY(xy, radius) {
  const [x, y] = xy.split(',').map(Number);
  const q = new URLSearchParams({
    geometry: `${x},${y}`, geometryType: 'esriGeometryPoint', inSR: '2236',
    distance: String(radius), units: 'esriSRUnit_Foot', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FOLIO,TRUE_SITE_ADDR,X_COORD,Y_COORD,LEGAL', returnGeometry: 'false', f: 'json',
  });
  const j = await get(`${GIS}?${q}`);
  if (j.error) throw new Error(JSON.stringify(j.error));
  const feats = (j.features || []).map((f) => f.attributes)
    .map((a) => ({ ...a, dist: Math.hypot(a.X_COORD - x, a.Y_COORD - y) }))
    .sort((a, b) => a.dist - b.dist);
  const out = [];
  for (const a of feats) out.push({ distFt: +a.dist.toFixed(1), ...(await byFolio(a.FOLIO)) });
  return out;
}

async function byAddress(addr) {
  const j = await get(`${PA}?Operation=GetAddress&clientAppName=PropertySearch&myUnit=&from=1&to=200&myAddress=${encodeURIComponent(addr)}`);
  if (!j.MinimumPropertyInfos?.length) return { error: j.Message || 'address not found — use --xy instead' };
  const out = [];
  for (const m of j.MinimumPropertyInfos) out.push(await byFolio(m.Strap));
  return out;
}

try {
  let res;
  if (args.xy) res = await byXY(args.xy, Number(args.radius || 60));
  else if (args.folio) res = await byFolio(args.folio);
  else if (args.address) res = await byAddress(args.address);
  else { console.error('usage: --xy X,Y [--radius ft] | --folio N | --address "..."'); process.exit(2); }
  console.log(JSON.stringify(res, null, 1));
} catch (e) { console.error(String(e)); process.exit(1); }
