#!/usr/bin/env python3
"""After shortening the C-300 MD-WASD notes MText (fase1-strip-prop-notes.mjs), the vector glyphs of the line
"(NOT PART OF M-WASD NOTES NOR APPROVAL)" (layer PDF_Geometry: ~43 Polylines + 2 Arcs, not text) stay behind, because the
"PROJECT SPECIFIC NOTES:" header they hang under moved up. This prints the paper-space dy (inches) to move them.

    python fase1-notes-shift.py <plot BEFORE the edit>.pdf <plot AFTER the edit>.pdf

Both PDFs come from scripts/qc-plot.ps1 (1:1 plot, 72 pt per paper inch). Then, with the drawing open:
  acad_list_polyline_entities {layer:"PDF_Geometry", space:"paper"} + acad_list_shape_entities {layer:"PDF_Geometry", space:"paper"}
  -> keep the ones inside the sheet (paper x < 36) whose minY/maxY sit just under the old header (VILLA ONE: y 7.39-7.56, x 25.6-28.6)
  -> acad_move_entities {handles:[...], dx:0, dy:<printed value>}   (Arcs are shapes, not polylines: do not forget them)
Verified on VILLA ONE 2026-09-28: dy = +7.6222 (43 polylines D25C-D286 + arcs D25B, D287).
"""
import sys
import pymupdf

if len(sys.argv) != 3:
    sys.exit(__doc__)


def header_top(path):
    hits = pymupdf.open(path)[0].search_for("PROJECT SPECIFIC NOTES")
    if not hits:
        sys.exit(f"'PROJECT SPECIFIC NOTES' not found in {path}")
    return hits[0].y0


old, new = header_top(sys.argv[1]), header_top(sys.argv[2])
dy = (old - new) / 72.0
print(f"header top: before {old:.1f} pt, after {new:.1f} pt -> paper dy = {dy:+.4f} in (positive = up)")
