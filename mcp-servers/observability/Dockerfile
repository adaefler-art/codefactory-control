FROM node:20.10.0-alpine AS builder

WORKDIR /build

# Set deterministic build timestamp
ENV SOURCE_DATE_EPOCH=0

# Copy package files for dependency installation
COPY base/package.json base/package-lock.json ./base/
COPY observability/package.json observability/package-lock.json ./observability/

# Install dependencies for base
WORKDIR /build/base
RUN npm ci

# Install dependencies for observability server
WORKDIR /build/observability
RUN npm ci

# Copy source files after dependencies are installed
WORKDIR /build
COPY base ./base
COPY observability ./observability

# Build base
WORKDIR /build/base
RUN npm run build

# Build observability server
WORKDIR /build/observability
RUN npm run build

# Production stage
FROM node:20.10.0-alpine

WORKDIR /app

# Copy dist and node_modules from builder
COPY --from=builder /build/observability/dist /app/dist
COPY --from=builder /build/observability/node_modules /app/node_modules
COPY --from=builder /build/observability/package.json /app/package.json

ENV NODE_ENV=production
ENV PORT=3003
ENV SOURCE_DATE_EPOCH=0

EXPOSE 3003

CMD ["npm", "start"]
