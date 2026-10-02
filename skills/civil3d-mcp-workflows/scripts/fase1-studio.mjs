#!/usr/bin/env node
// FASE 1 STUDIO: local web app (127.0.0.1, no dependencies) over the Fase 1 engine. Stage 2 + 3 of the "Fase 1 desde cero" plan.
//   node fase1-studio.mjs [--port 8765] [--root "<...>\AUTOCAD @XEREFT"] [--open]
// What it does (every step is an existing script; nothing here re-implements them):
//   TABLERO     every project under the root (project-state.mjs list) + what each one has/misses + "audit all" (fase1-batch.mjs, headless)
//   _ENTRADA    optional inbox <root>\_ENTRADA\<NAME>\ : drop the 3 DWG + POC.pdf + scans there (or drag them into the page) -> "Crear proyecto"
//               (classifies the DWGs by their layers, new-project.mjs: folders, xrefs, template, project.json, POC, Property Appraiser)
//   PROYECTO    checklist + drag & drop (DWG classified, scans -> scans\, POC) + buttons: POC, Property Appraiser, prepare (spec),
//               scans (scan-ocr -> asbuilt-extract -> asbuilt-associate -> asbuilt-review.py page embedded; YOU confirm; upload the
//               confirmed JSON -> asbuilt-build -> asbuilt.json) and BUILD (fase1-from-scratch.mjs, a NEW throwaway name each time;
//               --deliver only with the explicit checkbox + a name that does not exist)
// Safety: listens on 127.0.0.1 only, every request needs the random token printed at start, project dirs must live under --root,
// one job at a time (Civil 3D is single-threaded), uploads never overwrite (a numbered copy is written), the build refuses to start
// when the Civil 3D plugin (port 8080) does not answer. As-built numbers only enter a drawing through YOUR confirmation.
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, copyFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const here = dirname(fileURLToPath(import.meta.url));
const ps = await import(pathToFileURL(join(here, "project-state.mjs")).href);
const ROOT = resolve((flag("root") ?? ps.DEFAULT_ROOT));
const PORT = Number(flag("port") ?? 8765);
const TOKEN = crypto.randomBytes(12).toString("hex");
const STUDIO_TMP = join(tmpdir(), "c3d-studio");
const INBOX = join(ROOT, "_ENTRADA");
const node = process.execPath;
const slugOf = (dir) => basename(resolve(dir)).replace(/[^\w\-]/g, "_");
const win = (p) => resolve(p).replace(/\//g, "\\");
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const underRoot = (p) => { const r = resolve(p).toLowerCase(), b = ROOT.toLowerCase(); return r === b || r.startsWith(b + sep); };
const safeDir = (d) => { if (!d || !underRoot(d) || !existsSync(d)) throw Object.assign(new Error(`folder outside the root or missing: ${d}`), { status: 400 }); return resolve(d); };
const listDir = (d, re) => (existsSync(d) ? readdirSync(d).filter((x) => re.test(x)) : []);
const nextFree = (dir, name) => { if (!existsSync(join(dir, name))) return name; const e = extname(name), b = name.slice(0, -e.length); for (let i = 2; ; i++) if (!existsSync(join(dir, `${b} (${i})${e}`))) return `${b} (${i})${e}`; };

// ---------------------------------------------------------------- jobs (one at a time, polled log)
const job = { id: 0, label: "", log: "", running: false, code: null, started: 0 };
function startJob(label, fn) {
  if (job.running) throw Object.assign(new Error(`a job is already running: ${job.label}`), { status: 409 });
  Object.assign(job, { id: job.id + 1, label, log: "", running: true, code: null, started: Date.now() });
  const id = job.id;
  const say = (s) => { if (job.id === id) job.log += s.endsWith("\n") ? s : s + "\n"; };
  const run = (cmd, a, opts = {}) => new Promise((res) => {
    say(`\n$ ${[cmd === node ? "node" : cmd, ...a].map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" ")}`);
    const c = spawn(cmd, a, { env: { ...process.env, PYTHONIOENCODING: "utf-8" }, windowsHide: true, ...opts });
    let out = "";
    const feed = (b) => { const s = b.toString("utf8"); out += s; if (job.id === id) job.log += s; };
    c.stdout.on("data", feed); c.stderr.on("data", feed);
    c.on("error", (e) => { say(`ERROR ${e.message}`); res({ code: 1, out }); });
    c.on("close", (code) => res({ code: code ?? 1, out }));
  });
  (async () => {
    try { const r = await fn({ say, run }); job.code = r === false ? 1 : 0; }
    catch (e) { say(`FAILED: ${e.message}`); job.code = 1; }
    job.running = false; say(`\n== ${job.code === 0 ? "DONE" : "STOPPED (see above)"} ==`);
  })();
  return id;
}
const sc = (name) => join(here, name);
const portOpen = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }); const done = (v) => { s.destroy(); res(v); }; s.setTimeout(1200, () => done(false)); s.on("connect", () => done(true)); s.on("error", () => done(false)); });

