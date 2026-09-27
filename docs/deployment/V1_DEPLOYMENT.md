# NodeProx V1 production deployment

This runbook prepares one Linux VPS for NodeProx containers. It does not configure external providers automatically. Run the commands from the repository root on the VPS and keep `.env.production` outside version control.

## A. VPS prerequisites

- A supported Linux VPS with a current Docker Engine and Docker Compose plugin.
- DNS control for `app.nodeprox.org` and Cloudflare configured in **Full (strict)** mode once the Caddy origin certificate is available.
- Network access from the VPS to Backblaze B2 and the configured PostgreSQL/Redis containers.
- Ports 80 and 443 open in the VPS firewall. Do not open 3000, 3001, 5432, or 6379.

## B. Install Docker and Compose

Install Docker Engine and the Docker Compose plugin using Docker's current distribution instructions for the VPS operating system. Verify both before continuing:

```bash
docker --version
docker compose version
```

## C. Clone the repository

```bash
git clone <your-nodeprox-repository-url> nodeprox
cd nodeprox
git checkout <approved-release-tag-or-commit>
```

Use a reviewed tag or commit for each release. Do not deploy a dirty local checkout.

## D–E. Create and configure production environment

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production` and replace every `replace-with-...` value. `DATABASE_URL` and `REDIS_URL` must reference the Compose service names `postgres` and `redis`, never `localhost`. Production requires `STORAGE_PROVIDER=b2` and all B2 variables; the application fails closed if B2 configuration is incomplete.

### B2 write-credential hardening gate

Before declaring production storage hardened, inventory all Backblaze Application Keys with write authority. Restrict them to the `nodeprox` bucket, grant only the capabilities each component needs, and restrict file-name prefixes wherever the component's actual keys allow it. Prefer separate keys for API, Worker, and controlled maintenance commands; the current Compose configuration passes the same environment file to API, Worker, and migration operations, so component isolation must be verified during deployment. Avoid routine manual sharing of production write credentials. Rotate or revoke unnecessary broad keys after inventory, under the normal credential-change procedure.

Web clients receive scoped upload grants, not permanent B2 credentials. Confirm that no external or manual writer shares the keys used for Chapter media publication. NodeProx protects its controlled writers through PostgreSQL serialization, canonical keys, create-exclusive writes, equivalence verification, post-write verification, and reconciliation. This does not provide atomic exclusion against an external writer with the same credentials. Credential exclusivity is a deployment/security gate, not a code-commit gate.

The current session implementation is database-backed and cookie-based. There is no JWT/session-signing environment variable to invent or expose.

## F. Build images

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
```

## G. Start PostgreSQL and Redis

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres redis
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Wait until both services are healthy. PostgreSQL persists in `postgres-data`. Redis uses append-only persistence in `redis-data` because it carries BullMQ queue state; retain this volume through normal application updates.

## H. Run database migrations exactly once

Run migrations before starting traffic for a new release. The operational `migrate` service is intentionally not part of the normal stack. Its image contains a prebuilt Node.js migration runner and the official Drizzle migration files; it does not run `pnpm install`, fetch packages, or require `tsx` at runtime:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate
```

Do not run this command concurrently and do not configure API replicas to migrate on startup.

## H.1 Bootstrap the first administrator exactly once

An empty production database has no functional users. After migrations, create the first administrator with the existing Identity/Authorization bootstrap command:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate pnpm db:bootstrap:admin
```

Set `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` to unique, secret values in `.env.production` before running it. The migration runner preserves this Compose command as a compatibility operation while dispatching to a prebuilt Node.js artifact, not `pnpm`. That artifact uses the existing `AdminBootstrapService` and Argon2 password hasher; it never requires hand-written SQL or a manually generated password hash. On a clean installation it creates one active `admin` user and its audit event. Subsequent executions report `already-admin` for the same address, or promote an existing user with that address, so treat this as a controlled bootstrap operation rather than a startup hook.

`pnpm db:seed:auth` is a development/test helper and must not be run in production.

## I–J. Start API, Worker, Discord bot, Web, and reverse proxy

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d api worker discord-bot web reverse-proxy
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

