# NodeProx

Monolito modular con Fastify, Next.js App Router, Drizzle/PostgreSQL, BullMQ/Redis y almacenamiento Backblaze B2 compatible con S3.

## Alcance actual

El repositorio incluye sesiones server-side con Argon2id, RBAC y autorización contextual de Chapters, Series/Chapters, transferencia directa de ZIP a B2, procesamiento asíncrono de imágenes, manifests públicos y un frontend operativo. Los ZIP grandes no atraviesan Next.js ni Fastify.

## Requisitos

- Node.js 24 LTS
- pnpm 11+
- Docker Compose para PostgreSQL y Redis
- Backblaze B2 para probar uploads desde el navegador

## Desarrollo local

```bash
pnpm install
Copy-Item .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:check
pnpm dev
```

La API usa `http://127.0.0.1:3001` y el frontend Next.js `http://localhost:3000`. La transferencia directa local requiere `STORAGE_PROVIDER=b2`, las variables B2 server-side y la política bucket CORS descrita en [docs/architecture/b2-direct-upload.md](docs/architecture/b2-direct-upload.md).

## Validación

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm db:migrate
pnpm db:check
pnpm storage:smoke:b2
```

## Estructura

```text
apps/api       API Fastify y composition root
apps/web       frontend Next.js y boundary same-origin
apps/worker    procesamiento BullMQ de ZIP e imágenes
apps/bot       integración Discord reservada
packages/      configuración, contratos y storage adapters
database/      schemas, migraciones y scripts
tests/         unit, integration, security y E2E
scripts/       smoke tests y soporte operativo
```
