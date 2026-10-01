"""FASE 1 QC WITHOUT A GUIDE (etapa 1.8): is the C-300 sheet complete and legible, judged only against the base data?

    python fase1-qc.py --dir "<project folder>" [--dwg <FASE 1.dwg>] [--pdf <C-300 plot.pdf>] [--dump <dwg dump>] [--util-dump <X-UTIL dump>]

Reads (all read-only): the saved DWG through dwg-dump.ps1 (Core Console on a %TEMP% copy), X-UTIL.dwg the same way, project.json and
the plot PDF (default _QC/C-300 FASE 1.pdf). No guide anywhere. Checks, each OK / WARN / FAIL:
  completeness, inside the C-300 viewport (model rectangle = target + viewctr turned by the twist, size w x ht at the viewport scale):
    - every X-UTIL manhole (ELLIPSE, or a junction of 2+ SAN segments) has an "SAN MH" MLeader whose arrow is on it (<= 3 ft)
    - every X-UTIL SAN tramo (split at the manholes) has a "SAN MAIN" MLeader whose arrow is on it (<= 3 ft)
    - every X-UTIL water line has a "WATER MAIN" MLeader on it; every FH block has an "EXIST FH" MLeader
    - PL symbols (U+214A), R/W dims (C-ANNO), street labels, the alignment, the 3 xrefs (and their files) are present
    - the survey's own DIM layer is frozen (it would double the R/W dims)
  cross-checked data: the subject label's folio / GPD / P.B. = project.json (which pa-site.mjs filled from the Property Appraiser)
  legibility on the PDF: words of different text lines overlapping each other (>= 8 % of the smaller box: a rotated word crossing a label barely touches its box), words < 5 pt
Exit 1 on any FAIL. Prints the exact item (handle / coordinates / PDF position) for every WARN/FAIL.
"""
import argparse, json, math, os, re, subprocess, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--dwg"); ap.add_argument("--pdf"); ap.add_argument("--dump"); ap.add_argument("--util-dump")
ap.add_argument("--tol", type=float, default=3.0)
ap.add_argument("--json", help="write the clashes + every movable label (box in PDF pt, text position, arrows) for fase1-declutter.py")
a = ap.parse_args()
proj_dir = os.path.abspath(a.dir)
project = json.load(open(os.path.join(proj_dir, "project.json"), encoding="utf-8"))
dwg = a.dwg or os.path.join(proj_dir, project.get("deliverables", {}).get("dwg") or f"{os.path.basename(proj_dir)} FASE 1.dwg")
pdf = a.pdf or os.path.join(proj_dir, project.get("deliverables", {}).get("pdf") or "_QC/C-300 FASE 1.pdf")
rows = []
def add(level, what, detail=""): rows.append((level, what, detail))

def dump_of(path):
    out = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", os.path.join(HERE, "dwg-dump.ps1"), path],
                         capture_output=True, text=True, timeout=900).stdout.strip().splitlines()
    return out[-1].strip() if out else None
dump = a.dump or dump_of(dwg)
udump = a.util_dump or dump_of(os.path.join(proj_dir, "X-UTIL.dwg"))
if not dump or not os.path.exists(dump): sys.exit(f"no dump for {dwg}")

def kv(fields):
    d = {}
    for f in fields:
        i = f.find("=")
        if i > 0: d[f[:i]] = f[i + 1:]
    return d
def pt(s):
    m = re.search(r"\(([-\d.eE+]+)\s+([-\d.eE+]+)", s or "")
    return (float(m.group(1)), float(m.group(2))) if m else None

ents, dims, vports, layers, xrefs = [], [], [], {}, []
for line in open(dump, encoding="utf-8", errors="replace"):
    f = line.rstrip("\n").split("|")
    if f[0] == "ENT":
        # the text itself may contain "|" (MText font codes "\fArial|b1|i0|...") -> take everything after "|txt=" verbatim
        raw = line.rstrip("\n"); cut = raw.find("|txt=")
        d = kv((raw[:cut] if cut >= 0 else raw).split("|")[4:]); d["txt"] = raw[cut + 5:] if cut >= 0 else ""
        d.update(type=f[1], h=f[2], layer=f[3]); ents.append(d)
    elif f[0] == "DIM" and f[1] == "Model":
        d = kv(f[2:]); dims.append(d)
    elif f[0] == "VPORT":
        d = kv(f[2:]); d["layout"] = f[1]; vports.append(d)
    elif f[0] == "LAYER":
        layers[f[1] + ("|" + f[2] if not f[2].startswith("c=") else "")] = kv(f[2:] if f[2].startswith("c=") else f[3:])
    elif f[0] == "XREF":
        xrefs.append((f[1], f[2]))

