#!/usr/bin/env node
// One command for the R/W rule (user 2026-10-26, SEIDENSTEIN): remove every `R/W` mark of the ACTIVE drawing, rebuild them with c300-rw-marks.mjs (corner marks 14 ft from each
// corner + equal ~125 ft rhythm along every R/W run, same offset, white, never overlapping), create them, save. Survey R/W marks must already be hidden (topo-white-rw.mjs --hide).
//
//   node c300-rw-apply.mjs --dump X-TOPO_dump.txt --twist 4.6755 --frame x0,y0,x1,y1 [--box x0,y0,x1,y1] [--extend-config streets.json] [--dry-run] [--no-save] [--end 14] [--spacing 125]
// --extend-config  streets config of c300-rw-extend.mjs: its extension lines (host layer R-W) are marked too
// --frame sheet frame in model coordinates (marks stay fully inside it); --box limits the R/W geometry considered (default: frame grown by 500 ft)
// Only host MLeaders whose text is exactly "R/W" are replaced: "EXIST R/W", "(50' TOTAL R/W)" and "R/W 100.00'" are different labels and stay.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const here = dirname(fileURLToPath(import.meta.url));
if (!flag("dump") || !flag("twist") || !flag("frame")) { console.error("usage: node c300-rw-apply.mjs --dump X-TOPO_dump.txt --twist <rad> --frame x0,y0,x1,y1 [--box ...] [--dry-run] [--no-save]"); process.exit(2); }
const rpc = (method, payload) => {
  const r = spawnSync("node", [join(here, "plugin-rpc.mjs"), method, JSON.stringify(payload)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const t = (r.stdout ?? ""); const i = t.search(/^\{/m);   // skip the "[INFO] Connected {...}" log line
  if (i < 0) throw new Error(`${method}: no JSON (${(r.stderr ?? "").slice(0, 200)})`);
  return JSON.parse(t.slice(i));
};
const docs = rpc("listOpenDocuments", {}).documents ?? [];
const active = docs.find((d) => d.isActive);
console.log(`active drawing: ${active?.name ?? "?"}`);
const frame = flag("frame").split(",").map(Number);
const box = flag("box") ?? [frame[0] - 500, frame[1] - 500, frame[2] + 500, frame[3] + 500].join(",");
const work = mkdtempSync(join(tmpdir(), "rw-apply-"));

const list = () => (rpc("listTextEntities", { space: "model", contains: "R/W", limit: 500 }).entities ?? []).filter((e) => e.entityType === "MLeader" && e.text.trim() === "R/W");
const old = list();
console.log(`existing R/W marks: ${old.length}`);
if (!has("dry-run") && old.length) rpc("eraseEntities", { handles: old.map((e) => e.handle) });
const host = join(work, "host.json");
writeFileSync(host, JSON.stringify(rpc("listTextEntities", { space: "model", limit: 800 })));
const payload = join(work, "payload.json");
let extra = [];
if (flag("extend-config")) {
  const ext = join(work, "extend.json");
  const r = spawnSync("node", [join(here, "c300-rw-extend.mjs"), "--dump", flag("dump"), "--config", flag("extend-config"), "--out", ext], { encoding: "utf8" });
  if (r.status) { console.error(r.stderr); process.exit(1); }
  extra = ["--extra", ext];
}
const gen = spawnSync("node", [join(here, "c300-rw-marks.mjs"), "--dump", flag("dump"), "--host", host, "--twist", flag("twist"), "--box", box, "--frame", flag("frame"), "--out", payload, ...extra,
  ...(flag("end") ? ["--end", flag("end")] : []), ...(flag("spacing") ? ["--spacing", flag("spacing")] : [])], { encoding: "utf8" });
console.log(gen.stdout.trim()); if (gen.status) { console.error(gen.stderr); process.exit(1); }
if (has("dry-run")) { console.log("DRY RUN: nothing erased or created"); process.exit(0); }
const entities = JSON.parse(readFileSync(payload, "utf8")).entities;
if (entities.length) rpc("createEntities", { entities });
if (!has("no-save")) rpc("saveDrawing", {});
console.log(`OK: ${entities.length} R/W marks created${has("no-save") ? "" : " and saved"} (next: base-pdf-refresh.mjs --dir "<BASE folder>", check the PDF)`);