// ---------------------------------------------------------------- project inspection
function inspect(dir) {
  const pj = readJson(join(dir, "project.json"));
  const has = (n) => existsSync(join(dir, n));
  const scans = [...listDir(dir, /\.tiff?$/i), ...listDir(join(dir, "scans"), /\.(tiff?|png)$/i).map((x) => `scans/${x}`)];
  const pdfs = [...listDir(dir, /\.pdf$/i), ...listDir(join(dir, "docs"), /\.pdf$/i).map((x) => `docs/${x}`)];
  const pocRef = pj?.sources?.poc && existsSync(pj.sources.poc) ? pj.sources.poc : null;
  const poc = pocRef ?? (pdfs.find((x) => /poc/i.test(x)) ? join(dir, pdfs.find((x) => /poc/i.test(x))) : null);
  const builds = listDir(dir, /FASE1-BUILD.*\.dwg$/i);
  const templates = listDir(dir, /^_template.*\.dwg$/i);
  const blocksFrom = pj?.sources?.blocksFrom ? resolve(dir, pj.sources.blocksFrom) : null;
  const slug = slugOf(dir);
  const dwgs = { topo: has("X-TOPO.dwg"), util: has("X-UTIL.dwg"), arch: has("X-ARCH.dwg") };
  const items = [
    { id: "dwgs", label: "X-TOPO + X-UTIL + X-ARCH", ok: dwgs.topo && dwgs.util && dwgs.arch, detail: Object.entries(dwgs).filter(([, v]) => !v).map(([k]) => `falta ${k.toUpperCase()}`).join(", ") || "los 3" },
    { id: "project", label: "project.json", ok: !!pj, detail: pj ? `${pj.status ?? ""} fase ${pj.phase ?? "?"}` : "no existe (crear desde _ENTRADA)" },
    { id: "poc", label: "POC leído (GPD, AGR, folio)", ok: !!(pj?.sources?.pocData || pj?.subject?.gpd), detail: poc ? basename(poc) : "sin POC.pdf" },
    { id: "pa", label: "Property Appraiser (folio, P.B./PG)", ok: !!(pj?.subject?.folio && pj?.subject?.pb), detail: pj?.subject?.folio ? `${pj.subject.folio} · ${pj.subject.pb ?? "sin P.B."}` : "pendiente" },
    { id: "lot", label: "Punto del lote (site.lotPoint)", ok: !!pj?.site?.lotPoint, detail: pj?.site?.lotPoint ? pj.site.lotPoint.map((v) => Number(v).toFixed(1)).join(", ") : "falta (lo llena el Property Appraiser o lo escribes)" },
    { id: "addr", label: "Dirección del sitio (title block y rótulo)", ok: !!pj?.subject?.address, detail: pj?.subject?.address ?? "falta: escríbela en Ajustes (el POC a veces trae otra dirección)" },
    { id: "ids", label: "N.º de proyecto + AGR (title block)", ok: !!(pj?.projectNo && pj?.agrNo), detail: `${pj?.projectNo ?? "?"} · AGR ${pj?.agrNo ?? "?"}` },
    { id: "scans", label: "Escaneos de as-builts", ok: scans.length > 0, detail: scans.length ? scans.join(", ") : "ninguno (sin ellos no hay rótulos de utilidades)", soft: true },
    { id: "asbuilt", label: "asbuilt.json confirmado", ok: has("asbuilt.json"), detail: has("asbuilt.json") ? "listo" : "falta (leer escaneos → revisar → confirmar)", soft: true },
    { id: "template", label: "Plantilla (_template*.dwg)", ok: templates.length > 0, detail: templates.join(", ") || "falta" },
    { id: "blocks", label: "Bloques EXIST ARROW/FH (sources.blocksFrom)", ok: !!(blocksFrom && existsSync(blocksFrom)), detail: blocksFrom ? basename(blocksFrom) : "C-300 de un paquete anterior", soft: true },
  ];
  const next = items.find((i) => !i.ok && !i.soft) ?? items.find((i) => !i.ok);
  return { dir, slug, name: pj?.name ?? basename(dir), status: pj?.status ?? "—", phase: pj?.phase ?? null, projectNo: pj?.projectNo, agrNo: pj?.agrNo, subject: pj?.subject ?? {}, address: pj?.subject?.address ?? "", site: pj?.site ?? {},
    deliverable: pj?.deliverables?.dwg && has(pj.deliverables.dwg) ? pj.deliverables.dwg : null, lastAudit: pj?.lastVerified?.audit ?? null, items, next: next?.id ?? null, ready: items.every((i) => i.ok || i.soft),
    scans, builds, templates, poc, hasAsbuilt: has("asbuilt.json"), blocksFrom, review: existsSync(join(STUDIO_TMP, slug, "review.html")) };
}
function listProjects() {
  const r = spawnSync(node, [sc("project-state.mjs"), "list", "--root", ROOT, "--json"], { encoding: "utf8" });
  let rows = []; try { rows = JSON.parse(r.stdout); } catch { /* none */ }
  return rows.map((p) => { const i = inspect(resolve(p.dir)); return { dir: i.dir, name: i.name, status: i.status, phase: i.phase, audit: i.lastAudit, deliverable: i.deliverable, ok: i.items.filter((x) => x.ok).length, total: i.items.length, next: i.items.find((x) => x.id === i.next)?.label ?? null, ready: i.ready, builds: i.builds.length, scans: i.scans.length, asbuilt: i.hasAsbuilt }; });
}
function listInbox() {
  if (!existsSync(INBOX)) return [];
  return readdirSync(INBOX).filter((n) => statSync(join(INBOX, n)).isDirectory()).map((n) => {
    const d = join(INBOX, n);
    const created = existsSync(join(ROOT, `${n.toUpperCase()} @XEREFT`, "project.json")) || existsSync(join(ROOT, n, "project.json"));
    return { name: n, files: readdirSync(d).filter((f) => statSync(join(d, f)).isFile()), created };
  });
}

