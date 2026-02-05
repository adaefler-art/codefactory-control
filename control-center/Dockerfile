# AFU-9 Control Center Dockerfile
# Multi-stage build for Next.js application using pinned Node version and Debian base to satisfy lightningcss native bindings

ARG APP_DIR=control-center

# Stage 1: Dependencies (install full deps to support build tooling)
FROM node:20.10.0-bookworm-slim AS deps
ARG APP_DIR
WORKDIR /app
COPY packages ./packages

# Build local packages so file: dependencies contain compiled output
RUN npm --prefix packages/deploy-memory ci && npm --prefix packages/deploy-memory run build
RUN npm --prefix packages/verdict-engine ci && npm --prefix packages/verdict-engine run build

WORKDIR /app/${APP_DIR}
COPY control-center/package.json control-center/package-lock.json ./

RUN npm ci && npm cache clean --force

# Stage 2: Build
FROM node:20.10.0-bookworm-slim AS builder
ARG APP_DIR
ARG BUILD_VERSION
ARG BUILD_COMMIT_HASH=local
ARG BUILD_ENV
ARG BUILD_TIMESTAMP
WORKDIR /app/${APP_DIR}

# Determinism knobs
ENV SOURCE_DATE_EPOCH=0
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=UTC
ENV LC_ALL=C
ENV LANG=C

# Build-time metadata (available to the app build)
ENV BUILD_VERSION=${BUILD_VERSION}
ENV BUILD_COMMIT_HASH=${BUILD_COMMIT_HASH}
ENV BUILD_ENV=${BUILD_ENV}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV NEXT_BUILD_ID=${BUILD_COMMIT_HASH}

# Keep prebuild disabled in container builds (CI injects deterministic metadata)
ENV SKIP_PREBUILD=1

COPY --from=deps /app/${APP_DIR}/node_modules ./node_modules
COPY --from=deps /app/packages /app/packages
COPY control-center/ ./

# Generate public/build-metadata.json deterministically from BUILD_* args
RUN node prebuild.js

RUN set -eu; \
    __NEXT_PREVIEW_MODE_ID="$(node -e 'const crypto=require("crypto");const seed=process.env.BUILD_COMMIT_HASH||"local";const b=crypto.createHash("sha256").update("preview-id:"+seed).digest().subarray(0,16);process.stdout.write(b.toString("base64"));')"; \
    __NEXT_PREVIEW_MODE_SIGNING_KEY="$(node -e 'const crypto=require("crypto");const seed=process.env.BUILD_COMMIT_HASH||"local";const b=crypto.createHash("sha256").update("preview-sign:"+seed).digest();process.stdout.write(b.toString("base64"));')"; \
    __NEXT_PREVIEW_MODE_ENCRYPTION_KEY="$(node -e 'const crypto=require("crypto");const seed=process.env.BUILD_COMMIT_HASH||"local";const b=crypto.createHash("sha256").update("preview-enc:"+seed).digest();process.stdout.write(b.toString("base64"));')"; \
    export __NEXT_PREVIEW_MODE_ID __NEXT_PREVIEW_MODE_SIGNING_KEY __NEXT_PREVIEW_MODE_ENCRYPTION_KEY; \
    npm run build

# Stage 3: Production
FROM node:20.10.0-bookworm-slim AS runner
ARG APP_DIR
WORKDIR /app/${APP_DIR}

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV SOURCE_DATE_EPOCH=0

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Migration tooling (for ECS one-off migration tasks)
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy necessary files
COPY --from=builder /app/${APP_DIR}/public ./public
COPY --from=builder /app/${APP_DIR}/package.json ./package.json

# Include SQL migrations + runner script in the runtime image
# Copy migrations to both locations:
# - /app/database/migrations for API parity checks
# - ./database/migrations for db-migrate.sh script
COPY --chown=nextjs:nodejs database/migrations /app/database/migrations
COPY --chown=nextjs:nodejs database/migrations ./database/migrations
COPY --chown=nextjs:nodejs scripts/db-migrate.sh ./scripts/db-migrate.sh

# Include runtime workflow artifacts (required when enabling self-propelling)
COPY --chown=nextjs:nodejs control-center/runtime ./runtime

# Include canonical MCP catalog (used by /api/mcp/verify gate at runtime)
COPY --chown=nextjs:nodejs docs/mcp/catalog.json /app/docs/mcp/catalog.json

RUN chmod +x ./scripts/db-migrate.sh

# Copy standalone build output
COPY --from=builder --chown=nextjs:nodejs /app/${APP_DIR}/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/${APP_DIR}/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
