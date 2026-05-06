#!/usr/bin/env bash
# Start the standard 4-agent screen layout for AMASS CRM.
#
# Sessions:
#   amass-be       — backend implementer (Claude Code) with AGENT_BACKEND.md
#   amass-fe       — frontend implementer (Codex CLI) with AGENT_FRONTEND.md
#   amass-redteam  — adversarial security agent (Claude Code) with AGENT_REDTEAM.md
#   amass-docs     — technical writer (Claude Code) with AGENT_DOCS.md
#
# Usage:
#   bash scripts/start-agents.sh           # creates all four detached sessions
#   bash scripts/start-agents.sh be        # only the backend session
#   bash scripts/start-agents.sh be redteam
#
# Reattach with: screen -r amass-be   (or `screen -d -r amass-be` to take over)
# Detach inside a session: Ctrl-A then D

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing tool: $1" >&2
    echo "Install before running this script." >&2
    exit 1
  fi
}
require screen

# Each agent: short id → (full screen name, agent prompt file, command)
start_session() {
  local id="$1"
  local name="amass-$id"
  local prompt_file="$2"
  local cmd="$3"

  if screen -ls | grep -q "\.${name}\b"; then
    echo "[skip] session ${name} already exists — reattach with: screen -r ${name}"
    return 0
  fi

  if [ ! -f "${REPO_DIR}/${prompt_file}" ]; then
    echo "[warn] prompt file missing: ${prompt_file}" >&2
    return 1
  fi

  # Use `bash -lc` so the agent gets the user's full PATH (codex/claude etc.)
  screen -dmS "${name}" bash -lc "
    cd '${REPO_DIR}'
    echo '──────────────────────────────────────────────────────────'
    echo '  AMASS CRM — agent session: ${id}'
    echo '  Prompt: ${prompt_file}'
    echo '  Detach: Ctrl-A then D · Reattach: screen -r ${name}'
    echo '──────────────────────────────────────────────────────────'
    cat '${prompt_file}'
    echo
    echo '── Now starting the agent CLI. Paste the prompt above as your first message. ──'
    ${cmd}
  "
  echo "[ok] started ${name} (cmd: ${cmd})"
}

# Per-agent commands. Override with env if you have different names.
: "${CLAUDE_CMD:=claude --dangerously-skip-permissions}"
: "${CODEX_CMD:=codex}"

if ! command -v claude >/dev/null 2>&1; then
  echo "[warn] 'claude' not found — backend/redteam/docs sessions need it" >&2
fi
if ! command -v codex >/dev/null 2>&1; then
  echo "[warn] 'codex' not found — frontend session needs it" >&2
fi

# Which sessions to start. Default = all four.
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=(be fe redteam docs)
fi

for id in "${TARGETS[@]}"; do
  case "$id" in
    be)
      start_session be "agents/AGENT_BACKEND.md" "$CLAUDE_CMD"
      ;;
    fe)
      start_session fe "agents/AGENT_FRONTEND.md" "$CODEX_CMD"
      ;;
    redteam)
      start_session redteam "agents/AGENT_REDTEAM.md" "$CLAUDE_CMD"
      ;;
    docs)
      start_session docs "agents/AGENT_DOCS.md" "$CLAUDE_CMD"
      ;;
    *)
      echo "[skip] unknown agent id: $id (valid: be, fe, redteam, docs)" >&2
      ;;
  esac
done

echo
echo "──────────────────────────────────────────────────────────"
echo "Active sessions:"
screen -ls | grep amass- || echo "  (none)"
echo "──────────────────────────────────────────────────────────"
