#!/usr/bin/env node
// FASE 1 cleanup PLANNER (READ-ONLY). For a drawing that already carries fase-2/3 design (proposed networks, profile views,
// laterals, PROP callouts, a C-301 sheet) it lists exactly what to remove to get back to a pure fase 1, as ordered MCP calls.
// It never writes. Claude then executes the plan with ONE approval per step (acad_erase_entities takes the whole handle list).
//
//   node fase1-cleanup-plan.mjs [--repo C:/Users/camil/OneDrive/Documents/Civil3D-mcp] [--out plan.json]
//
// Rules (references/standards/formtech-c300.json -> roles.fase1; VILLA ONE 2026-09-28):
//   1. layouts other than Model / C-300                       -> acad_layout delete_layout
//   2. pressure networks                                       -> civil3d_pressure_network_delete
//   3. gravity network parts (pipes first, then structures)    -> acad_erase_entities   (names come from --networks "PROP SAN SEWER,EXIST WM CROSSING")
//   4. profile views + every Model entity inside their zone    -> acad_erase_entities   (text/MLeaders, dimensions, polylines, blocks)
//   5. proposed StationOffsetLabels (styles SAN LAT / C.O / WATER SERVICE) -> acad_erase_entities
//   6. Model MLeaders/text with PROP outside the profile zone, and geometry on the proposed layers -> acad_erase_entities
//   7. alignments other than the street ones (e.g. FH1: tee -> hydrant) -> civil3d_alignment delete   (reported, name pattern --drop-alignments FH1)
//   8. gravity network shells                                  -> civil3d_pipe_network_delete
//   9. EG surface boundary                                     -> acad_create_or_update_layer {name:"C-TINN-BNDY", frozen:true}
//  10. alignment style                                         -> civil3d_alignment set_style
// Steps 3-6 need the parts' handles: pipes/structures are found with civil3d_pipe get_pipe/get_structure by name (list can fail),
// pass them with --parts "12BF5,12C6A,..." (pipes first). Everything else is discovered here.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const repo = flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp";
const outPath = flag("out");
const networks = (flag("networks") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const parts = (flag("parts") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const dropAlignments = (flag("drop-alignments") ?? "FH1").split(",").map((s) => s.trim()).filter(Boolean);
const proposedLayers = new Set((flag("proposed-layers") ?? "C-SAN,C-WATR-PIPE,V-SITE-FNCE,C-STRM-PROF,C-WATR-PROF").split(",").map((s) => s.trim().toUpperCase()));
const proposedLabelStyles = new Set((flag("proposed-label-styles") ?? "SAN LAT,C.O,WATER SERVICE").split(",").map((s) => s.trim().toUpperCase()));
const alignStyle = flag("alignment-style") ?? "BCC - ALIGNMENT";
// margins (ft) around the profile views that still belong to them (titles, CL/R-W leaders above, dimension rows)
const M = { left: 60, right: 260, below: 80, above: 170 };

const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const call = async (c, m, p = {}) => { try { return await c.sendCommand(m, p); } catch (e) { return { __error: e instanceof Error ? e.message : String(e) }; } };
const plan = [];
const notes = [];
const strip = (t) => String(t ?? "").replace(/\\P/g, " ").replace(/\\[A-Za-z][^;\\]*;/g, "").replace(/[{}]/g, "");

await withApplicationConnection(async (c) => {
  const lay = await call(c, "listLayouts", {});
  for (const l of lay.layouts ?? []) if (l.name !== "Model" && l.name !== "C-300") plan.push({ step: 1, tool: "acad_layout", params: { action: "delete_layout", name: l.name } });

  const pres = await call(c, "listPressureNetworks", {});
  for (const n of pres.networks ?? []) plan.push({ step: 2, tool: "civil3d_pressure_network_delete", params: { name: n.name } });

  const ordered = [];
  const seen = new Set();
  const push = (h) => { if (h && !seen.has(h)) { seen.add(h); ordered.push(h); } };
  parts.forEach(push);

  // profile views and their zone
  const pv = await call(c, "profileViewInfo", {});
  const views = pv.profileViews ?? [];
  const zones = views.map((v) => {
    const x0 = v.location.x, y0 = v.location.y;
    const w = (v.stationEnd - v.stationStart) * (v.xPerStation ?? 1);
    const h = (v.elevationMax - v.elevationMin) * (v.yPerElevation ?? 10);
    return { x1: x0 - M.left, x2: x0 + w + M.right, y1: y0 - M.below, y2: y0 + h + M.above };
  });
  const inZone = (x, y) => zones.some((z) => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2);
  views.forEach((v) => push(v.handle));

  // proposed StationOffsetLabels (plan labels)
  const ann = await call(c, "profileViewAnnotations", {});
  for (const l of ann.planLabels ?? []) if (proposedLabelStyles.has(String(l.style).toUpperCase())) push(l.handle);

  const txt = await call(c, "listTextEntities", { space: "model", limit: 500 });
  for (const e of txt.entities ?? []) {
    if (inZone(e.x, e.y)) push(e.handle);
    else if (/\bPROP\b|\bPROPOSED\b/i.test(strip(e.text)) && e.entityType === "MLeader") push(e.handle);
    else if (/\bPROP\b/i.test(strip(e.text))) notes.push(`DECIDE with the user: ${e.handle} (${e.entityType}, ${e.layer}) "${strip(e.text).slice(0, 60)}"`);
  }
  const dim = await call(c, "listDimensions", {});
  for (const e of dim.entities ?? []) if (inZone(e.textX ?? e.dimLinePoint?.x ?? 0, e.textY ?? e.dimLinePoint?.y ?? 0)) push(e.handle);
  const pl = await call(c, "listPolylineEntities", { space: "model", limit: 500 });
  for (const e of pl.entities ?? []) if (inZone(e.centerX, e.centerY) || proposedLayers.has(String(e.layer).toUpperCase())) push(e.handle);
  const blk = await call(c, "listBlockReferences", { space: "model", limit: 500 });
  for (const e of blk.entities ?? []) if (inZone(e.x ?? e.position?.x ?? 0, e.y ?? e.position?.y ?? 0)) push(e.handle);
  const shp = await call(c, "listShapeEntities", { space: "model", limit: 500 });
  for (const e of shp.entities ?? []) if (inZone(e.centerX ?? e.center?.x ?? 0, e.centerY ?? e.center?.y ?? 0) || proposedLayers.has(String(e.layer).toUpperCase())) push(e.handle);

  for (let i = 0; i < ordered.length; i += 500) plan.push({ step: 3, tool: "acad_erase_entities", params: { handles: ordered.slice(i, i + 500) } });

  const al = await call(c, "listAlignments", {});
  for (const a of al.alignments ?? []) {
    if (dropAlignments.includes(a.name)) plan.push({ step: 7, tool: "civil3d_alignment", params: { action: "delete", name: a.name } });
    else plan.push({ step: 10, tool: "civil3d_alignment", params: { action: "set_style", name: a.name, style: alignStyle } });
  }
  for (const n of networks) plan.push({ step: 8, tool: "civil3d_pipe_network_delete", params: { name: n } });
  const sf = await call(c, "listSurfaces", {});
  if ((sf.surfaces ?? []).length) plan.push({ step: 9, tool: "acad_create_or_update_layer", params: { name: "C-TINN-BNDY", frozen: true }, note: "hides the green EG boundary; never delete the surface" });
});

plan.sort((a, b) => a.step - b.step);
if (!parts.length) notes.push("No --parts given: gravity pipes/structures are NOT in the erase list. Get their handles with civil3d_pipe get_pipe/get_structure (pipes first) and re-run with --parts.");
const result = { plan, notes, counts: Object.fromEntries(plan.map((p) => [p.tool + "#" + p.step, p.params.handles ? p.params.handles.length : 1])) };
if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1).slice(0, 6000));
