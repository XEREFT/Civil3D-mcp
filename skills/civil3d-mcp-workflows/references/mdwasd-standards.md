# MDWASD standards (Miami-Dade Water & Sewer): the county's law

Official source: https://www.miamidade.gov/global/service.page?Mduid_service=ser148156625339722 ("Water and Sewer Design & Construction Standards"). Read 2026-10-02: UC-005 (Project Approval, R-7 2/2015), Standard Details GS 0.5, GS 1.5 (10/1/2017), WS 2.21 sheets 1-3, UC-250, UC-310, UC-075. Machine-readable numbers: `standards/mdwasd-standards.json` (only number source for scripts). They apply to **existing-data cleanup (Fase 1) and to design proposals**.

## Easements (UC-005 A.8-A.11, A.15, A.21; WS 2.21)
| Case | Width | Offset from centerline | Label |
|---|---|---|---|
| Water only | 12 ft | 6 ft each side | `twelve (12) feet MDWASD easement` |
| Sewer only | 15 ft | 7.5 ft each side | `fifteen (15) feet MDWASD easement` |
| Water + sewer | >= 23.5 ft | 6 ft from water, 7.5 ft from sewer, 10 ft between | - |

- Dark dashed line; a single pipe **centered** in the easement. No structures or trees inside (or in vertical projection); overhead lines only with >= 25 ft clearance.
- Meters, hydrants, other appurtenances **outside** the main's easement, with their own (A.11). Meters on private property = part of an MDWASD easement; service line main->meter <= 50 ft (B.5).
- WS 2.21: 1"-2"/4" service and FH -> 6 ft each side of main and of service line, +2.5 ft past the meter box, +6 ft past the hydrant. 8"/10" turbine meter: 6 ft from main, 12 ft + 10 ft along the service, 7 ft each side.
- **Do not confuse** with a plat U.E. (e.g. 5 ft on a lot line): that comes from the plat + user confirmation (`c300-easement.mjs`).
- An MDWASD easement is drawn **only when the pipe is on private property** (inside a Property Appraiser lot). In public R/W, Miami-Dade Public Works location rules apply.
- A **recorded** easement (plat / O.R. Book, confirmed by the user) beats the standard strip (`c300-mdwasd-easement.mjs --recorded-width W --recorded-ref REF`).

## Separations (GS 1.5, F.A.C. 62-555.314, UC-005 A.16)
- Water <-> gravity sanitary / pressure / force main: horizontal **10 ft preferred, 6 ft minimum** (wall to wall; 6 ft only with water >= 6 in above the sewer crown).
- Water <-> storm / reclaimed: 3 ft min (10 ft recommended wall to wall with storm/sewer, note 2). Vacuum: 10 preferred / 3 min. On-site treatment: 10 ft.
- Any other service/drain vs water or sewer main outside 62-555.314: **5 ft face to face**.
- Crossings: **12 in** vertical (invert of upper to crown of lower); water above whenever possible; otherwise both DIP, joints equidistant (>= 10 ft between joints), 6 in min. Cross perpendicular when possible. Laterals: 12 in, or a 20 ft DIP / C-900 SDR18 section centered.

## Sewer / water (UC-005 B, C, D; UC-250; UC-310)
- MH at most every **400 ft**; label MH number, slope, size, material, distance to next; INV with flow direction and RIM above the MH.
- Sanitary cover: green areas < 2.5 ft DIP+slab; 2.5-6 DIP/C900 (PVC SDR35 with unreinforced slab if approved); 6-14 PVC; > 14 DIP. Pavement: < 3.5 ft DIP or C900; < 2.5 ft DIP + reinforced slab.
- Gate valves every **660 ft**; mains >= 20" valve every half mile; hydrant lateral <= **50 ft** and 6".
- Water/force main cover: <= 12": 30 in; 16-24": 36 in; less -> reinforced concrete slab (GS 1.2).
- Services: 1"/2" blue HDPE with tracer wire (UC-075); services <= 2" from existing mains and cut/plug of MDWASD mains are done by MDWASD at owner's cost.
- Lateral: tee with riser (sewer >= 7 ft) or wye; plug; green 2x2x2 ft stake; location measured and recorded before backfill (UC-310 3.01).

## Plan conventions (UC-005 1.05 A)
Existing = dashed; proposed = dark solid; both with **size + material + type**; >= 20" double line. Buildings marked existing/proposed. Baseline never on top of the main; baseline and R/W labeled at 2 points. Plan scale 1" = 10'-40', vertical profile 1/10. Standard GS 0.5 notes on all sheets; other notes "Not Part of MDWASD Notes nor Approval".

## Record drawing (GS 0.5 sheet 2): what an as-built must carry
Water: size, material, offset, deflections, station of services/hydrants/valves/fittings, crossings. Sewer: MH number, size, material, deflection, slope, laterals referenced to the MH, cleanouts, **RIM + INV per direction (N/S/E/W)**, State Plane (NAD83 FL East) coordinates of **all** MH and valves + 2 control points. All "PROPOSED" info removed. These fix the **mandatory fields** of `asbuilt-review.py`.

