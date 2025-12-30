FROM node:20.10.0-alpine AS builder

WORKDIR /build

# Set deterministic build timestamp
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

# Production stage
FROM node:20.10.0-alpine

WORKDIR /app

# Copy dist and node_modules from builder
COPY --from=builder /build/afu9-runner/dist /app/dist
COPY --from=builder /build/afu9-runner/node_modules /app/node_modules
COPY --from=builder /build/afu9-runner/package.json /app/package.json

ENV NODE_ENV=production
ENV PORT=3002
ENV SOURCE_DATE_EPOCH=0

EXPOSE 3002

CMD ["npm", "start"]
