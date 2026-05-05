## What this changes

<!-- 1-3 sentences. Why does this exist? -->

## How to verify

<!-- Concrete commands or steps. NOT "tested locally" — exact commands. -->

```bash
pnpm --filter @amass/api test
# or
docker compose up -d && curl ...
```

## Checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] If schema changed: migration created and `prisma generate` ran
- [ ] If multi-tenant code: every Prisma query inside `runWithTenant()` or filters by `tenantId`
- [ ] If security-relevant: `SECURITY_FINDINGS.md` updated with SEC-N entry
- [ ] If user-facing: tested in browser, not just unit tests
- [ ] Conventional commit message

## Screenshots

<!-- For UI changes. Drag-and-drop here. -->

## Related issues

<!-- Closes #123 -->