The `ps` output must include `discord-bot` alongside API, Worker, Web, and reverse proxy. The bot is the production Discord integration; `apps/bot` is a legacy placeholder and is not a Compose service. Do not infer a bot HTTP health endpoint from this check.

Caddy is the only public entrypoint. It terminates HTTPS for `app.nodeprox.org` and sends all paths, including `/api/*`, to Next.js Web. Next.js preserves the existing same-origin proxy boundary and forwards API calls internally to `api:3001`.

## K–L. Validate health and UI

From the VPS:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api node -e "fetch('http://127.0.0.1:3001/health').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
curl -fsS https://app.nodeprox.org/api/health
```

Then open `https://app.nodeprox.org`, verify login, dashboard navigation, and an authorized B2 direct-upload browser flow.

## M. DNS and Cloudflare actions performed by a human

- Point `app.nodeprox.org` at the VPS reverse proxy and allow 80/443 through the VPS firewall.
- Configure Cloudflare SSL/TLS as **Full (strict)**. Do not use Flexible TLS.
- Keep `media.nodeprox.org` on the existing CDN/B2 path. This deployment does not proxy or alter media delivery.
- Update B2 bucket CORS for the final application origin as documented in [B2 direct upload](../architecture/b2-direct-upload.md).

## Pre-Go-Live Data Check

Before publishing traffic, perform this manual, non-destructive review:

- Confirm PostgreSQL migrations completed successfully and that no development/test records were imported. The migration history creates schema and a safe internal product-configuration default only; it does not create users, Series, Chapters, Images, or demo content.
- Confirm Redis starts from its empty production volume. Compose imports no dump, fixture, or development cache. Keep AOF enabled for runtime queue durability after go-live.
- Confirm the first ADMIN bootstrap command completed successfully and that the account can authenticate. Do not run `db:seed:auth` in production.
- Confirm there are zero demo/test users beyond the intentionally bootstrapped administrator, and zero development Series/Chapters/Images.
- Manually inventory the existing/shared Backblaze B2 bucket for test objects before directing production traffic. NodeProx has durable application-managed cleanup for supported asynchronous media workflows and [integrity reconciliation](../architecture/ASYNC_INTEGRITY.md); neither is a blanket bucket purge tool. Manual bucket cleanup remains a separately controlled operation.
- Confirm B2 bucket CORS permits `https://app.nodeprox.org` and does not retain development origins that should no longer be authorized.

Do not mass-delete PostgreSQL, Redis, or B2 data as part of this pre-go-live check. Any manual cleanup needs an approved, explicitly scoped operational procedure.

For diagnosis from a repository checkout with the required local tooling and environment, `pnpm integrity:reconcile` runs in dry-run mode by default; `--repair` performs mutations and requires review of the proposed scope. The production API/migration images are not documented as containing the repo-local TypeScript script and `tsx`, so this runbook intentionally gives no production-container reconciliation command.

## N. Rollback

1. Keep the prior reviewed release tag or image available.
2. Stop only the application-facing services for the failed release.
3. Check out/build the previous release, then start `api worker discord-bot web reverse-proxy` with the reviewed Compose configuration.
4. Validate `/api/health` and the UI.

Do **not** automatically roll back database migrations. A database rollback requires a reviewed, explicit, and safe migration plan.

## O. PostgreSQL backups

Take regular logical backups outside the Docker volume and verify restore procedures:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "nodeprox-$(date +%F).sql"
```

Encrypt and copy backups to a separate retention location. Restores must be rehearsed in a non-production environment first.

## P. Logs

All services emit structured/stdout logs and Docker rotates JSON files at 10 MiB with three retained files:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f worker
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f discord-bot
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f reverse-proxy
```

Where available, `requestId` identifies the current HTTP request, `originRequestId` links durable async work to its originating request, and `jobId` identifies the BullMQ job. Use them with resource IDs to correlate API, Worker, and cleanup logs; historical or system work can lack an origin. This is operational correlation, not a promise of complete distributed tracing.

## Q. Update a release

```bash
git fetch --tags
git checkout <new-approved-release-tag-or-commit>
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres redis
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d api worker discord-bot web reverse-proxy
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Validate health and UI before declaring the release complete.
