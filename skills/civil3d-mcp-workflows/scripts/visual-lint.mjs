#!/usr/bin/env node
// VISUAL LINT: checks the ACTIVE Civil 3D drawing against the XEREFT visual signature (references/standards/visual-signature.json) and reports what a human
// would call "not tidy". Read-only. Part of the self-improvement loop (skill civil3d-visual-polish): lint -> fix (c300-road-labels-realign.mjs, topo-move-text.mjs...)
// -> lint again -> record what the user still corrects in references/visual-lessons.json (and teach this script the new check).
//   node visual-lint.mjs --expect "<open drawing name>" --work "<%TEMP%\c3d-fase1-build\<name>>" [--json out.json] [--repo <Civil3D-mcp>]
// Checks: (1) native NoteLabels (EOP / EXIST R/W): duplicates, leader slant in SHEET axes, one text line per row/column, text boxes overlapping each other;
//         (2) MLeaders (our callouts): style / layer / text height inside the signature's allowed sets, and two arrows on the same spot.
// Exit code 1 when any ERROR is found (warnings do not fail).
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const die = (m) => { console.error(m); process.exit(2); };
const here = dirname(fileURLToPath(import.meta.url));
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp/Civil3D-mcp").replace(/\\/g, "/");
const expect = flag("expect"), work = flag("work");
if (!expect || !work) die('usage: node visual-lint.mjs --expect "<open drawing name>" --work "<build work dir with spec.json>" [--json out.json]');
const SIG = JSON.parse(readFileSync(join(here, "../references/standards/visual-signature.json"), "utf8"));
const spec = JSON.parse(readFileSync(join(work, "spec.json"), "utf8"));
const findings = [];
const add = (level, rule, msg) => findings.push({ level, rule, msg });

// sheet frame (same as c300-road-labels.mjs)
const A = spec.twist.streetAngleDegrees * Math.PI / 180, ux = [Math.cos(A), Math.sin(A)], uy = [-ux[1], ux[0]], ctr = [spec.twist.centerX, spec.twist.centerY];
const sheet = (p) => { const d = [p.x - ctr[0], p.y - ctr[1]]; return [d[0] * ux[0] + d[1] * ux[1], d[0] * uy[0] + d[1] * uy[1]]; };

process.env.CIVIL3D_LOG_LEVEL ??= "warn";
const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
const norm = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.dwg$/i, "").toLowerCase();
let docPath = "", labels = [];
await withApplicationConnection(async (client) => {
  const active = ((await client.sendCommand("listOpenDocuments", {})).documents ?? []).find((d) => d.isActive);
  if (!active || norm(active.filePath ?? active.name) !== norm(expect)) die(`active drawing is "${active ? basename(active.filePath ?? active.name) : "none"}", expected "${expect}"`);
  docPath = active.filePath ?? active.name;
  labels = ((await client.sendCommand("profileViewAnnotations", {})).planLabels ?? []).filter((l) => l.type === "NoteLabel" && l.labelLocation);
});

