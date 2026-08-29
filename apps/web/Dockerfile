FROM node:24-bookworm-slim AS build

WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts vitest.integration.config.ts ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages ./packages
COPY database ./database
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nodeprox/web build
RUN pnpm --filter @nodeprox/web --prod deploy --legacy /deploy

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /deploy ./
COPY --from=build --chown=node:node /workspace/apps/web/.next ./.next
COPY --from=build --chown=node:node /workspace/apps/web/public ./public

USER node
EXPOSE 3000

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
