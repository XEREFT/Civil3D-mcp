"""AS-BUILT GLYPH READER: reads the callout lines that the Windows OCR cannot (struck-through RIM / INV lines) by TEMPLATE MATCHING against the scan's own letters.

    python asbuilt-glyphs.py --scan <scan.tif> --ocr <scan.ocr.json> --box x,y,w,h [--lib <cache.pkl>]       (debug: reads the missing rows of the callout at that box)
    (normally imported by asbuilt-reocr.py)

Why: in the as-builts a leader line or the dashed base line runs along the top of some callout lines ("INV.EL=1.64'(E,W)" under a dashed line; MH#5's RIM line). The
Windows OCR returns nothing for such a line at ANY scale, with line removal, dilation or band crops (tested 2026-10-02). But the scan is one font ("SIMPLEX", one size) and the
first OCR pass reads hundreds of CLEAN words of it with their boxes, so:
  1. LIBRARY: every first-pass word whose glyph count (connected components, merging stacked parts: i dots, = bars) equals its character count gives one labeled bitmap per
     character (VILLA ONE: 455 words -> 2,200 glyphs, digits 28-89 each). Same scan = same resolution = no scale problem.
  2. MISSING ROWS: the callout's lines sit on a regular pitch (32 px on VILLA ONE); grid rows with no first-pass line, and rows that start with INV / RIM but were read short, are cut
     out (the crop starts BELOW the strike rows), long horizontal runs (dash segments, 13-22 px) are erased, the glyphs are segmented and classified (nearest neighbour on shape +
     position in the line); 7 vertical offsets x 2 run thresholds vote.
  3. GRAMMAR: INV rows decode as  ...=<-?d.dd>'(<dirs>)   RIM rows as  ...=<d.dd>' ; look-alikes are folded only in numeric slots (I,l->1, O->0), a '(' read as 6 / E is repaired from the
     comma structure, and a leading '-' counts only at mid-height (a strike remnant sits at the top). A reading is accepted when >= 3 variants agree on the same (value, dirs).
Result on VILLA ONE: see references/automation-backlog.md. It never replaces a first-pass value; asbuilt-extract.mjs --reocr treats it as one more reading and the review page
still shows every value for the user to confirm (a struck line is a REQUIRED field).
Needs Pillow, numpy, scipy.
"""
import argparse, json, os, pickle, re
from collections import Counter
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
ALPHA = set("0123456789.'(),=EWNSILVRM-")
FOLD = {"O": "0", "o": "0", "D": "0", "l": "1", "Z": "2", "B": "8", "G": "6"}


def glyph_boxes(binary):
    """connected components (8-connectivity), merged when they overlap in x by >= 50% of the smaller one (dots of i, bars of =, :), sorted by x"""
    lab, _ = ndi.label(binary, structure=np.ones((3, 3)))
    boxes = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        ys, xs = sl
        if (lab[sl] == i).sum() < 2:
            continue
        boxes.append([xs.start, ys.start, xs.stop, ys.stop])
    boxes.sort()
    merged = []
    for b in boxes:
        for m in merged:
            if min(m[2], b[2]) - max(m[0], b[0]) > 0.5 * min(m[2] - m[0], b[2] - b[0]):
                m[0], m[1], m[2], m[3] = min(m[0], b[0]), min(m[1], b[1]), max(m[2], b[2]), max(m[3], b[3])
                break
        else:
            merged.append(list(b))
    merged.sort()
    return merged


def feature(binary, b, lh, base):
    x0, y0, x1, y1 = b
    g = binary[y0:y1, x0:x1].astype(np.float32)
    h, w = g.shape
    s = min(16 / h, 10 / w) if h and w else 1
    small = np.array(Image.fromarray((g * 255).astype(np.uint8)).resize((max(1, int(w * s)), max(1, int(h * s))), Image.BILINEAR)) / 255.0
    box = np.zeros((18, 12), np.float32)
    yy, xx = (18 - small.shape[0]) // 2, (12 - small.shape[1]) // 2
    box[yy:yy + small.shape[0], xx:xx + small.shape[1]] = small
    v = box.flatten()
    return v / (np.linalg.norm(v) + 1e-6), np.array([(y0 - base) / lh, (y1 - base) / lh, (x1 - x0) / lh], np.float32)


