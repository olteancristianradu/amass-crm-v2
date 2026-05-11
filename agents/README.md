# Agent prompts for AMASS CRM

This folder contains the system prompts used by AI agents (Claude Code, Codex, etc.) when working on this codebase.

Each agent file is a self-contained prompt that:
- Defines a specific role (backend implementer, frontend implementer, red team, code reviewer, technical writer)
- Inherits the non-negotiable rules from [`../AGENTS.md`](../AGENTS.md)
- Adds role-specific guidance (allowed tools, scope, hand-off rules)

## How to use

When you start a new agent session, paste the corresponding `AGENT_*.md` content as the first message:

```bash
# In one terminal
screen -S amass-backend
claude --dangerously-skip-permissions
# Paste contents of agents/AGENT_BACKEND.md as first prompt

# In another terminal
screen -S amass-redteam
claude --dangerously-skip-permissions
# Paste contents of agents/AGENT_REDTEAM.md
```

Detach with `Ctrl+A D`, reattach with `screen -r <name>`.

## Roles

| File | Role | Typical scope |
|---|---|---|
| [AGENT_BACKEND.md](./AGENT_BACKEND.md) | Senior NestJS engineer | API features, Prisma schema, BullMQ jobs, security fixes |
| [AGENT_FRONTEND.md](./AGENT_FRONTEND.md) | Senior React engineer | Pages, components, TanStack Query, design polish |
| [AGENT_REDTEAM.md](./AGENT_REDTEAM.md) | Security pentester (adversarial) | RLS fuzz, auth bypass attempts, SSRF probes, dependency triage |
| [AGENT_REVIEWER.md](./AGENT_REVIEWER.md) | Code reviewer (gate before push) | Architectural critique, test coverage check, regression risk |
| [AGENT_DOCS.md](./AGENT_DOCS.md) | Technical writer | README, FEATURES.md, ARCHITECTURE.md, CHANGELOG |

## Hand-off contract

When agent A finishes a task and agent B picks up:

1. Agent A commits + pushes to `main` with a Conventional-Commit message that explains the *why*.
2. Agent A updates `CHANGELOG.md` for user-visible changes, `LESSONS.md` if anything broke or surprised, `SECURITY_FINDINGS.md` if security-relevant, `RELEASE_CHECKLIST.md` if launch-readiness changed.
3. Agent B starts by reading the recent `CHANGELOG.md` + `LESSONS.md` entries and the [`AGENTS.md`](../AGENTS.md) "Required startup checklist" before any code change.

See [`HANDOFF.md`](./HANDOFF.md) for the full contract.

This way no agent needs to memorize what another did — the control docs are the truth.
