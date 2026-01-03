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

# Materialize base module for the file:../base symlink target
COPY --from=builder /build/base-runtime /app/base

ENV NODE_ENV=production
ENV PORT=3002
ENV SOURCE_DATE_EPOCH=0

EXPOSE 3002

CMD ["npm", "start"]
