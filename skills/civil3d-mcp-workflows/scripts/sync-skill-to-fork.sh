#!/usr/bin/env bash
# Backs this skill up to the fork branch `skill/civil3d-mcp-workflows` (XEREFT/Civil3D-mcp, PUBLIC repo; the skill holds firm
# standards + project data — the user accepted that). The skill folder is NOT a git repo, so the branch is refreshed through a
# temporary worktree (procedure from memory `github-publishing`). PUSHES to the fork: the user authorized it PERMANENTLY (2026-10-02, continuous improvement): run it at the end of every session that changed the skill/scripts/memory, without waiting to be asked.
#   bash sync-skill-to-fork.sh "<commit message>" --yes        (without --yes it stops after committing locally in the worktree)
set -euo pipefail
MSG="${1:?commit message required}"
PUSH="${2:-}"
REPO="/c/Users/camil/OneDrive/Documents/Civil3D-mcp"
SKILL="/c/Users/camil/.claude/skills/civil3d-mcp-workflows"
TMP="$(mktemp -d)/skill-wt"
BR="skill/civil3d-mcp-workflows"

cd "$REPO"
git fetch fork "$BR"
git worktree add -B "$BR" "$TMP" "fork/$BR" >/dev/null
trap 'cd "$REPO"; git worktree remove --force "$TMP" >/dev/null 2>&1 || true' EXIT

# Backups that live outside the skill folder:
#  - the 4 subagents (repo .claude/agents is gitignored, so they exist nowhere else) -> skill/subagents-backup/ (goes to the public fork)
#  - the Claude Code memory folder -> a PRIVATE OneDrive folder (never the public fork)
AGENTS_SRC="$REPO/.claude/agents"
MEM_SRC="/c/Users/camil/.claude/projects/C--Users-camil-OneDrive-Documents-Civil3D-mcp/memory"
MEM_DST="/c/Users/camil/OneDrive/Documents/Civil3D-MCP-backup/memory"
if [ -d "$AGENTS_SRC" ]; then mkdir -p "$SKILL/subagents-backup"; cp -f "$AGENTS_SRC"/*.md "$SKILL/subagents-backup/"; fi
if [ -d "$MEM_SRC" ]; then mkdir -p "$MEM_DST"; cp -f "$MEM_SRC"/*.md "$MEM_DST/"; echo "memory backed up to $MEM_DST"; fi

mkdir -p "$TMP/skills"
rm -rf "$TMP/skills/civil3d-mcp-workflows"
cp -r "$SKILL" "$TMP/skills/civil3d-mcp-workflows"
# runtime junk written by Core Console / plot runs (never part of the skill)
rm -rf "$TMP/skills/civil3d-mcp-workflows/scripts/ErrorReports" "$TMP/skills/civil3d-mcp-workflows/scripts/plot.log"
cd "$TMP"
# CI of the skill branch: runs scripts/skill-selfcheck.mjs (skill-only checks) on every push touching the skill
if [ -f "$SKILL/ci/skill-check.yml" ]; then
  mkdir -p "$TMP/.github/workflows"
  cp -f "$SKILL/ci/skill-check.yml" "$TMP/.github/workflows/skill-check.yml"
  git add -A .github/workflows/skill-check.yml
fi
git add -A skills
if git diff --cached --quiet; then echo "skill already up to date on the fork branch"; exit 0; fi
git commit -q -m "$MSG

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git log --oneline -1
if [ "$PUSH" = "--yes" ]; then
  git push fork "$BR"
  echo "pushed $BR"
else
  echo "committed locally in the temp worktree only (re-run with --yes to push)"
fi
