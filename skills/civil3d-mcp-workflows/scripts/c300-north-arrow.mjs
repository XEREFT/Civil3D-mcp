#!/usr/bin/env node
// North arrow that matches the viewport twist (design audit 2026-10-25). The template's north arrow is the paper-space block "sna" at rotation 0, but the C-300
// viewport is twisted so the frontage street reads horizontally (VILLA ONE 268.49 deg): with the arrow left at 0 the sheet says north is UP while true north points
// to the right. The designer's own VILLA ONE sheet has this error; Goulds 08-03 (twist 359.1) gets away with it. Rule: arrow rotation = main viewport twist.
//   node c300-north-arrow.mjs --expect "<open drawing name>" [--layout C-300] [--block sna] [--no-save] [--dry-run] [--repo <Civil3D-mcp>]
// Main viewport = the largest model viewport of the layout (the 1:1 title-sheet viewport has twist 0 and no model content of interest). Idempotent.
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp/Civil3D-mcp").replace(/\\/g, "/");
const expect = flag("expect") ?? die('usage: node c300-north-arrow.mjs --expect "<open drawing name>" [--layout C-300] [--block sna] [--no-save] [--dry-run]');
const layout = flag("layout") ?? "C-300", block = flag("block") ?? "sna";

process.env.CIVIL3D_LOG_LEVEL ??= "warn";
const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const norm = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.dwg$/i, "").toLowerCase();
await withApplicationConnection(async (client) => {
  const active = ((await client.sendCommand("listOpenDocuments", {})).documents ?? []).find((d) => d.isActive);
  if (!active) die("no active drawing");
  if (norm(active.filePath ?? active.name) !== norm(expect)) die(`active drawing is "${basename(active.filePath ?? active.name)}", expected "${expect}": nothing changed`);
  const vps = (await client.sendCommand("listViewports", { layout })).viewports ?? [];
  // main viewport = the model viewport at the sheet scale (1"=20'), largest first (the 1:1 overall viewport is the paper-space one)
  const main = vps.filter((v) => !v.isPaperSpaceViewport && (v.customScale ?? 0) < 0.5).sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
  if (!main) die(`no model viewport on ${layout}`);
  const twistRad = Number(main.twistRadians ?? 0);
  const refs = ((await client.sendCommand("listBlockReferences", { contains: block, space: "paper", limit: 200 })).entities ?? [])
    .filter((r) => String(r.blockName).toLowerCase() === block.toLowerCase() && String(r.layout ?? "").toUpperCase() === layout.toUpperCase());
  if (!refs.length) { console.log(`no "${block}" block on ${layout}: nothing to rotate`); return; }
  let changed = 0;
  for (const r of refs) {
    const cur = Number(r.rotation ?? 0);
    const d = Math.abs(((cur - twistRad) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    if (d < 1e-4) { console.log(`  ok   ${r.handle}: already ${(twistRad * 180 / Math.PI).toFixed(4)} deg`); continue; }
    if (has("dry-run")) { console.log(`  plan ${r.handle}: ${(cur * 180 / Math.PI).toFixed(4)} -> ${(twistRad * 180 / Math.PI).toFixed(4)} deg`); continue; }
    await client.sendCommand("updateBlockReference", { handle: r.handle, rotation: twistRad });
    console.log(`  OK   ${r.handle}: ${(cur * 180 / Math.PI).toFixed(4)} -> ${(twistRad * 180 / Math.PI).toFixed(4)} deg (viewport twist)`); changed++;
  }
  if (changed && !has("no-save") && !has("dry-run")) { await client.sendCommand("saveDrawing", { overwrite: true }); console.log("  saved"); }
  console.log(`${changed} north arrow(s) rotated to the viewport twist`);
});
