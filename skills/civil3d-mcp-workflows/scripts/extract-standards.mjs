#!/usr/bin/env node
// Groups the ENT| lines of a dwg-dump.ps1 output into drafting "recipes": every distinct
// combination of type + layer + color + linetype + lineweight + style + height + block.
// These are the properties to reuse when drawing the same element in a future project.
//
//   node extract-standards.mjs <dump.txt> [--window xmin,ymin,xmax,ymax] [--json out.json]
//
// Layer defaults (color/linetype/lineweight of each layer used) are included so a recipe
// that says "ByLayer" can be recreated in a drawing where the layer doesn't exist yet.
import fs from 'node:fs';

const [dumpPath, ...rest] = process.argv.slice(2);
if (!dumpPath) { console.error('usage: extract-standards.mjs <dump.txt> [--window x0,y0,x1,y1] [--json out.json]'); process.exit(2); }
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
const win = opt.window ? opt.window.split(',').map(Number) : null;

const lines = fs.readFileSync(dumpPath, 'utf8').split(/\r?\n/);
const kv = (parts) => Object.fromEntries(parts.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
const pt = (s) => { const m = /\(([-\d.e+]+) ([-\d.e+]+)/.exec(s || ''); return m ? [+m[1], +m[2]] : null; };

const layers = {};
for (const l of lines.filter((x) => x.startsWith('LAYER|'))) {
  const [, name, ...p] = l.split('|');
  const o = kv(p);
  layers[name] = { color: +o.c, linetype: o.lt, lineweight: o.lw === '' ? null : +o.lw, plot: o.plot !== '0' };
}

const ents = lines.filter((l) => l.startsWith('ENT|')).map((l) => {
  const i = l.indexOf('|txt=');
  const [, type, handle, layer, ...p] = (i >= 0 ? l.slice(0, i) : l).split('|');
  return { type, handle, layer, ...kv(p), txt: i >= 0 ? l.slice(i + 5) : '' };
}).filter((o) => !win || (+o.x >= win[0] && +o.y >= win[1] && +o.x <= win[2] && +o.y <= win[3]));

const num = (v, d = 3) => (v === undefined || v === '' ? undefined : +(+v).toFixed(d));
const recipes = {};
for (const o of ents) {
  const r = {
    type: o.type, layer: o.layer,
    color: o.c === '' ? 'ByLayer' : +o.c,
    linetype: o.lt === '' ? 'ByLayer' : o.lt,
    lineweight: o.lw === '' ? 'ByLayer' : +o.lw,
    linetypeScale: num(o.lts),
    style: o.style || undefined,
    height: num(o.h),
    attachment: o.att ? +o.att : undefined,
    block: o.block || undefined,
    blockScale: num(o.sx),
    constantWidth: num(o.cw),
    pattern: o.pattern || undefined,
  };
  const key = JSON.stringify(r);
  const g = (recipes[key] ||= { ...r, count: 0, examples: [] });
  g.count++;
  if (g.examples.length < 3) {
    const ex = { handle: o.handle, x: num(o.x, 2), y: num(o.y, 2) };
    if (o.rot) ex.rotationDeg = num((+o.rot * 180) / Math.PI, 2);
    if (o.txt) ex.text = o.txt.slice(0, 120);
    if (o.type === 'DIMENSION') { ex.measurement = num(o.meas, 2); ex.p2 = pt(o.p2); }
    if (o.type === 'LINE') ex.p2 = pt(o.p2);
    g.examples.push(ex);
  }
}

const out = {
  source: dumpPath,
  window: win,
  recipes: Object.values(recipes).sort((a, b) => b.count - a.count).map((r) => JSON.parse(JSON.stringify(r))),
};
out.layers = Object.fromEntries([...new Set(out.recipes.map((r) => r.layer))].sort().map((n) => [n, layers[n]]));

if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(out, null, 1));
for (const r of out.recipes) {
  const props = [r.color !== 'ByLayer' && `c=${r.color}`, r.linetype !== 'ByLayer' && `lt=${r.linetype}`, r.style && `style=${r.style}`,
    r.height !== undefined && `h=${r.height}`, r.attachment && `att=${r.attachment}`, r.block && `block=${r.block}@${r.blockScale}`].filter(Boolean).join(' ');
  console.log(`${String(r.count).padStart(3)}  ${r.type.padEnd(11)} ${r.layer.padEnd(18)} ${props}  | ${r.examples.map((e) => e.text || e.measurement || '').filter(Boolean).slice(0, 2).join(' // ').slice(0, 90)}`);
}
console.log(`\n${ents.length} entities, ${out.recipes.length} recipes${opt.json ? ` -> ${opt.json}` : ''}`);
