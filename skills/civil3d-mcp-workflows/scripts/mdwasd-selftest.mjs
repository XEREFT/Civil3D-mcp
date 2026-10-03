#!/usr/bin/env node
// Synthetic regression test for mdwasd-check.mjs (valve spacing UC-005 B.6, water-sewer separation GS 1.5, MH spacing UC-005 C.4, labels A.12).
//   node mdwasd-selftest.mjs      -> exit 0 = every assertion holds
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const ab = {
  manholes: [{ id: 'A', x: 0, y: 0, rim: 10, inv: [['N', 2], ['E', 4.5]] }, { id: 'B', x: 450, y: 0, rim: 10, inv: [['ND', 1]] }],
  sewerMains: [{ from: 'A', to: 'B', text: 'EXIST 8" PVC SAN MAIN', lengthFt: 450 }],
  waterMains: [{ a: [0, 12], b: [1000, 12], text: 'EXIST 8" DIP WATER MAIN' }, { a: [0, 5], b: [100, 5], text: 'EXIST WATER MAIN' }],
  hydrants: [],
  appurtenances: [
    { ref: 'water', label: '8" G.V.', x: 100, y: 12 }, { ref: 'water', label: '8" G.V.', x: 900, y: 12 },   // 800 ft apart > 660
    { ref: 'water', label: '8" G.V.', x: 500, y: 40 },                                                      // 28 ft off any main: ignored
    { ref: 'water', label: '8"x8" TEE', x: 500, y: 12 },                                                    // not a valve
    { ref: 'sewer', label: '4" PVC SAN. LAT.', stationText: 'STA.1+00', detail: 'SLOPE 1/16"/FT', x: 50, y: 0 },    // 4 in and 1/16 in per ft: both below SS 1.0
  ],
};
const f = path.join(os.tmpdir(), 'mdwasd-selftest.json'); fs.writeFileSync(f, JSON.stringify(ab));
const out = spawnSync('node', [path.join(here, 'mdwasd-check.mjs'), '--asbuilt', f], { encoding: 'utf8' }).stdout;
fs.unlinkSync(f);
const must = [
  [/WARN \[UC-005 B\.6\].*800\.0 ft apart/, 'valves 800 ft apart -> WARN'],
  [/WARN \[UC-005 C\.4\].*450\.0 ft between manholes/, 'MH spacing 450 ft -> WARN'],
  [/WARN \[GS 1\.5 horizontal\]/, 'water main 5 ft from the sewer -> WARN'],
  [/WARN \[UC-005 A\.12\] water main: label lacks size/, 'water label without size -> WARN'],
  [/INFO \[UC-005 B\.6\] valve.*28\.0 ft from any water main/, 'valve far from any main -> ignored with INFO'],
  [/INFO \[SS 9\.0\] A: inverts differ by 2\.5 ft/, 'MH inverts 2.5 ft apart -> drop INFO'],
  [/WARN \[SS 1\.0\].*4 in \(min 6 in\)/, 'lateral 4 in -> WARN'],
  [/WARN \[SS 1\.0\].*slope 1\/16/, 'lateral slope 1/16 -> WARN'],
];
let bad = 0;
for (const [re, what] of must) { const ok = re.test(out); if (!ok) bad++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`); }
if (bad) console.log('\n' + out);
process.exit(bad ? 1 : 0);