## How it is used in the flow
| Step | What it does |
|---|---|
| `scripts/mdwasd-check.mjs --asbuilt asbuilt.json --report pa-area.json [--json out]` | water-sewer separations, crossings, MH <= 400 ft, size+material labels, RIM/INV, cover, FH <= 50 ft, mains on private property -> easement. Levels WARN/INFO/OK; **never** changes values. |
| `fase1-qc.py` | calls `mdwasd-check.mjs`, adds the "MDWASD standards" row; INFO printed apart. |
| `scripts/c300-mdwasd-easement.mjs --check out.json --spec spec.json` | `acad_create_entities` payload with the DASHED2 strip (C-ANNO) + standard label for each main on private property. |
| Design proposal | use the numbers above when locating; run `mdwasd-check.mjs`; cite sections with `civil3d_standards_lookup topic=mdwasd`. |

## WASD CAD & GIS Manual (Jan 2026), read 2026-10-02
Source: https://www.miamidade.gov/resources/water/documents/wasd-cad-manual.pdf (92 pp.; CAD Manager Eric Vilaire, 305-878-6051). All in `standards/mdwasd-standards.json` -> `cadManual`.
- **Georeference/units:** NAD83 Florida East 901, NGVD29, decimal + US Survey Feet, model 1:1, Simplex text. Slopes to 0.01 %, elevations/inverts to 0.01 ft, continuous stationing every 100 ft from 10+00, State Plane coordinates at start/end/PI/PC/PT/fittings. Plan 1"=20' (or 40'), profile vertical 1"=2'.
- **Existing layers (US NCS):** water `C-WATR-PIPE-EXST` (190, HIDDEN 0.006"), `C-WATR-FITT-EXST`, `C-WATR-INST-EXST` (152, valves/meters); sanitary `C-SSWR-PIPE-EXST` (70, HIDDEN), `C-SSWR-FITT-EXST`, `C-SSWR-STRC-EXST` (80); survey `V-WATR*`, `V-SSWR*`, `V-ESMT` (DASHED2), `V-RWAY`, `V-PROP-LINE`, `V-PROP-LOTL`. GIS layers `*_WASD` only for plan as-builts.
- **Callouts (Tables 3.7.1/3.7.2):** `STA. XX+XX (O/S XX' LT./RT.)` + `PROP. ...` + `REST. W/GLANDS`; surveyed MH `MHSA / RIM ELEV.=X.XX' / 8" CLAY (E) INV. ELEV.=X.XX' / BOTTOM ELEV.=X.XX'`.
- **Chapter 7 (GIS as-builts):** official template, single lines base-to-base, blocks/COGO at the surveyed point, only field-verified assets (no trees, poles, spot elevations, lots, EOP, or proposed info), Appendix C attributes, name `E/ES + 6 digits + C/D + phase + subphase` (e.g. `EXXXXXXC01A`).
- **GS 3.0 symbols:** existing = open/gray, proposed = solid; gate valve = bowtie; the 2026 exhibits A.1-A.8, B, C, D equal the 2024 transcription in `docs/reference/wasd-symbol-legend.md`.
- **DWT templates:** `WASDTemplate-Survey-Asbuilts.dwt`, `WASDTemplate-Pipeline-Design.dwt`, `WASD-Blocks.dwg`: site links (`.../donation/part-6/...dwt`) return **HTTP 404** (tried www/non-www, case, browser headers, Wayback). Ask WASD's CAD Manager or use the firm's copy.

## 660 ft valve check (UC-005 B.6), automated
`mdwasd-check.mjs` takes valves from `asbuilt.json` (`appurtenances` with `G.V.`/gate/butterfly/plug valve **and coordinates**), snaps them to water pipes (<= 15 ft), builds the main graph and measures pipe distance between **adjacent** valves: > 660 ft = WARN; a main end without valve is only INFO (the as-built window ends where the scan ends). Synthetic test: `node scripts/mdwasd-selftest.mjs` (5 assertions). VILLA ONE: 3 located valves, OK; Goulds: no located valves (155 ft window), INFO.

## Standard details read (image, 2026-10-02)
- **WS 4.50 hydrant (2013):** 6" DIP lateral from M.J. tee / tapping sleeve + 6" gate valve in No. 2 box; cover 4 ft (54" to shoe); thrust block 18"x18" (no mechanical restraint); slab 3'x3'x6"; sidewalk within 4-7 ft offset -> hydrant 1 ft from sidewalk face in grass zone, else Fire Dept decides; guide posts 4"x5' (2.5 ft buried) at the pumper face and 2.5 ft from centerline; no posts in FDOT R/W.
- **WS 4.10 service (2006):** meter box axis 2.5 ft inside the property line; no meter if the box falls on a travel surface; 1" copper, street crossing in 1.5" steel casing with min 18" offset.
- **SS 1.0 sanitary lateral (2010):** 6" min lateral, slope >= 1/8"/ft (matches the as-builts' SLOPE 1/8"/FT note), wye + 45 deg bends, 8" min main, 3 ft min to invert, cleanout with threaded plug in a concrete box at property line / R/W / easement, watertight plug at lateral end.
- Image only, no useful dimensions yet: SS 22.0, WS 1.0, GS 2.0, A 10 sheets 2-3 (abbreviations, already transcribed in `docs/reference/wasd-symbol-legend.md`). One doubtful SS 2.0 dimension (2.5 ft from the double lateral) is flagged in `mdwasd-details.md`: confirm on the PDF before using.
