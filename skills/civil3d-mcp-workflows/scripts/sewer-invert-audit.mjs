// Gravity sewer audit: node sewer-invert-audit.mjs design.json
// design.json: {"slopeMain":0.004,"mhs":[{"name":"EXIST MH","sta":24.16,"inv":-4.30},{"name":"MH-1","sta":205.35,"inv":-3.58}],
//   "laterals":[{"sta":79.72,"inv":-4.08}], "mainDia":8,"latDia":6,"latSlope":0.0104,"mainCrownDepthFt":12.3,"latDepthFt":5.5}
// mhs[].inv = downstream-side invert, mhs[].invUp = upstream-side invert (drop = invUp - inv).
// Checks (MD-WASD DB: references/standards/mdwasd-standards.json): MH spacing <=400, sizes, lateral slope >=1/8"/ft,
// invert continuity along the main (tol 0.01 ft), drop through MH, riser rule (>=7 ft deep => tee with riser, not SS 1.0 wye), cover class.
import fs from 'fs';
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const out = []; const add = (lvl, m) => out.push(`${lvl} ${m}`);
const mh = [...d.mhs].sort((a, b) => a.sta - b.sta);
for (let i = 1; i < mh.length; i++) { const L = mh[i].sta - mh[i - 1].sta; if (L > 400) add('FAIL', `MH spacing ${L.toFixed(1)} ft > 400`); else add('OK', `MH spacing ${L.toFixed(1)} ft`);
  const exp = (mh[i - 1].invUp ?? mh[i - 1].inv) + d.slopeMain * L; if (Math.abs(exp - mh[i].inv) > 0.011) add('FAIL', `${mh[i].name} inv ${mh[i].inv} expected ${exp.toFixed(2)}`); else add('OK', `${mh[i].name} inv continuity`); }
for (const l of d.laterals || []) { let a = mh[0]; for (const m of mh) if (m.sta <= l.sta) a = m; const exp = (a.invUp ?? a.inv) + d.slopeMain * (l.sta - a.sta);
  add(Math.abs(exp - l.inv) > 0.011 ? 'FAIL' : 'OK', `lateral @${l.sta} inv ${l.inv} expected ${exp.toFixed(2)}`); }
if (d.mainDia < 8) add('FAIL', 'main < 8 in'); if (d.latDia < 6) add('FAIL', 'lateral < 6 in');
if (d.latSlope < 0.0104) add('FAIL', 'lateral slope < 1/8 in/ft (1.04 %)'); else if (d.latSlope - 0.0104 < 1e-4) add('INFO', 'lateral slope at the minimum');
if (d.mainCrownDepthFt >= 7) add('WARN', 'main >= 7 ft deep: every lateral must cite SS 1.0 SHT 2 OF 2 (DEEP: tee + 45 + riser); SHT 1 OF 2 is the shallow wye (< 7 ft)');
if (d.slopeMain <= 0.0040001) add('WARN', 'UC-250: absolute minimum slope (0.40 % terminal run >= 300 ft) should not be used; keep margin');
if (d.mainCrownDepthFt > 14) add('FAIL', 'cover > 14 ft requires DIP');
for (const m of mh.slice(1, -1)) { const dr = (m.invUp ?? m.inv) - m.inv; add(dr < 0.0999 ? 'WARN' : 'OK', `${m.name} drop through MH ${dr.toFixed(2)} ft (>= 0.10 ft common practice; set invUp = upstream-side invert)`); }
console.log(out.join('\n'));

