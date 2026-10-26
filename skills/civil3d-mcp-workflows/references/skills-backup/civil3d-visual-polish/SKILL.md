---
name: civil3d-visual-polish
description: Make a Civil 3D plan sheet (C-300 BASE/PROPOSED) look professionally tidy and keep improving it - one XEREFT visual signature (fonts, sizes, colours, leader geometry, alignment grid), a lint that measures it, fixers, and a lessons log that learns from every user correction. Use when the user says labels/arrows/titles look untidy, overlapped, crooked or misaligned, asks for a "professional" look, gives a screenshot of a label to fix, or after building/editing any BASE sheet.
---

# Civil 3D visual polish (self-improving)

The signature, checks and fixers live in the `civil3d-mcp-workflows` skill (scripts/ + references/). This skill is the loop.

## The loop (always, in this order)
1. **Read the memory of the loop:** `references/visual-lessons.json` (every correction the user ever made) and `references/standards/visual-signature.json` (the rules). Never re-learn what is already written there.
2. **Measure:** open the BASE drawing (`civil3d_drawing set_active_document`, match the FULL file name), then `node scripts/visual-lint.mjs --expect "<name>.dwg" --work "%TEMP%\c3d-fase1-build\<name>" --json <out>`. Look at the live window too (`scripts/view-capture.ps1 -Doc <name>.dwg -Window "x1,y1 x2,y2"`) and the PDF: the lint cannot see everything.
3. **Fix with the existing fixers** (never by hand-dragging): EOP / EXIST R/W / ALIGNMENT labels `c300-road-labels-realign.mjs`; lot notes `topo-move-text.mjs`; sanitary MH labels `topo-san-mh-labels.mjs`; hidden survey callouts `topo-hide-*.mjs`; overlaps of our MLeaders `fase1-declutter*.mjs`. Printed overlaps with survey text the lint cannot see (rotated BLOCK / P.B. titles): `road-labels-nudge.mjs --dwg <dwg> --work <work dir>` (PDF-verified, pushes whole rows; `--dry` only reports, `--reuse-qc` after re-activating the drawing).
4. **Re-measure, then refresh the deliverable:** `node scripts/base-pdf-refresh.mjs --dir "<base folder>"` (PDF must be newer than the DWG), `package-base.mjs`.
5. **Learn:** when the user corrects anything (or the lint/PDF shows a defect no rule covers) add an entry to `references/visual-lessons.json` (what they disliked, the rule adopted, where it is encoded), add the rule to `visual-signature.json`, and teach `visual-lint.mjs` or the generator the new check. Then push (`sync-skill-to-fork.sh`).

## Hard rules
- One signature for every project: same label style (Formtech-1.0, C-ANNO, grey 8), same text height, vertical/horizontal leaders only for EOP / EXIST R/W / SAN MH (the ONLY allowed diagonals: multi-line utility callouts and ALIGNMENT START/END - one straight leader, clear space, never crossing text; see visual-signature.json leaders.diagonalExceptions), text right of a vertical leader, one text line per row of labels, text never on linework or other text.
- Survey xrefs are edited only through the topo-* scripts (temp copy + reload). Nothing is erased without the user's OK (our own accidental duplicate is the only exception: report it).
- Everything delivered is in English; the chat with the user is in Spanish.
