#!/usr/bin/env node
// Creates the PROPOSED plan callouts the way the design engineer does (2026-10-27): NATIVE Civil 3D station-offset labels (AeccDbStaOffsetLabel, style SAN LAT) bound to the
// alignment, instead of Multileader copies. STA / OFF / side are computed by Civil 3D (fixed point = the exact station + offset); only the INV line is typed (a text-component
// override of the style's own text, same as Edit Label Text > Text Component Editor). Uses profileViewApplyAnnotations without a profile view (idempotent: re-running updates
// the existing label of the same alignment + point, never stacks a second one).
//
//   node c300-native-sanlat-labels.mjs --expect "<open drawing name>" [--alignment "SW 53RD CT"] [--dry-run] [--replace-mleaders] [--no-save]
//   node c300-native-sanlat-labels.mjs --expect "<name>" --spec labels.json     (new project: no MLeaders to convert)
// Default source = the SAN LAT CONNECTION Multileaders of the active drawing (text "PROP 8"x6" SAN LAT CONNECTION \P (SEE NOTE ...) \P INV: -4.05' \P STA: 0+74.32/OFF: 2.18' L"):
//   station / offset / side / INV are parsed from the text; the text position of the Multileader becomes the label location; profile-view copies are skipped (they are not near the alignment).
// --spec  JSON array of { "station": 79.72, "offset": 2.30, "side": "L"|"R", "inv": -4.02, "title": ["PROP 8\"x6\" SAN LAT CONNECTION","(SEE NOTE ON THIS SHEET)"], "labelLocation": {"x":..,"y":..} }
// --replace-mleaders  after the native labels exist and round-trip, erase the Multileaders that were converted (only those matched above); without it nothing is deleted.
// --path "<full .dwg path>"  refuse to run unless the ACTIVE drawing is exactly that file (copies of the same name are often open at once).
// --layer (default C-ROAD-TEXT, the layer the SAN LAT style puts its labels on) / --style (default SAN LAT) / --marker (default _No Markers; a null marker makes Civil 3D throw "Value does not fall within the expected range").
// Writes to the ACTIVE drawing: run it on the PROPOSED file that is ours (never on a file the engineer already fixed). Rules: references/engineer-feedback-2026-10.md section 1.
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp/Civil3D-mcp").replace(/\\/g, "/");
const expect = flag("expect");
const alignment = flag("alignment", "SW 53RD CT");
const style = flag("style", "SAN LAT"), layer = flag("layer", "C-ROAD-TEXT"), marker = flag("marker", "_No Markers");
if (!expect) die('usage: node c300-native-sanlat-labels.mjs --expect "<open drawing name>" [--alignment "<name>"] [--spec labels.json] [--dry-run] [--replace-mleaders] [--no-save]');

// Default text of the SAN LAT style (read from the live style, 2026-10-29); only the INV value changes.
const STA = "<[Station Value(Uft|FS|P2|RN|Sn|OF|AP|B2|TP|EN|W0|DZY)]>";
const OFF = "<[Offset(Uft|P2|RN|AP|SD|OF)]>";
const SIDE = "<[Station Offset Side(CU)]>";
const overrideText = (title, inv) => `${[...title, `INV: ${inv}'`, `STA: ${STA}/OFF: ${OFF}' ${SIDE}`].join("\\P")}`;

process.env.CIVIL3D_LOG_LEVEL ??= "warn";
const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const norm = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.dwg$/i, "").toLowerCase();

