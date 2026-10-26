#!/usr/bin/env node
// Extends the survey's R/W lines (layer R-W, cyan PHANTOM2) so they end where our red CENTER_LINE street extensions end (user 2026-10-26, SEIDENSTEIN: the plan looked "cut in
// parts" because the survey R/W stops at the survey limit while the red lines run on). Real data only: each extension keeps the surveyed offset of that side (half width measured
// on the R-W lines, e.g. 25 ft = "50' TOTAL R/W" of SW 53rd Court), runs parallel to the survey centerline, stops at the red line's end station, and leaves the crossing street's
// R/W gap (starts at the far edge of the crossing street). Only sides the survey actually drew are extended. Where the red line is the shorter one the script only reports it
// (extend the red polyline instead of trimming survey data).
//   node c300-rw-extend.mjs --dump X-TOPO_dump.txt --config streets.json --out payload.json
// streets.json = { "NAME": { "a":[x,y], "b":[x,y]  /* survey CL */, "h":25 /* half width */, "red":[[x,y],[x,y]] /* ends of the red CENTER_LINE */, "low":"OTHER"|null, "high":"OTHER"|null /* crossing street at each end */ } }
// Then create the polylines on host layer R-W (color 4, linetype PHANTOM2, lineweight 40, ByLayer entities) with createEntities.
import fs from 'node:fs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,arr)=>(v.startsWith('--')?a.concat([[v.slice(2),arr[i+1]]]):a),[]));
if(!args.dump||!args.config){console.error('usage: node c300-rw-extend.mjs --dump X-TOPO_dump.txt --config streets.json [--out payload.json]');process.exit(2);}
const rows=fs.readFileSync(args.dump,'utf8').split(/\r?\n/).filter(l=>l.startsWith('ENT|')).map(l=>{const p=l.split('|'),kv={};p.slice(5).forEach(s=>{const i=s.indexOf('=');if(i>0)kv[s.slice(0,i)]=s.slice(i+1)});const n=(kv.p2??'').replace(/[()]/g,'').trim().split(/\s+/).map(Number);return{type:p[1],layer:p[3],a:[+kv.x,+kv.y],b:kv.p2?[n[0],n[1]]:null}});
const rw=rows.filter(r=>r.type==='LINE'&&r.layer==='R-W');
const S=JSON.parse(fs.readFileSync(args.config,'utf8'));
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]],add=(a,b)=>[a[0]+b[0],a[1]+b[1]],mul=(a,k)=>[a[0]*k,a[1]*k],dot=(a,b)=>a[0]*b[0]+a[1]*b[1],len=a=>Math.hypot(...a);
for(const s of Object.values(S)){const d=sub(s.b,s.a);s.L=len(d);s.u=mul(d,1/s.L);s.n=[-s.u[1],s.u[0]];}
const out=[],ents=[],rep=[];
for(const [k,s] of Object.entries(S)){
 const pr=p=>dot(sub(p,s.a),s.u),of=p=>dot(sub(p,s.a),s.n);
 const tR=s.red.map(pr).sort((x,y)=>x-y);
 const sides={};
 for(const r of rw){const t=sub(r.b,r.a),l=len(t);if(l<1||Math.abs(dot(t,s.u))/l<0.995)continue;const o=of(r.a);if(Math.abs(Math.abs(o)-s.h)>1.5)continue;
   const sg=o>0?1:-1;const e=(sides[sg]??={ts:[],off:[]});e.ts.push(pr(r.a),pr(r.b));e.off.push(o)}
 for(const [sg,e] of Object.entries(sides)){
  const tmin=Math.min(...e.ts),tmax=Math.max(...e.ts),off=e.off.reduce((a,b)=>a+b)/e.off.length;
  const P=t=>add(add(s.a,mul(s.u,t)),mul(s.n,off));
  const farEdge=(cname,t0)=>{const c=S[cname];const g=p=>dot(sub(p,c.a),c.n);const g0=g(P(t0));const sgn=g0>0?1:-1;const target=-sgn*c.h;const dg=dot(s.u,c.n);const tf=t0+(target-g0)/dg;rep.push(`${k} side ${sg} off ${off.toFixed(2)}: end at t=${t0.toFixed(1)} is ${g0.toFixed(1)} ft from ${cname} CL (half width ${c.h}); far edge t=${tf.toFixed(1)}`);return tf};
  rep.push(`${k} side ${sg}: survey t ${tmin.toFixed(1)}..${tmax.toFixed(1)}, red t ${tR[0].toFixed(1)}..${tR[1].toFixed(1)}`);
  if(tR[0]<tmin-1){const t0=s.low?farEdge(s.low,tmin):tmin;ents.push({k,sg,a:P(t0),b:P(tR[0])});}
  if(tR[1]>tmax+1){const t0=s.high?farEdge(s.high,tmax):tmax;ents.push({k,sg,a:P(t0),b:P(tR[1])});}
 }
}
console.log(rep.join('\n'));
console.log(ents.map(e=>`${e.k}${e.sg}: ${e.a.map(v=>v.toFixed(2))} -> ${e.b.map(v=>v.toFixed(2))} (${len(sub(e.b,e.a)).toFixed(0)} ft)`).join('\n'));
const r4=v=>Math.round(v*1e4)/1e4;
if(args.out)fs.writeFileSync(args.out,JSON.stringify({entities:ents.map(x=>({kind:'polyline',layer:'R-W',colorIndex:256,points:[{x:r4(x.a[0]),y:r4(x.a[1])},{x:r4(x.b[0]),y:r4(x.b[1])}]}))}));
for(const [k,s] of Object.entries(S)){const pr=p=>dot(sub(p,s.a),s.u);const t=s.red.map(pr).sort((x,y)=>x-y);if(t[0]>1)console.log(`${k}: red line starts ${t[0].toFixed(0)} ft after the survey CL start: extend the red polyline to ${s.a.map(v=>v.toFixed(2))}`);if(t[1]<s.L-1)console.log(`${k}: red line ends ${(s.L-t[1]).toFixed(0)} ft before the survey CL end: extend the red polyline to ${s.b.map(v=>v.toFixed(2))}`);}
