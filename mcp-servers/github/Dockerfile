FROM node:20.10.0-alpine AS builder

WORKDIR /build

# Set deterministic build timestamp
ENV SOURCE_DATE_EPOCH=0

# Copy package files for dependency installation
COPY base/package.json base/package-lock.json ./base/
COPY github/package.json github/package-lock.json ./github/

# Install dependencies for base
WORKDIR /build/base
RUN npm ci

# Install dependencies for github server
WORKDIR /build/github
RUN npm ci

# Copy source files after dependencies are installed
WORKDIR /build
COPY base ./base
COPY github ./github

# Build base
WORKDIR /build/base
RUN npm run build

# Build github server
WORKDIR /build/github
RUN npm run build

# Production stage
FROM node:20.10.0-alpine

WORKDIR /app

# Copy dist and node_modules from builder
COPY --from=builder /build/github/dist /app/dist
COPY --from=builder /build/github/node_modules /app/node_modules
COPY --from=builder /build/github/package.json /app/package.json

ENV NODE_ENV=production
ENV PORT=3001
ENV SOURCE_DATE_EPOCH=0

EXPOSE 3001

CMD ["npm", "start"]
