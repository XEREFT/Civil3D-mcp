# Plan production: sheets, title blocks, publishing

## Tools
| Task | Tool |
|---|---|
| List sheet sets | `civil3d_sheet_set_list`, `civil3d_sheet_set_get_info` |
| Create a set / add a sheet | `civil3d_sheet_set_create { name }`, `civil3d_sheet_add { sheetSetName, sheetName, sheetNumber?, layoutName? }` |
| Assign a title block | `civil3d_sheet_set_title_block { sheetSetName, sheetName, titleBlockPath }` |
| Plan/profile sheet per alignment | `civil3d_plan_production { action:"plan_profile_sheet_create", sheetSetName, alignmentName, ... }`; update: `civil3d_plan_profile_sheet_update_alignment` |
| Viewport | `civil3d_sheet_view_create { layoutName, centerX?, centerY?, width?, height?, scale? }`, `civil3d_sheet_view_set_scale` |
| Properties | `civil3d_sheet_get_properties` |
| Publish PDF | `civil3d_sheet_publish_pdf { layoutNames:[...], outputPath, overwrite?, plotStyleTable?, paperSize? }` |
| Export a set / all orchestrated | `civil3d_sheet_set_export` / `civil3d_workflow_plan_production_publish` |

Publishing needs an approval token (it exports); the output path must be inside `CIVIL3D_EXPORT_ROOTS` / `CIVIL3D_FILE_ROOTS` when set. Firm standard: 24"x36", typical 1"=20', plot style mapping color to line weight (`drawing-setup-xrefs-layers.md`). **Batch Plot of the whole set is manual**; if `sheet_publish_pdf` is not enough, ask the user.

## Title blocks (most-edited item in QC)
Usually loose DBText/MText in the **layout** (paper space), not attributes. If `acad_list_text_entities { space:"paper" }` does not find the field, try `acad_list_block_references { space:"paper", includeAttributes:true }` and edit with `acad_update_block_reference { handle, attributes:[{tag,value}] }`.
Typical fields: sheet number (`C-301`), title (`WATER PLAN`), count (`2<TAB>OF<TAB>3`, **real tab**), date, project (`YY-MM.XXX`), seal, revision table.

Procedure:
1. List each layout's text; summarize with `summarize-entities.mjs --by layer`.
2. Build a layout -> number / title / count table and **check the whole set** (consecutive numbers, coherent "N OF total", no duplicates). A half-edited state from an earlier session is common (Goulds C-300: C-02 said "C-300, 2 OF 3", C-03 said "C-301, 1 OF 3").
3. If a sheet number already belongs to another real DWG of the project (`Glob` the project folders), the text is an inherited placeholder, not a valid number.
4. Confirm final values with the user; edit only the substring (in a tab-separated count, only the digit).
5. A DWG acting only as an xref source (e.g. C-WS) may not need a number: a placeholder (`C-XXX` / `TBD` / `X OF X`) is a valid final state.

## Revision table
Loose per-cell texts in paper space (No. / date / description / initials). Edit by handle; add rows with `acad_create_text` + `space:"paper"` + `layout` (`redline-qc-workflow.md` §3).

## Hidden templates
Some covers (`Cover_C-001.dwg`) keep a blank title-block copy and a master sheet index outside the printable area (negative X). Intentional: do not touch or report.

## Closing folder
At the end of a session/phase the user copies edited DWGs into a dated subfolder (`YYYY-MM-DD_QC`, `Cierre`, `08.03`); if you saved with Save As, follow the same convention.
