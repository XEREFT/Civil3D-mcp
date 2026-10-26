# Design-ready BASE sheet - what the design engineer needs (design audit 2026-10-25)

Source: reverse engineering of two finished designer sets (Villa One "how it should look" `C-300_GUIA_COMO_DEBE_QUEDAR.dwg`; Goulds Design 2026-07-31 / 08-03 + the dated
folders of Goulds) against our BASE deliverables. Both references were drawn by a human, so every rule below says whether it is **COPY** (the designer is right)
or **FIX** (the designer's file has an error; we do the right thing instead). Check any BASE with `node scripts/design-ready-audit.mjs --dir "<base folder>"`
(ids DR-01..DR-13 below); tools that fix each gap are named in the last column.

## Ground truth (verified, do not re-derive)
| Fact | Evidence |
|---|---|
| POC names the governing as-builts per connection | `poc-extract.mjs` -> `connections[]`. Goulds: sewer **ES7843-7** (SW 231 ST), water **E11158-7** (12"), E11826-1 (16"). Villa: sewer **ES9467-2**, water E14611-2 (8"), E32920D00A-2 (16") |
| A POC may list two folios | Goulds: 30-6913-011-0825 **and** 30-6913-011-0827; both go in the subject label |
| The survey governs what it measured | Designer prints survey R.E./I.E. (Goulds MH 9.39 / 4.09 / 3.99, Villa MH 10.82); as-built values only for what the survey cannot see |
| Survey layers are gray, lot lines cyan | Designer GUIA: X-TOPO layers ACI 8, lot lines ACI 4 |
| The sheet turns to the street grid | viewport twist = 360 - street angle; when lot + POC point do not fit the frontage-aligned 25"x23" window at 1"=20', turn to the grid |
| Centerlines are drawn in the host | CENTER_LINE LINE/LWPOLYLINE in the designer's C-300, not necessarily in X-TOPO |
| Villa's newest client X-TOPO is the designer's | client `2026-09-21_WASD - Xereft\x-ref\X-TOPO.dwg` = 6 302 069 bytes = the designer's xref |

## Gap table (ranked) and the tools that close it
| # | Audit id | Gap in our BASE | Rule | Closed by |
|---|---|---|---|---|
| 1 | DR-05 | As-built cited was not the POC's (Goulds: ES8206-1, a 303 ft run, 8" water per E11826-1 which the POC lists as 16") | COPY: the POC governs; cross-check length/slope on the scan (ES7843-7 prints 128.7 LF @ 0.39% = the 130 ft main we draw) | `poc-extract.mjs --project` (connections), fix `asbuilt.json` sewerRef/waterRef, per-main `asBuilt` |
| 2 | DR-08 | POC connection point fell outside the viewport (Goulds) | COPY: turn the sheet to the grid | `site.pocPoints` in project.json -> `c300-build-spec.mjs` view-angle logic |
| 3 | DR-04 | Second POC folio missing from the label | COPY | `subject.folios` (poc-extract), label joins them |
| 4 | DR-12 | MH labels used the as-built RIM where the survey measured another | COPY, plus **(FIELD VERIFY)** when the gap > 0.10 ft (the designer silently picks one) | `asbuilt-survey-merge.mjs` -> `manholes[].survey` |
| 5 | DR-13 | Survey catch basins / storm pipe unlabeled | COPY: `EXIST STORM CB RIM: n (TO REMAIN)` | `asbuilt-survey-merge.mjs` -> `storm[]` |
| 6 | DR-09 | Survey drawn in color | COPY: gray look is now the default (`sources.xrefStyle = "color"` opts out) | `fase1-from-scratch.mjs` steps 0b / 2c |
| 7 | DR-10 | Lot/block labels missing (Villa used an older, cleaned X-TOPO) | COPY: use the newest client X-TOPO; carry the centerlines in project.json | `centerlines-extract.mjs --save`, xref swap with `_backup\xrefs_before_design_audit` |
| 8 | DR-07 | Street labels not on a parallel centerline after the sheet turned | COPY: label follows its own street's centerline, only on the legs the survey draws | `c300-build-spec.mjs` (per-street rotation) |
| 9 | DR-06 | North arrow left at 0 under a 268.49 deg twist | **FIX** (the designer's Villa sheet has the same error): arrow rotation = main viewport twist | `c300-north-arrow.mjs` (fase1-from-scratch step 2d) |
| 10 | DR-01/02/03 | Leftovers of another project in the file | **FIX** (Villa reference kept Goulds' "(OLD)" layouts and title text): BASE = Model + C-300, own AGR/project no. | design-ready-audit |

## Designer errors we do NOT copy
* Villa label folio `30-6913-011-0825` (Goulds'); Villa's folio is `30-6913-003-0830`.
* North arrow at 0 deg with a rotated view.
* Stale "(OLD)" layouts / Goulds title text inside the Villa file.
* AGR numbers swapped in a Goulds `.bak` (33808 vs 33809): the AGR comes from project.json, not from a copied title block.
* Villa MH#7 RIM: designer 9.63 comes from the survey, the as-built scan prints 9.69; both are real, so the label keeps survey + (FIELD VERIFY) rule.

## Kept from our own rules (the designer does not print them, we do)
* Scan length prefix on the sewer main label (`128.7'- EXIST 8" ...`): user rule 2026-10-02.
* Fase 1 = existing only: no PROP/C-301, alignment style `BCC - ALIGNMENT`, `C-TINN-BNDY` frozen.

## Procedure (new BASE or rebuild)
1. `new-project.mjs` / `poc-extract.mjs --project` -> subject, folios, connections.
2. Take the NEWEST client X-TOPO/X-UTIL/X-ARCH (not a designer folder). If the survey has no centerline near the lot: `centerlines-extract.mjs --dump <dump> --window ... --save <dir>`.
3. Set `site.pocPoints` (connection MH / tie-in) and, if known, `site.viewport`.
4. Put the POC-governing as-built in `_reports/asbuilt.json`; run `asbuilt-survey-merge.mjs --asbuilt ... --dump <X-TOPO dump> --window ...`.
5. `fase1-from-scratch.mjs --dir ... --dwg "<Name> @xereft base.dwg" --template _template.dwg --rebuild` (north arrow, gray look included).
6. `design-ready-audit.mjs --dir ...` must show 0 FAIL; every WARN is either fixed or explained in project.json `decisions`.
7. `package-base.mjs`.

## Source precedence override (user, 2026-10-26)
Default is survey-first (designer convention). When the user says "follow the as-built" for a manhole, set `preferAsBuilt: true` on it in `asbuilt.json`:
the label prints the as-built values, the survey ones stay in `surveyIgnored`, and `asbuilt-survey-merge.mjs` keeps the choice on reruns. Applied to Goulds MH#1 only.
Map as-built manholes to the drawn ones by position along the run and by the NUMBER of pipes (Goulds: the 2-pipe surveyed MH is MH#14-A, not the 3-pipe MH#14), never by order of appearance.

## Open questions to put to the client (only what the files cannot answer)
* Goulds: laterals of ES7843-7 (STA 21+50 and 22+01) have no N/E: location needed if the engineer wants them drawn.
* (Withdrawn 2026-10-26: "MH#14 RIM 10.76 vs survey 9.39" was a wrong MH mapping; the real gap is 0.06 ft.)