// ---------------------------------------------------------------- DWG classification by layers (dwg-dump.ps1 on a %TEMP% copy)
function classifyDwg(file, say = () => {}) {
  const out = join(STUDIO_TMP, "classify"); mkdirSync(out, { recursive: true });
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", sc("dwg-dump.ps1"), file, "-OutDir", out], { encoding: "utf8", timeout: 600000 });
  const dump = (r.stdout ?? "").trim().split(/\r?\n/).pop();
  if (!dump || !existsSync(dump)) { say(`  ${basename(file)}: dump failed`); return { kind: "unknown", why: "dump failed" }; }
  const text = readFileSync(dump, "utf8");
  const own = [...text.matchAll(/^LAYER\|([^|]+)\|/gm)].map((m) => m[1]).filter((n) => !n.includes("|") && !/^(0|Defpoints)$/i.test(n));
  const ents = [...text.matchAll(/^ENT\|[^|]*\|[^|]*\|([^|]*)\|/gm)].map((m) => m[1]);
  const byName = /util/i.test(basename(file)) ? "util" : /arch/i.test(basename(file)) ? "arch" : /topo|survey/i.test(basename(file)) ? "topo" : null;
  // Entities decide, layer names only break ties: the survey also DEFINES an empty X-ARCH layer, and X-UTIL/X-ARCH carry the survey as an xref.
  const count = (re) => ents.filter((n) => re.test(n)).length;
  const topoN = count(/^(ELEVATIONS|PROPERTY_LINE|CENTER_LINE|IMPROVEMENTS|HATCH_.*|SYMBOLS|TEXT)$/i), utilN = count(/^X-UTIL/i), archN = count(/^X-ARCH/i);
  let kind = "unknown", why = "";
  if (topoN >= 20) { kind = "topo"; why = `${topoN} entidades de survey (ELEVATIONS, PROPERTY_LINE, ...)`; }
  else if (utilN > 0) { kind = "util"; why = `${utilN} entidades en capas X-UTIL-*`; }
  else if (archN > 0 || (own.some((n) => /^X-ARCH/i.test(n)) && ents.length < 20)) { kind = "arch"; why = "capa X-ARCH, sin survey ni utilidades propias"; }
  if (kind === "unknown" && byName) { kind = byName; why = "por el nombre del archivo"; }
  else if (byName && byName !== kind) why += ` (¡el nombre sugiere ${byName}!)`;
  say(`  ${basename(file)} -> ${kind.toUpperCase()}  [${why}]`);
  return { kind, why };
}