# ---------- viewport rectangle in model space ----------
vp = max((v for v in vports if v["layout"] == "C-300" and v.get("layer") == "VPORT"), key=lambda v: float(v["w"]) * float(v["ht"]), default=None)
if not vp: sys.exit("no C-300 model viewport in the dump")
T = float(vp["twist_rad"]); tgt = pt(vp.get("target")); vc = pt(vp["viewctr"])
if not tgt: sys.exit("the dump has no viewport target: update dwg-dump.ps1 (2026-10-01+)")
c, s = math.cos(-T), math.sin(-T)
centre = (tgt[0] + vc[0] * c - vc[1] * s, tgt[1] + vc[0] * s + vc[1] * c)
scale = float(vp["viewht"]) / float(vp["ht"])           # model ft per sheet inch
half_u, half_v = float(vp["w"]) * scale / 2, float(vp["viewht"]) / 2
ux, uy = c, s                                             # sheet +x in model
def in_view(p, margin=0.0):
    dx, dy = p[0] - centre[0], p[1] - centre[1]
    return abs(dx * ux + dy * uy) <= half_u - margin and abs(-dx * uy + dy * ux) <= half_v - margin
add("OK", "viewport", f"C-300 {vp['h']}: centre {centre[0]:.2f},{centre[1]:.2f}, 1\" = {scale:.0f}', twist {math.degrees(T):.4f} deg")

# ---------- X-UTIL features ----------
mh_nodes, san, wat = [], [], []
if udump and os.path.exists(udump):
    for line in open(udump, encoding="utf-8", errors="replace"):
        f = line.rstrip("\n").split("|")
        if f[0] != "ENT": continue
        sysname = "SAN" if re.search(r"SAN|SEW", f[3], re.I) else "WAT" if re.search(r"WAT|WM|WTR", f[3], re.I) else None
        if not sysname: continue
        d = kv(f[4:]); p0 = (float(d["x"]), float(d["y"]))
        if f[1] in ("ELLIPSE", "CIRCLE") and sysname == "SAN": mh_nodes.append(p0)
        elif f[1] == "LINE": (san if sysname == "SAN" else wat).append((p0, pt(d["p2"])))
        elif f[1] == "LWPOLYLINE":
            v = [tuple(map(float, x.split(","))) for x in d.get("v", "").split(";") if x]
            (san if sysname == "SAN" else wat).extend(zip(v, v[1:]))
else: add("WARN", "X-UTIL", "no X-UTIL dump: utility completeness not checked")
dist = lambda p, q: math.hypot(p[0] - q[0], p[1] - q[1])
ends = Counter((round(p[0], 1), round(p[1], 1)) for seg in san for p in seg)
for k, n in ends.items():
    if n >= 2 and not any(dist(k, m) < 2 for m in mh_nodes): mh_nodes.append(k)
def seg_dist(p, a_, b_):
    dx, dy = b_[0] - a_[0], b_[1] - a_[1]; L2 = dx * dx + dy * dy or 1
    t = max(0, min(1, ((p[0] - a_[0]) * dx + (p[1] - a_[1]) * dy) / L2))
    return math.hypot(p[0] - a_[0] - t * dx, p[1] - a_[1] - t * dy)
tramos = []
for a_, b_ in san:
    cuts = sorted([m for m in mh_nodes if 0.5 < dist(m, a_) and 0.5 < dist(m, b_) and seg_dist(m, a_, b_) < 1.0], key=lambda m: dist(m, a_))
    pts = [a_, *cuts, b_]; tramos += list(zip(pts, pts[1:]))

leaders = [e for e in ents if e["type"] == "MULTILEADER" and e.get("x")]
def arrows(e):
    # arrowheads from dwg-dump's arrows= (2026-10-01+); x/y is only a fallback (it is the landing for acad_create_mleader leaders)
    pts = [tuple(map(float, p.split(","))) for p in e.get("arrows", "").split(";") if "," in p]
    return pts or [(float(e["x"]), float(e["y"]))]
