# Fase 1 - compatibility findings (SEIDENSTEIN, FormTech survey, 2026-10-25) and their status

Each row: what failed, why, what fixed it (script / profile key), and whether it is automated for the next project.

| # | Finding | Cause | Status / fix |
|---|---|---|---|
| 1 | "Missing SHX Files" dialog blocked `attachXref`; the 18 lot legal descriptions did not show | FormTech styles point to `dot.shx`, `archstyl.shx`, `engineering.shx` that do not exist here | FIXED: styles repointed to `simplex.shx` in the project copy of X-TOPO (geometry intact, original in `_backup`). Still ask the surveyor for the fonts (client-data-request item 7) |
| 2 | Host drawing cannot edit survey entities (colours, layers, text) | They live in an xref | FIXED: edit a `%TEMP%` copy with `accoreconsole` (entmod), then `xref-reload.ps1` (unload, copy file, reload, freeze, regen). Scripts: `topo-hide-pavement-labels`, `topo-hide-blocks`, `topo-white-blocks`, `topo-move-text` |
| 3 | Layer colour overrides had no effect on some entities | 518 survey entities had explicit colours; blocks with fixed colours inside (`ARR-L` -> `ARROW`, colour 1 on layer `1`) | FIXED: `topo-bylayer.ps1` (explicit -> ByLayer, once); blocks that cannot be recoloured are hidden (`hideBlocks`) or whitened per insert (`whiteBlocks`) |
| 4 | Hiding survey text left arrows pointing at nothing | Survey arrows are loose `LEADER`s (no link to the text) | FIXED: `topo-hide-pavement-labels.mjs` pairs text with leader by end point, detects orphan leaders and hides the pair; rule: no arrow without a label |
| 5 | Hiding labels by pattern removed needed ones (a manhole lost its name) | Pattern match on text only | FIXED: classes + pairing + preview before saving; layer `INVERTS & MANHOLES` leaders are never touched by the pavement classes |
| 6 | MLeader text came out diagonal (117 deg instead of 90) | `create_entities` mleader `rotation` is in RADIANS | FIXED in the recipe (`topo-san-mh-labels.mjs --rot 1.5708`); `c300-utility-labels.mjs` already converted degrees |
| 7 | MLeader text right-aligned with a slanted leader | Text placed to the LEFT of the arrow attaches on the right side | FIXED: text placed paper-up and 2 ft to the right of the arrow (left attachment, near-vertical leader) |
| 8 | `create_entities` rejected with "does not support idempotent retries" | The action takes no `idempotencyKey`; approval tokens are exact per parameters | FIXED: never pass `idempotencyKey` to `create_entities`; request a fresh token if parameters change |
| 9 | Zoom through COM unreliable on the twisted view (`ZoomCenter` landed 620 ft away; `VIEWCTR` write errors) | View twist 267.9 deg | FIXED: `view-capture.ps1` uses the command `ZOOM _W x1,y1 x2,y2` through `SendCommand` |
| 10 | `RPC_E_CALL_REJECTED`, slow COM layer enumeration (60 s timeouts) while Civil 3D is busy | COM calls during regen/command | WORKED AROUND: retry loops; enumerate by index with one property; never kill Civil 3D |
| 11 | Scripts patched through Bash heredocs lost backslashes (`\n`, Windows paths) | Shell escaping | WORKED AROUND: write/patch files with the Write/Edit tools; use `import.meta.dirname` and `path.join` for Windows paths |
| 12 | `accoreconsole` hung once and returned nothing | Relative `/i` paths; script without a terminal `QUIT` | FIXED: absolute paths, `QSAVE`/`QUIT`/`Y`; kill the hung process by its own PID, never `taskkill /IM` |
| 13 | A rebuild would lose declutter done only as host layer overrides (`HATCH`, `HATCH ASPHALT`, `U Mail Box`) | Overrides live in the host DWG, not in the profile | FIXED: those layers are now in `hideXrefLayers` of the formtech profile |
| 14 | PDF older than the DWG triggered the integrity warning | Saved after plotting | PROCESS: regenerate the PDF after every save of the BASE DWG |
| 15 | Survey notes overlap architecture inside the subject lot (569155, 56C6F1, 56E3A6) | MTEXT background mask cannot be set on xref text (entmod drops groups 90/45; ActiveX unavailable in `accoreconsole`) | OPEN: workaround = move the note (`topo-move-text.mjs`) or accept; our own white subject label already has a mask |
| 16 | "Unreconciled New Layers" balloon after each xref reload | New xref layers (`HIDE-*`) | OPEN, harmless (do not tick "always" in dialogs) |
| 17 | `REMAINDER OF TRACT 16` note straddles a lot line | The surveyor placed one note over two lots; its owner is not known | OPEN by design: centred below the two lot notes, never assigned to one lot without the plat |
| 18 | Sanitary manholes (3 `SMH`) are 230+ ft off the sheet window | Survey shows them on SW 74th St; the sheet is 1"=20' | OPEN (decision): labels exist in model space (`topo-san-mh-labels.mjs`) but do not print; as-builts/POC decide the window |
| 19 | Integrity check baseline: 6 WARN (extension mirror, tool-index, `subject.gpd` XXX by design, 2 missing `project.json`, stale batch report) | Pre-existing, unrelated | OPEN |