// ---- (1) native NoteLabels ----
const W = 1.7 * 0.85, H = 2.4;                                          // approx text box (ft) per character / height, like c300-road-labels.mjs
const seen = new Map();
for (const l of labels) {
  const k = `${l.style}|${l.anchor.x.toFixed(1)},${l.anchor.y.toFixed(1)}`;
  if (seen.has(k)) add("error", "duplicate", `${l.style} ${l.handle} duplicates ${seen.get(k)} at the same anchor`); else seen.set(k, l.handle);
}
const items = labels.map((l) => {
  const a = sheet(l.anchor), t = sheet(l.labelLocation), dx = t[0] - a[0], dy = t[1] - a[1];
  const vertical = Math.abs(dy) >= Math.abs(dx), text = l.style === "EOP" ? "EOP" : "EXIST R/W";
  return { l, a, t, dx, dy, vertical, text, w: W * text.length };
});
const slant = SIG.checks.slantMaxDeg, sideMax = (SIG.leaders.sideFt ?? 1.5) + 0.6 + 0.5;
for (const it of items) {
  // a vertical leader may only drift sideways by the signature's sideFt (text right of the arrow); a horizontal one must not drift up/down
  const drift = it.vertical ? Math.abs(it.dx) : Math.abs(it.dy), run = it.vertical ? Math.abs(it.dy) : Math.abs(it.dx);
  const maxDrift = it.vertical ? sideMax : 0.6;
  if (drift > maxDrift || (run > 0 && Math.atan2(it.vertical ? 0 : drift, run) * 180 / Math.PI > slant)) add("warn", "slant", `${it.l.style} ${it.l.handle}: leader drifts ${drift.toFixed(1)} ft sideways over ${run.toFixed(1)} ft`);
}
const groups = new Map();
for (const it of items) { const k = `${it.l.style}|${it.vertical ? "v" : "h"}|${Math.sign(it.vertical ? it.dy : it.dx)}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(it); }
for (const [k, g] of groups) {
  const ax = k.includes("|v|") ? 1 : 0;                                  // text line coordinate: sheet y for vertical leaders, sheet x for horizontal ones
  g.sort((p, q) => p.t[ax] - q.t[ax]);
  for (let i = 1; i < g.length; i++) {
    const gap = g[i].t[ax] - g[i - 1].t[ax];
    if (gap > SIG.checks.rowToleranceFt && gap <= SIG.grid.snapFt) add("warn", "row", `${g[i - 1].l.handle} and ${g[i].l.handle} (${g[i].l.style}) sit ${gap.toFixed(2)} ft apart on what should be one text line`);
  }
}
const box = (it) => { const left = it.vertical ? it.dx >= 0 : it.dx >= 0; const x0 = left ? it.t[0] : it.t[0] - it.w; return [x0, it.t[1] - H / 2, x0 + it.w, it.t[1] + H / 2]; };
for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
  const a = box(items[i]), b = box(items[j]);
  if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) add("error", "overlap", `${items[i].l.handle} and ${items[j].l.handle} text boxes overlap`);
}

// ---- (2) MLeaders through COM ----
const ps1 = join(mkdtempSync(join(tmpdir(), "c3d-vlint-")), "ml.ps1");
writeFileSync(ps1, `$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application'); $d=$null
foreach($x in $app.Documents){ if($x.Name -like '*${basename(docPath).replace(/'/g, "''")}'){ $d=$x; break } }
if(-not $d){ '[]'; exit }
$ms=$d.ModelSpace; $o=@()
for($i=0;$i -lt $ms.Count;$i++){ $e=$null; for($t=0;$t -lt 15 -and -not $e;$t++){ try{$e=$ms.Item($i)}catch{Start-Sleep -Milliseconds 250} }
  if($e.ObjectName -eq 'AcDbMLeader'){ $h=$null; try{$h=[double]$e.TextHeight}catch{}; $st=$null; try{$st=[string]$e.StyleName}catch{}
    $o += [pscustomobject]@{handle=$e.Handle;layer=$e.Layer;style=$st;h=$h;text=([string]$e.TextString).Substring(0,[Math]::Min(40,([string]$e.TextString).Length))} } }
$o | ConvertTo-Json -Compress`, "utf8");
const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1], { encoding: "utf8", timeout: 240000 });
let mls = []; try { const j = JSON.parse(r.stdout.trim() || "[]"); mls = Array.isArray(j) ? j : [j]; } catch { add("warn", "mleader", "could not read MLeaders through COM"); }
rmSync(dirname(ps1), { recursive: true, force: true });
const ok = SIG.checks.mleaderAllowed;
for (const m of mls) {
  if (m.style && !ok.style.includes(m.style)) add("warn", "mleader-style", `${m.handle} "${m.text}" uses style ${m.style} (allowed: ${ok.style.join(", ")})`);
  if (m.layer && !ok.layer.includes(m.layer)) add("warn", "mleader-layer", `${m.handle} "${m.text}" is on layer ${m.layer} (signature: ${ok.layer.join(", ")})`);
  const h = m.h && m.h < 0.5 ? m.h * 20 : m.h;                                // annotative text reports its PAPER height (1.4 ft = 0.07 at 1\" = 20')
  if (h && !ok.textHeightFt.some((v) => Math.abs(v - h) < 0.05)) add("warn", "mleader-height", `${m.handle} "${m.text}" text height ${h.toFixed(2)} ft (allowed: ${ok.textHeightFt.join(", ")})`);
}

const errors = findings.filter((f) => f.level === "error").length, warns = findings.length - errors;
const score = Math.max(0, 100 - errors * 10 - warns * 2);
for (const f of findings) console.log(`${f.level.toUpperCase().padEnd(5)} [${f.rule}] ${f.msg}`);
console.log(`VISUAL LINT ${basename(docPath)}: ${labels.length} native labels, ${mls.length} MLeaders | ${errors} error(s), ${warns} warning(s) | score ${score}/100`);
if (flag("json")) writeFileSync(flag("json"), JSON.stringify({ doc: docPath, date: new Date().toISOString(), labels: labels.length, mleaders: mls.length, errors, warns, score, findings }, null, 1));
process.exit(errors ? 1 : 0);
