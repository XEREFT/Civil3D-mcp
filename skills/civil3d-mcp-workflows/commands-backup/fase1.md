---
description: Leave the active Civil 3D DWG in pure Fase 1 (existing only) and deliver it - audit, clean with ONE plan approval, save, plot, copy the PDF
argument-hint: "[path to the DWG, or nothing = active document]"
---
Work in English (talk to the user in Spanish). Run flow I of skill `civil3d-mcp-workflows` (SKILL.md + `references/c300-water-sewer-plan.md` §9 "Fase 1 definition of done") on: $ARGUMENTS (empty = the active Civil 3D document; the guide/target is only READ, never saved).

1. Start: `node ~/.claude/skills/civil3d-mcp-workflows/scripts/integrity-check.mjs --skip-live --brief` (0 FAIL) + `civil3d_health` + `acad_list_open_documents`. Project state: `node .../scripts/project-state.mjs show <folder>` (no project.json: `init` then `poc-extract.mjs <POC.pdf> --project <folder>`).
2. Audit: `civil3d_workflow_fase1_audit` (native, live; else `node .../scripts/fase1-audit.mjs`). Each FAIL carries the fixing call.
3. If it has phases 2/3: back up the saved DWG, `node .../scripts/fase1-cleanup-plan.mjs`, run the plan with ONE `civil3d_request_plan_approval` (all steps in order: `delete_layout`, `delete_pressure_network`, `erase_entities` in ONE list, `delete_pipe_network` per shell, `delete` FH1, `set_style`, freeze `C-TINN-BNDY`), then each step with its token (SKILL.md §2.4 for the `parameters` format).
4. `BCC - ALIGNMENT` style, EG border hidden, existing SAN/WM = X-UTIL layers as received, no PROP/PROPOSED words (MD-WASD notes: `civil3d_workflow_fase1_build { expectedDocument: "<this DWG>" }` cleans them in one call; by hand: `fase1-strip-prop-notes.mjs` + `fase1-notes-shift.py`; subject label from `project.json`). Re-audit to 0 FAIL.
5. Save (`civil3d_drawing save`, approval) and run `node .../scripts/fase1-finish.mjs` (dump + audit + plot + PDF review + comparison with the approved PDF + copy + project.json update). Must end READY.
6. Record EVERYTHING without being asked: `project-state.mjs decide/log`, memory, skill/agents if you learned something, `integrity-check.mjs` (0 FAIL). `sync-skill-to-fork.sh` only if asked.

Delivery reminder (2026-10-26): save all drawings first, the zip must contain the working DWG (`package-base.mjs` exits `ZIP INCOMPLETE` otherwise) and deliveries REPLACE the previous ones: use `/entrega`.
