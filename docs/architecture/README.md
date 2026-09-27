# NodeProx current architecture

NodeProx is a modular monolith. The Fastify API owns HTTP and application orchestration; a separate BullMQ Worker executes asynchronous media work. Both use PostgreSQL through Drizzle. Redis carries the queue, Backblaze B2 stores ZIPs and media, and Cloudflare serves published media. The production Discord integration is `apps/discord-bot`, not the legacy `apps/bot` placeholder.

The current wiring is:

```text
Browser → Next.js same-origin /api proxy → Fastify API → PostgreSQL/Drizzle
                                             ↓ durable outbox
                                      Redis/BullMQ → Worker → B2
Published media: Browser → Cloudflare → B2
Discord: apps/discord-bot ↔ internal API
```

- [API dependency construction](../../apps/api/src/composition/create-api-dependencies.ts) and [API runtime](../../apps/api/src/composition/create-api-runtime.ts) own API infrastructure and background dispatchers; [app.ts](../../apps/api/src/app.ts) registers Fastify plugins and routes.
- [Worker dependency construction](../../apps/worker/src/composition/create-worker-dependencies.ts), [runtime](../../apps/worker/src/composition/create-worker-runtime.ts), and [job handler](../../apps/worker/src/composition/worker-job-handler.ts) own Worker wiring and queue dispatch.
- [Web proxy allowlist](../../apps/web/lib/api/proxy-allowlist.ts) is the deny-by-default same-origin route boundary; [route.ts](../../apps/web/app/api/%5B...path%5D/route.ts) applies it.
- [Database schema](../../database/schema/index.ts) and [migrations](../../database/migrations/) describe persisted state. [Production Compose](../../docker-compose.prod.yml) defines the deployed service set.

## Architecture documents

- [Authorization](AUTHORIZATION.md): global capabilities, contextual decisions, and technical failures.
- [Chapter lifecycle](CHAPTER_LIFECYCLE.md): executable states and transitions.
- [Async integrity and correlation](ASYNC_INTEGRITY.md): outboxes, Worker, cleanup, and reconciliation.
- [B2 direct upload](b2-direct-upload.md): browser transfer and finalization boundary.
- [Deployment V1](../deployment/V1_DEPLOYMENT.md) and [quality gates](../development/QUALITY_GATES.md): current operational procedures.

## Documentation authority and drift

Approved Notion Architecture Decisions are the source of truth for architectural decisions. `main` code, schema, and workflows are the source of truth for effective implementation. Repository docs are the versioned technical and operational mirror of that implementation. If an approved decision and implementation disagree, record the exact divergence for architecture review; do not silently redefine either one in documentation or change runtime behavior as part of a docs reconciliation.
