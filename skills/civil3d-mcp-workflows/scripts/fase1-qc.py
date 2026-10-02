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
    - survey text plotted as STROKES (SHX fonts: SIMPLEX "SIGNAL", "W.P.P." ...) is not a PDF word, so it is found through the base DWGs: every TEXT/MTEXT of
      X-TOPO / X-ARCH / X-UTIL in the viewport that no printed word accounts for owns the text-sized strokes inside its text box (a later white fill = a mask
      of ours hides them); >= 1.5 pt of that ink inside the glyph area of one of our words = WARN "survey SHX text over our labels". The ink hulls also go to
      --json as obstacles, so fase1-declutter.py steers our MLeaders around them. The base dumps are cached per project (size + mtime of the DWG).
      Not covered: attribute text inside blocks and anything that is not TEXT/MTEXT. --debug-shx lists every text found.
    - foreign ink: on a copy of the PDF with every text removed, >= 15 % (--ink-limit) of the glyph area of a word of ours on symbols, fills or lines = WARN
      "foreign ink over our labels" (a hair-line crossing a word is 3-6 %). PL symbols are skipped (they sit on their lot line); labels already reported
      for SHX text or the asphalt fill are not repeated. fase1-declutter.py then picks a new spot with < 5 % non-text ink.
Exit 1 on any FAIL. Prints the exact item (handle / coordinates / PDF position) for every WARN/FAIL.
"""
import argparse, json, math, os, re, subprocess, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--dwg"); ap.add_argument("--pdf"); ap.add_argument("--dump"); ap.add_argument("--util-dump"); ap.add_argument("--asbuilt", help="asbuilt.json to verify the label values against (default: <project>/asbuilt.json or project.json sources.asbuilt)")
ap.add_argument("--tol", type=float, default=3.0)
ap.add_argument("--ink-limit", type=float, default=0.15, help="WARN when this fraction of a word of ours (glyph area) lies on survey symbols, fills or lines")
ap.add_argument("--debug-shx", action="store_true", help="print every survey SHX text the stroke check found (ink strokes, hull, ink over our words)")
ap.add_argument("--plan-labels", help="JSON list of native Civil 3D plan labels read live (planLabels of profileViewAnnotations): they become movable 'our labels'")
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
def base_dump_of(path):
    """Dump of a base xref (X-TOPO / X-UTIL / X-ARCH): they do not change between QC rounds, so keep one per project under %TEMP%, keyed by the
    DWG's size + mtime (the generic c3d-dwg-dump folder is shared by every project's X-TOPO.dwg, so it cannot be trusted for this)."""
    if not os.path.exists(path): return None
    import shutil, tempfile
    work = os.path.join(tempfile.gettempdir(), "c3d-fase1-qc-cache", re.sub(r"[^\w\-]", "_", os.path.basename(proj_dir)))
    os.makedirs(work, exist_ok=True)
    base = re.sub(r"[^\w\-]", "_", os.path.splitext(os.path.basename(path))[0])
    cache, key = os.path.join(work, base + "_dump.txt"), os.path.join(work, base + "_dump.key")
    st = os.stat(path); sig = f"{st.st_size}:{int(st.st_mtime)}"
    if os.path.exists(cache) and os.path.exists(key) and open(key).read().strip() == sig: return cache
    fresh = dump_of(path)
    if not fresh or not os.path.exists(fresh): return None
    shutil.copyfile(fresh, cache); open(key, "w").write(sig)
    return cache
dump = a.dump or dump_of(dwg)
udump = a.util_dump or base_dump_of(os.path.join(proj_dir, "X-UTIL.dwg"))
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

# ---------- native Civil 3D plan labels (read live; the headless dump cannot see their text/position) ----------
# NoteLabel EOP / RW and StationOffsetLabel ALGN START / END become pseudo MLeaders (arrow = the label's anchor, text position = its dragged
# location, same text the style prints) so ownership, the viewport-edge / under-asphalt / overlap checks and the declutter planner treat them like ours.
if a.plan_labels and os.path.exists(a.plan_labels):
    _pl = json.load(open(a.plan_labels, encoding="utf-8"))
    _sol = sorted([l for l in _pl if l.get("type") == "StationOffsetLabel" and l.get("location")], key=lambda l: 0 if "START" in str(l.get("style", "")).upper() else 1)
    for l in _pl:
        loc = l.get("labelLocation"); h = l.get("handle", "?")
        if not loc: continue
        if l.get("type") == "NoteLabel":
            an = l.get("anchor") or loc
            txt = {"EOP": "EOP", "RW": "EXIST R/W"}.get(str(l.get("style", "")).upper(), str(l.get("style", "")))
        elif l.get("type") == "StationOffsetLabel" and l.get("location"):
            an = l["location"]; first = _sol[0]["location"] if _sol else an
            station = math.hypot(an["x"] - first["x"], an["y"] - first["y"])
            title = "ALIGNMENT START" if "START" in str(l.get("style", "")).upper() else "ALIGNMENT END" if "END" in str(l.get("style", "")).upper() else str(l.get("style", ""))
            txt = f"{title}\\PSTA: {int(station // 100)}+{station % 100:05.2f}/OFF: 0.00'\\P({l.get('alignmentName', '')})\\PN: {an['y']:.2f}\\PE: {an['x']:.2f}"
        else: continue
        ents.append(dict(type="MULTILEADER", h=h, layer=l.get("layer", ""), x=str(an["x"]), y=str(an["y"]), txt=txt, txtpt=f"({loc['x']} {loc['y']} 0)", arrows=f"{an['x']},{an['y']};", h2="2.0", native="1", style=l.get("style", "")))
    print(f"native plan labels: {sum(1 for e in ents if e.get('native'))} loaded as our labels")

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
# U.E. (etapa 1.4): when the project confirmed an easement (site.ue), the sheet needs its label, its 2 dashed lines and its two 5.00' dims
_ue = (project.get("site") or {}).get("ue")
if _ue:
    _lab = [e for e in leaders if "U.E." in re.sub(r"\s+", " ", e.get("txt", "").replace("\\P", " "))]
    _w = float(_ue.get("widthFt", 5))
    _d5 = [d for d in dims if d.get("layer") == "C-ANNO" and abs(float(d.get("meas") or 0) - _w) < 0.05]
    _lines = [e for e in ents if e["type"] == "LWPOLYLINE" and e.get("layer") == "C-ANNO" and "DASHED" in str(e.get("lt", "")).upper()]
    add("OK" if _lab and len(_d5) >= 2 and len(_lines) >= 2 else "FAIL", "U.E. (site.ue)", f"{len(_lab)} label, {len(_d5)} dims of {_w:g} ft, {len(_lines)} dashed lines" + ("" if _lab and len(_d5) >= 2 and len(_lines) >= 2 else " - the confirmed easement is not (fully) on the sheet"))

label = next((e.get("txt", "") for e in ents if e["type"] == "MTEXT" and "SUBJECT PROPERTY" in e.get("txt", "")), None)
if not label: add("FAIL", "subject label", "no MTEXT with SUBJECT PROPERTY")
else:
    probs = []
    if subj.get("folio") and subj["folio"] not in label: probs.append(f"folio {subj['folio']} not in the label")
    if subj.get("gpd") and f"{subj['gpd']} GPD" not in label: probs.append(f"'{subj['gpd']} GPD' not in the label")
    pb = str(subj.get("pb") or "").replace("PG-", "").split()
    if pb and not all(x in label for x in pb): probs.append(f"P.B. {subj.get('pb')} not in the label")
    add("FAIL" if probs else "OK", "subject label = project.json (PA / POC)", "; ".join(probs) or f"folio {subj.get('folio')}, {subj.get('gpd')} GPD, P.B. {subj.get('pb')}")

# ---------- DATA VERIFICATION: the VALUES on the sheet against the source files (2026-10-02 audit; the checks above only look for presence) ----------
_flat = lambda t: re.sub(r"\s+", " ", (t or "").replace("\\P", " ")).strip()
# (a) dimensions in C-ANNO: R/W dims (~25 ft) must start on the survey PROPERTY_LINE; U.E. dims are the confirmed easement width; the others must
#     join an existing sewer line to an existing water line (utility separation: 8.00' / 6.00' on VILLA ONE) -- anything else has no source.
_tdump = base_dump_of(os.path.join(proj_dir, "X-TOPO.dwg"))
if rw and _tdump:
    _pls = []
    for _ln in open(_tdump, encoding="utf-8", errors="replace"):
        if _ln.startswith("ENT|") and _ln.split("|")[3] == "PROPERTY_LINE":
            _m = re.search(r"\|v=([^|]*)", _ln)
            if _m:
                _q = [tuple(map(float, s.split(",")[:2])) for s in _m.group(1).split(";") if s]
                _pls += list(zip(_q, _q[1:]))
    _uew = float(((project.get("site") or {}).get("ue") or {}).get("widthFt", 5))
    _bad_rw, _bad_len, _nosrc, _n_rw, _n_sep, _n_ue = [], [], [], 0, 0, 0
    for d in rw:
        p13, p14 = pt(d.get("p13")), pt(d.get("p14")); meas = float(d.get("meas") or 0)
        if not (p13 and p14): continue
        if abs(meas - dist(p13, p14)) > 0.05: _bad_len.append(f"{d.get('h')} says {meas:.2f} but its points are {dist(p13, p14):.2f} apart")
        on_pl = lambda p: any(seg_dist(p, A, B) <= 0.05 for A, B in _pls)
        on_san = lambda p: any(seg_dist(p, A, B) <= 0.05 for A, B in tramos)
        on_wat = lambda p: any(seg_dist(p, A, B) <= 0.05 for A, B in wat)
        if abs(meas - 25) < 0.5:
            _n_rw += 1
            if not (on_pl(p13) or on_pl(p14)): _bad_rw.append(f"{d.get('h')} ({meas:.2f}')")
        elif abs(meas - _uew) < 0.05: _n_ue += 1
        elif (on_san(p13) and on_wat(p14)) or (on_wat(p13) and on_san(p14)): _n_sep += 1
        else: _nosrc.append(f"{d.get('h')} ({meas:.2f}')")
    add("FAIL" if _bad_rw or _bad_len else "OK", "dimension values = geometry (R/W on PROPERTY_LINE)",
        "; ".join((["R/W dim not on a survey R/W line: " + ", ".join(_bad_rw)] if _bad_rw else []) + _bad_len) or f"{_n_rw} R/W dims on the survey R/W line, {_n_ue} U.E. dims, {_n_sep} utility-separation dims (SAN to WM)")
    # engine rule: one C-ANNO R/W dim per survey R/W dim (X-TOPO DIM / _NPLT-TXT, ~25 ft) inside the viewport, at the surveyor's own points
    _sv = []
    for _ln in open(_tdump, encoding="utf-8", errors="replace"):
        if _ln.startswith("DIM|Model"):
            _d = kv(_ln.strip().split("|")[2:])
            if abs(float(_d.get("meas") or 0) - 25) < 0.5 and pt(_d.get("p13")) and pt(_d.get("p14")) and in_view(pt(_d["tm"] if pt(_d.get("tm")) else _d["p13"])): _sv.append((_d.get("h"), pt(_d["p13"]), pt(_d["p14"])))
    _mine = [(pt(d["p13"]), pt(d["p14"])) for d in rw if abs(float(d.get("meas") or 0) - 25) < 0.5 and pt(d.get("p13")) and pt(d.get("p14"))]
    _same = lambda q, r: (dist(q[0], r[0]) < 0.5 and dist(q[1], r[1]) < 0.5) or (dist(q[0], r[1]) < 0.5 and dist(q[1], r[0]) < 0.5)
    _miss = [h for h, p1, p2 in _sv if not any(_same((p1, p2), m) for m in _mine)]
    _extra = [i for i, m in enumerate(_mine) if not any(_same(m, (p1, p2)) for _, p1, p2 in _sv)]
    add("WARN" if _miss or _extra else "OK", "R/W dims = survey R/W dims (1:1)", (f"{len(_miss)} survey dim(s) not mirrored ({', '.join(_miss)}); " if _miss else "") + (f"{len(_extra)} of ours are not at a survey dim's points" if _extra else "") or f"{len(_sv)} survey R/W dims in view, each mirrored once")
    if _nosrc: add("WARN", "dimensions without a source", ", ".join(_nosrc) + " touch neither a R/W line, the U.E. width nor an existing SAN/WM pair")
# (b) as-built values in the labels: RIM / INV / pipe + slope / water-main text of asbuilt.json (the user's confirmed review) = what is printed
_abp = a.asbuilt or next((os.path.join(proj_dir, p) for p in [(project.get("sources") or {}).get("asbuilt"), "asbuilt.json", "_asbuilts/asbuilt.json"] if p and os.path.exists(os.path.join(proj_dir, p))), None)
if not _abp: add("WARN", "label values = as-builts", "no asbuilt.json in the project folder (or project.json sources.asbuilt): RIM / INV / slopes not verified")
else:
    _ab = json.load(open(_abp, encoding="utf-8")); _bad, _chk = [], 0
    _src = dict(_ab.get("source") or {})
    if _src.get("simulated") is None and _src.get("confirmed") and os.path.exists(_src["confirmed"]):    # asbuilt.json from before 2026-10-02 carries no flags
        try: _c = json.load(open(_src["confirmed"], encoding="utf-8")); _src["simulated"] = _c.get("simulated") is True; _src["confirmedAt"] = _src.get("confirmedAt") or _c.get("confirmedAt")
        except Exception: pass
    if _src.get("simulated"): add("FAIL", "as-built provenance", "asbuilt.json was built from a SIMULATED review (source.simulated): not the user's confirmation")
    elif not _src.get("confirmedAt"): add("WARN", "as-built provenance", "asbuilt.json has no source.confirmedAt (no record of the user's confirmation)")
    else: add("OK", "as-built provenance", f"confirmed {_src['confirmedAt']}")
    for m in _ab.get("manholes", []):
        if m.get("rim") is None and not m.get("inv"): continue
        mp = (m["x"], m["y"])
        if not in_view(mp): continue
        lab = [e for e in leaders if "SAN MH" in _flat(e.get("txt", "")) and any(dist(q, mp) <= a.tol for q in arrows(e))]
        if not lab: continue                      # a missing label is already a FAIL above
        t = _flat(lab[0]["txt"]); _chk += 1
        rim = re.search(r"RIM:\s*([\d.]+)", t); invs = sorted((d_, float(v)) for v, d_ in re.findall(r"INV:\s*([\d.]+)'\s*\((\w)\)", t))
        if m.get("rim") is not None and (not rim or abs(float(rim.group(1)) - m["rim"]) > 0.005): _bad.append(f"{m['id']} RIM label {rim.group(1) if rim else 'none'} vs as-built {m['rim']}")
        if sorted((d_, float(v)) for d_, v in m.get("inv", [])) != invs: _bad.append(f"{m['id']} INV label {invs} vs as-built {m.get('inv')}")
    _far = [f"{m['id']} {m['deltaFt']} ft" for m in _ab.get("manholes", []) if (m.get("deltaFt") or 0) > 0.5 and in_view((m["x"], m["y"]))]
    if _far: add("WARN", "as-built vs survey manhole position", "as-built N/E differs from the X-UTIL symbol by > 0.5 ft (arrow follows the survey): " + ", ".join(_far))
    for sm in _ab.get("sewerMains", []):
        if not any(_flat(sm["text"]) in _flat(e.get("txt", "")) for e in leaders if "SAN MAIN" in _flat(e.get("txt", ""))) and any(in_view(p) for p in [(m_["x"], m_["y"]) for m_ in _ab["manholes"] if m_["id"] in (sm["from"], sm["to"])]):
            _bad.append(f"no label prints '{sm['text']}' ({sm['from']}->{sm['to']})")
    for wm in _ab.get("waterMains", []):
        if any(in_view(p) for p in (wm["a"], wm["b"])) and not any(_flat(wm["text"]) in _flat(e.get("txt", "")) and f"(PER {_ab.get('waterRef')})" in _flat(e.get("txt", "")) for e in leaders):
            _bad.append(f"no label prints '{wm['text']}' (PER {_ab.get('waterRef')})")
    add("FAIL" if _bad else "OK", "label values = as-builts (RIM / INV / pipe / slope / WM)", "; ".join(_bad) or f"{_chk} manhole labels + {len(_ab.get('sewerMains', []))} sewer mains + {len(_ab.get('waterMains', []))} water mains match {os.path.basename(_abp)}")
# (c) alignment labels: START/END N/E agree with the printed station (length) -- the alignment itself is read live by fase1_audit
_sta = {}
for e in ents:
    t = _flat(e.get("txt", ""))
    for k in ("START", "END"):
        m_ = re.search(rf"ALIGNMENT {k} STA: (\d+)\+(\d+\.\d+).*?N: ([\d.]+) E: ([\d.]+)", t)
        if m_: _sta[k] = (int(m_.group(1)) * 100 + float(m_.group(2)), float(m_.group(4)), float(m_.group(3)))
if len(_sta) == 2:
    _len = math.hypot(_sta["END"][1] - _sta["START"][1], _sta["END"][2] - _sta["START"][2]); _dst = _sta["END"][0] - _sta["START"][0]
    add("OK" if abs(_len - _dst) <= 0.5 else "FAIL", "alignment labels: station vs coordinates", f"N/E length {_len:.2f} ft vs station difference {_dst:.2f} ft")
else: add("WARN", "alignment labels: station vs coordinates", "START/END text labels not found in the dump (native labels: pass --plan-labels)")
# (d) the lot on the sheet vs the Property Appraiser lot (pa-area report): a measured lot smaller than its plat = probable R/W dedication
_paf = ((project.get("site") or {}).get("paArea") or {}).get("file")
if _paf and os.path.exists(_paf):
    _pa = json.load(open(_paf, encoding="utf-8")); _sl = _pa.get("subject") if isinstance(_pa.get("subject"), dict) else {}
    _sl = next((l for l in _pa.get("lots", []) if l.get("subject")), _sl)
    if _sl.get("delta") and max(abs(x) for x in _sl["delta"]) > 5:
        add("WARN", "lot vs plat (Property Appraiser)", f"folio {_sl.get('folio')}: legal {_sl.get('legalSize')} ft vs measured {_sl.get('measuredSize')} ft ({_sl.get('delta')}): {_sl.get('sizeCheck')} -> confirm with the plat; not printed on the sheet")
    else: add("OK", "lot vs plat (Property Appraiser)", f"folio {_sl.get('folio')}: measured lot within 5 ft of the legal size")

# ---------- legibility on the PDF ----------
if os.path.exists(pdf):
    import pymupdf as fitz
    import numpy as np
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
    # ---------- survey text the plot draws as STROKES (SHX fonts): the blind spot of every word-based check above ----------
    # SIMPLEX / ROMANS / ... (.shx) text is plotted as vector strokes, so it is not in page.get_text("words"): a survey "SIGNAL" or "W.P.P." crossing one
    # of OUR labels was invisible to the overlap check. The base DWGs know where each survey text is: for every TEXT/MTEXT of X-TOPO / X-ARCH / X-UTIL in
    # the viewport that no printed word accounts for (TrueType text is already covered above), the plotted strokes that fall inside its text box (text
    # frame, model feet) are its ink. Ink that no later white fill hides (our masks) and that crosses the glyph area of one of our words is a clash; the
    # ink hull of every such text also goes to the declutter planner as an obstacle, so the MLeader loop can steer clear of it.
    def to_pdf(m):
        dx, dy = m[0] - centre[0], m[1] - centre[1]
        px, py = (dx * c + dy * s) / scale, (-dx * s + dy * c) / scale
        return ((px + ps[0]) * 72, (page_h_in - (py + ps[1])) * 72)
    def clip_len(p, q, r):                      # length of segment p-q inside rect r (Liang-Barsky)
        x0, y0, dx, dy = p[0], p[1], q[0] - p[0], q[1] - p[1]
        t0, t1 = 0.0, 1.0
        for pp, qq in ((-dx, x0 - r.x0), (dx, r.x1 - x0), (-dy, y0 - r.y0), (dy, r.y1 - y0)):
            if pp == 0:
                if qq < 0: return 0.0
            else:
                t = qq / pp
                if pp < 0:
                    if t > t1: return 0.0
                    t0 = max(t0, t)
                else:
                    if t < t0: return 0.0
                    t1 = min(t1, t)
        return max(0.0, t1 - t0) * math.hypot(dx, dy)
    def poly_of(d_):
        pts = []
        for it in d_["items"]:
            if it[0] == "l":
                if not pts: pts.append(it[1])
                pts.append(it[2])
            elif it[0] == "re": q = it[1]; pts += [q.top_left, q.top_right, q.bottom_right, q.bottom_left]
            elif it[0] == "qu": q = it[1]; pts += [q.ul, q.ur, q.lr, q.ll]
        return pts
    def in_poly(p, poly):
        inside = False
        for i in range(len(poly)):
            (x1, y1), (x2, y2) = poly[i - 1], poly[i]
            if (y1 > p[1]) != (y2 > p[1]) and p[0] < (x2 - x1) * (p[1] - y1) / (y2 - y1) + x1: inside = not inside
        return inside
    draws = page.get_drawings()
    whites = [(d_.get("seqno", 0), d_["rect"], poly_of(d_)) for d_ in draws
              if d_["type"] in ("f", "fs") and tuple(round(x, 2) for x in (d_.get("fill") or ())) == (1.0, 1.0, 1.0)]
    strokes = []                                # (seqno, [segments], rect): text-sized stroked paths only (longer ones are linework)
    for d_ in draws:
        if d_["type"] != "s" or max(d_["rect"].width, d_["rect"].height) > 24: continue
        segs = []
        for it in d_["items"]:
            if it[0] == "l": segs.append((it[1], it[2]))
            elif it[0] == "c": segs += [(it[1], it[2]), (it[2], it[3]), (it[3], it[4])]
            elif it[0] == "qu": q = it[1]; segs += [(q.ul, q.ur), (q.ur, q.lr), (q.lr, q.ll), (q.ll, q.ul)]
            elif it[0] == "re": q = it[1]; segs += [(q.top_left, q.top_right), (q.top_right, q.bottom_right), (q.bottom_right, q.bottom_left), (q.bottom_left, q.top_left)]
        if segs: strokes.append((d_.get("seqno", 0), segs, d_["rect"]))
    def hidden(seq, p):                         # painted over by a later white fill (a mask of ours, a wipeout)
        return any(w[0] > seq and w[1].contains(fitz.Point(*p)) and (len(w[2]) < 3 or in_poly(p, w[2])) for w in whites)
    fmt_re = re.compile(r"\\[A-Za-z][^;\\]*;|\\[LlOoKk]|\\[~\\{}]|[{}]")
    survey = []
    for tag in ("X-TOPO", "X-ARCH", "X-UTIL"):
        dp = udump if tag == "X-UTIL" else base_dump_of(os.path.join(proj_dir, tag + ".dwg"))
        if not dp or not os.path.exists(dp): continue
        for line in open(dp, encoding="utf-8", errors="replace"):
            if not (line.startswith("ENT|TEXT|") or line.startswith("ENT|MTEXT|")): continue
            raw = line.rstrip("\n"); cut = raw.find("|txt=")
            f0 = (raw[:cut] if cut >= 0 else raw).split("|"); d = kv(f0[4:])
            lay = layers.get(f"{tag}|{f0[3]}")
            if lay and (int(lay.get("fl", "0") or 0) & 1 or lay.get("plot") == "0" or lay.get("c", "").lstrip().startswith("-")): continue   # frozen / off / not plotted
            if not d.get("x"): continue
            txt = fmt_re.sub("", (raw[cut + 5:] if cut >= 0 else "").replace("\\P", "\n")).replace("%%c", "Ø").replace("%%d", "°").replace("%%p", "±").replace("%%u", "").replace("%%o", "")
            lines = [l.strip() for l in txt.split("\n") if l.strip()]
            if not lines: continue
            h_ = float(d.get("h") or 0) or 2.0; th = float(d.get("rot") or 0); att = int(float(d["att"])) if d.get("att") else 0
            L = max(len(l) for l in lines) * 0.95 * h_; Ht = h_ + 1.667 * h_ * (len(lines) - 1); pad = 0.35 * h_
            if att:
                col, row = (att - 1) % 3, (att - 1) // 3
                u0, u1 = [(-pad, L + pad), (-L / 2 - pad, L / 2 + pad), (-L - pad, pad)][col]
                v0, v1 = [(-Ht - pad, pad), (-Ht / 2 - pad, Ht / 2 + pad), (-pad, Ht + pad)][row]
            else: u0, u1, v0, v1 = -L - pad, L + pad, -h_ - pad, 1.4 * h_ + pad        # TEXT: its justification is not in the dump -> wide box
            x_, y_ = float(d["x"]), float(d["y"])
            if not in_view((x_, y_), -(L + 6)): continue
            survey.append(dict(tag=tag, h=f0[2], x=x_, y=y_, cs=math.cos(th), sn=math.sin(th), box=(u0, u1, v0, v1), text=" ".join(lines), n=sum(len(l.replace(" ", "")) for l in lines),
                               toks={norm_w(w) for w in " ".join(lines).split()} - {""}))
    def in_box(m, t):
        dx, dy = m[0] - t["x"], m[1] - t["y"]
        u, v = dx * t["cs"] + dy * t["sn"], -dx * t["sn"] + dy * t["cs"]
        b = t["box"]; return b[0] <= u <= b[1] and b[2] <= v <= b[3]
    ours_words = []                             # (owner handle, text, rect, glyph area): the glyphs sit inside the font box, so shrink it
    for w in all_words:
        if w["o"]:
            r_ = fitz.Rect(w["r"]); hh = r_.height
            ours_words.append((w["o"], w["t"], r_, fitz.Rect(r_.x0, r_.y0 + 0.14 * hh, r_.x1, r_.y1 - 0.17 * hh)))
    by_handle = {o["h"]: o for o in ours}
    shx_hits, shx_clashes, shx_obstacles, n_shx = [], [], [], 0
    for t in survey:
        # TrueType survey text is already a printed word: skip the texts a word accounts for
        if any(w[4].strip() and norm_w(w[4]) in t["toks"] and in_box(to_model((w[0] + w[2]) / 2, (w[1] + w[3]) / 2), t) for w in words):
            if a.debug_shx: print(f"  [skip: printed as a word] {t['tag']} {t['h']} '{t['text']}'")
            continue
        corners = [to_pdf((t["x"] + u * t["cs"] - v * t["sn"], t["y"] + u * t["sn"] + v * t["cs"])) for u in t["box"][:2] for v in t["box"][2:]]
        R = fitz.Rect(min(q[0] for q in corners), min(q[1] for q in corners), max(q[0] for q in corners), max(q[1] for q in corners))
        ink = [st for st in strokes if st[2].intersects(R) and in_box(to_model((st[2].x0 + st[2].x1) / 2, (st[2].y0 + st[2].y1) / 2), t)]
        ink = [(st[0], [sg for sg in st[1] if not hidden(st[0], ((sg[0][0] + sg[1][0]) / 2, (sg[0][1] + sg[1][1]) / 2))]) for st in ink]
        ink = [st for st in ink if st[1]]
        segs = [sg for _, ss in ink for sg in ss]
        if len(ink) < max(2, round(0.5 * t["n"])):                  # not (visibly) plotted: nothing there to clash with (frozen in the viewport, hidden, or not text)
            if a.debug_shx: print(f"  [skip: {len(ink)} visible strokes < {max(2, round(0.5 * t['n']))}] {t['tag']} {t['h']} '{t['text']}' at PDF {R.x0:.0f},{R.y0:.0f}")
            continue
        hull = fitz.Rect(min(min(sg[0][0], sg[1][0]) for sg in segs), min(min(sg[0][1], sg[1][1]) for sg in segs),
                         max(max(sg[0][0], sg[1][0]) for sg in segs), max(max(sg[0][1], sg[1][1]) for sg in segs))
        n_shx += 1
        shx_obstacles.append(dict(r=list(hull), t=t["text"], o=None, vis=True))
        per = {}
        for oh, otxt, r_, g in ours_words:
            if not g.intersects(hull): continue
            ln = sum(clip_len(sg[0], sg[1], g) for sg in segs)
            if ln > 0:
                e_ = per.setdefault(oh, [0.0, set(), fitz.Rect(g)]); e_[0] += ln; e_[1].add(otxt); e_[2] |= g
        if a.debug_shx: print(f"  [shx] {t['tag']} {t['h']} '{t['text']}' strokes {len(ink)} hull {tuple(round(v, 1) for v in hull)} ink-over-ours {{{', '.join(f'{k}: {v[0]:.1f}pt' for k, v in per.items())}}}")
        for oh, (ln, toks_, grect) in per.items():
            if ln < 1.5: continue                                    # a hair grazing the font box is not a crossing
            lab = by_handle.get(oh)
            shx_clashes.append(dict(kind="overlap", words=[(lab["text"] if lab else "label")[:40], t["text"]], rects=[list(grect), list(hull)], owners=[oh, None]))
            shx_hits.append(f"survey '{t['text']}' ({t['tag']} {t['h']}) crosses {'MLeader' if lab and lab['type'] == 'MULTILEADER' else 'label'} {oh} \"{(lab['text'] if lab else '')[:36]}\" ({ln:.1f} pt of ink; words {', '.join(sorted(toks_))[:50]}) at PDF {grect.x0:.0f},{grect.y0:.0f}")
    clashes += shx_clashes
    all_words += shx_obstacles
    add("WARN" if shx_hits else "OK", "survey SHX text over our labels", (f"{len(shx_hits)} crossing(s): " + "; ".join(shx_hits[:8]) + (" ..." if len(shx_hits) > 8 else "")) if shx_hits else f"none of the {n_shx} stroke-plotted survey texts in the viewport touches our text")
    # ---------- foreign ink (symbols, fills, lines) over the glyphs of our words ----------
    # The checks above only see TEXT. A survey symbol, a black fill or a heavy line under one of our MLeader words still makes it unreadable (TEST10: "(TO REMAIN)"
    # on a black symbol, 0 WARN). Take a copy of the page with EVERY text removed (what is left is linework, fills, symbols and the SHX strokes) and measure how
    # much of each word's glyph area is dark: a hair-line crossing a word is ~3-6 %, a symbol or fill is >= 15 %. PL symbols sit on their lot line by design: skipped.
    # Labels already reported above (SHX text, under the asphalt fill) are not reported twice.
    fdoc = fitz.open(pdf); fpage = fdoc[0]
    for w in fpage.get_text("words"): fpage.add_redact_annot(fitz.Rect(w[:4]))
    fpage.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE, text=fitz.PDF_REDACT_TEXT_REMOVE)
    fpix = fpage.get_pixmap(dpi=200, colorspace=fitz.csGRAY); fk = 200 / 72
    fimg = np.frombuffer(fpix.samples, dtype=np.uint8).reshape(fpix.height, fpix.width) < 140
    already = {o_ for cl in shx_clashes for o_ in cl["owners"] if o_} | {o["h"] for o in under}
    ink_by_label = {}
    for oh, otxt, r_, g in ours_words:
        if by_handle.get(oh, {}).get("type") != "MULTILEADER" or oh in already: continue
        sub = fimg[max(0, int(g.y0 * fk)):int(g.y1 * fk) + 1, max(0, int(g.x0 * fk)):int(g.x1 * fk) + 1]
        frac_ = float(sub.mean()) if sub.size else 0.0
        if frac_ >= a.ink_limit: ink_by_label.setdefault(oh, []).append((frac_, otxt, g))
    ink_hits = []
    for oh, ws_ in ink_by_label.items():
        lab = by_handle[oh]; ws_.sort(key=lambda t: -t[0]); grect = fitz.Rect(ws_[0][2])
        for t_ in ws_[1:]: grect |= t_[2]
        clashes.append(dict(kind="foreign_ink", words=[lab["text"][:40], "foreign ink"], rects=[list(grect), list(grect)], owners=[oh, None]))
        ink_hits.append(f"MLeader {oh} \"{lab['text'][:36]}\": " + ", ".join(f"'{t_[1]}' {t_[0]:.0%}" for t_ in ws_[:4]) + f" of the glyph area is symbol/fill/line ink, at PDF {grect.x0:.0f},{grect.y0:.0f}"
                        + f" [model {lab['pos'][0]:.1f},{lab['pos'][1]:.1f}]")
    add("WARN" if ink_hits else "OK", "foreign ink over our labels", (f"{len(ink_hits)} label(s): " + "; ".join(ink_hits[:8])) if ink_hits else f"no word of ours has >= {a.ink_limit:.0%} of its glyph area on symbols, fills or lines")
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
