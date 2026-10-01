"""FASE 1 DECLUTTER PLANNER (etapa 1.5, general MLeader clearance): from the problems fase1-qc.py reports for OUR MLeaders (text overlapping other
text, text on the survey's black fill, text cut off by the viewport edge), propose where each label's text should go. Read-only: it writes a plan;
nothing touches Civil 3D.

    python fase1-qc.py --dir <proj> --dwg <dwg> --pdf <plot.pdf> --json qc.json     (or: fase1-finish.mjs --dwg <dwg> --no-copy --qc-json qc.json)
    python fase1-declutter.py --qc qc.json [--out plan.json] [--max-ft 70] [--leader-ft 40]
    node  fase1-declutter-apply.mjs --plan plan.json --expect "<open drawing name>"       (acad_update_text_content {handle,x,y} per move, then save)
    ... re-plot + QC, re-plan, until 0 moves.

Geometry (plugin MoveMLeaderText): the text position is the text box's anchor — top-LEFT corner when the position is "forward" of the arrow
(along the text direction = sheet +x), top-RIGHT corner otherwise — so a move can flip the box to the other side of the position; the planner models that.
For each problem label it searches, on a 4 pt grid up to --max-ft, for the cheapest text position whose box (HARD rules)
  - touches no other printed word of anybody, 1.5 pt padding,
  - has < 15 % black-fill pixels (the asphalt hatch: text there is invisible) and stays inside the C-300 viewport (4 pt margin),
  - keeps the text within --leader-ft of the arrow tip, and does not land on a box this same plan already moved,
and (SOFT) costs extra for every line it would cross: score = distance in pt + 150 x (extra non-white fraction vs the clearest spot).
PL symbols are not moved here (c300-pl-symbols.mjs --avoid slides them along their own lot line).
"""
import argparse, json, math, sys
import numpy as np
import pymupdf as fitz

ap = argparse.ArgumentParser()
ap.add_argument("--qc", required=True); ap.add_argument("--out"); ap.add_argument("--max-ft", type=float, default=70.0)
ap.add_argument("--leader-ft", type=float, default=40.0); ap.add_argument("--step", type=float, default=4.0)
a = ap.parse_args()
Q = json.load(open(a.qc, encoding="utf-8"))

k = Q["ft_per_pt"]; ux, uy = Q["ux"], Q["uy"]
vx0, vy0, vx1, vy1 = Q["view_rect"]
labels = {l["h"]: l for l in Q["labels"]}
words = Q["words"]

DPI = 72
gray = fitz.open(Q["pdf"])[0].get_pixmap(dpi=DPI, colorspace=fitz.csGRAY)
img = np.frombuffer(gray.samples, dtype=np.uint8).reshape(gray.height, gray.width)
def integral(mask): return np.pad(mask.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
I_dark, I_ink = integral(img < 80), integral(img < 200)       # black fill / anything printed (lines, text)
sc = DPI / 72
def frac(I, r):
    x0, y0 = max(0, int(r[0] * sc)), max(0, int(r[1] * sc)); x1, y1 = min(gray.width, max(int(r[2] * sc), x0 + 1)), min(gray.height, max(int(r[3] * sc), y0 + 1))
    if x1 <= x0 or y1 <= y0: return 0.0
    return float(I[y1, x1] - I[y0, x1] - I[y1, x0] + I[y0, x0]) / ((x1 - x0) * (y1 - y0))
def hit(r1, r2, pad=1.5):
    return not (r1[2] + pad <= r2[0] or r2[2] + pad <= r1[0] or r1[3] + pad <= r2[1] or r2[3] + pad <= r1[1])
def pdf_delta_to_model(dx, dy):          # PDF pt (y down) -> model feet: sheet axes are (ux,uy) and (-uy,ux)
    du, dv = dx * k, -dy * k
    return du * ux - dv * uy, du * uy + dv * ux

problems = {}                              # handle -> list of why
for c in Q["clashes"]:
    for o in c["owners"]:
        if o and labels.get(o, {}).get("type") == "MULTILEADER": problems.setdefault(o, []).append(f"{c['kind']}: {' x '.join(map(str, c['words']))}")
unresolved = [dict(why=f"{c['kind']}: no MLeader of ours owns it ({c['words']}): survey/xref text or a PL symbol") for c in Q["clashes"] if not any(o and labels.get(o, {}).get("type") == "MULTILEADER" for o in c["owners"])]

plan, moved = [], []
for h, whys in problems.items():
    L = labels[h]; box = L["rect"]
    if not box: continue
    pos = L["pos"]; arr = L["arrows"][0] if L["arrows"] else pos
    fwd0 = L["fwd"] if L.get("fwd") is not None else True
    bw, bh = max(box[2] - box[0], 0.9 * (L.get("W") or 0) / k), box[3] - box[1]      # a cut-off label is wider than its visible words
    anchor0 = (box[0] if fwd0 else box[2], box[1])
    other = [w["r"] for w in words if w["o"] != h and w["vis"]]
    cands = []
    R = int(a.max_ft / k / a.step)
    for i in range(-R, R + 1):
        for j in range(-R, R + 1):
            cands.append((math.hypot(i, j) * a.step, i * a.step, j * a.step))
    cands.sort()
    ink_floor = None; best = None
    for cost, dx, dy in cands:
        if best and cost >= best[0]: break          # score >= distance: nothing farther can win
        mdx, mdy = pdf_delta_to_model(dx, dy)
        npos = (pos[0] + mdx, pos[1] + mdy)
        if math.hypot(npos[0] - arr[0], npos[1] - arr[1]) > a.leader_ft: continue
        fwd = (npos[0] - arr[0]) * ux + (npos[1] - arr[1]) * uy >= 0
        ax_, ay_ = anchor0[0] + dx, anchor0[1] + dy
        r = [ax_, ay_, ax_ + bw, ay_ + bh] if fwd else [ax_ - bw, ay_, ax_, ay_ + bh]
        if r[0] < vx0 + 4 or r[2] > vx1 - 4 or r[1] < vy0 + 4 or r[3] > vy1 - 4: continue
        if frac(I_dark, r) > 0.15: continue
        if any(hit(r, o) for o in other) or any(hit(r, m, 0) for m in moved): continue
        score = cost + 150.0 * frac(I_ink, r)
        if best is None or score < best[0]: best = (score, dx, dy, mdx, mdy, r, fwd)
    if not best:
        unresolved.append(dict(why=f"MLeader {h}: no free spot within {a.max_ft} ft / {a.leader_ft} ft of leader ({'; '.join(whys)})", handle=h)); continue
    score, dx, dy, mdx, mdy, r, fwd = best
    moved.append(r)
    plan.append(dict(handle=h, x=round(pos[0] + mdx, 4), y=round(pos[1] + mdy, 4), fromX=pos[0], fromY=pos[1], shiftFt=round(math.hypot(dx, dy) * k, 1),
                     side="right of the text position" if fwd else "left of the text position", why="; ".join(whys)))
out = dict(moves=plan, unresolved=unresolved, source=a.qc)
if a.out: json.dump(out, open(a.out, "w", encoding="utf-8"), indent=1)
print(f"{len(plan)} move(s), {len(unresolved)} unresolved")
for m in plan: print(f"  MOVE {m['handle']}  ({m['fromX']:.1f},{m['fromY']:.1f}) -> ({m['x']:.1f},{m['y']:.1f})  {m['shiftFt']} ft, text {m['side']}   [{m['why']}]")
for u in unresolved: print(f"  --   {u['why']}")
