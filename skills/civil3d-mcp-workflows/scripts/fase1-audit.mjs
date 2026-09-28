#!/usr/bin/env node
// FASE 1 audit (READ-ONLY): checks the drawing that is open in Civil 3D against the firm's "Fase 1 = existing conditions only"
// rule (references/c300-water-sewer-plan.md §9). Talks to the plugin directly (like plugin-rpc.mjs), never writes.
//
//   node fase1-audit.mjs [--dump <dwg-dump.txt>] [--repo C:/Users/camil/OneDrive/Documents/Civil3D-mcp] [--alignment-style "BCC - ALIGNMENT"]
//
// Checks (FAIL = must fix before delivering, WARN = look at it, OK):
//   1. layouts: only Model + C-300 (no C-301 / profile sheet)
//   2. no PROP / PROPOSED text or MLeader in Model space; paper-space MD-WASD standard notes are reported as INFO only
//   3. no pressure networks, no profile views (they are fase 3 design)
//   4. every alignment uses the firm style (default "BCC - ALIGNMENT")  -> fix: civil3d_alignment set_style
//   5. EG surface boundary hidden: layer C-TINN-BNDY frozen. The plugin cannot read layer state, so pass --dump (dwg-dump.ps1 output
//      of the SAVED file) to verify it; without --dump it is a WARN reminder when a surface exists.
// Exit code 1 if any FAIL.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const repo = flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp";
const wantedStyle = flag("alignment-style") ?? "BCC - ALIGNMENT";
const dumpPath = flag("dump");

const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const rows = [];
const add = (level, what, detail = "") => rows.push({ level, what, detail });

async function call(client, method, params = {}) {
  try { return await client.sendCommand(method, params); }
  catch (e) { return { __error: e instanceof Error ? e.message : String(e) }; }
}

await withApplicationConnection(async (client) => {
  // 1. layouts
  const lay = await call(client, "listLayouts", {});
  const names = (lay.layouts ?? []).map((l) => l.name);
  const extra = names.filter((n) => n !== "Model" && n !== "C-300");
  if (lay.__error) add("WARN", "layouts", lay.__error);
  else if (!names.includes("C-300")) add("FAIL", "layouts", `no C-300 layout (found: ${names.join(", ")})`);
  else if (extra.length) add("FAIL", "layouts", `extra layouts ${extra.join(", ")} (fase 1 = Model + C-300 only) -> acad_layout delete_layout`);
  else add("OK", "layouts", names.join(", "));

  // 2. PROP text
  const txt = await call(client, "listTextEntities", { space: "all", limit: 500 });
  if (txt.__error) add("WARN", "text scan", txt.__error);
  else {
    const strip = (t) => String(t ?? "").replace(/\\P/g, " ").replace(/\\[A-Za-z][^;\\]*;/g, "").replace(/[{}]/g, "");
    const isProp = (t) => /\bPROP\b|\bPROPOSED\b/i.test(strip(t));
    const model = (txt.entities ?? []).filter((e) => e.space === "model" && isProp(e.text));
    const paper = (txt.entities ?? []).filter((e) => e.space === "paper" && isProp(e.text));
    if (model.length) {
      add("FAIL", "PROP text in Model", `${model.length} item(s): ` + model.slice(0, 12).map((e) => `${e.handle}:${strip(e.text).slice(0, 40)}`).join(" | ") + (model.length > 12 ? " …" : ""));
    } else add("OK", "PROP text in Model", "none");
    if (paper.length) add("FAIL", "PROP/PROPOSED wording in paper space", `${paper.length} note MText(s) (${paper.map((e) => e.layout + ":" + e.handle).join(", ")}) -> node scripts/fase1-strip-prop-notes.mjs on the MD-WASD notes + acad_update_text_content; erase off-sheet template notes that say PROP/PROPOSED`);
  }

  // 3. design objects
  const pres = await call(client, "listPressureNetworks", {});
  if (pres.__error) add("WARN", "pressure networks", pres.__error);
  else if ((pres.networks ?? []).length) add("FAIL", "pressure networks", `${pres.networks.map((n) => n.name).join(", ")} -> civil3d_pressure_network_delete`);
  else add("OK", "pressure networks", "none");

  const pv = await call(client, "profileViewInfo", {});
  if (pv.__error) add("WARN", "profile views", pv.__error);
  else if ((pv.profileViews ?? []).length) add("FAIL", "profile views", `${pv.profileViews.map((v) => v.profileViewName).join(" | ")} -> acad_erase_entities`);
  else add("OK", "profile views", "none");

  const pn = await call(client, "listPipeNetworks", {});
  if (pn.__error) add("WARN", "gravity pipe networks", `cannot list (${pn.__error}); an empty shell like "PROP SAN SEWER" may remain -> civil3d_pipe_network_delete {name}`);
  else if ((pn.networks ?? []).length) add("FAIL", "gravity pipe networks", `${pn.networks.map((n) => n.name).join(", ")} -> civil3d_pipe_network_delete`);
  else add("OK", "gravity pipe networks", "none");

  // 4. alignment style
  const al = await call(client, "listAlignments", {});
  if (al.__error) add("WARN", "alignments", al.__error);
  else {
    for (const a of al.alignments ?? []) {
      const g = await call(client, "getAlignment", { name: a.name });
      const style = g.style ?? "?";
      if (String(style).toLowerCase() === wantedStyle.toLowerCase()) add("OK", `alignment ${a.name}`, `style ${style}`);
      else add("FAIL", `alignment ${a.name}`, `style "${style}" != "${wantedStyle}" -> civil3d_alignment set_style {name:"${a.name}", style:"${wantedStyle}"}`);
    }
    if (!(al.alignments ?? []).length) add("WARN", "alignments", "none in the drawing");
  }

  // 5. surface boundary
  const sf = await call(client, "listSurfaces", {});
  const hasSurface = !sf.__error && (sf.surfaces ?? []).length > 0;
  if (hasSurface) {
    if (dumpPath) {
      const line = readFileSync(dumpPath, "utf8").split(/\r?\n/).find((l) => l.startsWith("LAYER|C-TINN-BNDY|"));
      const flags = Number(/fl=(\d+)/.exec(line ?? "")?.[1] ?? 0);
      if (!line) add("WARN", "surface boundary", "layer C-TINN-BNDY not in the dump");
      else if (flags & 1) add("OK", "surface boundary", "C-TINN-BNDY is frozen (saved file)");
      else add("FAIL", "surface boundary", "C-TINN-BNDY not frozen: the green EG boundary shows -> acad_create_or_update_layer {name:\"C-TINN-BNDY\", frozen:true}");
    } else add("WARN", "surface boundary", `surface(s) ${sf.surfaces.map((s) => s.name).join(", ")} present: make sure layer C-TINN-BNDY is frozen (pass --dump <dwg-dump.ps1 output of the saved file> to check)`);
  } else add("OK", "surface boundary", "no surface in the drawing");
});

const order = { FAIL: 0, WARN: 1, INFO: 2, OK: 3 };
rows.sort((a, b) => order[a.level] - order[b.level]);
for (const r of rows) console.log(`${r.level.padEnd(4)}  ${r.what}${r.detail ? "  —  " + r.detail : ""}`);
const fails = rows.filter((r) => r.level === "FAIL").length;
console.log(fails ? `\nFASE 1 audit: ${fails} FAIL` : "\nFASE 1 audit: no FAIL");
process.exitCode = fails ? 1 : 0;
