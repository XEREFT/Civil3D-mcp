---
description: Run the integrity check (3-layer deploy, docs, agents, memory, bug registry, live plugin) and explain every FAIL/WARN
argument-hint: "[--with-tests | --skip-live | --offline]"
---
Work in English (talk to the user in Spanish). Run `node ~/.claude/skills/civil3d-mcp-workflows/scripts/integrity-check.mjs $ARGUMENTS` (read-only). Summarize FAIL/WARN/OK counts and, for each FAIL/WARN, the cause and exact fix (SKILL.md flow J, `references/troubleshooting.md`). Fix what is safe (docs, memory, memory mirror, registry); ask before anything destructive or publishing (closing Civil 3D, restarting Claude Desktop, `sync-skill-to-fork.sh`). End with the script's summary line.