await withApplicationConnection(async (client) => {
  const active = ((await client.sendCommand("listOpenDocuments", {})).documents ?? []).find((d) => d.isActive);
  if (!active) die("no active drawing");
  if (norm(active.filePath ?? active.name) !== norm(expect)) die(`active drawing is "${basename(active.filePath ?? active.name)}", expected "${expect}": nothing changed`);
  // several copies of the same drawing can be open (lab copy, Downloads, project folder): --path pins the exact file
  if (flag("path") && String(active.filePath ?? "").replace(/\\/g, "/").toLowerCase() !== flag("path").replace(/\\/g, "/").toLowerCase()) die(`active file is ${active.filePath}, expected ${flag("path")}: nothing changed`);
  const toPoint = async (station, offset) => await client.sendCommand("alignmentStationToPoint", { name: alignment, station, offset });
  const toStation = async (x, y) => await client.sendCommand("alignmentPointToStation", { name: alignment, x, y });

  // 1. what to create
  const items = [];
  if (flag("spec")) {
    for (const s of JSON.parse(readFileSync(flag("spec"), "utf8"))) {
      const off = Math.abs(Number(s.offset)) * ((s.side ?? (s.offset < 0 ? "L" : "R")) === "L" ? -1 : 1);
      items.push({ station: Number(s.station), offset: off, inv: Number(s.inv), title: s.title ?? ['PROP 8"x6" SAN LAT CONNECTION', "(SEE NOTE ON THIS SHEET)"], labelLocation: s.labelLocation, mleader: null });
    }
  } else {
    const ents = ((await client.sendCommand("listTextEntities", { space: "model", contains: "SAN LAT CONNECTION", limit: 500 })).entities ?? []).filter((e) => e.entityType === "MLeader");
    for (const e of ents) {
      const lines = e.text.split("\\P");
      const inv = /INV:\s*(-?[\d.]+)/.exec(e.text)?.[1];
      const sta = /STA:\s*(\d+)\+([\d.]+)\s*\/\s*OFF:\s*([\d.]+)'?\s*([LR])?/.exec(e.text);
      if (inv === undefined || !sta) continue;
      const station = Number(sta[1]) * 100 + Number(sta[2]);
      if (!sta[4]) { items.push({ skip: `no L/R in "${e.text.slice(-30)}"`, handle: e.handle }); continue; }
      const offset = Number(sta[3]) * (sta[4] === "L" ? -1 : 1);
      let pt;
      try { pt = await toPoint(station, offset); } catch { items.push({ skip: "station outside the alignment", handle: e.handle }); continue; }
      // plan callouts sit within ~60 ft of their point; profile-view copies are hundreds of thousands of feet away
      const near = pt.x >= e.minX - 80 && pt.x <= e.maxX + 80 && pt.y >= e.minY - 80 && pt.y <= e.maxY + 80;
      if (!near) { items.push({ skip: "not a plan callout (profile view copy)", handle: e.handle }); continue; }
      items.push({ station, offset, inv: Number(inv), title: lines.slice(0, lines.findIndex((l) => l.startsWith("INV:"))), labelLocation: { x: e.x, y: e.y }, mleader: e.handle, point: pt });
    }
  }
  const todo = items.filter((i) => !i.skip);
  for (const i of items.filter((x) => x.skip)) console.log(`  skip ${i.handle}: ${i.skip}`);
  if (!todo.length) die("nothing to create (no SAN LAT CONNECTION plan callouts found)");

  // 2. exact fixed point + round-trip check
  for (const i of todo) {
    i.point ??= await toPoint(i.station, i.offset);
    const back = await toStation(i.point.x, i.point.y);
    i.roundTrip = Math.abs(back.station - i.station) < 0.011 && Math.abs(Math.abs(back.offset) - Math.abs(i.offset)) < 0.011 && Math.sign(back.offset) === Math.sign(i.offset);
    console.log(`  STA ${i.station.toFixed(2)} OFF ${Math.abs(i.offset).toFixed(2)} ${i.offset < 0 ? "L" : "R"}  INV ${i.inv}  point (${i.point.x.toFixed(2)}, ${i.point.y.toFixed(2)})  ${i.roundTrip ? "ok" : "ROUND-TRIP MISMATCH"}${i.mleader ? `  <- MLeader ${i.mleader}` : ""}`);
  }
  if (todo.some((i) => !i.roundTrip)) die("round-trip mismatch: nothing created");
  if (has("dry-run")) { console.log(`DRY RUN: ${todo.length} native ${style} labels would be created on ${alignment}`); return; }

  // 3. create (idempotent per alignment + point)
  let ok = 0, fail = 0; const handles = [];
  for (const i of todo) {
    const spec = { type: "StationOffsetLabel", style, alignmentName: alignment, markerStyle: marker, layer, location: { x: i.point.x, y: i.point.y },
      overrides: [{ index: 0, text: overrideText(i.title, i.inv.toFixed(2)) }] };
    if (i.labelLocation) spec.labelLocation = i.labelLocation;
    const r = await client.sendCommand("profileViewApplyAnnotations", { labels: [spec] });
    if (r.failedLabels) { fail++; console.error(`  FAIL STA ${i.station}: ${r.labels?.[0]?.error}`); continue; }
    ok++; i.label = r.labels[0].handle; handles.push(i.label);
  }
  console.log(`native labels: ${ok} created/updated, ${fail} failed (${handles.join(", ")})`);
  if (fail) die("some labels failed: Multileaders kept, drawing not saved");

  // 4. read back
  const live = ((await client.sendCommand("profileViewAnnotations", {})).planLabels ?? []).filter((l) => l.type === "StationOffsetLabel" && l.style === style && l.alignmentName === alignment);
  const missing = handles.filter((h) => !live.some((l) => String(l.handle) === String(h)));
  if (missing.length) die(`labels not found when reading back: ${missing.join(", ")}`);
  console.log(`read back: ${live.length} ${style} label(s) on ${alignment}`);

  if (has("replace-mleaders")) {
    const gone = todo.map((i) => i.mleader).filter(Boolean);
    if (gone.length) { await client.sendCommand("eraseEntities", { handles: gone }); console.log(`erased ${gone.length} converted Multileaders: ${gone.join(", ")}`); }
  }
  if (!has("no-save")) { await client.sendCommand("saveDrawing", {}); console.log("saved"); }
  console.log("next: view-capture / plot, check STA/OFF/INV on the sheet, then base-pdf-refresh.mjs; orange 'i' on these labels is expected (LABELOVERRIDEGLYPHS, screen only).");
});
