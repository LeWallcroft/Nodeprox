# NodeProx

Bootstrap técnico del monolito modular NodeProx.

## Alcance actual

Esta fase prepara el workspace pnpm, TypeScript strict, Biome, Fastify, Next.js, Drizzle Kit, Vitest, PostgreSQL 17 y Redis 7. La API expone únicamente `GET /health`.

No incluye autenticación, usuarios, roles, permisos, series, capítulos, uploads, procesamiento de imágenes, Backblaze, Cloudflare, Discord ni dashboard funcional.

La autenticación futura utilizará sesiones server-side propias y Argon2id, sin JWT, Lucia Auth ni Better Auth.

## Requisitos

- Node.js 24 LTS
- pnpm 11+
- Docker Compose para PostgreSQL y Redis

Las herramientas se consideran instaladas; este proyecto no las reinstala.

## Desarrollo local

```bash
pnpm install
Copy-Item .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:check
pnpm test
pnpm dev
```

La API queda disponible en `http://127.0.0.1:3000`. Verifica el endpoint con:

```bash
Invoke-RestMethod http://127.0.0.1:3000/health
```

Debe responder `{ "status": "ok" }`.

## Comandos

- `pnpm typecheck`: comprobación TypeScript strict.
- `pnpm lint`: lint de Biome.
- `pnpm format:check`: verificación de formato Biome.
- `pnpm test`: tests unitarios con Vitest.
- `pnpm db:generate`: genera migraciones Drizzle.
- `pnpm db:migrate`: aplica migraciones a PostgreSQL.
- `pnpm db:check`: comprueba la conexión PostgreSQL.

Los directorios `tests/integration` y `tests/e2e` quedan preparados para Testcontainers y Playwright en fases posteriores.

## Estructura

```text
apps/api       API Fastify
apps/web       esqueleto Next.js + React
apps/worker    entrypoint preparado para BullMQ
apps/bot       entrypoint preparado para Discord
packages/      schemas, types y config compartidos
database/      schema, migraciones y seeds
tests/         integración y E2E
docker/        recursos Docker futuros
```

Docker Compose levanta únicamente PostgreSQL y Redis durante esta fase. API, Web, Worker y Bot se ejecutan directamente con Node/pnpm.