def has_leader(pred, near):
    # (line breaks count as spaces: the generator wraps "SAN MAIN" as SAN\PMAIN)
    return [e for e in leaders if pred(re.sub(r"\s+", " ", e.get("txt", "").replace("\\P", " "))) and any(near(q) for q in arrows(e))]
miss = []
for m in mh_nodes:
    if not in_view(m): continue
    if not has_leader(lambda t: "SAN MH" in t, lambda q: dist(q, m) <= a.tol): miss.append(f"MH at {m[0]:.2f},{m[1]:.2f}")
add("FAIL" if miss else "OK", "every X-UTIL manhole labeled", "; ".join(miss) or f"{sum(in_view(m) for m in mh_nodes)} in view, all labeled")
miss = []
for a_, b_ in tramos:
    mid = ((a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2)
    if not (in_view(a_) or in_view(b_) or in_view(mid)): continue
    if not has_leader(lambda t: "SAN MAIN" in t, lambda q: seg_dist(q, a_, b_) <= a.tol): miss.append(f"SAN {a_[0]:.1f},{a_[1]:.1f} -> {b_[0]:.1f},{b_[1]:.1f}")
add("FAIL" if miss else "OK", "every X-UTIL sewer tramo labeled", "; ".join(miss) or "all labeled")
miss = []
for a_, b_ in wat:
    mid = ((a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2)
    if not (in_view(a_) or in_view(b_) or in_view(mid)): continue
    if not has_leader(lambda t: "WATER MAIN" in t, lambda q: seg_dist(q, a_, b_) <= a.tol): miss.append(f"WM {a_[0]:.1f},{a_[1]:.1f} -> {b_[0]:.1f},{b_[1]:.1f}")
add("WARN" if miss else "OK", "every X-UTIL water line labeled", "; ".join(miss) or "all labeled")
fhs = [e for e in ents if e["type"] == "INSERT" and e.get("block", "").upper() == "FH" and in_view((float(e["x"]), float(e["y"])))]
miss = [f"FH {e['h']}" for e in fhs if not has_leader(lambda t: "EXIST FH" in t, lambda q, e=e: dist(q, (float(e["x"]), float(e["y"]))) <= a.tol)]
add("FAIL" if miss else "OK", "every FH labeled", ", ".join(miss) or f"{len(fhs)} FH in view, all labeled")

# ---------- presence ----------
inv = lambda e: e.get("x") and in_view((float(e["x"]), float(e["y"])))
pl = [e for e in ents if e["type"] == "MTEXT" and "214A" in e.get("txt", "") and inv(e)]
add("OK" if pl else "FAIL", "PL symbols", f"{len(pl)} in view")
rw = [d for d in dims if d.get("layer") == "C-ANNO" and pt(d.get("tm")) and in_view(pt(d["tm"]))]
add("OK" if len(rw) >= 2 else "FAIL", "R/W dimensions (C-ANNO)", f"{len(rw)} in view")
sdim = layers.get("X-TOPO|DIM")
if sdim is not None:
    frozen = int(sdim.get("fl", "0")) & 1
    add("OK" if frozen or not rw else "WARN", "survey dimensions hidden", "X-TOPO|DIM frozen" if frozen else "X-TOPO|DIM visible: R/W dims print doubled -> freeze it")
streets = [e for e in ents if e["type"] == "MTEXT" and re.search(r"\b(STREET|AVENUE|AVE|ST|ROAD|CT|TER)\b", e.get("txt", "")) and inv(e) and "FOLIO" not in e.get("txt", "")]
add("OK" if len(streets) >= 2 else "WARN", "street labels", f"{len(streets)} in view")
add("OK" if any(e["type"] == "AECC_ALIGNMENT" for e in ents) else "FAIL", "alignment", "present" if any(e["type"] == "AECC_ALIGNMENT" for e in ents) else "none")
need = {"X-TOPO", "X-UTIL", "X-ARCH"}; got = {n.upper() for n, _ in xrefs}
missing_files = [p for n, p in xrefs if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(dwg), p)))]
add("OK" if need <= got and not missing_files else "FAIL", "xrefs", f"{', '.join(sorted(got))}" + (f"; file not found: {', '.join(missing_files)}" if missing_files else "") + (f"; missing: {', '.join(sorted(need - got))}" if need - got else ""))

