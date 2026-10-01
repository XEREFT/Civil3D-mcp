#!/usr/bin/env node
// Applies a fase1-declutter.py plan to the ACTIVE Civil 3D drawing: acad_update_text_content {handle, x, y} per move (the MLeader's TEXT moves, the
// arrow tip stays), then saves. Guards: the active drawing's name must equal --expect, and a drawing whose name ends in "FASE 1.dwg" (the delivered
// file) is refused unless --real is passed (the user's OK is needed for that: first try it on a FASE1-BUILD-TEST copy).
//
//   node fase1-declutter-apply.mjs --plan plan.json --expect "<drawing name>" [--no-save] [--real] [--repo <Civil3D-mcp>]
// NEXT after applying: save is done here; re-plot + QC (fase1-finish.mjs --dwg <dwg> --no-copy) and re-plan until 0 moves: the plugin may
// re-pick a text's anchor side when it moves it, so the box can land elsewhere than planned.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp").replace(/\\/g, "/");
const planPath = flag("plan"), expect = flag("expect");
if (!planPath || !expect) die('usage: node fase1-declutter-apply.mjs --plan plan.json --expect "<open drawing name>" [--no-save] [--real]');
const plan = JSON.parse(readFileSync(planPath, "utf8"));
if (!plan.moves?.length) { console.log("plan has no moves: nothing to do"); process.exit(0); }

process.env.CIVIL3D_LOG_LEVEL ??= "warn";
const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const norm = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.dwg$/i, "").toLowerCase();
await withApplicationConnection(async (client) => {
  const docs = (await client.sendCommand("listOpenDocuments", {})).documents ?? [];
  const active = docs.find((d) => d.isActive);
  if (!active) die("no active drawing");
  if (norm(active.filePath ?? active.name) !== norm(expect)) die(`active drawing is "${basename(active.filePath ?? active.name)}", expected "${expect}": nothing changed`);
  if (/ FASE 1\.dwg$/i.test(active.filePath ?? active.name) && !has("real")) die("refusing the delivered FASE 1.dwg without --real (try a FASE1-BUILD-TEST copy first)");
  let ok = 0;
  for (const m of plan.moves) {
    try {
      await client.sendCommand("updateTextContent", { handle: m.handle, x: m.x, y: m.y });
      console.log(`  OK   ${m.handle}  -> (${m.x}, ${m.y})  ${m.shiftFt} ft  [${m.why}]`); ok++;
    } catch (e) { console.log(`  FAIL ${m.handle}: ${e instanceof Error ? e.message : e}`); }
  }
  if (!has("no-save") && ok) { await client.sendCommand("saveDrawing", { overwrite: true }); console.log("  saved"); }
  console.log(`${ok}/${plan.moves.length} moved. NEXT: node fase1-finish.mjs --dwg "${active.filePath}" --no-copy   (re-plot + QC; re-plan until 0 moves)`);
});
