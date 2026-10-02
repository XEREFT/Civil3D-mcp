"""Renders the model viewport region of a plotted C-300 PDF to a PNG for Fase 1 Studio.  python studio-preview.py <pdf> <out.png> [zoom]"""
import sys, pymupdf as fitz
pdf, out = sys.argv[1], sys.argv[2]
zoom = float(sys.argv[3]) if len(sys.argv) > 3 else 0.9
page = fitz.open(pdf)[0]
page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=fitz.Rect(0, 0, 1800, page.rect.height)).save(out)