// ---------------------------------------------------------------- jobs by kind
const prepareSteps = async ({ run, say }, dir) => {
  mkdirSync(join(STUDIO_TMP, slugOf(dir)), { recursive: true });
  const r = await run(node, [sc("fase1-build-payload.mjs"), "--dir", dir, "--no-template", "--no-pl", "--no-labels", "--out", join(STUDIO_TMP, slugOf(dir), "prepare-payload.json")]);
  return r.code === 0;
};
const specOf = (dir) => readJson(join(tmpdir(), "c3d-fase1-build", slugOf(dir), "spec.json"));

function jobScans(dir) {
  return startJob(`Leer escaneos · ${basename(dir)}`, async ({ run, say }) => {
    const slug = slugOf(dir), work = join(STUDIO_TMP, slug, "scan"); mkdirSync(work, { recursive: true });
    const scans = inspect(dir).scans.map((s) => join(dir, s));
    if (!scans.length) { say("No hay escaneos (.tif) en la carpeta del proyecto ni en scans\\."); return false; }
    if (!existsSync(join(dir, "X-UTIL.dwg"))) { say("Falta X-UTIL.dwg"); return false; }
    mkdirSync(join(STUDIO_TMP, slug), { recursive: true });
    if (!specOf(dir) && !(await prepareSteps({ run, say }, dir))) return false;
    const d = await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", sc("dwg-dump.ps1"), join(dir, "X-UTIL.dwg"), "-OutDir", work]);
    const utilDump = d.out.trim().split(/\r?\n/).pop();
    if (d.code !== 0 || !existsSync(utilDump)) { say("dwg-dump de X-UTIL falló"); return false; }
    const assocs = [];
    for (const scan of scans) {
      const base = basename(scan).replace(/\.[^.]+$/, "");
      const ocr = join(work, `${base}.ocr.json`), draft = join(work, `${base}.draft.json`), assoc = join(work, `${base}.assoc.json`);
      if ((await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", sc("scan-ocr.ps1"), "-Image", scan, "-Out", ocr])).code !== 0) return false;
      if ((await run(node, [sc("asbuilt-extract.mjs"), "--ocr", ocr, "--out", draft])).code !== 0) return false;
      // second OCR pass per incomplete manhole callout (names, RIM, misread digits); a failure only means the user types more in the review
      const reocr = join(work, `${base}.reocr.json`);
      if ((await run("python", [sc("asbuilt-reocr.py"), "--draft", draft, "--out", reocr, "--ocr", ocr])).code === 0) {
        if ((await run(node, [sc("asbuilt-extract.mjs"), "--ocr", ocr, "--reocr", reocr, "--out", draft])).code !== 0) say("(la segunda lectura no se pudo fusionar: se usa la primera)");
      } else say("(segunda lectura OCR omitida)");
      if ((await run(node, [sc("asbuilt-associate.mjs"), "--draft", draft, "--util", utilDump, "--out", assoc])).code !== 0) return false;
      assocs.push(assoc);
    }
    const review = join(STUDIO_TMP, slug, "review.html");
    const r = await run("python", [sc("asbuilt-review.py"), ...assocs.flatMap((a) => ["--assoc", a]), "--util", utilDump, "--out", review]);
    if (r.code === 0) say("\nListo: abre la tarjeta «Revisar as-builts» → «Abrir revisión», confirma fila por fila, Exportar, y sube el archivo exportado (asbuilt.confirmed.json).");
    return r.code === 0;
  });
}
function jobAsbuilt(dir, confirmed) {
  return startJob(`as-builts → asbuilt.json · ${basename(dir)}`, async ({ run, say }) => {
    const slug = slugOf(dir), work = join(STUDIO_TMP, slug, "scan");
    const assocs = listDir(work, /\.assoc\.json$/i).map((f) => join(work, f));
    const utilDump = listDir(work, /X-UTIL.*_dump\.txt$/i).map((f) => join(work, f))[0];
    if (!assocs.length || !utilDump) { say("Primero corre «Leer escaneos»."); return false; }
    const spec = specOf(dir); if (!spec) { say("Falta el spec (corre «Preparar»)."); return false; }
    const refs = assocs.map((a) => basename(a).replace(/\.assoc\.json$/, ""));
    const sewer = refs.find((r) => /^ES/i.test(r)), water = refs.find((r) => /^E(?!S)/i.test(r));
    const out = join(dir, "asbuilt.json");
    if (existsSync(out)) { mkdirSync(join(dir, "_backup"), { recursive: true }); copyFileSync(out, join(dir, "_backup", `asbuilt.${Date.now()}.json`)); say("(copia de asbuilt.json anterior en _backup)"); }
    const r = await run(node, [sc("asbuilt-build.mjs"), "--confirmed", confirmed, ...assocs.flatMap((a) => ["--assoc", a]), "--util", utilDump, "--frontage", String(spec.twist.streetAngleDegrees),
      ...(sewer ? ["--sewer-ref", sewer] : []), ...(water ? ["--water-ref", water] : []), "--out", out]);
    return r.code === 0;
  });
}
function jobBuild(dir, o) {
  return startJob(`${o.dryRun ? "Simulación de " : ""}Construir Fase 1 · ${basename(dir)}`, async ({ run, say }) => {
    const i = inspect(dir);
    if (!i.ready && !o.force) { say("Faltan datos obligatorios:\n" + i.items.filter((x) => !x.ok && !x.soft).map((x) => ` - ${x.label}: ${x.detail}`).join("\n")); return false; }
    if (!o.dryRun && !(await portOpen(8080))) { say("Civil 3D no responde en el puerto 8080: ábrelo (con el plugin cargado, sin dibujo abierto) y vuelve a intentar."); return false; }
    const template = o.template ? join(dir, o.template) : join(dir, i.templates[0] ?? "_template.dwg");
    if (!existsSync(template)) { say(`Falta la plantilla ${template}`); return false; }
    const n = Math.max(0, ...i.builds.map((b) => Number(/TEST(\d+)/i.exec(b)?.[1] ?? 0))) + 1;
    const dwg = o.deliver ? o.dwg : `${i.name} @XEREFT FASE1-BUILD-TEST${n}.dwg`;
    if (!dwg) { say("Falta el nombre del archivo."); return false; }
    if (existsSync(join(dir, dwg))) { say(`${dwg} ya existe: el runner no construye sobre archivos existentes.`); return false; }
    const a = [sc("fase1-from-scratch.mjs"), "--dir", dir, "--dwg", dwg, "--template", template];
    if (i.hasAsbuilt) a.push("--asbuilt", join(dir, "asbuilt.json"));
    if (i.blocksFrom && existsSync(i.blocksFrom)) a.push("--blocks-from", i.blocksFrom);
    if (o.deliver) a.push("--deliver"); if (o.dryRun) a.push("--dry-run");
    say(`Destino: ${dwg}`);
    const r = await run(node, a, { cwd: here });
    if (r.code === 0 && !o.dryRun) say(`\nResultado: ${dwg} (el plot queda en %TEMP%\\c3d-dwg-dump\\plot; usa «Ver último plot»).`);
    return r.code === 0;
  });
}
function jobNewProject(name, o) {
  return startJob(`Crear proyecto ${name}`, async ({ run, say }) => {
    const inbox = join(INBOX, name);
    if (!existsSync(inbox)) { say(`No existe ${inbox}`); return false; }
    const files = readdirSync(inbox).filter((f) => statSync(join(inbox, f)).isFile());
    const pick = {}; const note = [];
    say("Clasificando los DWG por sus capas...");
    for (const f of files.filter((x) => /\.dwg$/i.test(x))) { const c = classifyDwg(join(inbox, f), say); if (c.kind !== "unknown" && !pick[c.kind]) pick[c.kind] = join(inbox, f); else note.push(`${f}: ${c.kind === "unknown" ? "no se pudo clasificar" : "duplicado de " + c.kind}`); }
    if (note.length) say("Sin usar: " + note.join("; "));
    const missing = ["topo", "util", "arch"].filter((k) => !pick[k]);
    if (missing.length) { say(`Faltan en la bandeja: ${missing.join(", ")} (arrástralos o cámbiales el nombre a X-TOPO/X-UTIL/X-ARCH).`); return false; }
    const poc = files.find((f) => /poc.*\.pdf$/i.test(f) || /^poc/i.test(f));
    const a = [sc("new-project.mjs"), "--name", o.projectName || name, "--root", ROOT, "--topo", pick.topo, "--util", pick.util, "--arch", pick.arch];
    if (o.projectNo) a.push("--project-no", o.projectNo); if (o.agr) a.push("--agr", o.agr); if (poc) a.push("--poc", join(inbox, poc));
    if (o.templateFrom) a.push("--template-from", o.templateFrom); if (o.xy) a.push("--xy", o.xy);
    const r = await run(node, a);
    if (r.code === 0) {
      const dir = join(ROOT, `${(o.projectName || name).toUpperCase()} @XEREFT`);
      for (const f of files.filter((x) => /\.(tiff?)$/i.test(x))) { mkdirSync(join(dir, "scans"), { recursive: true }); copyFileSync(join(inbox, f), join(dir, "scans", f)); say(`scan copiado: scans\\${f}`); }
      say(`\nProyecto creado: ${dir}`);
    }
    return r.code === 0;
  });
}

// ---------------------------------------------------------------- HTTP
const MIME = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".json": "application/json", ".js": "text/javascript" };
const body = (req) => new Promise((res, rej) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c).toString("utf8"))); req.on("error", rej); });
const sendJson = (res, obj, status = 200) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
const uiHtml = () => readFileSync(join(here, "fase1-studio.html"), "utf8").replace("__TOKEN__", TOKEN);

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(403); return res.end("forbidden host"); }
    const u = new URL(req.url, `http://${host}`);
    if (req.headers["x-token"] !== TOKEN && u.searchParams.get("t") !== TOKEN) { res.writeHead(403); return res.end("token required: open the URL printed by fase1-studio.mjs"); }
    const p = u.pathname, q = (k) => u.searchParams.get(k);
    if (p === "/") { res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" }); return res.end(uiHtml()); }
    if (p === "/api/projects") return sendJson(res, { root: ROOT, projects: listProjects(), inbox: listInbox(), plugin: await portOpen(8080) });
    if (p === "/api/project") return sendJson(res, { ...inspect(safeDir(q("dir"))), plugin: await portOpen(8080) });
    if (p === "/api/paarea") { const dir = safeDir(q("dir")); const f = readJson(join(dir, "project.json"))?.site?.paArea?.file; if (!f || !existsSync(f)) throw Object.assign(new Error("run «Lotes del área» first"), { status: 404 }); const rep = readJson(f); return sendJson(res, { ...rep, lots: (rep.lots ?? []).map(({ ring, ...l }) => l) }); }
    if (p === "/api/job") { const from = Number(q("from") ?? 0); return sendJson(res, { id: job.id, label: job.label, running: job.running, code: job.code, text: job.log.slice(from), next: job.log.length, seconds: Math.round((Date.now() - job.started) / 1000) }); }
    if (p === "/api/upload" && req.method === "POST") {                       // raw body = file; ?dir=<project> or ?inbox=<NAME>&name=<file>
      const name = basename(q("name") ?? "").replace(/[<>:"|?*]/g, "_"); if (!name) throw Object.assign(new Error("name required"), { status: 400 });
      let destDir, rel = name;
      if (q("inbox")) { destDir = join(INBOX, basename(q("inbox")).replace(/[<>:"|?*\\/]/g, "_")); }
      else {
        const dir = safeDir(q("dir")); const ext = extname(name).toLowerCase();
        if (ext === ".dwg") destDir = null; else if ([".tif", ".tiff", ".png"].includes(ext)) destDir = join(dir, "scans"); else if (ext === ".pdf") destDir = /poc/i.test(name) ? dir : join(dir, "docs"); else destDir = join(dir, "docs");
        if (destDir === null) {                                              // a DWG dropped on a project: classify, then store as X-*.dwg (never over an existing one)
          const tmp = join(STUDIO_TMP, "incoming"); mkdirSync(tmp, { recursive: true }); const tf = join(tmp, name);
          await new Promise((ok, no) => { const w = createWriteStream(tf); req.pipe(w); w.on("finish", ok); w.on("error", no); });
          const c = classifyDwg(tf); const target = { topo: "X-TOPO.dwg", util: "X-UTIL.dwg", arch: "X-ARCH.dwg" }[c.kind];
          if (!target) return sendJson(res, { ok: false, kind: "unknown", message: `${name}: no pude saber si es TOPO/UTIL/ARCH (${c.why}). Renómbralo a X-TOPO.dwg, X-UTIL.dwg o X-ARCH.dwg y vuelve a arrastrarlo.` });
          const final = nextFree(dir, target); copyFileSync(tf, join(dir, final));
          return sendJson(res, { ok: true, kind: c.kind, saved: final, message: `${name} → ${final} (${c.why})${final !== target ? "  ¡ya existía " + target + "; no lo toqué!" : ""}` });
        }
      }
      mkdirSync(destDir, { recursive: true }); const final = nextFree(destDir, name), tmpPath = join(destDir, `.${final}.part`);
      await new Promise((ok, no) => { const w = createWriteStream(tmpPath); req.pipe(w); w.on("finish", ok); w.on("error", no); });
      renameSync(tmpPath, join(destDir, final));
      return sendJson(res, { ok: true, saved: final, message: `${name} → ${join(destDir, final)}` });
    }
    if (p === "/api/confirmed" && req.method === "POST") {                   // the review sheet's export, uploaded back
      const dir = safeDir(q("dir")); const txt = await body(req); let j; try { j = JSON.parse(txt); } catch { throw Object.assign(new Error("that file is not JSON"), { status: 400 }); }
      if (!j || typeof j !== "object") throw Object.assign(new Error("unexpected content"), { status: 400 });
      const f = join(STUDIO_TMP, slugOf(dir), "asbuilt.confirmed.json"); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(j));
      return sendJson(res, { id: jobAsbuilt(dir, f) });
    }
    if (p === "/api/run" && req.method === "POST") {
      const o = JSON.parse((await body(req)) || "{}"); const kind = o.kind;
      if (kind === "batch") return sendJson(res, { id: startJob("Auditar todos (sin Civil 3D)", async ({ run }) => (await run(node, [sc("fase1-batch.mjs"), "--root", ROOT, "--report", "--reuse-dump"])).code === 0) });
      if (kind === "newproject") return sendJson(res, { id: jobNewProject(basename(String(o.name)), o) });
      const dir = safeDir(o.dir);
      if (kind === "poc") { const i = inspect(dir); if (!i.poc) throw Object.assign(new Error("no hay POC.pdf (arrástralo a la página)"), { status: 400 }); return sendJson(res, { id: startJob("Leer POC", async ({ run }) => (await run(node, [sc("poc-extract.mjs"), i.poc, "--project", dir])).code === 0) }); }
      if (kind === "pa") return sendJson(res, { id: startJob("Property Appraiser", async ({ run }) => (await run(node, [sc("pa-site.mjs"), "--dir", dir, "--write", ...(o.xy ? ["--xy", String(o.xy)] : [])])).code === 0) });
      if (kind === "paarea") return sendJson(res, { id: startJob("Lotes del área (Property Appraiser)", async ({ run }) => (await run(node, [sc("pa-area.mjs"), "--dir", dir, "--write", ...(o.near ? ["--near", String(o.near)] : [])])).code === 0) });
      if (kind === "prepare") return sendJson(res, { id: startJob("Preparar (X-TOPO → spec)", async (c) => prepareSteps(c, dir)) });
      if (kind === "template") { const src = String(o.source ?? ""); if (!existsSync(src)) throw Object.assign(new Error(`no existe: ${src}`), { status: 400 }); if (existsSync(join(dir, "_template.dwg"))) throw Object.assign(new Error("_template.dwg ya existe (no se sobrescribe)"), { status: 409 });
        return sendJson(res, { id: startJob("Crear plantilla", async ({ run }) => (await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", sc("c300-prep-template.ps1"), "-Source", src, "-Out", join(dir, "_template.dwg"), "-DeleteLayouts", "C-301"])).code === 0) }); }
      if (kind === "scans") return sendJson(res, { id: jobScans(dir) });
      if (kind === "build") return sendJson(res, { id: jobBuild(dir, o) });
      if (kind === "set") { const sets = Object.entries(o.values ?? {}).filter(([k]) => /^[\w.]+$/.test(k)).map(([k, v]) => `${k}=${v}`); return sendJson(res, { id: startJob("Guardar ajustes", async ({ run }) => (await run(node, [sc("project-state.mjs"), "set", dir, ...sets])).code === 0) }); }
      throw Object.assign(new Error(`unknown job ${kind}`), { status: 400 });
    }
    if (p === "/api/preview") {                                              // latest plotted C-300 PDF -> PNG
      const base = join(tmpdir(), "c3d-dwg-dump", "plot");
      const pdfs = existsSync(base) ? readdirSync(base).map((d) => join(base, d, "c300.pdf")).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs) : [];
      if (!pdfs.length) throw Object.assign(new Error("no plot yet"), { status: 404 });
      mkdirSync(STUDIO_TMP, { recursive: true }); const png = join(STUDIO_TMP, "preview.png");
      const r = spawnSync("python", [sc("studio-preview.py"), pdfs[0], png], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`preview failed: ${(r.stderr ?? "").slice(-200)}`);
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }); return createReadStream(png).pipe(res);
    }
    if (p === "/review") {                                                    // embedded as-built review sheet
      const f = join(STUDIO_TMP, slugOf(safeDir(q("dir"))), "review.html"); if (!existsSync(f)) throw Object.assign(new Error("run «Leer escaneos» first"), { status: 404 });
      res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" }); return createReadStream(f).pipe(res);
    }
    res.writeHead(404); res.end("not found");
  } catch (e) { sendJson(res, { error: e.message }, e.status ?? 500); }
});
server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;
  console.log(`Fase 1 Studio  ${url}\nroot ${ROOT}\n(Ctrl+C para cerrar)`);
  if (args.includes("--open")) spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
});
