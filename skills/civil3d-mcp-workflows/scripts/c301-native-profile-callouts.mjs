#!/usr/bin/env node
// Profile side of the engineer's method (2026-10-27 recordings): the callout of every lateral connection in the MAIN profile view is a NATIVE Civil 3D
// Station Elevation label (style "Exist. Elevation Grade" = the style the engineer's labels of that view already use, marker _No Markers), not a Multileader. The station comes from the label itself
// (field), so it follows the pipe; INV and the plan offset are typed, like the engineer types INV in the plan labels (the Elevation field of this label type does not resolve: it prints "<3140>").
//
//   node c301-native-profile-callouts.mjs --expect "<open drawing name>" [--profile-view "<name>"] [--dry-run] [--replace-mleaders] [--no-save] [--path "<full .dwg>"]
// Source = the SAN LAT CONNECTION Multileaders that sit in the profile view (text "PROP 8"x6" SAN LAT CONNECTION \P (SEE NOTE...) \P INV: -4.05' \P STA: 0+74.32/OFF: 2.18' L").
// Each one is matched to the Station Elevation label that already exists in that view at the same station (and elevation = INV); that label is re-styled, re-texted
// and moved to the Multileader's text position (the engineer's labels sit at the pipe and are dragged to clear space). Re-running is idempotent.
// --replace-mleaders  erase the converted Multileaders after the labels read back OK. Nothing is deleted without it.
// Plan callouts (SAN LAT labels on the alignment) are c300-native-sanlat-labels.mjs. Rules: references/engineer-feedback-2026-10.md.
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp/Civil3D-mcp").replace(/\\/g, "/");
const expect = flag("expect");
const style = flag("style", "Exist. Elevation Grade"), marker = flag("marker", "_No Markers");
if (!expect) die('usage: node c301-native-profile-callouts.mjs --expect "<open drawing name>" [--profile-view "<name>"] [--dry-run] [--replace-mleaders] [--no-save] [--path "<full .dwg>"]');

const STA = "<[Station Value(Uft|FS|P2|RN|Sn|OF|AP|B2|TP|EN|W0|DZY)]>";
const NL = "\\P";
const overrideText = (title, inv, offsetText) => [...title, `INV: ${inv.toFixed(2)}'`, `STA: ${STA}/OFF: ${offsetText}`].join(NL);

process.env.CIVIL3D_LOG_LEVEL ??= "warn";
const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const norm = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.dwg$/i, "").toLowerCase();

