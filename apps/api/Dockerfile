# Multi-stage build for the Pod Life API.
#
# The API runs directly from TypeScript via tsx — the same way dev, tests, and
# migrations run it. The tsconfig is intentionally typecheck-only (noEmit, .ts
# import extensions, workspace path aliases like @pod-life/shared → source), so
# there is no precompiled `dist`; tsx executes the source under Node's ESM
# loader and resolves the workspace path aliases. Type-checking is enforced as
# a separate CI gate, not at image-build time.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.18.2 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Installs dev deps too (NODE_ENV is unset here): tsx is the runtime engine.
RUN pnpm install --frozen-lockfile=false

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
WORKDIR /app/apps/api
EXPOSE 3000
# Run from source via tsx (no dist). pnpm exec resolves the workspace tsx binary.
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
