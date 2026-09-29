# Quality gates

The required repository-wide quality gates run without error-count allowances
or ignored exit codes:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

CI formatting is a required changed-files ratchet: Biome formats only files
changed against the event's base revision (the pull request base SHA for PRs,
the previous commit for pushes to `main`, or `HEAD^` for manual/fallback runs).
A PR that introduces incorrectly formatted files fails the `static` job, while
pre-existing formatting debt outside the change is tolerated temporarily.
`pnpm format:check` remains a whole-repository formatting-debt diagnostic; it
is not the current CI formatter and a clean `main` is not claimed to pass it.

The [Quality Gates workflow](../../.github/workflows/quality-gates.yml) runs on
pull requests targeting `main` and pushes to `main`. It uses Node 24 and
pnpm 11.19.0. The stable aggregate check is `quality-gates`; it succeeds only
when `static`, `unit`, `integration`, `build`, and `e2e` succeed.

Integration tests use Testcontainers to start isolated PostgreSQL and Redis.
Their global setup applies the checked-in Drizzle migrations. The CI runner
must provide Docker. E2E uses local PostgreSQL and Redis service containers,
filesystem storage, and Playwright's own API/Web/Worker harness. The E2E
backend applies the same migrations. No production service or secret is needed.

## Main branch ruleset

The active GitHub ruleset for `main` requires a pull request and the
`quality-gates` status check. Required branches must be up to date before
merge. Non-fast-forward/force pushes and branch deletion are restricted; the
bypass list is empty. These settings were verified against the active GitHub
ruleset, not inferred from the workflow file.

The ruleset is operational GitHub configuration and can change outside this
repository. Reverify it after administrative changes. If a CI job fails, fix
the cause rather than adding an allowance, skipping a suite, or marking it
`continue-on-error`.
