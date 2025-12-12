FROM node:20-alpine AS builder

WORKDIR /build

# Copy all source files maintaining directory structure
COPY base ./base
COPY github ./github

# Install dependencies and build base
WORKDIR /build/base
RUN npm install && npm run build

# Install dependencies and build github server
WORKDIR /build/github
RUN npm install && npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy dist and node_modules from builder
COPY --from=builder /build/github/dist /app/dist
COPY --from=builder /build/github/node_modules /app/node_modules
COPY --from=builder /build/github/package.json /app/package.json

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["npm", "start"]
