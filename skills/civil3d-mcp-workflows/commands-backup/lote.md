---
description: Audit every Fase 1 project in the background (without opening Civil 3D) and show what each one is missing
argument-hint: "[--only <name text>] [--reuse-dump]"
---
Work in English (talk to the user in Spanish). Run `node ~/.claude/skills/civil3d-mcp-workflows/scripts/fase1-batch.mjs --report $ARGUMENTS` (read-only; Core Console on %TEMP% copies; a few minutes per project). Show the table "project -> result -> what is missing" and the exact fix for each FAIL/WARN (flow I: `/fase1`, `fase1-finish.mjs`, freeze `C-TINN-BNDY`...). What the no-Civil-3D mode cannot cover (networks, profiles, alignment style) is audited by opening the file with `civil3d_workflow_fase1_audit`. The report goes to `AUTOCAD @XEREFT\_reports\`; a scheduled task already runs it Mon-Fri 22:00.
