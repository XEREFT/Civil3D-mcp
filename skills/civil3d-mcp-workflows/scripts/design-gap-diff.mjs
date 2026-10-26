#!/usr/bin/env node
// Compare DWG fingerprints produced by dwg-fingerprint.ps1 (TAB-separated .tsv).
// Usage:
//   node design-gap-diff.mjs --summary A.tsv [--json]            what one drawing contains
//   node design-gap-diff.mjs A.tsv B.tsv [--json] [--label A,B]   what B has that A lacks and vice versa
//   node design-gap-diff.mjs --texts A.tsv [--layout NAME]        every annotation string (model + paper)
//   node design-gap-diff.mjs --selftest
// A = reference (designer / target), B = ours, by convention. Layer names of xrefs keep their "XREF|" prefix;
// diffs strip the prefix so X-TOPO|FOO in one host matches X-TOPO|FOO in another.
import { readFileSync } from "node:fs";

const TEXT_TYPES = new Set(["TEXT", "MTEXT", "MULTILEADER", "DIMENSION"]);

export function parseFp(raw) {
  const fp = { sys: {}, xrefs: [], layers: {}, ltypes: [], tstyles: {}, dstyles: {}, mlstyles: [], blocks: {}, views: [], ents: [], vports: [], layouts: [] };
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const c = line.split("\t");
    const kv = (from) => Object.fromEntries(c.slice(from).map((s) => { const i = s.indexOf("="); return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; }));
    switch (c[0]) {
      case "SYS": fp.sys[c[1]] = c[2]; break;
      case "XREF": fp.xrefs.push({ name: c[1], path: c[2], ...kv(3) }); break;
      case "LAYER": fp.layers[c[1]] = kv(2); break;
      case "LTYPE": fp.ltypes.push(c[1]); break;
      case "TSTYLE": fp.tstyles[c[1]] = kv(2); break;
      case "DSTYLE": fp.dstyles[c[1]] = kv(2); break;
      case "MLSTYLE": fp.mlstyles.push(c[1]); break;
      case "BLOCK": fp.blocks[c[1]] = kv(2); break;
      case "VIEW": fp.views.push(c[1]); break;
      case "VPORT": fp.vports.push({ layout: c[1], ...kv(2) }); break;
      case "LAYOUT": fp.layouts.push({ name: c[1], ...kv(2) }); break;
      case "ENT": fp.ents.push({ space: c[1], type: c[2], handle: c[3], layer: c[4], ...kv(5) }); break;
    }
  }
  return fp;
}

