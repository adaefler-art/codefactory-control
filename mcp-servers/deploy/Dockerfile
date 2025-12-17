FROM node:20.10.0-alpine AS builder

WORKDIR /build

# Set deterministic build timestamp
ENV SOURCE_DATE_EPOCH=0

# Copy package files for dependency installation
COPY base/package.json base/package-lock.json ./base/
COPY deploy/package.json deploy/package-lock.json ./deploy/

# Install dependencies for base
WORKDIR /build/base
RUN npm ci

# Install dependencies for deploy server
WORKDIR /build/deploy
RUN npm ci

# Copy source files after dependencies are installed
WORKDIR /build
COPY base ./base
COPY deploy ./deploy

# Build base
WORKDIR /build/base
RUN npm run build

# Build deploy server
WORKDIR /build/deploy
RUN npm run build

# Production stage
FROM node:20.10.0-alpine

WORKDIR /app

# Copy dist and node_modules from builder
COPY --from=builder /build/deploy/dist /app/dist
COPY --from=builder /build/deploy/node_modules /app/node_modules
COPY --from=builder /build/deploy/package.json /app/package.json

ENV NODE_ENV=production
ENV PORT=3002
ENV SOURCE_DATE_EPOCH=0

EXPOSE 3002

CMD ["npm", "start"]
