FROM node:20-alpine AS builder

WORKDIR /build

# Copy all source files maintaining directory structure
COPY base ./base
COPY observability ./observability

# Install dependencies and build base
WORKDIR /build/base
RUN npm install && npm run build

# Install dependencies and build observability server
WORKDIR /build/observability
RUN npm install && npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy dist and node_modules from builder
COPY --from=builder /build/observability/dist /app/dist
COPY --from=builder /build/observability/node_modules /app/node_modules
COPY --from=builder /build/observability/package.json /app/package.json

ENV NODE_ENV=production
ENV PORT=3003

EXPOSE 3003

CMD ["npm", "start"]
