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
- **PROPOSED / design labels (design engineer, 2026-10-27)**: any callout with a station/offset or an elevation is a NATIVE Civil 3D label (Add Labels > Alignment > Station Offset - Fixed Point, style SAN LAT / C.O / WATER SERVICE; Profile View > Station Elevation), never an MLeader copy, never exploded; only the INV text is typed (Edit Label Text); arrow tip = control point. Never change a viewport/annotation scale. Never delete labels a table reads (no-plot layer instead). Do NOT "polish" these by converting them. Rules: visual-signature.json `nativeLabels` + `viewports`, reference `engineer-feedback-2026-10.md`. Files the engineer fixed himself are the source of truth: our ideas for them are SUGGESTIONS to the user, not edits; OUR proposed file is corrected to his method. Create them with `civil3d-mcp-workflows/scripts/c300-native-sanlat-labels.mjs` (`--dry-run`, `--replace-mleaders`, `--path`; marker `_No Markers`); `visual-lint.mjs` rule `mleader-substitute` flags regressions.

- **R/W marks (user 2026-10-26)**: one white set, same orthogonal-leader family as EOP (strictly vertical/horizontal on the sheet axes, 8 ft, text right of a vertical leader), at every R/W corner leg and then at equal ~125 ft along every run, over the whole plan (model space too); never diagonal, never overlapping, never missing at a corner. Do not drag them: run `/rw-marks` (`c300-rw-apply.mjs`). Rules: visual-signature.json `rwMarks`.

## R/W + EOP companion rules (user 2026-10-26)
Blue R/W lines end where the red street lines are cut, real offsets, same tone (`c300-rw-extend.mjs` then `layer-truecolor.ps1 -Layer R-W`); the survey's own R/W marks are hidden, ONE uniform white set from `/rw-marks`; all labels we add are white (`labels-white.ps1`, symbols `topo-white-blocks.mjs --circles`); EOP / EXIST R/W strictly orthogonal (the 3 EOP marks the user straightened are the model); a blocked mark is retried, never omitted or overlapped. Projects without `R-W` survey lines only get the white look. Checklist: memory `rw-eop-marks-future-projects`, `rw-line-extension-rule`.