const count = (arr, keyFn) => arr.reduce((m, x) => { const k = keyFn(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const normText = (t) => (t || "")
  .replace(/\\[A-Za-z][^;\\]*;/g, "").replace(/\\P/g, " ").replace(/[{}]/g, "").replace(/%%[cCdDpP]/g, "")
  .replace(/^LEADER\{.*?CONTEXT_DATA\{.*$/s, "").replace(/\s+/g, " ").trim().toUpperCase();
const isPaper = (e) => e.space !== "Model";

export function summarize(fp) {
  const paperLayouts = fp.layouts.filter((l) => l.name !== "Model").sort((a, b) => +a.tab - +b.tab);
  const texts = fp.ents.filter((e) => TEXT_TYPES.has(e.type));
  const styleUse = count(texts, (e) => `${e.type}:${e.style || "-"}:h=${e.h || "-"}`);
  const inserts = count(fp.ents.filter((e) => e.type === "INSERT"), (e) => `${e.space}:${e.block}`);
  return {
    sys: fp.sys,
    xrefs: fp.xrefs.map((x) => `${x.name} -> ${x.path} (resolved=${x.resolved})`),
    layouts: paperLayouts.map((l) => ({ ...l, vports: fp.vports.filter((v) => v.layout === l.name && v.status !== "0").map((v) => ({ h: v.h, scale: v.scale, w: v.w, ht: v.ht, twist: v.twist, frozen: v.frozen ? v.frozen.split(";").filter(Boolean).length : 0 })) })),
    counts: { layers: Object.keys(fp.layers).length, ownLayers: Object.keys(fp.layers).filter((n) => !n.includes("|")).length, ents: fp.ents.length, blocks: Object.keys(fp.blocks).length, tstyles: Object.keys(fp.tstyles).length, dstyles: Object.keys(fp.dstyles).length },
    entsBySpaceType: count(fp.ents, (e) => `${e.space}:${e.type}`),
    entsByLayer: Object.fromEntries(Object.entries(count(fp.ents, (e) => `${e.space === "Model" ? "M" : "P"}:${e.layer}`)).sort((a, b) => b[1] - a[1])),
    textStyleUse: styleUse,
    inserts,
    mlstyles: fp.mlstyles,
  };
}

const stripX = (n) => n; // keep full names; xref prefix is meaningful (X-TOPO|...)
function layerDiff(a, b) {
  const out = { onlyA: [], onlyB: [], changed: [] };
  for (const n of Object.keys(a.layers)) if (!(n in b.layers)) out.onlyA.push(n);
  for (const n of Object.keys(b.layers)) if (!(n in a.layers)) out.onlyB.push(n);
  for (const n of Object.keys(a.layers)) {
    if (!(n in b.layers)) continue;
    const pa = a.layers[n], pb = b.layers[n], d = {};
    for (const k of ["c", "lt", "fl", "lw", "plot", "tc"]) if ((pa[k] || "") !== (pb[k] || "")) d[k] = `${pa[k]} -> ${pb[k]}`;
    if (Object.keys(d).length) out.changed.push({ layer: stripX(n), ...d });
  }
  return out;
}

function mapDelta(ma, mb) {
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  const rows = [];
  for (const k of keys) { const x = ma[k] || 0, y = mb[k] || 0; if (x !== y) rows.push({ key: k, A: x, B: y, delta: y - x }); }
  return rows.sort((r, s) => Math.abs(s.delta) - Math.abs(r.delta));
}

export function textSet(fp, filter = () => true) {
  const m = new Map();
  for (const e of fp.ents) {
    if (!TEXT_TYPES.has(e.type) || !filter(e)) continue;
    const t = normText(e.txt);
    if (!t) continue;
    if (!m.has(t)) m.set(t, []);
    m.get(t).push({ space: e.space, type: e.type, layer: e.layer, style: e.style, h: e.h, x: e.x, y: e.y, handle: e.handle });
  }
  return m;
}

export function diff(a, b) {
  const ta = textSet(a), tb = textSet(b);
  const onlyTextA = [...ta.keys()].filter((t) => !tb.has(t)).map((t) => ({ text: t, at: ta.get(t)[0] }));
  const onlyTextB = [...tb.keys()].filter((t) => !ta.has(t)).map((t) => ({ text: t, at: tb.get(t)[0] }));
  const sysD = {};
  for (const k of new Set([...Object.keys(a.sys), ...Object.keys(b.sys)])) if (a.sys[k] !== b.sys[k] && !["EXTMIN", "EXTMAX", "CTAB", "CLAYER"].includes(k)) sysD[k] = `${a.sys[k]} -> ${b.sys[k]}`;
  const lay = (fp) => Object.fromEntries(fp.layouts.map((l) => [l.name, l]));
  const la = lay(a), lb = lay(b), layoutD = [];
  for (const n of new Set([...Object.keys(la), ...Object.keys(lb)])) {
    if (!la[n] || !lb[n]) { layoutD.push({ layout: n, only: la[n] ? "A" : "B" }); continue; }
    const d = {};
    for (const k of ["setup", "device", "paper", "ctb", "pw", "ph", "rot", "ptype", "num", "den"]) if (la[n][k] !== lb[n][k]) d[k] = `${la[n][k]} -> ${lb[n][k]}`;
    if (Object.keys(d).length) layoutD.push({ layout: n, ...d });
  }
  const vp = (fp) => fp.vports.filter((v) => v.status !== "0" && v.status !== "").map((v) => ({ layout: v.layout, scale: v.scale, size: `${(+v.w).toFixed(2)}x${(+v.ht).toFixed(2)}`, twist: v.twist, frozen: (v.frozen || "").split(";").filter(Boolean) }));
  const va = vp(a), vb = vp(b);
  const frozenA = new Set(va.flatMap((v) => v.frozen)), frozenB = new Set(vb.flatMap((v) => v.frozen));
  return {
    sys: sysD,
    xrefs: { A: a.xrefs.map((x) => `${x.name}=${x.path}`), B: b.xrefs.map((x) => `${x.name}=${x.path}`) },
    layouts: layoutD,
    viewports: { A: va.map(({ frozen, ...r }) => ({ ...r, frozen: frozen.length })), B: vb.map(({ frozen, ...r }) => ({ ...r, frozen: frozen.length })),
      frozenOnlyA: [...frozenA].filter((x) => !frozenB.has(x)), frozenOnlyB: [...frozenB].filter((x) => !frozenA.has(x)) },
    layers: layerDiff(a, b),
    tstyles: { onlyA: Object.keys(a.tstyles).filter((n) => !(n in b.tstyles)), onlyB: Object.keys(b.tstyles).filter((n) => !(n in a.tstyles)) },
    dstyles: { onlyA: Object.keys(a.dstyles).filter((n) => !(n in b.dstyles)), onlyB: Object.keys(b.dstyles).filter((n) => !(n in a.dstyles)) },
    mlstyles: { A: a.mlstyles, B: b.mlstyles },
    blocksInserted: mapDelta(count(a.ents.filter((e) => e.type === "INSERT"), (e) => `${isPaper(e) ? "P" : "M"}:${e.block}`), count(b.ents.filter((e) => e.type === "INSERT"), (e) => `${isPaper(e) ? "P" : "M"}:${e.block}`)),
    entsByLayerType: mapDelta(count(a.ents, (e) => `${isPaper(e) ? "P" : "M"}:${e.layer}:${e.type}`), count(b.ents, (e) => `${isPaper(e) ? "P" : "M"}:${e.layer}:${e.type}`)),
    textStyleUse: mapDelta(count(a.ents.filter((e) => TEXT_TYPES.has(e.type)), (e) => `${e.type}:${e.style}:h=${e.h}:${e.layer}`), count(b.ents.filter((e) => TEXT_TYPES.has(e.type)), (e) => `${e.type}:${e.style}:h=${e.h}:${e.layer}`)),
    textsOnlyA: onlyTextA,
    textsOnlyB: onlyTextB,
  };
}

function printable(obj, depth = 0) {
  const pad = "  ".repeat(depth);
  if (Array.isArray(obj)) return obj.length ? obj.map((x) => (typeof x === "object" ? `${pad}- ${JSON.stringify(x)}` : `${pad}- ${x}`)).join("\n") : `${pad}(none)`;
  return Object.entries(obj).map(([k, v]) => (v && typeof v === "object" ? `${pad}${k}:\n${printable(v, depth + 1)}` : `${pad}${k}: ${v}`)).join("\n");
}

function selftest() {
  const A = "SYS\tLTSCALE\t1\nLAYER\tC-PROP\tc=1\tlt=Continuous\tfl=0\tlw=-3\tplot=1\ttc=\nLAYOUT\tC-300\ttab=1\tsetup=\tdevice=DWG To PDF.pc3\tpaper=ARCH_D\nENT\tC-300\tMTEXT\t1A\tC-ANNO\tc=\tx=1\ty=2\tstyle=S\th=0.1\ttxt=EX. 8\" WM\n";
  const B = "SYS\tLTSCALE\t2\nLAYER\tC-PROP\tc=3\tlt=Continuous\tfl=0\tlw=-3\tplot=1\ttc=\nLAYER\tNEW\tc=7\nLAYOUT\tC-300\ttab=1\tsetup=\tdevice=DWG To PDF.pc3\tpaper=ANSI_B\n";
  const d = diff(parseFp(A), parseFp(B));
  const ok = d.sys.LTSCALE === "1 -> 2" && d.layers.onlyB[0] === "NEW" && d.layers.changed[0].c === "1 -> 3" && d.layouts[0].paper === "ARCH_D -> ANSI_B" && d.textsOnlyA[0].text === 'EX. 8" WM';
  console.log(ok ? "selftest OK" : "selftest FAIL " + JSON.stringify(d));
  process.exit(ok ? 0 : 1);
}

const argv = process.argv.slice(2);
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("design-gap-diff.mjs")) {
  const json = argv.includes("--json");
  const files = argv.filter((a, i) => !a.startsWith("--") && !["--layout", "--label"].includes(argv[i - 1]));
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--selftest")) selftest();
  else if (argv.includes("--summary")) {
    const s = summarize(parseFp(readFileSync(files[0], "utf8")));
    console.log(json ? JSON.stringify(s, null, 1) : printable(s));
  } else if (argv.includes("--texts")) {
    const lay = opt("layout");
    const m = textSet(parseFp(readFileSync(files[0], "utf8")), (e) => !lay || e.space === lay);
    const rows = [...m.entries()].map(([t, at]) => ({ text: t, n: at.length, ...at[0] }));
    console.log(json ? JSON.stringify(rows, null, 1) : rows.map((r) => `${r.space}\t${r.type}\t${r.layer}\t${r.style || ""}\th=${r.h || ""}\tx${r.n}\t${r.text}`).join("\n"));
  } else if (files.length === 2) {
    const d = diff(parseFp(readFileSync(files[0], "utf8")), parseFp(readFileSync(files[1], "utf8")));
    console.log(json ? JSON.stringify(d, null, 1) : printable(d));
  } else {
    console.error("usage: design-gap-diff.mjs --summary A.tsv | A.tsv B.tsv | --texts A.tsv [--layout L] | --selftest  [--json]");
    process.exit(2);
  }
}
