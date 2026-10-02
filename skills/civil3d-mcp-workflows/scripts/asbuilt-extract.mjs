#!/usr/bin/env node
// AS-BUILT EXTRACT: turns the OCR of a scanned WASD as-built (scan-ocr.ps1 JSON) into a DRAFT of features with drawing coordinates.
//   node asbuilt-extract.mjs --ocr <scan.ocr.json> [--out <draft.json>] [--max-residual 1.0]
// The scans are NOT uniformly scaled (VILLA ONE: 6.47 vs 4.07 px/ft), so nothing is placed by image position. Instead, as the user
// suggested ("comparar las líneas principales, como la baseline"), every callout is located by its BASELINE STATION + OFFSET:
//   1. OCR text is normalised where it must be numeric (O->0, l/I->1, Z->% , lost decimal point in N/E, stray letters).
//   2. Lines are grouped into callout columns (same left edge, consecutive rows; a fragment on the same row to the right, e.g. "(R)",
//      is appended to its row) and split into items: description / STA x+yy B / n' O/S (R|L) / N … / E … / RIM / INV / pipe.
//   3. Items that print BOTH a station+offset and N/E are anchors. Per baseline letter, a similarity transform
//      (station, signed offset) -> (E, N) is fitted by least squares; scale must stay ~1 and each anchor's leave-one-out residual is
//      reported. Items with only station+offset get computed N/E (source "computed"); printed N/E always win (source "printed").
// Output: { scan, baselines:[{letter, anchors, scale, rotationDeg, maxResidualFt}], items:[{kind, text, sta, baseline, offset, side,
// N, E, source, rim, inv, pipe, slope, box, issues}] }. It is a DRAFT: every value still goes through the user's review table
// (as-builts are always scans; never use an unconfirmed OCR number). Node 18+, no deps.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const ocrPath = flag("ocr");
if (!ocrPath) { console.error("usage: node asbuilt-extract.mjs --ocr <scan.ocr.json> [--out draft.json] [--max-residual 1.0]"); process.exit(2); }
const maxResidual = Number(flag("max-residual") ?? 1.0);
const ocr = JSON.parse(readFileSync(ocrPath, "utf8").replace(/^﻿/, ""));

