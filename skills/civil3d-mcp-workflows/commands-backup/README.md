# commands-backup
Copias (respaldo en el fork) de la automatización que vive FUERA de la skill:
- `fase1.md`, `integridad.md` → `~/.claude/commands/` (comandos `/fase1` y `/integridad`).
- `SessionStart-hook.settings.json` → clave `hooks` de `<repo>/.claude/settings.json` (hook de arranque de sesión).
Restaurar: copiar los .md a `~/.claude/commands/` y fusionar el JSON en settings. `integrity-check.mjs` avisa (grupo agents) si estas copias difieren de las vivas.
