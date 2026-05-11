# Agent hand-off contract

When agent A finishes a task and agent B (or a future you) picks up, **the only context that survives is what's written down**. Memory in a screen session does not transfer.

## At end of every task

1. **Commit + push to `main`** with a Conventional-Commit message that documents the *why* and the *what*.
2. **Update `CHANGELOG.md`** for any user-visible change.
3. **Update `LESSONS.md`** if anything broke, surprised, or wasted time.
4. **Update `RELEASE_CHECKLIST.md`** if launch readiness changed.
5. **Update `SECURITY_FINDINGS.md`** if you touched anything security-related.
6. Verify: `git fetch origin && gh run list --limit 5` — CI must be green.
7. Final sentence: *"Pushed `<sha>`. CI: <pass/fail/in_progress>. Health: <200/non-200>."*

History (what was done when, by whom) lives in `git log` and `CHANGELOG.md`. Don't try to maintain a separate "status snapshot" file — those age into traps within days. See `LESSONS.md` 2026-05-03 entry for the lesson learned.

## At start of every task

1. Read `AGENTS.md` (the rules) and `CLAUDE.md` (the project mandates).
2. Read `CHANGELOG.md` recent entries + `LESSONS.md` to catch context.
3. Run startup checks:
   ```bash
   git status --short
   git branch --show-current
   git log --oneline -10
   git fetch origin
   git rev-list --left-right --count HEAD...origin/main
   docker ps | head
   ```
4. State concretely: branch, ahead/behind, dirty?, Docker accessible?, GitHub accessible?
5. Identify the next task from open issues / `RELEASE_CHECKLIST.md` items / the user's request.
6. **Stop and propose the ≤15-line plan.** Only proceed when approved (or, if the user explicitly said "work autonomously", proceed but report at end).

## What never goes into agent-to-agent comms

- "I'll remember to..." (no, you won't — write it down)
- "Last time we discussed..." (the next agent didn't have that conversation)
- "I think the plan was..." (read the commit message + `CHANGELOG.md` entry)
- "It worked on my machine" (paste the command + output)

## Conflict resolution between agents

Two agents touching the same file:

1. The agent that pushed first wins on `main`.
2. The second agent rebases their work on top, resolves conflicts, retests.
3. If a third agent comes in and finds the previous two contradict each other in a commit message or doc entry, **stop** and surface the contradiction. Don't pick a side silently.

## Bouncing a task back to a different agent

If you're AGENT_BACKEND and you find a UI issue mid-task, do **not** fix it yourself. Open a GitHub issue (or add a TODO in the relevant file with a `// TODO(AGENT_FRONTEND):` marker) and continue your BE work. The next FE session picks it up from there.

## Honesty rules — non-negotiable

Inherited from `AGENTS.md`:

- Never claim something works without verification (paste the command).
- Never say "tested" without specifying which test.
- After push: "Push executed. I am not declaring everything ok yet. I am verifying remote + CI + health."
- Only after the verification passes: "Push verified."

Anti-patterns to refuse, even under pressure:

- Skipping `pnpm test` because "the change is small"
- Using `--no-verify` to bypass pre-commit hooks
- Force-pushing to `main` (CLAUDE.md rule 7)
- Marking `RELEASE_CHECKLIST.md` items complete without the listed verification commands

## Quickstart for a new agent session

```bash
cd ~/amass-crm-v2
cat AGENTS.md CLAUDE.md
sed -n '1,80p' CHANGELOG.md
sed -n '1,80p' LESSONS.md
git fetch origin && git status --short && git rev-list --left-right --count HEAD...origin/main
docker ps | head
```

Now you have the same baseline every other agent has. Pick the next task from open issues / `RELEASE_CHECKLIST.md` / the user's request and start.
