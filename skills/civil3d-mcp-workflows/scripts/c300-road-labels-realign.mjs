#!/usr/bin/env node
// Re-aligns the EOP / EXIST R/W NoteLabels of the ACTIVE Civil 3D drawing to the tidy grid of c300-road-labels.mjs (vertical/horizontal leaders, one text line per
// row/column, side chosen so the text never sits on survey linework) WITHOUT rebuilding the sheet: the labels are matched by anchor + style and only their
// labelLocation changes (profileViewApplyAnnotations is idempotent: reused:true). Then saves.
//   node c300-road-labels-realign.mjs --work "<%TEMP%\c3d-fase1-build\<name>>" --expect "<open drawing name>" [--no-save] [--dry-run] [--repo <Civil3D-mcp>]
// --work = the folder fase1-from-scratch / fase1-build-payload wrote (needs X-TOPO_dump.txt + spec.json). Same rule for every project; user 2026-10-25.
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const here = dirname(fileURLToPath(import.meta.url));
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp/Civil3D-mcp").replace(/\\/g, "/");
const work = flag("work"), expect = flag("expect");
if (!work || !expect) die('usage: node c300-road-labels-realign.mjs --work <build work dir> --expect "<open drawing name>" [--no-save] [--dry-run]');
for (const f of ["X-TOPO_dump.txt", "spec.json"]) if (!existsSync(join(work, f))) die(`${join(work, f)} not found`);
const out = join(tmpdir(), `c3d-roadlabels-realign-${basename(work).replace(/[^\w\-]/g, "_")}.json`);
const g = spawnSync(process.execPath, [join(here, "c300-road-labels.mjs"), "--topo", join(work, "X-TOPO_dump.txt"), "--spec", join(work, "spec.json"), "--native", "--no-align", "--out", out], { encoding: "utf8" });
if (g.status !== 0) die(`c300-road-labels failed: ${g.stderr || g.stdout}`);
console.log(g.stdout.trim());
const labels = JSON.parse(readFileSync(out, "utf8")).planLabels.filter((l) => l.type === "NoteLabel");
if (has("dry-run")) { console.log(`[dry-run] ${labels.length} labels`); process.exit(0); }

process.env.CIVIL3D_LOG_LEVEL ??= "warn";
const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const norm = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.dwg$/i, "").toLowerCase();
await withApplicationConnection(async (client) => {
  const active = ((await client.sendCommand("listOpenDocuments", {})).documents ?? []).find((d) => d.isActive);
  if (!active) die("no active drawing");
  if (norm(active.filePath ?? active.name) !== norm(expect)) die(`active drawing is "${basename(active.filePath ?? active.name)}", expected "${expect}": nothing changed`);
  let ok = 0, fail = 0;
  // Match each wanted label to the nearest LIVE label of the same style (<= 0.5 ft between anchors): applying with an anchor the live label does not have creates a second label. Live NoteLabels nobody claims are stale: they are reported, never deleted here.
  const live = ((await client.sendCommand("profileViewAnnotations", {})).planLabels ?? []).filter((l) => l.type === "NoteLabel");
  const free = new Set(live.map((l) => String(l.handle)));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const l of labels) {
    const m = live.filter((v) => v.style === l.style && free.has(String(v.handle)) && dist(v.anchor, l.anchor) <= 0.5).sort((a, b) => dist(a.anchor, l.anchor) - dist(b.anchor, l.anchor))[0];
    if (m) free.delete(String(m.handle));
  }
  if (free.size) console.log(`  NOTE ${free.size} live label(s) not claimed by the new set (stale or extra, erase with approval): ${[...free].join(", ")}`);
  for (const l of labels) {
    try {
      const r = await client.sendCommand("profileViewApplyAnnotations", { labels: [{ type: l.type, style: l.style, layer: l.layer, anchor: l.anchor, labelLocation: l.labelLocation, dragged: true }] });
      if (r.failedLabels) throw new Error(r.labels?.[0]?.error ?? "label not applied");
      ok++;
    } catch (e) { fail++; console.log(`  FAIL ${l.style} @ ${l.anchor.x},${l.anchor.y}: ${e instanceof Error ? e.message : e}`); }
  }
  console.log(`${ok}/${labels.length} labels re-aligned${fail ? `, ${fail} failed` : ""}`);
  if (!has("no-save") && ok) { await client.sendCommand("saveDrawing", { overwrite: true }); console.log("saved"); }
});
