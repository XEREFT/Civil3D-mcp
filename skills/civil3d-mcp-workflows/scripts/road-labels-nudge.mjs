#!/usr/bin/env node
// PDF-VERIFIED NUDGE for the native EOP / EXIST R/W labels (the self-correcting half of the visual signature): plots the saved BASE drawing, finds where the PRINTED
// text of a native label overlaps other printed text (fase1-qc.py "overlap" clashes: survey titles, rotated block names, dimensions...), and moves the WHOLE ROW of
// that label one step further out (+STEP ft along its push axis) so rows stay aligned; repeats until the plot has no such overlap (max --rounds).
//   node road-labels-nudge.mjs --dwg "<...\<Name> @xereft base.dwg>" [--rounds 3] [--step 8] [--repo <Civil3D-mcp>]
// Needs the drawing ACTIVE in Civil 3D (plan labels are read/moved through the plugin) and saved. Updates the drawing (saved) but not the PDF: run base-pdf-refresh.mjs after.
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const die = (m) => { console.error(m); process.exit(2); };
const here = dirname(fileURLToPath(import.meta.url));
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp/Civil3D-mcp").replace(/\\/g, "/");
const dwg = flag("dwg") ? resolve(flag("dwg")) : die('usage: node road-labels-nudge.mjs --dwg "<...\\<Name> @xereft base.dwg>" [--rounds 3] [--step 8]');
const rounds = Number(flag("rounds", 3)), STEP = Number(flag("step", 8));
const qcJson = join(tmpdir(), `c3d-nudge-${basename(dwg).replace(/[^\w\-]/g, "_")}.json`);
process.env.CIVIL3D_LOG_LEVEL ??= "warn";
const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const norm = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.dwg$/i, "").toLowerCase();
const OURS = new Set(["EXIST", "R/W", "EOP"]);
const spec = JSON.parse(readFileSync(join(flag("work") ?? die("--work <build work dir with spec.json> is required"), "spec.json"), "utf8"));
const ctr = [spec.twist.centerX, spec.twist.centerY];

