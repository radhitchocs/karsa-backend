FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate
WORKDIR /app

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
# Build tools for native modules (argon2) when no prebuilt binary matches the platform
# (e.g. linux/arm64 musl). Only in this stage — the runtime image stays slim.
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma/
RUN pnpm install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm prisma:generate
RUN pnpm build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
# Prisma 7 reads the datasource URL (for `migrate deploy`) from prisma.config.ts
COPY --from=builder /app/prisma.config.ts ./
COPY package.json ./

RUN mkdir -p uploads

EXPOSE 3001

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