await withApplicationConnection(async (client) => {
  const active = ((await client.sendCommand("listOpenDocuments", {})).documents ?? []).find((d) => d.isActive);
  if (!active) die("no active drawing");
  if (norm(active.filePath ?? active.name) !== norm(expect)) die(`active drawing is "${basename(active.filePath ?? active.name)}", expected "${expect}": nothing changed`);
  if (flag("path") && String(active.filePath ?? "").replace(/\\/g, "/").toLowerCase() !== flag("path").replace(/\\/g, "/").toLowerCase()) die(`active file is ${active.filePath}, expected ${flag("path")}: nothing changed`);

  const all = await client.sendCommand("profileViewAnnotations", {});
  const views = all.profileViews ?? [];
  const pvName = flag("profile-view") ?? views.find((v) => /SAN MAIN/i.test(v.profileViewName))?.profileViewName ?? views[0]?.profileViewName;
  const pv = views.find((v) => v.profileViewName === pvName);
  if (!pv) die(`profile view not found: ${pvName}`);
  const stationLabels = pv.labels.filter((l) => l.type === "StationElevationLabel");

  const ents = flag("spec") ? [] : ((await client.sendCommand("listTextEntities", { space: "model", contains: "SAN LAT CONNECTION", limit: 500 })).entities ?? []).filter((e) => e.entityType === "MLeader");
  const items = [];
  // --spec labels.json: [{ "station": 74.32, "inv": -4.05, "offset": 2.18, "side": "L", "location": {"x":..,"y":..}, "title": [...] }] re-applies (moves / re-texts) callouts that already are native labels
  for (const s of flag("spec") ? JSON.parse((await import("node:fs")).readFileSync(flag("spec"), "utf8")) : []) {
    const lab = stationLabels.find((l) => Math.abs(l.station - s.station) < 0.011 && Math.abs(l.elevation - s.inv) < 0.006);
    if (!lab) { console.log(`  skip STA ${s.station}: no Station Elevation label there`); continue; }
    items.push({ mleader: null, label: lab, station: s.station, inv: s.inv, title: s.title ?? ['PROP 8"x6" SAN LAT CONNECTION', "(SEE NOTE ON THIS SHEET)"], offsetText: `${Number(s.offset).toFixed(2)}' ${s.side ?? "L"}`, location: s.location });
    console.log(`  STA ${s.station.toFixed(2)} INV ${s.inv}  label ${lab.handle} (${lab.style})  OFF ${Number(s.offset).toFixed(2)}' ${s.side ?? "L"}`);
  }
  for (const e of ents) {
    const inv = /INV:\s*(-?[\d.]+)/.exec(e.text)?.[1];
    const sta = /STA:\s*(\d+)\+([\d.]+)\s*\/\s*OFF:\s*([\d.+]+)'?\s*([LR])?/.exec(e.text);
    if (inv === undefined || !sta) continue;
    const station = Number(sta[1]) * 100 + Number(sta[2]);
    const lab = stationLabels.find((l) => Math.abs(l.station - station) < 0.011 && Math.abs(l.elevation - Number(inv)) < 0.006);
    if (!lab) { console.log(`  skip ${e.handle}: not a callout of ${pvName} (no Station Elevation label at STA ${station.toFixed(2)} / ${inv})`); continue; }
    const offsetNum = Number(sta[3].replace("+", "."));
    const lines = e.text.split(NL);
    const title = lines.slice(0, lines.findIndex((l) => l.startsWith("INV:")));
    items.push({ mleader: e.handle, label: lab, station, inv: Number(inv), title, offsetText: `${offsetNum.toFixed(2)}' ${sta[4] ?? "L"}`, location: { x: e.x, y: e.y } });
    console.log(`  STA ${station.toFixed(2)} INV ${inv}  label ${lab.handle} (${lab.style}) <- MLeader ${e.handle}  OFF ${offsetNum.toFixed(2)}' ${sta[4] ?? "L"}`);
  }
  if (!items.length) die("nothing to convert (no SAN LAT CONNECTION callouts of that profile view found)");
  if (has("dry-run")) { console.log(`DRY RUN: ${items.length} callouts would become native ${style} labels in ${pvName}`); return; }

  const specs = items.map((i) => ({ type: "StationElevationLabel", style, markerStyle: marker, station: i.label.station, elevation: i.label.elevation,
    labelLocation: i.location, dragged: true, overrides: [{ index: 0, text: overrideText(i.title, i.inv, i.offsetText) }] }));
  const r = await client.sendCommand("profileViewApplyAnnotations", { profileViewName: pvName, labels: specs });
  if (r.failedLabels) { for (const l of r.labels.filter((x) => x.error)) console.error(`  FAIL ${l.index}: ${l.error}`); die("some labels failed: Multileaders kept, drawing not saved"); }
  console.log(`native profile labels: ${r.createdLabels} created/updated (${r.labels.map((l) => l.handle).join(", ")})`);

  const back = ((await client.sendCommand("profileViewAnnotations", { profileViewName: pvName })).profileViews[0]?.labels ?? []);
  const bad = items.filter((i) => { const l = back.find((x) => x.handle === i.label.handle); return !l || l.style !== style || !l.overrides?.length; });
  if (bad.length) die(`labels not read back as ${style}: ${bad.map((b) => b.label.handle).join(", ")}`);
  console.log(`read back: ${items.length} labels are ${style} with the callout text`);

  if (has("replace-mleaders") && items.some((i) => i.mleader)) { await client.sendCommand("eraseEntities", { handles: items.filter((i) => i.mleader).map((i) => i.mleader) }); console.log(`erased ${items.filter((i) => i.mleader).length} converted Multileaders`); }
  if (!has("no-save")) { await client.sendCommand("saveDrawing", {}); console.log("saved"); }
  console.log("next: qc-plot.ps1 -Layouts C-301, check text, leaders and overlaps; then replace the profiles PDF.");
});
