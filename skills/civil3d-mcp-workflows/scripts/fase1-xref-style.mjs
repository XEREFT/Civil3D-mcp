#!/usr/bin/env node
// Xref look of the survey on the C-300 (the rule the firm's GUIA applies to X-TOPO): every X-TOPO layer goes to ACI 8 (gray) EXCEPT the layers that already
// are ACI 4 (boundary / building / property classes: VILLA ONE's GUIA keeps exactly its 16 ACI-4 layers and grays the other 196, spot-elevation layer frozen),
// plus the survey profile's property-line layers (keep -> ACI 4, so the lot lines stay heavy even when the surveyor drew them green/magenta), and the
// profile's hideXrefLayers (spot elevations, trees) frozen. Xref layer overrides: the host layer-table record of "X-TOPO|name" (VISRETAIN keeps them).
// Opt-in per project: project.json sources.xrefStyle = "gray" (fase1-from-scratch runs this as step 2c). VILLA ONE / Goulds are not touched unless asked.
//   node fase1-xref-style.mjs --expect "<open drawing name>" [--dir <project folder>] [--keep LOTLINE,BNDRY] [--hide ELV,TREES] [--xref X-TOPO]
//        [--dry-run] [--no-save] [--real] [--repo <Civil3D-mcp>]
// --dir reads project.json (sources.surveyProfile) and the profile's propertyLine / hideXrefLayers; --keep / --hide override. Idempotent.
import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadProfiles, profileByName } from "./lib/survey-profile.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp/Civil3D-mcp").replace(/\\/g, "/");
const expect = flag("expect");
if (!expect) die('usage: node fase1-xref-style.mjs --expect "<open drawing name>" [--dir <project folder>] [--keep A,B] [--hide C,D] [--dry-run] [--no-save] [--real]');
const xref = flag("xref") ?? "X-TOPO";
const GRAY = 8, HEAVY = 4;

let profile = {};
if (flag("dir")) {
  const pj = join(flag("dir"), "project.json");
  const forced = existsSync(pj) ? JSON.parse(readFileSync(pj, "utf8")).sources?.surveyProfile : undefined;
  try { profile = forced ? profileByName(forced) : {}; } catch (e) { die(String(e.message ?? e)); }
}
const list = (s) => String(s).split(",").map((x) => x.trim()).filter(Boolean);

process.env.CIVIL3D_LOG_LEVEL ??= "warn";
const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const norm = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.dwg$/i, "").toLowerCase();
await withApplicationConnection(async (client) => {
  const active = ((await client.sendCommand("listOpenDocuments", {})).documents ?? []).find((d) => d.isActive);
  if (!active) die("no active drawing");
  if (norm(active.filePath ?? active.name) !== norm(expect)) die(`active drawing is "${basename(active.filePath ?? active.name)}", expected "${expect}": nothing changed`);
  if (/ FASE 1\.dwg$/i.test(active.filePath ?? active.name) && !has("real")) die("refusing the delivered FASE 1.dwg without --real (try a FASE1-BUILD-TEST copy first)");
  const res = await client.sendCommand("listLayers", { namePattern: `${xref}|*`, includeXref: true, limit: 5000 });
  const layers = (res.layers ?? []).filter((l) => l.isXrefDependent !== false);
  if (!layers.length) die(`no ${xref}| layers in the active drawing (attach the xref first)`);
  // profile: forced by project.json, else the first one whose centerline layer exists in this xref (same roles the build used)
  if (!profile.name) {
    const have = new Set(layers.map((l) => l.name.slice(xref.length + 1).toLowerCase()));
    const all = loadProfiles();
    const hit = Object.entries(all).find(([, p]) => p.centerline.some((c) => have.has(c.toLowerCase())));
    if (hit) profile = { name: hit[0], ...hit[1] };
  }
  console.log(`  profile: ${profile.name ?? "none (only --keep / --hide apply)"}`);
  const keep = new Set((flag("keep") ? list(flag("keep")) : profile.heavyXrefLayers ?? profile.propertyLine ?? []).map((n) => n.toLowerCase()));
  const hide = new Set((flag("hide") ? list(flag("hide")) : profile.hideXrefLayers ?? []).map((n) => n.toLowerCase()));
  const white = new Set((profile.whiteXrefLayers ?? []).map((n) => n.toLowerCase()));
  const heavyOnly = profile.heavyOnly === true;   // user 2026-10-25 (SEIDENSTEIN): blue ONLY on the lot line that carries the R/W; every other ACI 4 layer goes gray too
  let gray = 0, heavy = 0, kept = 0, frozen = 0, fail = 0;
  for (const l of layers) {
    const short = l.name.slice(xref.length + 1), low = short.toLowerCase();
    let want, why;
    if (hide.has(low)) { want = { frozen: true }; why = "frozen (hidden on the sheet)"; }
    else if (keep.has(low)) { want = l.colorIndex === HEAVY ? null : { colorIndex: HEAVY }; why = "property line -> ACI 4"; }
    else if (white.has(low)) { want = l.colorIndex === 7 ? null : { colorIndex: 7 }; why = "street name -> ACI 7 (white)"; }
    else if (l.colorIndex === HEAVY && !heavyOnly) { want = null; why = "already ACI 4 (kept like the guide)"; }
    else if (l.colorIndex === GRAY) { want = null; why = "already ACI 8"; }
    else { want = { colorIndex: GRAY }; why = "-> ACI 8"; }
    if (!want) { kept++; continue; }
    if (want.frozen && l.isFrozen === true) { kept++; continue; }
    if (has("dry-run")) { console.log(`  DRY  ${short}: ${why}`); continue; }
    try {
      await client.sendCommand("createOrUpdateLayer", { name: l.name, ...want });
      if (want.frozen) frozen++; else if (want.colorIndex === HEAVY) heavy++; else gray++;   // gray also counts the white street names
    } catch (e) { fail++; console.log(`  FAIL ${short}: ${e instanceof Error ? e.message : e}`); }
  }
  const changed = gray + heavy + frozen;
  if (changed && !has("no-save")) { await client.sendCommand("saveDrawing", { overwrite: true }); console.log("  saved"); }
  console.log(`xref style: ${layers.length} ${xref}| layers | ${gray} -> ACI 8, ${heavy} -> ACI 4, ${frozen} frozen, ${kept} already right${fail ? `, ${fail} FAILED` : ""}`);
  if (fail) process.exitCode = 1;
});
