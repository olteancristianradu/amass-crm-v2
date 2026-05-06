# Agent hand-off contract

When agent A finishes a task and agent B (or a future you) picks up, **the only context that survives is what's written to the control docs**. Memory in a screen session does not transfer.

## At end of every task

1. **Update `STATUS.md`** — what changed, what's still true, what's now broken.
2. **Update `UNFINISHED.md`** — close items you finished, open items you discovered.
3. **Update `TEST_REPORT.md`** — exact commands run, exact pass/fail counts.
4. **Update `SECURITY_FINDINGS.md`** — if you touched anything security-related.
5. **Update `LESSONS.md`** — if you hit a non-obvious trap.
6. **Update `RELEASE_CHECKLIST.md`** — if launch readiness changed.
7. Commit + push to `main`.
8. Verify: `git fetch origin && gh run list --limit 5` — CI must be green.
9. Final sentence: *"Pushed `<sha>`. CI: <pass/fail/in_progress>. Health: <200/non-200>."*

## At start of every task

1. Read `AGENTS.md` (the rules).
2. Read all 6 control docs above.
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
5. Identify the next task from `UNFINISHED.md` (lowest open ID, not blocked).
6. **Stop and propose the ≤15-line plan.** Only proceed when approved (or, if the user explicitly said "work autonomously", proceed but report at end).

## What never goes into agent-to-agent comms

- "I'll remember to..." (no, you won't — write it down)
- "Last time we discussed..." (the next agent didn't have that conversation)
- "I think the plan was..." (find it in `STATUS.md` or `UNFINISHED.md`)
- "It worked on my machine" (paste the command + output)

## Conflict resolution between agents

Two agents touching the same file:

1. The agent that pushed first wins on `main`.
2. The second agent rebases their work on top, resolves conflicts, retests.
3. If a third agent comes in and finds the previous two contradict each other in `STATUS.md` or `UNFINISHED.md`, **stop** and surface the contradiction. Don't pick a side silently.

## Bouncing a task back to a different agent

If you're AGENT_BACKEND and you find a UI issue mid-task, do **not** fix it yourself. Add an entry to `UNFINISHED.md` for AGENT_FRONTEND with:

```markdown
| ID | Task | Owner | Notes |
|---|---|---|---|
| FE-XXX | Fix X | AGENT_FRONTEND | discovered while doing BE-YYY; affects file Z:line N |
```

Then keep doing BE work. The next FE session picks it up from `UNFINISHED.md`.

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
- Marking `STATUS.md` as updated when you didn't run the verification commands listed in it

## Quickstart for a new agent session

```bash
cd ~/amass-crm-v2
cat AGENTS.md
cat STATUS.md
cat UNFINISHED.md
git fetch origin && git status --short && git rev-list --left-right --count HEAD...origin/main
docker ps | head
```

Now you have the same baseline every other agent has. Pick the lowest-ID open item from `UNFINISHED.md` and start.
