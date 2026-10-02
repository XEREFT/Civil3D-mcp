// Shared county-GIS / Property Appraiser fetch. The Miami-Dade GIS (gisfs.miamidade.gov) often answers the FIRST request after a pause with a
// 200 and an EMPTY feature list, then answers normally (seen 2026-10-02: "PL 0" builds, empty "possible matches"). getJson retries (up to
// `tries`, growing wait) when the response is an error, a non-200, or has `features: []`; a genuinely empty answer is accepted after the last try.
//   import { getJson } from "./lib/gis.mjs";   const j = await getJson(url);            // features list expected (default)
//                                              const r = await getJson(url, { expectFeatures: false });   // PA Operation=... proxy answers
export async function getJson(url, { tries = 4, expectFeatures = true } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      if (j?.error) throw new Error(JSON.stringify(j.error).slice(0, 120));
      if (!expectFeatures || !("features" in (j ?? {})) || j.features.length > 0 || i === tries) return j;
      last = j;
    } catch (e) { if (i === tries) throw new Error(`${e.message} ${url.slice(0, 110)}`); }
    await new Promise((res) => setTimeout(res, 1500 * i));
  }
  return last;
}