# ---------- cross-checked data (subject label vs project.json, filled from the Property Appraiser / POC) ----------
subj = project.get("subject", {})
label = next((e.get("txt", "") for e in ents if e["type"] == "MTEXT" and "SUBJECT PROPERTY" in e.get("txt", "")), None)
if not label: add("FAIL", "subject label", "no MTEXT with SUBJECT PROPERTY")
else:
    probs = []
    if subj.get("folio") and subj["folio"] not in label: probs.append(f"folio {subj['folio']} not in the label")
    if subj.get("gpd") and f"{subj['gpd']} GPD" not in label: probs.append(f"'{subj['gpd']} GPD' not in the label")
    pb = str(subj.get("pb") or "").replace("PG-", "").split()
    if pb and not all(x in label for x in pb): probs.append(f"P.B. {subj.get('pb')} not in the label")
    add("FAIL" if probs else "OK", "subject label = project.json (PA / POC)", "; ".join(probs) or f"folio {subj.get('folio')}, {subj.get('gpd')} GPD, P.B. {subj.get('pb')}")

# ---------- legibility on the PDF ----------
if os.path.exists(pdf):
    import pymupdf as fitz
    page = fitz.open(pdf)[0]
    words = page.get_text("words")
    tiny = [w for w in words if (w[3] - w[1]) < 5 and (w[2] - w[0]) < 5 * max(1, len(w[4]))]
    add("WARN" if tiny else "OK", "PDF tiny text (< 5 pt)", f"{len(tiny)} word(s)" + (f", e.g. '{tiny[0][4]}' at {tiny[0][0]:.0f},{tiny[0][1]:.0f}" if tiny else ""))
    hits, seen = [], set()
    # words under a filled black area (survey texts under the asphalt hatch) are in the PDF but not visible: skip them
    pix = page.get_pixmap(dpi=36, colorspace=fitz.csGRAY); k = 36 / 72
    def dark_frac(r, lim=60):
        x0, y0, x1, y1 = int(r.x0 * k), int(r.y0 * k), max(int(r.x1 * k), int(r.x0 * k) + 1), max(int(r.y1 * k), int(r.y0 * k) + 1)
        vals = [pix.pixel(x, y)[0] for x in range(max(0, x0), min(pix.width, x1)) for y in range(max(0, y0), min(pix.height, y1))]
        return sum(v < lim for v in vals) / len(vals) if vals else 0.0
    def visible(r): return dark_frac(r) < 0.85
    # PDF point -> model (paper inches from the viewport centre, times the scale, turned by the twist); page = sheet, 72 pt/in
    ps = pt(vp["psctr"]); page_h_in = page.rect.height / 72
    def to_model(x, y):
        px, py = x / 72 - ps[0], (page_h_in - y / 72) - ps[1]
        return (centre[0] + (px * c - py * s) * scale, centre[1] + (px * s + py * c) * scale)
    movable = [e for e in ents if e.get("x") and (e["type"] in ("MTEXT", "MULTILEADER", "TEXT"))]
    def nearest(m, words=()):
        pool = [e for e in movable if "214A" in e.get("txt", "")] if any("⅊" in w for w in words) else movable
        best = min(pool or movable, key=lambda e: dist(m, (float(e["x"]), float(e["y"]))), default=None)
        if not best: return ""
        d = dist(m, (float(best["x"]), float(best["y"])))
        kind = "PL symbol" if "214A" in best.get("txt", "") else best["type"]
        return f" [model {m[0]:.1f},{m[1]:.1f}; nearest {kind} {best['h']} at {d:.1f} ft]"
    boxes = [(fitz.Rect(w[:4]), w[4], (w[5], w[6])) for w in words if w[4].strip() and visible(fitz.Rect(w[:4]))]
    # --- who owns each printed word? Only OUR labels can be moved: MLeaders (text position = txtpt) and PL symbols. A word belongs to the
    # nearest one (in model space, <= 80 ft from its text position) whose own text contains that word; survey/xref words have no owner.
    code_re = re.compile(r"\\[A-Za-z][^;\\]*;|\\P|[{}]")
    norm_w = lambda t: re.sub(r"[^A-Z0-9⅊]", "", t.upper())
    ours = []
    for e in ents:
        if e["type"] == "MULTILEADER" and pt(e.get("txtpt")):
            toks = {norm_w(x) for x in code_re.sub(" ", e.get("txt", "")).split()} - {""}
            ours.append(dict(h=e["h"], type="MULTILEADER", raw=e.get("txt", ""), pos=pt(e["txtpt"]), toks=toks, ntok=sum(1 for x in code_re.sub(" ", e.get("txt", "")).split() if norm_w(x)), text=code_re.sub(" ", e.get("txt", "")).strip(), arrows=arrows(e)))
        elif e["type"] == "MTEXT" and "214A" in e.get("txt", "") and e.get("x"):
            ours.append(dict(h=e["h"], type="PL", raw="", pos=(float(e["x"]), float(e["y"])), toks={"⅊"}, text="PL", arrows=[]))
    # The text box hangs from the text position: to the right (sheet +x) when the position is "forward" of the arrow, to the left otherwise
    # (plugin MoveMLeaderText: TopLeft / TopRight attachment), about 1 ft per character wide and 2 ft per line tall at this text height.
    for o in ours:
        if o["type"] != "MULTILEADER": continue
        lines = re.split(r"\\P", o["raw"])
        o["W"] = 1.05 * max(len(code_re.sub("", l)) for l in lines); o["H"] = 2.1 * len(lines)
        ar = o["arrows"][0]; o["fwd"] = (o["pos"][0] - ar[0]) * ux + (o["pos"][1] - ar[1]) * uy >= 0
    def box_dist(o, m):
        if o["type"] != "MULTILEADER": return dist(m, o["pos"])
        da, dd = (m[0] - o["pos"][0]) * ux + (m[1] - o["pos"][1]) * uy, (m[0] - o["pos"][0]) * uy - (m[1] - o["pos"][1]) * ux
        lo, hi = (0, o["W"]) if o["fwd"] else (-o["W"], 0)
        return math.hypot(max(0, lo - da, da - hi), max(0, -1.5 - dd, dd - (o["H"] + 1.5)))
    def owner_of(rect, text):
        m = to_model((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
        c_ = [(box_dist(o, m), o) for o in ours if norm_w(text) in o["toks"]]
        c_ = [t for t in c_ if t[0] <= 6]
        return min(c_, key=lambda t: t[0])[1] if c_ else None
    for o in ours: o["rect"] = None; o["hidden"] = 0; o["words"] = 0
    all_words = []
    for w in words:
        if not w[4].strip(): continue
        r_ = fitz.Rect(w[:4]); o = owner_of(r_, w[4]); vis_ = visible(r_)
        all_words.append(dict(r=list(r_), t=w[4], o=o and o["h"], vis=bool(vis_)))
        if o is None: continue
        o["rect"] = fitz.Rect(r_) if o["rect"] is None else o["rect"] | r_
        o["words"] += 1; o["hidden"] += 1 if dark_frac(r_, 80) >= 0.25 else 0
    clashes = []
    # the survey's own street name ("S.W. 118TH AVENUE") sits UNDER our masked street label ("SW 118TH AVENUE"): the PDF keeps both
    # words but the mask hides the survey one -> a pair whose words both belong to one of our street labels is not a clash
    street_tokens = [set(re.sub(r"[^A-Z0-9 ]", " ", e.get("txt", "").upper()).split()) for e in streets]
    norm = lambda t: re.sub(r"[^A-Z0-9]", "", t.upper())
    hidden_dupe = lambda t1, t2: any(norm(t1) in tok and norm(t2) in tok for tok in street_tokens)
    for i in range(len(boxes)):
        r1, t1, k1 = boxes[i]
        for j in range(i + 1, len(boxes)):
            r2, t2, k2 = boxes[j]
            if k1 == k2 or not r1.intersects(r2) or hidden_dupe(t1, t2): continue
            inter = r1 & r2
            small = min(r1.get_area(), r2.get_area()) or 1
            ratio = inter.get_area() / small
            if ratio >= 0.08:
                # 8-25 %: a rotated word grazing a label only counts when one of the two is OUR label (survey-vs-survey grazing is not ours to fix)
                o1, o2 = owner_of(r1, t1), owner_of(r2, t2)
                if ratio < 0.25 and not (o1 or o2): continue
                key = (round(r1.x0 / 20), round(r1.y0 / 20))
                if key in seen: continue
                seen.add(key)
                clashes.append(dict(kind="overlap", words=[t1, t2], rects=[list(r1), list(r2)], owners=[o1 and o1["h"], o2 and o2["h"]]))
                hits.append(f"'{t1}' x '{t2}' at PDF {r1.x0:.0f},{r1.y0:.0f}" + nearest(to_model((r1.x0 + r1.x1) / 2, (r1.y0 + r1.y1) / 2), (t1, t2)))
    under = [o for o in ours if o["type"] == "MULTILEADER" and o["words"] and o["hidden"]]
    for o in under: clashes.append(dict(kind="under_asphalt", words=[o["text"][:40]], rects=[list(o["rect"])], owners=[o["h"]]))
    add("WARN" if under else "OK", "our labels under the survey fill", ("; ".join(f"MLeader {o['h']} ({o['hidden']}/{o['words']} words hidden) at model {o['pos'][0]:.1f},{o['pos'][1]:.1f}" for o in under)) if under else "none hidden (asphalt does not cover any of our MLeader text)")
    # a label whose text box reaches the viewport edge is cut off there (the viewport clips model space): words beyond the edge are not in the PDF at all
    vx0 = (ps[0] - float(vp["w"]) / 2) * 72; vx1 = (ps[0] + float(vp["w"]) / 2) * 72
    vy0 = (page_h_in - ps[1] - float(vp["ht"]) / 2) * 72; vy1 = (page_h_in - ps[1] + float(vp["ht"]) / 2) * 72
    # (words the viewport clips away are missing from the PDF: fewer printed words than the label has = text cut off)
    edge = [o for o in ours if o["type"] == "MULTILEADER" and any(in_view(q) for q in o["arrows"]) and o["words"] < o.get("ntok", 0)
            or o["type"] == "MULTILEADER" and o["rect"] is not None and (o["rect"].x0 < vx0 + 3 or o["rect"].x1 > vx1 - 3 or o["rect"].y0 < vy0 + 3 or o["rect"].y1 > vy1 - 3)]
    for o in edge: clashes.append(dict(kind="viewport_edge", words=[o["text"][:40]], rects=[list(o["rect"])], owners=[o["h"]]))
    add("WARN" if edge else "OK", "our labels inside the viewport", ("; ".join(f"MLeader {o['h']} is cut off by the viewport edge ({o['words']}/{o.get('ntok', 0)} words printed) at model {o['pos'][0]:.1f},{o['pos'][1]:.1f}" for o in edge)) if edge else "none cut by the viewport edge")
    if a.json:
        vx0 = (ps[0] - float(vp["w"]) / 2) * 72; vx1 = (ps[0] + float(vp["w"]) / 2) * 72
        vy0 = (page_h_in - ps[1] - float(vp["ht"]) / 2) * 72; vy1 = (page_h_in - ps[1] + float(vp["ht"]) / 2) * 72
        json.dump(dict(pdf=pdf, ft_per_pt=scale / 72, ux=ux, uy=uy, view_rect=[vx0, vy0, vx1, vy1], clashes=clashes, words=all_words,
                       labels=[dict(h=o["h"], type=o["type"], pos=o["pos"], arrows=o["arrows"], fwd=o.get("fwd"), W=o.get("W"), rect=list(o["rect"]) if o["rect"] else None,
                                    text=o["text"], words=o["words"], hidden=o["hidden"]) for o in ours]),
                  open(a.json, "w", encoding="utf-8"), indent=1)
    add("WARN" if hits else "OK", "PDF overlapping texts", f"{len(hits)} spot(s)" + (": " + "; ".join(hits[:12]) + (" ..." if len(hits) > 12 else "") if hits else ""))
else: add("WARN", "PDF", f"{pdf} not found: plot first (qc-plot.ps1 / fase1-finish.mjs)")

order = {"FAIL": 0, "WARN": 1, "OK": 2}
for lvl, what, det in sorted(rows, key=lambda r: order[r[0]]):
    print(f"{lvl:4}  {what}" + (f"  -  {det}" if det else ""))
fails = sum(1 for r in rows if r[0] == "FAIL")
print(f"\nFASE 1 QC (no guide): {fails} FAIL, {sum(1 for r in rows if r[0] == 'WARN')} WARN, {sum(1 for r in rows if r[0] == 'OK')} OK")
sys.exit(1 if fails else 0)