def strip_runs(binary, hmax, vmax=40):
    out = binary.copy()
    for axis, mx in ((1, hmax), (0, vmax)):
        a = binary if axis == 1 else binary.T
        b = a.copy()
        for r in range(a.shape[0]):
            row = a[r]; n = len(row); i = 0
            while i < n:
                if row[i]:
                    j = i
                    while j < n and row[j]:
                        j += 1
                    if j - i > mx:
                        b[r, i:j] = False
                    i = j
                else:
                    i += 1
        out &= (b if axis == 1 else b.T)
    return out


class GlyphReader:
    def __init__(self, scan, ocr_json, cache=None):
        self.im = np.array(Image.open(scan).convert("L"))
        self.ocr = json.load(open(ocr_json, encoding="utf-8-sig"))
        self.lines = self.ocr["passes"][0]["lines"]
        if cache and os.path.exists(cache):
            lib = pickle.load(open(cache, "rb"))
        else:
            lib = self.build_library()
            if cache:
                pickle.dump(lib, open(cache, "wb"))
        self.X = np.stack([f for _, f, _ in lib]); self.P = np.stack([p for _, _, p in lib]); self.C = np.array([c for c, _, _ in lib])
        self.n_glyphs = len(lib)

    def build_library(self):
        lib = []
        for ln in self.lines:
            for w in ln["words"]:
                t = w["text"]
                if not re.fullmatch(r"[0-9.'(),=#+\-A-Za-z:/]+", t):
                    continue
                b = w["box"]
                if not (15 <= b["h"] <= 30):
                    continue
                x0, y0 = int(b["x"]) - 2, int(b["y"]) - 2
                x1, y1 = int(b["x"] + b["w"]) + 2, int(b["y"] + b["h"]) + 2
                crop = self.im[max(0, y0):y1, max(0, x0):x1] < 150
                gl = glyph_boxes(crop)
                if len(gl) != len(t):
                    continue
                lh = crop.shape[0]
                for c, g in zip(t, gl):
                    f, p = feature(crop, g, lh, lh - 2)
                    lib.append((c, f, p))
        if len(lib) < 300:
            raise RuntimeError(f"glyph library too small ({len(lib)} glyphs): not enough clean first-pass words in this scan")
        return lib

    def classify(self, f, p):
        d = (1 - self.X @ f) + 0.6 * np.abs(self.P - p).sum(1)
        best = {}
        for i in np.argsort(d)[:60]:
            c = FOLD.get(self.C[i], self.C[i])
            if c in ALPHA and (c not in best or d[i] < best[c]):
                best[c] = d[i]
        return sorted(best.items(), key=lambda kv: kv[1])

    def read_row(self, x0, y0, x1, y1, hmax):
        crop = strip_runs(self.im[max(0, y0):y1, max(0, x0):x1] < 150, hmax)
        lh = crop.shape[0]; base = lh - 2
        out = []
        for g in glyph_boxes(crop):
            if (g[2] - g[0]) * (g[3] - g[1]) < 6:
                continue
            f, p = feature(crop, g, lh, base)
            c = self.classify(f, p)
            if c:
                out.append((c[0][0], float(p[0]), float(p[1])))
        return out

    # ---- grammar ------------------------------------------------------------------------
    @staticmethod
    def parse(glyphs):
        """glyph string of one row -> {'kind','value','dirs'} or None"""
        s = "".join(c for c, _, _ in glyphs)
        if "=" not in s:
            return None
        eq = s.rindex("=")
        prefix, tail_g = s[:eq], glyphs[eq + 1:]
        # leading '-' only when it sits at mid-height (a strike remnant is at the top of the row)
        neg = False
        while tail_g and tail_g[0][0] == "-":
            top, bot = tail_g[0][1], tail_g[0][2]
            if -0.7 < (top + bot) / 2 < -0.3 and bot - top < 0.25:      # a real minus sign sits at mid-height, a strike remnant at the very top
                neg = True
            tail_g = tail_g[1:]
        tail = "".join(c for c, _, _ in tail_g).replace("I", "1")
        m = re.match(r"(\d{1,2})\.(\d{1,2})'?(.*)$", tail)
        if not m:
            return None
        value = float(f"{m.group(1)}.{m.group(2)}") * (-1 if neg else 1)
        rest = m.group(3)
        kind = "INV" if "V" in prefix else "RIM" if ("R" in prefix or "M" in prefix) and not rest else None
        dirs = None
        if rest:
            toks = [t for t in re.sub(r"[^NSEW,]", ",", rest).split(",") if t != ""]
            fixed = []
            for i, t in enumerate(toks):
                if t not in {"N", "S", "E", "W", "NE", "NW", "SE", "SW"}:
                    t = t[1:] if i == 0 and t[1:] in {"N", "S", "E", "W", "NE", "NW", "SE", "SW"} else t[:-1] if t[:-1] in {"N", "S", "E", "W"} else t
                if t in {"N", "S", "E", "W", "NE", "NW", "SE", "SW"}:
                    fixed.append(t)
            dirs = fixed or None
            if dirs and kind is None:
                kind = "INV"
        if kind is None:
            kind = "RIM" if not rest else None
        return {"kind": kind, "value": round(value, 2), "dirs": dirs, "decimals": len(m.group(2))}

    # ---- rows of one callout --------------------------------------------------------------
    def callout_rows(self, box):
        """first-pass lines of the callout column below/around `box`: (x, widths, heights, pitch, rows[y, text])"""
        col = [l for l in self.lines if abs(l["box"]["x"] - box["x"]) <= 30 and box["y"] - 50 <= l["box"]["y"] <= box["y"] + box["h"] + 230]
        col.sort(key=lambda l: l["box"]["y"])
        # keep the contiguous block that contains / touches the box
        gaps = [b["box"]["y"] - a["box"]["y"] for a, b in zip(col, col[1:])]
        good = [g for g in gaps if 18 <= g <= 48]
        pitch = float(np.median(good)) if good else 32.0
        return col, pitch

    def read_missing(self, box, votes_needed=3):
        col, pitch = self.callout_rows(box)
        if not col:
            return []
        lh = float(np.median([l["box"]["h"] for l in col])) or 22.0
        x = min(l["box"]["x"] for l in col)
        width = min(330, max(l["box"]["w"] for l in col) + 80)
        # rows to read: (1) every gap between two consecutive first-pass lines that holds >= 1 missing line, split evenly (the N / E block of a callout is spaced wider than
        # its text lines, so a fixed grid drifts); (2) INV / RIM lines the first pass read SHORT (struck through at the right end)
        targets = []
        for a_, b_ in zip(col, col[1:]):
            g = b_["box"]["y"] - a_["box"]["y"]
            m = int(round(g / pitch)) - 1
            for k in range(1, m + 1):
                targets.append((a_["box"]["y"] + k * g / (m + 1), ""))
        for l in col:
            if re.match(r"\s*(INV|RIM)", l["text"], re.I) and not re.search(r"'\s*\(?[NSEW, ]+\)?|RIM\s*EL\s*=\s*\d+\.\d\d", l["text"]):
                targets.append((l["box"]["y"], l["text"]))
        rows = []
        for y, txt in targets:
            reads = []
            for dy in range(-3, 4):
                for hmax in (13, 18):
                    g = self.read_row(int(x) - 4, int(y) + dy, int(x + width), int(y + dy + lh + 4), hmax)
                    r = self.parse(g)
                    if r and r["kind"]:
                        reads.append((r["kind"], r["value"], tuple(r["dirs"]) if r["dirs"] else None, r["decimals"]))
            if not reads:
                continue
            (kind, value, dirs, decimals), n = Counter(reads).most_common(1)[0]
            if n >= votes_needed:
                # the as-builts always print RIM / INV with 2 decimals: a 1-decimal reading lost a digit, and < 75 % agreement is a shaky reading -> flagged for the review
                rows.append({"y": round(float(y), 1), "kind": kind, "value": value, "dirs": list(dirs) if dirs else [], "votes": n, "of": len(reads), "firstPass": txt,
                             "lowConfidence": bool(decimals < 2 or n / len(reads) < 0.75)})
        return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", required=True); ap.add_argument("--ocr", required=True); ap.add_argument("--box", required=True); ap.add_argument("--lib")
    a = ap.parse_args()
    x, y, w, h = [float(v) for v in a.box.split(",")]
    r = GlyphReader(a.scan, a.ocr, a.lib)
    print(f"library: {r.n_glyphs} glyphs")
    for row in r.read_missing({"x": x, "y": y, "w": w, "h": h}):
        print(row)
