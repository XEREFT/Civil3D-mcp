// Usage: node c301-profile-annos.cjs [out.json]  (reads %TEMP%/c3d-dwg-dump/PKG-C-300_dump.txt written by dwg-dump.ps1)
// Builds an acad_create_entities payload from the engineer's package dump for the C-301 profile views
// (same grid as ours after view_set_location, so coordinates are copied 1:1).
const fs = require("fs");
const path = require("path");
const dump = fs.readFileSync(path.join(process.env.TEMP, "c3d-dwg-dump", "PKG-C-300_dump.txt"), "utf8").split(/\r?\n/);
const box = { x0: 859650, x1: 860300, y0: 441550, y1: 442420 };
const inBox = (x, y) => x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1;
const pt = (s) => { const m = /\(([-\d.]+) ([-\d.]+)/.exec(s || ""); return m ? { x: +m[1], y: +m[2] } : null; };

function fields(line) {
  const parts = line.split("|");
  const kv = { _type: parts[1], _handle: parts[2], _layer: parts[3] };
  for (const p of parts.slice(4)) { const i = p.indexOf("="); if (i > 0) kv[p.slice(0, i)] = p.slice(i + 1); }
  // txt is last and may itself contain '|'-free text; keep everything after "txt="
  const t = line.indexOf("|txt="); if (t >= 0) kv.txt = line.slice(t + 5);
  return kv;
}

const dims = {};
for (const l of dump) if (l.startsWith("DIM|")) {
  const kv = {}; for (const p of l.split("|").slice(2)) { const i = p.indexOf("="); if (i > 0) kv[p.slice(0, i)] = p.slice(i + 1); }
  dims[kv.h] = kv;
}

const common = (kv) => {
  const o = { layer: kv._layer };
  if (kv.c) o.colorIndex = +kv.c;
  if (kv.lt) o.linetype = kv.lt;
  if (kv.lts) o.linetypeScale = +kv.lts;
  return o;
};

const out = [], skipped = [], seen = new Set();
for (const l of dump) {
  if (!l.startsWith("ENT|")) continue;
  const kv = fields(l);
  const t = kv._type;
  let item = null;
  if (t === "LWPOLYLINE") {
    const pts = kv.v.split(";").filter(Boolean).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; });
    if (!pts.every((p) => inBox(p.x, p.y))) continue;
    item = { kind: "polyline", ...common(kv), points: pts, closed: kv.closed === "1" };
    if (+kv.cw) item.constantWidth = +kv.cw;
  } else if (t === "MULTILEADER") {
    const tp = pt(kv.txtpt);
    if (!inBox(+kv.x, +kv.y)) continue;
    item = { kind: "mleader", ...common(kv), mLeaderStyle: kv.style, height: +kv.h, text: kv.txt, leaderX: +kv.x, leaderY: +kv.y, x: tp.x, y: tp.y };
  } else if (t === "DIMENSION") {
    const d = dims[kv._handle];
    if (!d || !inBox(+kv.x, +kv.y)) continue;
    const p13 = pt(d.p13), p14 = pt(d.p14), p10 = pt(d.p10);
    item = { kind: "aligned_dimension", ...common(kv), dimStyle: d.style, x1: p13.x, y1: p13.y, x2: p14.x, y2: p14.y, dimLineX: p10.x, dimLineY: p10.y };
    if (d.txt) item.textOverride = d.txt;
    item._type = d.type;
  } else if (t === "MTEXT") {
    if (!inBox(+kv.x, +kv.y)) continue;
    item = { kind: "mtext", ...common(kv), text: kv.txt, x: +kv.x, y: +kv.y, height: +kv.h, width: +kv.w, attachment: +kv.att, textStyle: kv.style };
    if (+kv.rot) item.rotation = +kv.rot;
  } else if (t === "CIRCLE") {
    if (!inBox(+kv.x, +kv.y)) continue;
    const r = +kv.r, n = 24;
    const pts = Array.from({ length: n }, (_, i) => ({ x: +kv.x + r * Math.cos((2 * Math.PI * i) / n), y: +kv.y + r * Math.sin((2 * Math.PI * i) / n) }));
    item = { kind: "polyline", ...common(kv), points: pts, closed: true, _circle: { x: +kv.x, y: +kv.y, r } };
  } else {
    if (kv.x && inBox(+kv.x, +kv.y)) skipped.push(`${t} ${kv._handle} ${kv._layer} ${kv.block || ""}`);
    continue;
  }
  const key = JSON.stringify({ ...item, _type: undefined });
  if (seen.has(key)) { skipped.push(`duplicate ${t} ${kv._handle}`); continue; }
  seen.add(key);
  item._handle = kv._handle;
  out.push(item);
}

const report = out.map((e) => `${e._handle} ${e.kind} ${e.layer} ${e._type ? "type=" + e._type : ""} ${(e.text || e.textOverride || "").slice(0, 60)}`);
console.log(report.join("\n"));
console.log("skipped:", skipped.join("; "));
const clean = out.map(({ _handle, _type, _circle, ...rest }) => rest);
fs.writeFileSync(process.argv[2] || path.join(process.cwd(), "profile-annos.json"), JSON.stringify({ space: "model", entities: clean }));
console.log("entities:", clean.length);
