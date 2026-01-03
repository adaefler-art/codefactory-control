FROM node:20.10.0-alpine AS builder

WORKDIR /build

# Deterministic build timestamp
ENV SOURCE_DATE_EPOCH=0

# Copy package files for dependency installation
COPY base/package.json base/package-lock.json ./base/
COPY afu9-runner/package.json afu9-runner/package-lock.json ./afu9-runner/

# Install dependencies for base
WORKDIR /build/base
RUN npm ci

# Install dependencies for afu9-runner server
WORKDIR /build/afu9-runner
RUN npm ci

# Copy source files after dependencies are installed
WORKDIR /build
COPY base ./base
COPY afu9-runner ./afu9-runner

# Build base
WORKDIR /build/base
RUN npm run build

# Build afu9-runner server
WORKDIR /build/afu9-runner
RUN npm run build

# Prepare runtime layout for the local file: dependency.
# afu9-runner imports '@afu9/mcp-base/src/server', and npm installs it as a symlink to ../../../base.
# In the runtime image we materialize /app/base/src/*.js so the deep import resolves.
RUN mkdir -p /build/base-runtime/src \
  && cp /build/base/dist/server.js /build/base-runtime/src/server.js \
  && cp /build/base/dist/logger.js /build/base-runtime/src/logger.js \
  && cp /build/base/package.json /build/base-runtime/package.json \
  && if [ -f /build/base/dist/server.js.map ]; then cp /build/base/dist/server.js.map /build/base-runtime/src/server.js.map; fi \
  && if [ -f /build/base/dist/logger.js.map ]; then cp /build/base/dist/logger.js.map /build/base-runtime/src/logger.js.map; fi

# Production stage
FROM node:20.10.0-alpine

WORKDIR /app

# Copy dist and node_modules from builder
COPY --from=builder /build/afu9-runner/dist /app/dist
COPY --from=builder /build/afu9-runner/node_modules /app/node_modules
COPY --from=builder /build/afu9-runner/package.json /app/package.json

# Normalize runner entrypoint path for compatibility with npm start.
# Some builds emit /app/dist/index.js (flat) instead of dist/src/index.js.
RUN if [ ! -f /app/dist/src/index.js ] && [ -f /app/dist/index.js ]; then \
      mkdir -p /app/dist/src; \
      cp /app/dist/index.js /app/dist/src/index.js; \
    fi

# Materialize base module for the file:../base symlink target
COPY --from=builder /build/base-runtime /app/base

# Ensure deep imports resolve even when npm installs file: deps as a copied directory
# (i.e., no symlink preserved in node_modules). The runner code imports:
#   require('@afu9/mcp-base/src/server')
# so we must guarantee node can resolve that path at runtime.
RUN rm -rf /app/node_modules/@afu9/mcp-base \
  && mkdir -p /app/node_modules/@afu9/mcp-base \
  && cp -R /app/base/* /app/node_modules/@afu9/mcp-base/

ENV NODE_ENV=production
ENV PORT=3002
ENV SOURCE_DATE_EPOCH=0

EXPOSE 3002

# Start without relying on package.json paths.
CMD ["sh","-lc","set -e; if [ -f /app/dist/index.js ]; then exec node /app/dist/index.js; elif [ -f /app/dist/src/index.js ]; then exec node /app/dist/src/index.js; elif [ -f /app/dist/afu9-runner/src/index.js ]; then exec node /app/dist/afu9-runner/src/index.js; else echo \"No runner entrypoint found\" >&2; find /app/dist -maxdepth 4 -type f -name index.js >&2 || true; exit 1; fi"]
