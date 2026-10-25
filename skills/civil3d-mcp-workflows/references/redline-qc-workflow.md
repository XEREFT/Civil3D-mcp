# Workflow: redline (DG / QC markup) -> plan-sheet corrections

Validated on T25-06.212 (Westport, C-310), Goulds C-300 and C-WS. General pattern only; per-project state lives in that project's memory.
Subagent `civil3d-qc-redline` can do the reading and diff; **writes are done by the main session.**

## 1. Inputs
- **DG / markup PDF:** red corrections (struck text, added text, clouds). **Submittal / sealed PDF:** final state, what the DWG must say. **Live DWG** open in Civil 3D.
- Only a markup PDF: the markup defines the change; ask when ambiguous.

## 2. Steps
0. **Pre-flight** (SKILL.md).
1. **Find the right DWG:** `Glob` the project folder; if several copies exist (e.g. `...\` and `...\Camilo Results\`) **ask which is live**; then `acad_list_open_documents` / `acad_set_active_document`.
2. **Read both PDFs sheet by sheet** with `Read` + `pages`, every session (never trust old summaries). CAD text extraction loses note-to-leader association: anchor each note by station/offset or distinctive text, not extraction position.
3. **Diff table** (show before writing): `# | location (STA/OFFSET or object) | DG (before/red) | Submittal (final) | action`. Actions: replace substring, delete text, erase whole note, add note/MLeader, merge two notes, no change (DWG already matches; common).
4. **Find each entity:** `acad_list_text_entities { contains:"<short distinctive substring>", space:"all" }`. MText holds `\P` and format codes, so short fragments ("TAPPING SLEEVE") match more than whole phrases. Several hits: disambiguate by position/station. Empty: the text may be PDF-underlay geometry (`PDF##_*` layers): not editable, report it.
5. **Verify truth before writing:** every STA/OFFSET in a text must land on something via `civil3d_alignment { action:"station_to_point", name, station, offset }` (leader anchor, pipe end, fitting). LT/RT sign: confirm with `point_to_station` on a known point. Plan geometry is model space with real coordinates (e.g. 316000/16300 FL East); small coordinates (x~-5, y~32) are paper space (`coordinates-cogo.md`). A duplicated label at the same station with another offset and no leader is a **defect to report**, not to delete on your own.
6. **Draft and apply:** take the raw `text`, change only the substring, proofread, then `civil3d_request_approval { toolName:"acad_update_text_content", action:"update_text_content", parameters:{handle,text} }` -> `acad_update_text_content { handle, text, approvalToken }`. New token per edit (depends on drawing state). Real tab characters in MText ("2<TAB>OF<TAB>3") must be identical in approval and call. Erase a whole note (`acad_erase_entity`) only if the user confirmed that row.
7. **Save** per sheet: `civil3d_drawing { action:"save" }` (token). If `unsavedChanges` was already true before starting -> ask, then `saveAs` to `...\<project>\YYYY-MM-DD_QC\<file>.dwg`.
8. **Next sheet** from step 2. Plan (C-3x0) and profile (C-3x1) are reviewed separately; the profile has its own fitting callouts.

## 3. Typical corrections (WASD / Miami-Dade)
- **Easements:** `PROP. 15' WASD GRANT OF EASEMENT`; markup often drops qualifiers (`NON EXCLUSIVE`, `NON-`, `(BY OTHERS)`). Check first whether the DWG already matches the Submittal (it did on T25-06.212).
- **Tapping sleeve/valve:** `PROP. 12"X10" D.I. TAPPING SLEEVE WITH 10" TAPPING VALVE AND 10"X12" INCREASER TIED TO TAPPING VALVE PER G.S.1.7 (1/1)`. Frequent changes: `TAPPED TO` -> `TIED TO`; add `(REFER TO WASD DESIGN AND CONSTRUCTION STANDARDS SECTION 15102, PART 1.05. UTILITY CONTRACTOR MUST COORDINATE WITH WASD FIELD INSPECTOR AND MD-WASD WATER DISTRIBUTION TO AVOID ANY WATER INTERRUPTION TO THE NEIGHBORING PROPERTIES.)` and delete the short "NOTE: UTILITY CONTRACTOR TO COORDINATE..."; merge sleeve and valve notes. Repeats on each sleeve (left and right): apply to all and verify each station.
- **Fittings:** "GATE VALVE ... VALVE BOX & LID" -> "TEE IN VERTICAL POSITION" when the Submittal changes the fitting; cross-check the profile (`PROP. 12"X6" D.I. TEE IN VERTICAL POSITION PER G.S.1.7`). The graphic symbol may need changing too (§4).
- **Removed qualifiers:** `(PER MD-WASD FIELD VERIFICATION)`, `, PRIVATE`, `- PER W.S.3.10 (1/1)`: remove only that substring, no double spaces or dangling commas.
- **Duplicate notes:** remove only if the Submittal lacks it and the user confirms.
- **Revision table:** loose DBText/MText per cell in paper space. Find with `acad_list_text_entities { space:"paper", contains:"CPR" }` or by date. Edit a row by handle; add a row with `acad_create_text { text, x, y, height, layer, space:"paper", layout }` (one call per cell, copying layout/layer/height/X from the previous row; Y = previous row's Y minus the row pitch; MText cells -> `acad_create_mtext`); or reuse empty/placeholder cells with `update_text_content`.
- **Revision clouds:** polylines/splines: `acad_list_polyline_entities { space:"all", colorIndex }` + `summarize-entities.mjs --by layer`; if only PDF-underlay noise shows, confirm visually with the user before deleting anything.
- **New MLeaders:** `acad_create_mleader` tip at the object's XY (`station_to_point`), text in free space, layer/style of existing callouts (`acad_list_text_entities { entityTypes:["MLeader"] }`).
- **Title blocks / numbering:** `plan-production-sheets.md`.

## 4. Identifying hand-drawn symbols (tee / valve / bend)
1. `acad_list_block_references { contains }` and `acad_list_text_entities` first (cheap). 2. Else STA/OFFSET -> XY with `station_to_point`. 3. `acad_list_shape_entities { nearX, nearY, nearRadius:3-10 }` (or filter by `PDF##_*` layer). 4. Compare against `C:\Users\camil\OneDrive\Documents\Civil3D-mcp\Civil3D-mcp\docs\reference\wasd-symbol-legend.md` (or subagent `wasd-symbol-reference`); gray = existing, solid black = proposed. 5. State the match and your confidence. There is no "swap block" for primitives: redraw (erase + insert block) is the user's decision. 6. Add any new symbol/abbreviation to the legend with project and sheet of origin.

## 5. Final report (always)
```
Sheet: C-310 | DWG: <path> | Saved: yes (save | saveAs <path>)
Applied: #1 handle 52FBA (TAPPED->TIED) | #2 handle 4D1CC (removed ", PRIVATE") ...
No change (already matched): #5 easements
Pending / needs decision: symbol at STA 10+30.52 (primitives, looks like valve) | duplicate 4FB02 8.23' LT
New gotchas: ...
```
Store this state in the project memory (not in the skill).
