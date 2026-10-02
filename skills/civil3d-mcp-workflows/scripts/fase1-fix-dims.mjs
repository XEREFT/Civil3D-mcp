#!/usr/bin/env node
// Puts back the text of every C-ANNO aligned dimension whose text sits far from its own line (the short-dimension DIMFIT bug, fase1-audit check #6:
// text farther than max(3 ft, line length) from its line; seen on the 6.00' SAN-WM separation dim on VILLA ONE, FASE 1 and TEST24). The text goes to the
// midpoint of the dimension LINE (midpoint of the two extension points shifted by the line's own perpendicular offset) with acad_update_text_content
// {handle, x, y} (Dimension support since 2026-09-28), then the drawing is saved. Same guards as fase1-declutter-apply.mjs.
//   node fase1-fix-dims.mjs --expect "<open drawing name>" [--no-save] [--real] [--repo <Civil3D-mcp>]
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp").replace(/\\/g, "/");
const expect = flag("expect");
if (!expect) die('usage: node fase1-fix-dims.mjs --expect "<open drawing name>" [--no-save] [--real]');

process.env.CIVIL3D_LOG_LEVEL ??= "warn";
const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const norm = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.dwg$/i, "").toLowerCase();
const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
await withApplicationConnection(async (client) => {
  const active = ((await client.sendCommand("listOpenDocuments", {})).documents ?? []).find((d) => d.isActive);
  if (!active) die("no active drawing");
  if (norm(active.filePath ?? active.name) !== norm(expect)) die(`active drawing is "${basename(active.filePath ?? active.name)}", expected "${expect}": nothing changed`);
  if (/ FASE 1\.dwg$/i.test(active.filePath ?? active.name) && !has("real")) die("refusing the delivered FASE 1.dwg without --real (try a FASE1-BUILD-TEST copy first)");
  const dims = (await client.sendCommand("listDimensions", { layer: "C-ANNO", space: "model", limit: 500 })).entities ?? [];
  let fixed = 0;
  for (const d of dims) {
    const [ax, ay] = d.xLine1Point ?? [], [bx, by] = d.xLine2Point ?? [], [lx, ly] = d.dimLinePoint ?? [];
    if (ax == null || bx == null || lx == null || d.textX == null) continue;
    const len = Math.hypot(bx - ax, by - ay);
    if (distToSegment(d.textX, d.textY, ax, ay, bx, by) <= Math.max(3, len)) continue;
    // the dimension line's own perpendicular offset from the extension points
    const ux = (bx - ax) / (len || 1), uy = (by - ay) / (len || 1), nx = -uy, ny = ux;
    const off = (lx - bx) * nx + (ly - by) * ny;
    const x = (ax + bx) / 2 + nx * off, y = (ay + by) / 2 + ny * off;
    try {
      await client.sendCommand("updateTextContent", { handle: d.handle, x, y });
      console.log(`  OK   ${d.handle} (${d.measurement.toFixed(2)} ft): text -> ${x.toFixed(2)}, ${y.toFixed(2)}`); fixed++;
    } catch (e) { console.log(`  FAIL ${d.handle}: ${e instanceof Error ? e.message : e}`); }
  }
  if (fixed && !has("no-save")) { await client.sendCommand("saveDrawing", { overwrite: true }); console.log("  saved"); }
  console.log(`${fixed} dimension text(s) put back`);
});
