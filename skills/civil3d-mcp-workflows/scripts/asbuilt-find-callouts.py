"""AS-BUILT: find pipe callouts the first OCR pass saw but the review/assoc never got (born 2026-10-02, Goulds 33809: "419' 8" DIP WM" and "278' 8" DIP WM" of
E11826-1 were in the raw OCR but not in assoc.items, so the water main stayed unsized). Read-only: it only writes crops + a JSON list.

    python asbuilt-find-callouts.py --scan-dir <project>\\_reports\\scan --tif-dir <project>\\scans [--pattern REGEX] [--out-dir <dir>]

For every <ref>.ocr.json it takes the OCR LINES (dicts with "words") whose text matches the pipe-material pattern (DIP, PVC, HDPE, C900, WM, FM, SAN, ...),
drops the ones already covered by an item of <ref>.assoc.json (box overlap AND the matched token is in that item's text), and for the rest saves an UPRIGHT
crop (rotated lines are turned) to <out-dir>\\<ref>_<n>.png. READ THE CROP (it is the only reliable reading: OCR drops the number in front of DIP), then add it with
    node asbuilt-add-callout.mjs --dir <project> --scan <ref> --text "<what the crop says>" --box x,y,w,h --by "<who authorised reading it>"
"""
import argparse, json, os, re, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

ap = argparse.ArgumentParser()
ap.add_argument("--scan-dir", required=True); ap.add_argument("--tif-dir", required=True)
ap.add_argument("--pattern", default=r'(?<![A-Z])(DIP|PVC|HDPE|C-?900|CIP|AC|WM|W\.?M\.?|FM|SAN|WATER ?MAIN)(?![A-Z])')
ap.add_argument("--skip", default=r"LAT(?![A-Z])|LATERAL|PLAN|SUBDIV")      # lateral labels / titles are handled elsewhere
ap.add_argument("--out-dir"); ap.add_argument("--pad", type=int, default=40)
a = ap.parse_args()
pat = re.compile(a.pattern, re.I)
out_dir = a.out_dir or os.path.join(a.scan_dir, "callout-crops")
os.makedirs(out_dir, exist_ok=True)


def lines_of(o, acc):
    if isinstance(o, dict):
        if "words" in o and "box" in o and isinstance(o.get("text"), str): acc.append(o)
        for v in o.values(): lines_of(v, acc)
    elif isinstance(o, list):
        for v in o: lines_of(v, acc)
    return acc


def overlap(b1, b2, pad=6):
    return not (b1["x"] + b1["w"] + pad < b2["x"] or b2["x"] + b2["w"] + pad < b1["x"] or b1["y"] + b1["h"] + pad < b2["y"] or b2["y"] + b2["h"] + pad < b1["y"])


found = []
for f in sorted(os.listdir(a.scan_dir)):
    if not f.endswith(".ocr.json"): continue
    ref = f[: -len(".ocr.json")]
    tif = next((os.path.join(a.tif_dir, ref + e) for e in (".tif", ".tiff") if os.path.exists(os.path.join(a.tif_dir, ref + e))), None)
    if not tif: print(f"{ref}: no TIF in {a.tif_dir}", file=sys.stderr); continue
    ocr = json.load(open(os.path.join(a.scan_dir, f), encoding="utf-8"))
    ap_ = os.path.join(a.scan_dir, ref + ".assoc.json")
    items = json.load(open(ap_, encoding="utf-8")).get("items", []) if os.path.exists(ap_) else []
    gp_ = os.path.join(a.scan_dir, ref + ".georef.assoc.json")                  # the georeferenced pass keeps its own copy of the items
    if os.path.exists(gp_): items += json.load(open(gp_, encoding="utf-8")).get("items", [])
    im = None
    n = 0
    for ln in lines_of(ocr, []):
        m = pat.search(ln["text"])
        if not m or re.search(a.skip, ln["text"], re.I): continue
        tok = m.group(1).upper()
        if any(it.get("box") and overlap(it["box"], ln["box"]) and tok in (it.get("text") or "").upper() for it in items): continue
        if im is None: im = Image.open(tif).convert("L")
        b, rot = ln["box"], int(ln.get("rotation") or 0)
        x0, y0, x1, y1 = max(0, b["x"] - a.pad), max(0, b["y"] - a.pad), min(im.width, b["x"] + b["w"] + a.pad * 6), min(im.height, b["y"] + b["h"] + a.pad)
        crop = im.crop((x0 - (a.pad * 5 if rot not in (90, 270) else 0), y0, x1, y1)) if rot in (0, 180) else im.crop((x0, y0 - a.pad * 3, x1 + a.pad, y1 + a.pad * 3))
        if rot == 270: crop = crop.rotate(90, expand=True)       # text reading bottom-to-top
        elif rot == 90: crop = crop.rotate(-90, expand=True)
        elif rot == 180: crop = crop.rotate(180, expand=True)
        n += 1
        png = os.path.join(out_dir, f"{ref}_{n}.png"); crop.save(png)
        found.append(dict(scan=ref, text=ln["text"], token=tok, rotation=rot, box=b, crop=png))
        print(f"{ref} #{n}: OCR '{ln['text']}' (rot {rot}) at {b['x']},{b['y']} -> {png}")
json.dump(found, open(os.path.join(out_dir, "callouts.json"), "w", encoding="utf-8"), indent=1)
print(f"{len(found)} uncovered pipe callout(s); read each crop, then asbuilt-add-callout.mjs")