// ---------- 1. normalisation ----------
/** Characters OCR confuses with digits; only applied inside numeric-looking tokens. */
const DIGITISH = { O: "0", o: "0", D: "0", Q: "0", "ô": "6", "ó": "6", l: "1", I: "1", i: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2", z: "2" };
export function fixNumber(raw) {
  // keep digits, dot, sign; map look-alikes; collapse "1 1" inside a number (OCR splits "11")
  let t = String(raw).trim().replace(/\s+(?=\d)/g, "");
  t = t.replace(/[OoDQôólIi|SsBZz]/g, (c) => DIGITISH[c] ?? c);
  t = t.replace(/[^0-9.\-]/g, "");
  return t;
}
/** N/E: 6 integer digits + 2-4 decimals; restores a lost decimal point (E 8596034134 -> 859603.4134). */
export function fixCoordinate(raw) {
  // "444534.579,}" / "444547,3680" / "444541 ,0886": comma or spaced separator = decimal point; trailing junk dropped
  let t = String(raw).replace(/\s*[,.]\s*/g, ".").replace(/[^0-9OoIlô.]+$/, "");
  t = fixNumber(t);
  if (!t.includes(".") && t.length >= 8 && t.length <= 10) t = `${t.slice(0, 6)}.${t.slice(6)}`;
  const v = Number(t);
  return Number.isFinite(v) && v > 100000 && v < 1000000 ? v : null;
}
/** Station "8+14.15" / "13+93.68" / "1 1+40" / "lO+ô3.7" -> feet. */
export function parseStation(text) {
  const m = /S?TA[.,]?\s*([0-9OoIl ô]{1,4})\s*\+\s*([0-9OoIlô]{2}(?:[.,][0-9OoIlô]+)?)\s*([A-Z])?\b/.exec(text);
  if (!m) return null;
  const hundreds = Number(fixNumber(m[1]));
  const rest = Number(fixNumber(m[2].replace(",", ".")));
  if (!Number.isFinite(hundreds) || !Number.isFinite(rest) || rest >= 100) return null;
  return { sta: hundreds * 100 + rest, baseline: m[3] ?? null };
}
/** Offset "8' O/S(R)" / "10'0/s (R)" / "15.4' O/S" (side may come later on the row) / "6.4' a/s(R)". */
export function parseOffset(text) {
  const m = /([0-9OoIlô]+(?:[.,][0-9OoIlô]+)?)\s*['’]?\s*[O0oa]\s*\/\s*[Ss5]\s*\(?\s*([RL])?/.exec(text);
  if (!m) {
    // sewer style: "STA.6+74.51C 0.0'" = on the baseline (offset 0, no side needed)
    const zero = /S?TA[.,]?\s*[0-9OoIlô ]{1,4}\s*\+\s*[0-9OoIlô.,]+\s*[A-Z]?\s+([0O][.,][0O])\s*['’]/.exec(text);
    return zero ? { offset: 0, side: "C" } : null;
  }
  const off = Number(fixNumber(m[1].replace(",", ".")));
  const side = m[2] ?? (/\(\s*R\s*\)?/.test(text) ? "R" : /\(\s*L\s*\)?/.test(text) ? "L" : null);
  return Number.isFinite(off) ? { offset: off, side } : null;
}
export function parseRim(text) {
  const m = /RIM\s*(?:EL)?\s*[=.:]?\s*(-?[0-9OoIlô]+[.,][0-9OoIlô]+)/i.exec(text);
  return m ? Number(fixNumber(m[1].replace(",", "."))) : null;
}
export function parseInv(text) {
  // "INV.EL=4.44' (NE,S)" | "INV W:-l.34 8" PVC" | "INV.EL=2.1"
  const m = /INV\.?\s*(?:EL)?\s*(?:([NSEW]{1,2})\s*:)?\s*[=.:]?\s*(-?[0-9OoIlô]+[.,][0-9OoIlô]+)\s*'?\s*(?:\(([NSEW, ]+)\))?/i.exec(text);
  if (!m) return null;
  const value = Number(fixNumber(m[2].replace(",", ".")));
  const dirs = (m[1] ?? m[3] ?? "").replace(/\s/g, "").split(",").filter(Boolean);
  return Number.isFinite(value) ? { value, dirs } : null;
}
export function parsePipe(text) {
  const size = /(\d{1,2})\s*["”]\s*(PVC|DIP|D\.I\.P\.?|DI|C\.?I\.?P|VCP|HDPE)/i.exec(text);
  // slope: "0.39%" / "0.39Z" / "0.407." / "0.357a" / "o.3gz" (OCR turns % into Z, 7., 7a; o->0, g->9)
  const slope = /([0-9oO][.,][0-9oOgG]{2})\s*(?:[%Zz]|7[.a]?(?![0-9]))/.exec(text);
  const slopeVal = slope ? Number(fixNumber(slope[1].replace(",", ".").replace(/[gG]/g, "9"))) : null;
  return {
    pipe: size ? `${size[1]}" ${size[2].toUpperCase().replace(/\./g, "")}` : null,
    slope: Number.isFinite(slopeVal) && slopeVal > 0 && slopeVal < 10 ? slopeVal : null,
  };
}
const KIND_RULES = [
  [/F\.?\s*H\.?\s*ASSY|FIRE\s*HYD/i, "FH"],
  [/G\.?\s*V\.?\b|GATE\s*VALVE/i, "GV"],
  [/TEE\b/i, "TEE"],
  [/FLUSHING/i, "FLUSHING VALVE"],
  [/\bC\.?\s*V\b|CHECK/i, "CV"],
  [/WATER\s*SERVICE|METER/i, "SERVICE"],
  [/\bMH\b|MANHOLE|\bM\.H\./i, "MH"],
  [/RIM/i, "MH"],
  [/PLUG|CAP\b/i, "PLUG"],
];
const kindOf = (text) => (KIND_RULES.find(([re]) => re.test(text)) ?? [null, null])[1];

// ---------- 2. callout columns ----------
const rows = (ocr.passes.find((p) => p.rotation === 0)?.lines ?? []).map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text);
// append same-row fragments to the right (e.g. "(R)", "o/s") to the row whose left edge starts the column
// left to right, so the left fragment is always the host even when the right one sits 1 px higher ("8" PVC" | "SDR-35@ 0.39Z")
rows.sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
const merged = [];
for (const l of rows) {
  // same row, starting just after the host's right edge: "(R)" after a station, "PVC SDR-35@ 0.38Z" after "206'-" (OCR splits callouts)
  const host = merged.find((m) => Math.abs(m.box.y - l.box.y) <= Math.max(8, 0.4 * m.box.h) && l.box.x > m.box.x &&
    l.box.x - (m.box.x + m.box.w) < (l.text.length <= 6 ? 320 : 120));
  if (host) { host.text += ` ${l.text}`; host.box.w = l.box.x + l.box.w - host.box.x; continue; }
  merged.push({ text: l.text, box: { ...l.box } });
}
const columns = [];
for (const l of merged.sort((a, b) => a.box.y - b.box.y)) {
  // an N / E line sits under its callout even when the OCR dropped the RIM / INV lines in between (VILLA ONE MH#3: 70 px gap): allow a taller gap for those
  const coordLine = /^\s*[I|l]?\s*[NE]\s*[.:]?\s*[0-9OoIlô]/.test(l.text);
  const col = columns.find((c) => Math.abs(c.x - l.box.x) <= 25 && l.box.y - c.lastBottom <= (coordLine ? 5.5 : 2.2) * Math.max(l.box.h, 18));
  if (col) { col.lines.push(l); col.lastBottom = l.box.y + l.box.h; } else columns.push({ x: l.box.x, lastBottom: l.box.y + l.box.h, lines: [l] });
}

// ---------- items ----------
const items = [];
for (const [colIdx, col] of columns.entries()) {
  let cur = null;
  let part = 0;
  let colSta = null; // a column's later items (G.V., F.H.) sit at the station of its first line unless they print their own
  const flush = () => { if (cur && (cur.kind || cur.sta != null || cur.N != null || cur.rim != null || cur.inv.length || cur.pipe || cur.slope != null)) items.push(cur); cur = null; };
  const start = (l) => { flush(); cur = { kind: null, text: [], sta: null, baseline: null, offset: null, side: null, N: null, E: null, rim: null, inv: [], pipe: null, slope: null, box: { ...l.box }, issues: [], col: colIdx, part: part++ }; };
  for (const l of col.lines) {
    const t = l.text;
    const nMatch = /^\s*[I|l]?\s*N\s*[.:]?\s*([0-9OoIlô][0-9OoIlô ,.]{7,13})[^0-9A-Za-z]*$/.exec(t);
    const eMatch = /^\s*E\s*[.:]?\s*([0-9OoIlô][0-9OoIlô ,.]{7,13})[^0-9A-Za-z]*$/.exec(t);
    if (nMatch) { if (!cur || cur.N != null) start(l); cur.N = fixCoordinate(nMatch[1]); if (cur.N == null) cur.issues.push(`N unreadable: "${t}"`); continue; }
    if (eMatch) { if (!cur) start(l); cur.E = fixCoordinate(eMatch[1]); if (cur.E == null) cur.issues.push(`E unreadable: "${t}"`); continue; }
    const kind = kindOf(t);
    const st = parseStation(t);
    // a new description or a new station after a printed coordinate pair starts a new item; so does a second offset
    // ("W/6"C.V. 2'O/S" then "& F.H. ASSY. 6' O/S" are two features even when an N/E line between them was unreadable)
    const offHere = parseOffset(t);
    if (!cur || (cur.N != null && cur.E != null && (kind || st || offHere)) || (offHere && cur.offset != null && !st) ||
      (st && cur.sta != null && !cur.inherited)) start(l);
    if (kind && !cur.kind) cur.kind = kind;
    cur.text.push(t);
    if (st) { cur.sta = st.sta; cur.baseline = st.baseline ?? cur.baseline; colSta = colSta ?? st; }
    const off = offHere;
    if (off) { cur.offset = off.offset; cur.side = off.side ?? cur.side; }
    const rim = parseRim(t); if (rim != null) cur.rim = rim;
    const inv = parseInv(t); if (inv) cur.inv.push(inv);
    const p = parsePipe(t); if (p.pipe) cur.pipe = p.pipe; if (p.slope != null) cur.slope = p.slope;
    cur.box.w = Math.max(cur.box.x + cur.box.w, l.box.x + l.box.w) - cur.box.x;
    cur.box.h = l.box.y + l.box.h - cur.box.y;
    if (cur.sta == null && colSta && cur.offset != null) { cur.sta = colSta.sta; cur.baseline = colSta.baseline; cur.inherited = true; cur.issues.push("station inherited from the callout's first line"); }
  }
  flush();
}
for (const it of items) it.text = it.text.join(" | ");

// ---------- callout grouping (2026-10-02) ----------
// The line-level splitter above cuts a callout wherever a new station / description appears, so ONE manhole callout ("MH#6 / STA.6+74.51C 0.0' O/S / RIM EL=12.20' /
// INV.EL=3.50'(E) / STA.10+11.78 C / N / E") became two items, each with half the data (VILLA ONE review: RIM in one item, N/E in another, INV nowhere). A column that holds a
// structure callout (a RIM/INV line, an MH name) is ONE manhole: its items are merged into the first one, keeping EVERY printed station (a manhole prints one per baseline).
// Other columns are assemblies (8"x6" TEE / W/6" G.V. / & F.H. ASSY, each with its own N/E): they stay separate items but share `callout` + `part`, so the review sheet can show them together.
const isStructure = (it) => it.rim != null || it.inv.length || /\bMH\b|MANHOLE|\bM\.H\./i.test(it.text);
const byCol = new Map();
for (const it of items) { if (!byCol.has(it.col)) byCol.set(it.col, []); byCol.get(it.col).push(it); }
const stationOf = (x) => (x.sta == null ? null : { sta: x.sta, baseline: x.baseline, offset: x.offset, side: x.side });
const absorb = (head, x) => {          // x is another OCR fragment of the SAME callout as head
  head.stations ??= []; for (const y of [head, x]) { const st = stationOf(y); if (st && !head.stations.some((z) => z.sta === st.sta && z.baseline === st.baseline)) head.stations.push(st); }
  head.text += ` | ${x.text}`;
  if (head.rim == null && x.rim != null) head.rim = x.rim;
  for (const v of x.inv) if (!head.inv.some((y) => y.value === v.value && y.dirs.join() === v.dirs.join())) head.inv.push(v);
  if (head.N == null && x.N != null) head.N = x.N; else if (x.N != null && Math.abs(x.N - head.N) > 1) head.issues.push(`two different N in one callout: ${head.N} / ${x.N}`);
  if (head.E == null && x.E != null) head.E = x.E; else if (x.E != null && Math.abs(x.E - head.E) > 1) head.issues.push(`two different E in one callout: ${head.E} / ${x.E}`);
  if (!head.pipe && x.pipe) head.pipe = x.pipe;
  if (head.slope == null && x.slope != null) head.slope = x.slope;
  if (head.offset == null && x.offset != null && head.sta == null) { head.sta = x.sta; head.baseline = x.baseline; head.offset = x.offset; head.side = x.side; }
  for (const i of x.issues) if (!head.issues.includes(i)) head.issues.push(i);
  const x0 = Math.min(head.box.x, x.box.x), y0 = Math.min(head.box.y, x.box.y);
  head.box = { x: x0, y: y0, w: Math.max(head.box.x + head.box.w, x.box.x + x.box.w) - x0, h: Math.max(head.box.y + head.box.h, x.box.y + x.box.h) - y0 };
  head.mergedFrom = (head.mergedFrom ?? 1) + 1;
};
const grouped = [];
for (const [, list] of byCol) {
  let out = [];
  if (list.some(isStructure) && list.length > 1) {
    // a structure column = ONE manhole: everything merges into its first item
    const head = list[0]; for (const x of list.slice(1)) absorb(head, x); head.kind = "MH"; out = [head];
  } else {
    // an assembly column (TEE / G.V. / F.H. ...): a fragment WITHOUT a description of its own (no kind, pipe, RIM/INV) that follows an item still waiting for its
    // coordinates is that item's continuation (second station line + N/E of the same tee / manhole); anything with its own description stays an item
    for (const x of list) {
      const prev = out[out.length - 1];
      if (prev && !x.kind && !x.pipe && x.slope == null && x.rim == null && !x.inv.length && prev.N == null && !/LATERAL|CLEAN/i.test(x.text)) absorb(prev, x);
      else out.push(x);
    }
  }
  for (const it of out) {
    it.callout = it.col;
    if (it.mergedFrom) {
      const prim = it.stations.find((st) => st.offset != null) ?? it.stations[0];
      if (prim) { it.sta = prim.sta; it.baseline = prim.baseline; it.offset = prim.offset; it.side = prim.side; }
      it.issues.push(`one callout: ${it.mergedFrom} OCR fragments merged (${it.stations.length} station(s) kept)`);
    }
    grouped.push(it);
  }
}
items.length = 0; items.push(...grouped);
for (const it of items) delete it.col;

// ---------- second OCR pass (asbuilt-reocr.py) ----------
// --reocr <file>: each INCOMPLETE manhole callout was re-read on its own enlarged crop. The readings VOTE with the first pass (first pass = one vote): a missing
// field is filled, a value the majority of second readings contradicts is replaced; every difference is listed on the item. Struck-through lines stay unread.
const reocrPath = flag("reocr");
if (reocrPath) {
  const re = JSON.parse(readFileSync(reocrPath, "utf8").replace(/^﻿/, ""));
  const vote = (first, readings, plausible = () => true) => {
    const counts = new Map();
    const add = (v, w) => { if (v == null || !plausible(v)) return; const k = JSON.stringify(v); counts.set(k, { v, n: (counts.get(k)?.n ?? 0) + w }); };
    add(first, 1); for (const r of readings) add(r, 1);
    const best = [...counts.values()].sort((x, y) => y.n - x.n)[0];
    return best ? { value: best.v, votes: best.n, total: readings.length + (first != null ? 1 : 0) } : null;
  };
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  let touched = 0;
  for (const c of re.callouts ?? []) {
    const it = items.find((x) => Math.abs(x.box.x - c.box.x) < 3 && Math.abs(x.box.y - c.box.y) < 3);
    if (!it) continue;
    const ids = [], rims = [], invs = [], Ns = [], Es = [];
    for (const v of c.variants) {
      const lines = v.lines.map((t) => t.trim()).filter(Boolean);
      let idv = null, rimv = null, invv = null;
      for (const l of lines) {
        const m = /(?:^|[^A-Za-z])MH\s*#\s*(\d{1,3})\b/i.exec(l); if (m && idv == null) idv = `MH#${Number(m[1])}`;
        const rl = l.replace(/(?<=[0-9])\s+(?=[0-9])/g, "");               // "RIM EL=1 2.20*" -> "RIM EL=12.20*"
        const r = parseRim(rl); if (r != null && rimv == null && r > -20 && r < 80) rimv = Math.round(r * 100) / 100;
        const iv = parseInv(l); if (iv && invv == null) invv = iv;
        // coordinates: "N 444524:1610", "444518,2847" on its own line (label lines "N" / "E" can come first), digit groups split by spaces
        const num = /^\s*(?:[NE]\s*[.:]?\s*)?([0-9OoIlô][0-9OoIlô ,.:_]{7,14}[0-9OoIlô])\s*$/.exec(l);
        if (num) {
          const val = fixCoordinate(num[1].replace(/[:_]/g, "."));
          if (val != null) { if (it.N != null && Math.abs(val - it.N) < 100) Ns.push(val); else if (it.E != null && Math.abs(val - it.E) < 100) Es.push(val); }
        }
      }
      if (idv) ids.push(idv); if (rimv != null) rims.push(rimv); if (invv) invs.push(invv);
    }
    const notes = [];
    const idV = vote(null, ids); if (idV && idV.votes >= 1) { it.id = idV.value; if (!/MH\s*#/i.test(it.text)) it.text = `${idV.value} | ${it.text}`; notes.push(`name ${idV.value}`); }
    const rimV = vote(it.rim, rims);
    if (rimV && !same(rimV.value, it.rim)) {
      if (it.rim == null) { it.rim = rimV.value; notes.push(`RIM ${rimV.value} (second pass)`); }
      else if (rimV.votes >= 2) { notes.push(`RIM ${it.rim} -> ${rimV.value} (${rimV.votes}/${rimV.total} readings)`); it.rim = rimV.value; }
    }
    if (!it.inv.length) { const iV = vote(null, invs); if (iV) { it.inv.push(iV.value); notes.push(`INV ${iV.value.value} (${iV.value.dirs.join(",") || "no directions"}) from the second pass: check it`); } }
    for (const [key, list] of [["N", Ns], ["E", Es]]) {
      const v = vote(it[key], list, (x) => x > 100000);
      if (v && !same(v.value, it[key])) {
        if (it[key] == null) { it[key] = v.value; notes.push(`${key} ${v.value} (second pass)`); }
        else if (v.votes >= 2 && v.votes > (it[key] === v.value ? 1 : 1)) { notes.push(`${key} ${it[key]} -> ${v.value} (${v.votes}/${v.total} readings)`); it[key] = v.value; }
        else notes.push(`${key}: first pass ${it[key]}, second pass ${v.value}: check the crop`);
      }
    }
    if (notes.length) { it.issues.push(`second OCR pass: ${notes.join("; ")}`); it.reocr = notes; touched++; }
  }
  console.log(`second OCR pass: ${touched} callout(s) completed or corrected`);
}

// ---------- pipe callouts read along the pipes (rotated passes) ----------
// In a rotated pass the words' "raw" boxes are in the rotated (reading) frame, so fragments of one callout share a raw row there:
// "249'." + "8" PVC SDR-35@ 0.38Z" on SW 118th Ave (VILLA ONE). Only pipe callouts are taken from these passes.
const unionBox = (bs) => {
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 };
};
for (const pass of ocr.passes.filter((p) => p.rotation !== 0)) {
  const ls = pass.lines.filter((l) => l.words?.every((w) => w.raw)).map((l) => ({
    text: l.text.trim(), raw: unionBox(l.words.map((w) => w.raw)), box: l.box,
  })).sort((a, b) => a.raw.x - b.raw.x || a.raw.y - b.raw.y);
  const joined = [];
  for (const l of ls) {
    const host = joined.find((m) => Math.abs(m.raw.y - l.raw.y) <= Math.max(8, 0.4 * m.raw.h) && l.raw.x > m.raw.x && l.raw.x - (m.raw.x + m.raw.w) < 260);
    if (host) { host.text += ` ${l.text}`; host.raw = unionBox([host.raw, l.raw]); host.box = unionBox([host.box, l.box]); continue; }
    joined.push({ ...l });
  }
  for (const j of joined) {
    const p = parsePipe(j.text);
    if (!p.pipe && p.slope == null) continue;
    if (/LATERAL|CLEAN\s*OUT|SAN\.?\s*SEW/i.test(j.text)) continue; // 6" lateral notes, not mains
    items.push({ kind: "PIPE", text: j.text, sta: null, baseline: null, offset: null, side: null, N: null, E: null, rim: null, inv: [],
      pipe: p.pipe, slope: p.slope, box: j.box, issues: [`read in the ${pass.rotation}° pass`] });
  }
}
// rotation-0 pipe callouts (sewer mains along the street) become PIPE items too, unless already inside a structure callout
for (const it of items) if (!it.kind && (it.pipe || it.slope != null) && it.N == null && it.rim == null && !/LATERAL|CLEAN/i.test(it.text)) it.kind = "PIPE";
const lengthOf = (t) => { const m = /(\d{2,4})\s*['’]\s*[-–.]?/.exec(t); return m ? Number(m[1]) : null; };
for (const it of items) if (it.kind === "PIPE") it.lengthFt = lengthOf(it.text);

// ---------- 3. baselines: (station, signed offset) -> (E, N) ----------
const signed = (it) => (it.side === "C" ? 0 : (it.side === "L" ? 1 : it.side === "R" ? -1 : null) * it.offset); // left of increasing station = +
function fitSimilarity(pairs) {
  // E = a*s - b*o + tx ; N = b*s + a*o + ty   (least squares, centred)
  const n = pairs.length;
  const ms = pairs.reduce((a, p) => a + p.s, 0) / n, mo = pairs.reduce((a, p) => a + p.o, 0) / n;
  const mE = pairs.reduce((a, p) => a + p.E, 0) / n, mN = pairs.reduce((a, p) => a + p.N, 0) / n;
  let sxx = 0, a1 = 0, b1 = 0;
  for (const p of pairs) {
    const s = p.s - ms, o = p.o - mo, E = p.E - mE, N = p.N - mN;
    sxx += s * s + o * o; a1 += s * E + o * N; b1 += s * N - o * E;
  }
  const a = a1 / sxx, b = b1 / sxx;
  const tx = mE - a * ms + b * mo, ty = mN - b * ms - a * mo;
  return { a, b, tx, ty, apply: (s, o) => ({ E: a * s - b * o + tx, N: b * s + a * o + ty }) };
}
const baselines = [];
const byLetter = new Map();
for (const it0 of items) {
  // a merged manhole callout prints one station per baseline: each one with its own offset is an anchor of ITS baseline
  const sts = it0.stations?.length ? it0.stations.filter((x) => x.offset != null && x.side != null).map((x) => ({ ...it0, ...x, _owner: it0 })) : [it0];
  for (const it of sts) {
  if (it.sta == null || it.offset == null || it.side == null || it.N == null || it.E == null) continue;
  // only items that PRINT their own station are anchors: a G.V./F.H. under a TEE inherits the station, but its offset may be measured
  // along the branch, not square to the baseline (VILLA ONE: F.H. at 3+14.9 "6' O/S" sat 8 ft off the fit)
  if (it.inherited) continue;
  const key = it.baseline ?? "?";
  if (!byLetter.has(key)) byLetter.set(key, []);
  byLetter.get(key).push({ it: it._owner ?? it, s: it.sta, o: signed(it), E: it.E, N: it.N });
  }
}
for (const [letter, pairs] of byLetter) {
  const info = { letter, anchors: pairs.length, scale: null, rotationDeg: null, maxResidualFt: null, residuals: [], usable: false };
  if (pairs.length >= 2) {
    // robust: drop the worst anchor (leave-one-out residual) while it exceeds the tolerance and >= 3 anchors would remain;
    // a rejected anchor is a misread station/offset/N/E, reported on its item for the review table
    const looResiduals = (set) => set.map((p, i) => {
      const f = set.length >= 3 ? fitSimilarity(set.filter((_, j) => j !== i)) : fitSimilarity(set);
      const q = f.apply(p.s, p.o);
      return Math.hypot(q.E - p.E, q.N - p.N);
    });
    let kept = [...pairs];
    info.rejected = [];
    for (;;) {
      const r = looResiduals(kept);
      const worst = r.indexOf(Math.max(...r));
      if (kept.length <= 3 || r[worst] <= maxResidual) break;
      kept[worst].it.issues.push(`rejected as baseline ${letter} anchor (${r[worst].toFixed(2)} ft off the others): check its station/offset/side/N/E`);
      info.rejected.push({ sta: kept[worst].s, offset: kept[worst].o, ft: r[worst] });
      kept.splice(worst, 1);
    }
    const fit = fitSimilarity(kept);
    info.anchors = kept.length;
    info.scale = Math.hypot(fit.a, fit.b);
    info.rotationDeg = (Math.atan2(fit.b, fit.a) * 180) / Math.PI;
    const r = looResiduals(kept);
    info.residuals = kept.map((p, i) => ({ sta: p.s, offset: p.o, ft: r[i] }));
    info.maxResidualFt = Math.max(...r);
    // 2 anchors always fit exactly: they place, but nothing checks them -> usable only with >= 3 (else "unverified")
    info.verified = kept.length >= 3;
    info.usable = info.verified && Math.abs(info.scale - 1) < 0.01 && info.maxResidualFt <= maxResidual;
    if (info.usable) {
      for (const it of items) {
        if ((it.baseline ?? "?") !== letter || it.sta == null || it.offset == null || it.side == null) continue;
        if (it.inherited && (it.N == null || it.E == null)) { it.issues.push("not placed: inherited station (offset may run along a branch) — needs its printed N/E or a click"); continue; }
        const q = fit.apply(it.sta, signed(it));
        if (it.N == null || it.E == null) { it.N = +q.N.toFixed(4); it.E = +q.E.toFixed(4); it.source = "computed"; }
        else {
          it.source = "printed";
          const d = Math.hypot(q.E - it.E, q.N - it.N);
          if (d > maxResidual) it.issues.push(`printed N/E is ${d.toFixed(2)} ft from its station/offset: check the OCR of both`);
        }
      }
    }
  }
  baselines.push(info);
}
for (const it of items) if (it.N != null && it.E != null && !it.source) it.source = "printed";

const out = { scan: ocr.image, width: ocr.width, height: ocr.height, baselines, items };
const outPath = flag("out");
if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 1));
for (const b of baselines) {
  console.log(`baseline ${b.letter}: ${b.anchors} anchor(s)` + (b.scale == null ? " (need >= 2 to fit)" :
    `, scale ${b.scale.toFixed(4)}, rotation ${b.rotationDeg.toFixed(3)}°, max residual ${b.maxResidualFt.toFixed(2)} ft` +
    `${b.rejected?.length ? `, ${b.rejected.length} anchor(s) rejected` : ""} -> ${b.usable ? "USABLE" : b.verified ? "NOT usable" : "UNVERIFIED (2 anchors)"}`));
}
const located = items.filter((i) => i.N != null && i.E != null);
console.log(`${items.length} item(s): ${located.length} located (${located.filter((i) => i.source === "computed").length} computed from baseline), ${items.filter((i) => i.issues.length).length} with issues${outPath ? ` -> ${outPath}` : ""}`);
