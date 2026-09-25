#!/usr/bin/env node
// Resume salidas grandes de acad_list_* / civil3d_* (JSON persistido en archivo) sin cargarlas al contexto.
// Uso:
//   node summarize-entities.mjs <archivo> [--by layer|colorIndex|entityType|space|layout|blockName] [--contains TXT]
//                               [--layer NAME] [--space model|paper] [--near X,Y,R] [--list N] [--fields a,b,c]
//   node summarize-entities.mjs --station "10+30.52"   |   --station 1030.52
// Sin --by: agrupa por layer y por entityType. --list N muestra N filas compactas (handle, tipo, capa, texto/pos).
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

// --- conversión de estaciones ---
const st = opt("station");
if (st !== undefined) {
  if (st.includes("+")) {
    const [a, b] = st.split("+");
    const v = Number(a) * 100 + Number(b);
    console.log(v.toFixed(2));
  } else {
    const v = Number(st);
    const hundreds = Math.floor(v / 100);
    const rest = (v - hundreds * 100).toFixed(2).padStart(5, "0");
    console.log(`${String(hundreds).padStart(2, "0")}+${rest}`);
  }
  process.exit(0);
}

const file = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--")));
if (!file) {
  console.error("Uso: node summarize-entities.mjs <archivo.json|txt> [--by campo] [--contains TXT] [--list N] ...");
  process.exit(2);
}

// --- parseo tolerante: JSON crudo, envoltorio MCP [{type:'text',text}], o texto con JSON embebido ---
function tryParse(s) { try { return JSON.parse(s); } catch { return undefined; } }
function parseLoose(raw) {
  let v = tryParse(raw);
  if (v === undefined) {
    const start = raw.search(/[\[{]/);
    const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
    if (start >= 0 && end > start) v = tryParse(raw.slice(start, end + 1));
  }
  if (Array.isArray(v) && v.every((c) => c && c.type === "text" && typeof c.text === "string")) {
    const inner = v.map((c) => parseLoose(c.text)).filter((x) => x !== undefined);
    return inner.length === 1 ? inner[0] : inner;
  }
  if (v && typeof v === "object" && Array.isArray(v.content)) return parseLoose(JSON.stringify(v.content));
  return v;
}
const data = parseLoose(readFileSync(file, "utf8"));
if (data === undefined) { console.error("No se pudo extraer JSON del archivo."); process.exit(1); }

// --- encontrar el arreglo de objetos más grande ---
let best = [];
(function walk(node) {
  if (Array.isArray(node)) {
    if (node.length > best.length && node.every((x) => x && typeof x === "object" && !Array.isArray(x))) best = node;
    node.forEach(walk);
  } else if (node && typeof node === "object") Object.values(node).forEach(walk);
})(data);
let rows = best;

// --- filtros ---
const contains = opt("contains")?.toLowerCase();
const layer = opt("layer")?.toLowerCase();
const space = opt("space")?.toLowerCase();
const near = opt("near")?.split(",").map(Number);
const xy = (r) => [r.x ?? r.centerX ?? r.startX ?? r.minX, r.y ?? r.centerY ?? r.startY ?? r.minY];
rows = rows.filter((r) => {
  if (contains && !JSON.stringify(r).toLowerCase().includes(contains)) return false;
  if (layer && String(r.layer ?? "").toLowerCase() !== layer) return false;
  if (space && String(r.space ?? "").toLowerCase() !== space) return false;
  if (near) { const [x, y] = xy(r); if (x === undefined || Math.hypot(x - near[0], y - near[1]) > near[2]) return false; }
  return true;
});

console.log(`Filas: ${rows.length} (de ${best.length})`);
const group = (field) => {
  const m = new Map();
  for (const r of rows) { const k = String(r[field] ?? "∅"); m.set(k, (m.get(k) ?? 0) + 1); }
  const sorted = [...m].sort((a, b) => b[1] - a[1]);
  console.log(`\nPor ${field} (${sorted.length} valores):`);
  for (const [k, n] of sorted.slice(0, 40)) console.log(`  ${String(n).padStart(6)}  ${k}`);
  if (sorted.length > 40) console.log(`  … ${sorted.length - 40} más`);
};
const by = opt("by");
if (by) group(by); else { if (rows.some((r) => "layer" in r)) group("layer"); if (rows.some((r) => "entityType" in r)) group("entityType"); }

const n = Number(opt("list") ?? 0);
if (n > 0) {
  const fields = opt("fields")?.split(",");
  console.log(`\nPrimeras ${Math.min(n, rows.length)} filas:`);
  for (const r of rows.slice(0, n)) {
    if (fields) { console.log("  " + fields.map((f) => `${f}=${JSON.stringify(r[f])}`).join(" | ")); continue; }
    const [x, y] = xy(r);
    const label = r.text ?? r.blockName ?? r.name ?? "";
    const pos = x !== undefined ? `@${Number(x).toFixed(2)},${Number(y).toFixed(2)}` : "";
    console.log(`  ${r.handle ?? "-"} | ${r.entityType ?? r.type ?? ""} | ${r.layer ?? ""} | ${r.space ?? ""} ${pos} | ${String(label).replace(/\\P/g, " ¶ ").replace(/\t/g, "⇥").replace(/\s+/g, " ").slice(0, 140)}`);
  }
}
