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
RUN pnpm --filter @nodeprox/worker build
RUN pnpm exec tsc -p packages/types/tsconfig.json
RUN pnpm --filter @nodeprox/worker --prod deploy --legacy /deploy

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /deploy ./
COPY --from=build --chown=node:node /workspace/apps/worker/dist ./dist
# pnpm deploy keeps workspace dependency symlinks rooted at /workspace.
COPY --from=build --chown=node:node /workspace/packages /workspace/packages
RUN ln -s /app/node_modules /workspace/node_modules \
  && node -e "const fs=require('node:fs'); const path='/workspace/packages/types/package.json'; const pkg=JSON.parse(fs.readFileSync(path, 'utf8')); pkg.exports={'.':'./dist/index.js'}; fs.writeFileSync(path, JSON.stringify(pkg));"

USER node
CMD ["node", "dist/apps/worker/src/index.js"]
