# Quality gates

TD-3 closes the historical TypeScript and formatting debt. A clean checkout must
pass every command below without error-count allowances or ignored exit codes:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

The [Quality Gates workflow](../../.github/workflows/quality-gates.yml) runs on
pull requests targeting `main` and pushes to `main`. It uses Node 24 and
pnpm 11.19.0. The stable aggregate check is `quality-gates`; it succeeds only
when `static`, `unit`, `integration`, `build`, and `e2e` succeed.

Integration tests use Testcontainers to start isolated PostgreSQL and Redis.
Their global setup applies the checked-in Drizzle migrations. The CI runner
must provide Docker. E2E uses local PostgreSQL and Redis service containers,
filesystem storage, and Playwright's own API/Web/Worker harness. The E2E
backend applies the same migrations. No production service or secret is needed.

## Branch protection rollout

The intended protected branch is `main`. Branch protection is **not activated
by this document**. After the workflow is merged:

1. Let it run on `main` or on a PR and verify the exact check name
   `quality-gates`.
2. Configure a GitHub ruleset or branch-protection rule requiring a PR before
   merge and requiring the `quality-gates` status check.
3. Require branches to be up to date before merge where practical.
4. Disable force pushes and branch deletion.

Do not configure a required check before its first successful run: GitHub must
recognize the check name. If a CI job fails, fix the cause rather than adding
an allowance, skipping a suite, or marking it `continue-on-error`.
