# Drawing setup: xrefs, layers, documents, cleanup

Full firm conventions (colors, scales, text, project flow) are in subagent `civil3d-new-project`; delegate "how is X normally done?" to it. Here: tool mechanics and gotchas only.

## Typical water-connection project
- Xrefs per discipline: `X-ARCH`, `X-TOPO`, `X-UTIL` (sometimes `C-WS` as water/sewer source); never design inside them.
- Design sheet (e.g. `C-300.dwg`) with those xrefs as **Overlay** on layer `XREF`, at 0,0,0, scale 1, rotation 0.
- Folders: per project only the client intake (untouched) + `<NAME> @XEREFT BASE` (+ `PROPOSED` when we design); see SKILL.md. One project can have several separate deliverables (e.g. a Grading & Drainage permit vs a water-main proposal): do not mix their states.

## Several open documents
`acad_list_open_documents` -> `acad_set_active_document { match }` -> operate -> go back. Every tool acts ONLY on the active document.

## Xrefs
1. `acad_create_or_update_layer { name:"XREF" }` if missing. 2. `acad_attach_xref { filePath:"<absolute>", layer:"XREF", x:0, y:0 }` (default `overlay:true`; `overlay:false` = Attach only on explicit request: attach nests xrefs in cascade). 3. Verify with `acad_list_block_references { contains:"X-TOPO" }`.
- **Changing an existing xref's layer:** no "set layer" tool: attach again on the right layer at the same place, then `acad_erase_entity` the old instance (with confirmation). Validated on Goulds C-WS.
- An xref block on an odd layer (e.g. `C-ANNO`) may be a duplicate: report it, do not delete without confirmation.
- Absolute paths keep resolving after Save As to another folder. Project xrefs inside a BASE folder are relative (`.\X-TOPO.dwg`) so the folder can be moved.
- Xref layer overrides: setting `colorIndex`/`frozen` on `X-TOPO|layer` writes host overrides (VISRETAIN=1, saved in the DWG, honored by Core Console plots); entities with explicit colors ignore them (`topo-bylayer.ps1`).

## Layers
`acad_create_or_update_layer { name, colorIndex?, linetype?, lineweight?, plot?, frozen?, locked? }` (updates if it exists).
- Existing = ACI 8 gray dashed; proposed = saturated color per discipline (water = green in Goulds). In the firm's plot style color = line weight: red 0.15, yellow 0.30, green 0.35, blue 0.50, color 5 0.70, color 8 ~70-80% gray.
- One layer per discipline (`C-Watr`, `C-San`, `C-Align`): recoloring the layer recolors everything on it.
- `linetype` loads from `acad.lin`/`acadiso.lin`; complex text linetypes (`SANITARY_LINE` "SAN", `WM` "WM") are NOT there: they arrive with the X-UTIL xref (`X-UTIL|SANITARY_LINE`, `X-UTIL|WM`), never recreate them. Standard SAN/WM marking: `c300-water-sewer-plan.md` §9.

## Blocks (fittings, meters)
`acad_insert_block_reference { blockName, x, y, rotation(rad)?, layer?, sourceFilePath? }` (with `sourceFilePath` imports only that definition via WblockCloneObjects). Use county part names letter by letter (e.g. `DualMeterBox`); name fittings with sizes ("12x6").

## Cleanup
- `acad_audit_drawing { fixErrors:true }` is safe (habit QC). `acad_purge_unused` is a real PURGE: only on disposable files with confirmation (working files may end with thousands of dangling references).
- `civil3d_qc_check_drawing_standards` -> `civil3d_qc_fix_drawing_standards` (mutates; needs token).

## Orchestrated new project
`civil3d_workflow_project_startup` / `..._project_reference_setup` / `..._drawing_readiness_audit` (parameters via `list_tool_capabilities`). `civil3d_drawing { action:"new", templatePath }` creates a DWG from a template (`templates/Civil_Imperial.dwt` in the repo).

## Manual steps (no tool)
Open a DWG from disk, Batch Plot, Sunshine 811 ticket, verify existing services with satellite imagery.
