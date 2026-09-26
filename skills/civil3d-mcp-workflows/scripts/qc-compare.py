"""Fase 4 QC helpers on PDFs (pymupdf; numpy+scipy only for `visual`). One file, five subcommands, all read-only.

  python qc-compare.py words  <ours.pdf> [--need "25.00'" --need "C-301" ...]   0 tiny words + expected words present
  python qc-compare.py text   <guide.pdf> <ours.pdf>                           line-level diff (only-in-guide / only-in-ours)
  python qc-compare.py visual <guide.pdf> <ours.pdf> [--dpi 40]                ink-diff regions (inches from top-left of sheet)
  python qc-compare.py where  <guide.pdf> <ours.pdf> "EXIST FH"                where a text sits in each (inches)
  python qc-compare.py crop   <guide.pdf> <ours.pdf> x0 y0 x1 y1 [--dpi 90] [--out crop.png]   guide over ours, red bar between
Set PYTHONIOENCODING=utf-8 on Windows (symbols like the PL glyph crash the cp1252 console).

How to read the result (learned on VILLA ONE, 2026-09-26): a difference is NOT automatically a defect. Classify each one:
  * guide error / not from base files (folio, RIM 9.63, wrong FH offset)      -> report, do NOT copy
  * base-file data the guide simply lacks (Fase 2 laterals, package labels)   -> fine, compare against the sibling (CREATOR) plot instead
  * objective defect: text overlapping text/road, label clipped by the viewport edge, "R" suffix on a 0.00' offset (structure a hair
    off the alignment because coordinates were rounded to 3 decimals), missing dimension words (annotation-scale gotcha)  -> fix
Use the CREATOR/sibling PDF as the second reference: if ours != guide but ours == sibling, the difference comes from the package data.
"""
import argparse
import re
import sys
from collections import Counter

import pymupdf


def page(path):
    return pymupdf.open(path)[0]


def lines(path):
    out = []
    for b in page(path).get_text("blocks"):
        for ln in b[4].split("\n"):
            ln = re.sub(r"\s+", " ", ln).strip()
            if ln:
                out.append(ln)
    return out


def cmd_words(a):
    p = page(a.ours)
    words = p.get_text("words")
    text = " ".join(w[4] for w in words)
    tiny = [w for w in words if (w[3] - w[1]) < a.tiny_pt]
    print("%s: %d words, %d tiny (< %.0f pt)" % (a.ours, len(words), len(tiny), a.tiny_pt))
    for k in a.need:
        print("   %-28s %s" % (k, "OK" if k in text else "MISSING"))
    print("   tallest words (pt):", [(round(h, 1), s) for h, s in sorted(((w[3] - w[1]), w[4]) for w in words)[-4:]])
    if tiny:
        print("   tiny sample:", [w[4] for w in tiny[:8]], "(cotas anotativas sin escala en el viewport dan ~0.5 pt)")


def cmd_text(a):
    g, o = Counter(lines(a.guide)), Counter(lines(a.ours))
    for title, d in (("only in GUIDE", g - o), ("only in OURS", o - g)):
        print("-- %s (%d):" % (title, sum(d.values())))
        for k, v in sorted(d.items()):
            print("   %s%s" % (k, " x%d" % v if v > 1 else ""))


def cmd_visual(a):
    import numpy as np
    from scipy import ndimage

    def ink(path):
        pix = page(path).get_pixmap(dpi=a.dpi, colorspace=pymupdf.csGRAY)
        return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w) < 200

    g, o = ink(a.guide), ink(a.ours)
    h, w = min(g.shape[0], o.shape[0]), min(g.shape[1], o.shape[1])
    g, o = g[:h, :w], o[:h, :w]
    only_g = g & ~ndimage.binary_dilation(o, iterations=2)   # ink with no ink nearby in the other (2 px misregistration ok)
    only_o = o & ~ndimage.binary_dilation(g, iterations=2)
    print("page %dx%d px @%d dpi, ink guide=%d ours=%d" % (w, h, a.dpi, g.sum(), o.sum()))
    for label, m in (("ONLY GUIDE", only_g), ("ONLY OURS", only_o)):
        lab, _ = ndimage.label(ndimage.binary_dilation(m, iterations=6))
        rows = []
        for sl in ndimage.find_objects(lab):
            area = int(m[sl].sum())
            if area >= 25:
                rows.append((area, sl[1].start / a.dpi, sl[0].start / a.dpi, sl[1].stop / a.dpi, sl[0].stop / a.dpi))
        rows.sort(reverse=True)
        print("-- %s: %d regions (top 12; x0,y0 -> x1,y1 in inches from top-left)" % (label, len(rows)))
        for ar, x0, y0, x1, y1 in rows[:12]:
            print("   (%5.1f,%5.1f) -> (%5.1f,%5.1f)  ink=%d" % (x0, y0, x1, y1, ar))


def cmd_where(a):
    for tag, path in (("GUIDE", a.guide), ("OURS ", a.ours)):
        hits = page(path).search_for(a.needle)
        print(tag, len(hits), " ".join("(%.1f,%.1f)" % (r.x0 / 72, r.y0 / 72) for r in hits))


def cmd_crop(a):
    def clip(path):
        return page(path).get_pixmap(dpi=a.dpi, clip=pymupdf.Rect(a.x0 * 72, a.y0 * 72, a.x1 * 72, a.y1 * 72))

    g, o = clip(a.guide), clip(a.ours)
    doc = pymupdf.open()
    pg = doc.new_page(width=max(g.width, o.width), height=g.height + o.height + 6)
    pg.insert_image(pymupdf.Rect(0, 0, g.width, g.height), pixmap=g)
    pg.draw_rect(pymupdf.Rect(0, g.height, pg.rect.width, g.height + 6), color=(1, 0, 0), fill=(1, 0, 0))
    pg.insert_image(pymupdf.Rect(0, g.height + 6, o.width, g.height + 6 + o.height), pixmap=o)
    pg.get_pixmap(dpi=72).save(a.out)
    print(a.out)


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = ap.add_subparsers(dest="cmd", required=True)
s = sub.add_parser("words"); s.add_argument("ours"); s.add_argument("--need", action="append", default=[]); s.add_argument("--tiny-pt", type=float, default=5); s.set_defaults(f=cmd_words)
s = sub.add_parser("text"); s.add_argument("guide"); s.add_argument("ours"); s.set_defaults(f=cmd_text)
s = sub.add_parser("visual"); s.add_argument("guide"); s.add_argument("ours"); s.add_argument("--dpi", type=int, default=40); s.set_defaults(f=cmd_visual)
s = sub.add_parser("where"); s.add_argument("guide"); s.add_argument("ours"); s.add_argument("needle"); s.set_defaults(f=cmd_where)
s = sub.add_parser("crop"); s.add_argument("guide"); s.add_argument("ours")
for n in ("x0", "y0", "x1", "y1"):
    s.add_argument(n, type=float)
s.add_argument("--dpi", type=int, default=90); s.add_argument("--out", default="crop.png"); s.set_defaults(f=cmd_crop)
args = ap.parse_args()
args.f(args)
