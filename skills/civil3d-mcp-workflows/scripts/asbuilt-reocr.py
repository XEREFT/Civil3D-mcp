"""AS-BUILT RE-OCR (second pass per callout): re-reads the callouts of a scanned as-built that the first OCR pass left incomplete.

    python asbuilt-reocr.py --draft <scan.draft.json> --out <scan.reocr.json> [--scales 2,3] [--pad 60]
    node   asbuilt-extract.mjs --ocr <scan.ocr.json> --reocr <scan.reocr.json> --out <scan.draft.json>     (merges what this finds)

Why: the first pass reads the whole sheet at its native size. Small callout text (2 mm at plot size) loses the manhole NAME ("MH#7"), RIM values and digits
("444513.2847" for 444518.2847) and whole lines; the leader line of the callout also strikes through text. VILLA ONE, real data: the first pass gave MH#6 a wrong
N, MH#3 no RIM and no name, and MH#7 / MH#5 / MH#3 / MH#6 no name at all. Re-reading each INCOMPLETE callout on its own crop, enlarged 2x and 3x, recovers names, RIM values
and misread digits; the extractor then VOTES between the readings (it never overwrites a value unless the majority disagrees, and every difference is listed on the item).
Struck-through lines (INV.EL=1.64'(E,W) under the dashed base line) are NOT readable by the Windows OCR at any scale (tested 2026-10-02): with --ocr they are read by
asbuilt-glyphs.py (template matching against the scan's own letters; VILLA ONE: all 4 known struck INV/RIM lines read correctly) and stored as `glyphRows`.

Candidates = manhole-like items (kind MH, or a station + N/E without a description) that still miss RIM or INV. Read-only on the scan. Needs Pillow + Windows PowerShell 5.1
(scan-ocr.ps1 uses Windows.Media.Ocr).
"""
import argparse, json, os, subprocess, sys, tempfile
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--draft", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--scales", default="2,3")
ap.add_argument("--pad", type=int, default=60)
ap.add_argument("--ocr", help="the first-pass OCR json of the scan (scan-ocr.ps1): its clean words become the glyph library of asbuilt-glyphs.py, which reads struck-through RIM / INV lines")
a = ap.parse_args()

draft = json.load(open(a.draft, encoding="utf-8"))
scan = draft["scan"]
scales = [int(s) for s in a.scales.split(",") if s.strip()]
im = Image.open(scan).convert("L")


def candidate(it):
    # a plain station + N/E callout is a manhole unless it prints an offset with a SIDE ("8' O/S (R)": a water tee / valve / corp stop, which print complete data)
    manhole = it.get("kind") == "MH" or (it.get("kind") is None and it.get("sta") is not None and it.get("N") is not None and not it.get("pipe")
                                         and it.get("side") not in ("R", "L"))
    return manhole and (it.get("rim") is None or not it.get("inv"))


reader = None
if a.ocr:
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("asbuilt_glyphs", os.path.join(HERE, "asbuilt-glyphs.py"))
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        reader = mod.GlyphReader(scan, a.ocr, a.out + ".glyphs.pkl")
        print(f"glyph reader: {reader.n_glyphs} glyphs from the scan's own clean words")
    except Exception as e:   # numpy / scipy missing, or too few clean words: the Windows-OCR variants still work
        print(f"glyph reader unavailable: {e}")

tmp = tempfile.mkdtemp(prefix="reocr_")
out = {"scan": scan, "callouts": []}
n = 0
for it in draft["items"]:
    if not candidate(it):
        continue
    b = it["box"]
    x0, y0 = int(max(0, b["x"] - a.pad)), int(max(0, b["y"] - 45))
    x1, y1 = int(min(im.width, b["x"] + max(b["w"], 330) + a.pad)), int(min(im.height, b["y"] + b["h"] + 130))
    crop = im.crop((x0, y0, x1, y1))
    variants = []
    for sc in scales:
        big = crop.resize((crop.width * sc, crop.height * sc), Image.LANCZOS)
        png = os.path.join(tmp, f"c{n}_x{sc}.png"); js = png[:-4] + ".json"
        big.save(png)
        r = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", os.path.join(HERE, "scan-ocr.ps1"), "-Image", png, "-Out", js, "-Rotations", "0"],
                           capture_output=True, text=True)
        lines = []
        if os.path.exists(js):
            d = json.load(open(js, encoding="utf-8-sig"))
            lines = [l["text"] for l in d["passes"][0]["lines"]]
        variants.append({"scale": sc, "lines": lines})
    glyph_rows = []
    if reader:
        try: glyph_rows = reader.read_missing(b)
        except Exception as e: print(f"  glyph reader failed on this callout: {e}")
    out["callouts"].append({"box": b, "crop": [x0, y0, x1, y1], "variants": variants, "glyphRows": glyph_rows})
    n += 1
    print(f"callout {n}: box ({b['x']:.0f},{b['y']:.0f}) -> " + " || ".join(" | ".join(v['lines'])[:70] for v in variants)
          + ("  GLYPHS: " + "; ".join(f"{r['kind']} {r['value']}{(' ' + ','.join(r['dirs'])) if r['dirs'] else ''} ({r['votes']}/{r['of']})" for r in glyph_rows) if glyph_rows else ""))
json.dump(out, open(a.out, "w", encoding="utf-8"), indent=1)
print(f"{n} callout(s) re-read -> {a.out}")