const tries = new Map();                                              // handle -> how many rounds it still overlapped
for (let round = 1; round <= rounds; round++) {
  const reuse = args.includes("--reuse-qc") && round === 1 && existsSync(qcJson);   // fase1-finish may leave ANOTHER document active: activate the drawing, then pass --reuse-qc
  const r = reuse ? { stdout: "", stderr: "" } : spawnSync(process.execPath, [join(here, "fase1-finish.mjs"), "--dwg", dwg, "--no-copy", "--qc-json", qcJson], { encoding: "utf8", timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
  if (!existsSync(qcJson)) die(`QC did not produce ${qcJson}: ${(r.stdout + r.stderr).slice(-300)}`);
  const q = JSON.parse(readFileSync(qcJson, "utf8"));
  const f = q.ft_per_pt, [vx0, vy0, vx1, vy1] = q.view_rect, cx = (vx0 + vx1) / 2, cy = (vy0 + vy1) / 2;
  // overlap clashes where one word is ours (EXIST / R/W / EOP); fase1-qc.py reports the owning label handle in `owners` (native labels included)
  const spots = [];
  for (const c of q.clashes ?? []) {
    if (c.kind !== "overlap") continue;
    c.words.forEach((w, i) => { if (OURS.has(String(w).trim()) && c.rects?.[i]) spots.push({ rect: c.rects[i], owner: c.owners?.[i] ?? null }); });
  }
  console.log(`round ${round}: ${spots.length} printed overlap(s) on native labels`);
  if (!spots.length || args.includes("--dry")) break;                       // --dry: report only
  await withApplicationConnection(async (client) => {
    const active = ((await client.sendCommand("listOpenDocuments", {})).documents ?? []).find((d) => d.isActive);
    if (!active || norm(active.filePath ?? active.name) !== norm(dwg)) die(`active drawing is not ${basename(dwg)}`);
    const live = ((await client.sendCommand("profileViewAnnotations", {})).planLabels ?? []).filter((l) => l.type === "NoteLabel" && l.labelLocation);
    // sheet frame: right = ux, up = uy (c300-road-labels.mjs); the PDF spot is relative to the viewport centre, a label's model point relative to spec.twist centre
    const ux = [q.ux, q.uy], uy = [-q.uy, q.ux];
    const sheetOf = (p) => { const d = [p.x - ctr[0], p.y - ctr[1]]; return [d[0] * ux[0] + d[1] * ux[1], d[0] * uy[0] + d[1] * uy[1]]; };
    const hits = new Set();
    for (const { rect: rc, owner } of spots) {
      if (owner && live.some((l) => String(l.handle) === String(owner))) { hits.add(owner); console.log(`  spot owned by ${owner}`); continue; }
      const [sx, sy] = [((rc[0] + rc[2]) / 2 - cx) * f, (cy - (rc[1] + rc[3]) / 2) * f];
      // nearest label TEXT BOX (not anchor): text sits right of a vertical leader / on the push side of a horizontal one; left-side text ends at its location
      let best = null;
      for (const l of live) {
        const s = sheetOf(l.labelLocation), a = sheetOf(l.anchor), n = l.style === "EOP" ? 3 : 9, w = 1.45 * n, h = 2.4;
        const vertical = Math.abs(s[1] - a[1]) >= Math.abs(s[0] - a[0]), right = vertical ? s[0] - a[0] >= -0.05 : s[0] - a[0] >= 0;
        const x0 = right ? s[0] : s[0] - w, dx = Math.max(x0 - sx, 0, sx - (x0 + w)), dy = Math.max(s[1] - h / 2 - sy, 0, sy - (s[1] + h / 2));
        const d = Math.hypot(dx, dy);
        if (!best || d < best.d) best = { l, d };
      }
      console.log(`  spot (${sx.toFixed(1)}, ${sy.toFixed(1)}) -> ${best?.l.style} ${best?.l.handle} at ${best?.d.toFixed(1)} ft`);
      if (best && best.d < 4) hits.add(best.l.handle);
    }
    console.log(`  labels involved: ${[...hits].join(", ")}`);
    const moved = new Set();
    for (const h of hits) {
      const L = live.find((x) => String(x.handle) === String(h)); if (!L) continue;
      const s = sheetOf(L.labelLocation), a = sheetOf(L.anchor), vertical = Math.abs(s[1] - a[1]) >= Math.abs(s[0] - a[0]);
      const ax = vertical ? 1 : 0, sgn = Math.sign(s[ax] - a[ax]) || 1;
      const n = (tries.get(h) ?? 0) + 1; tries.set(h, n);
      if (vertical && n >= 2) {                                         // pushing further did not clear it (text runs along a street name): flip to the other side of the leader, short push
        const sideNow = Math.sign(s[0] - a[0]) || 1, ns = [a[0] - sideNow * 1.5, a[1] + sgn * 8], d = [ns[0] - s[0], ns[1] - s[1]];
        const loc = { x: L.labelLocation.x + ux[0] * d[0] + uy[0] * d[1], y: L.labelLocation.y + ux[1] * d[0] + uy[1] * d[1] };
        await client.sendCommand("profileViewApplyAnnotations", { labels: [{ type: L.type, style: L.style, layer: L.layer, anchor: L.anchor, labelLocation: loc, dragged: true }] });
        moved.add(L.handle); console.log(`  ${L.handle}: flipped to the ${sideNow > 0 ? "left" : "right"} side of its leader`);
        continue;
      }
      for (const m of live) {                                          // the whole row: same style, same orientation/side, text line within 0.5 ft
        const ms = sheetOf(m.labelLocation), ma = sheetOf(m.anchor), mv = Math.abs(ms[1] - ma[1]) >= Math.abs(ms[0] - ma[0]);
        if (m.style !== L.style || mv !== vertical || (Math.sign(ms[ax] - ma[ax]) || 1) !== sgn || Math.abs(ms[ax] - s[ax]) > 0.5 || moved.has(m.handle)) continue;
        moved.add(m.handle);
        const dxm = vertical ? uy : ux, k = sgn * STEP;                 // model displacement of one step along the sheet push axis
        const loc = { x: m.labelLocation.x + dxm[0] * k, y: m.labelLocation.y + dxm[1] * k };
        await client.sendCommand("profileViewApplyAnnotations", { labels: [{ type: m.type, style: m.style, layer: m.layer, anchor: m.anchor, labelLocation: loc, dragged: true }] });
      }
    }
    console.log(`  moved ${moved.size} label(s) one step (${STEP} ft) further out`);
    if (moved.size) await client.sendCommand("saveDrawing", { overwrite: true });
  });
}
