"""AS-BUILT RE-OCR (second pass per callout): re-reads the callouts of a scanned as-built that the first OCR pass left incomplete.

    python asbuilt-reocr.py --draft <scan.draft.json> --out <scan.reocr.json> [--scales 2,3] [--pad 60]
    node   asbuilt-extract.mjs --ocr <scan.ocr.json> --reocr <scan.reocr.json> --out <scan.draft.json>     (merges what this finds)

Why: the first pass reads the whole sheet at its native size. Small callout text (2 mm at plot size) loses the manhole NAME ("MH#7"), RIM values and digits
("444513.2847" for 444518.2847) and whole lines; the leader line of the callout also strikes through text. VILLA ONE, real data: the first pass gave MH#6 a wrong
N, MH#3 no RIM and no name, and MH#7 / MH#5 / MH#3 / MH#6 no name at all. Re-reading each INCOMPLETE callout on its own crop, enlarged 2x and 3x, recovers names, RIM values
and misread digits; the extractor then VOTES between the readings (it never overwrites a value unless the majority disagrees, and every difference is listed on the item).
Struck-through lines (INV.EL=1.64'(E,W) under the dashed base line) are still not readable by the Windows OCR at any scale or after removing the long lines (tested
2026-10-02: crop / 2-5x / line removal / dilation): those stay for the user to type in the review sheet (required field).

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
a = ap.parse_args()

draft = json.load(open(a.draft, encoding="utf-8"))
scan = draft["scan"]
scales = [int(s) for s in a.scales.split(",") if s.strip()]
im = Image.open(scan).convert("L")


def candidate(it):
    manhole = it.get("kind") == "MH" or (it.get("kind") is None and it.get("sta") is not None and it.get("N") is not None and not it.get("pipe"))
    return manhole and (it.get("rim") is None or not it.get("inv"))


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
    out["callouts"].append({"box": b, "crop": [x0, y0, x1, y1], "variants": variants})
    n += 1
    print(f"callout {n}: box ({b['x']:.0f},{b['y']:.0f}) -> " + " || ".join(" | ".join(v['lines'])[:70] for v in variants))
json.dump(out, open(a.out, "w", encoding="utf-8"), indent=1)
print(f"{n} callout(s) re-read -> {a.out}")
