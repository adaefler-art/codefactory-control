FROM node:20-alpine

WORKDIR /app

# Copy base package
COPY base/package*.json ../base/
COPY base/src ../base/src
COPY base/tsconfig.json ../base/

# Copy observability server
COPY observability/package*.json ./
COPY observability/src ./src
COPY observability/tsconfig.json ./

# Install dependencies and build
WORKDIR /app/../base
RUN npm ci && npm run build

WORKDIR /app
RUN npm ci && npm run build

ENV NODE_ENV=production
ENV PORT=3003

EXPOSE 3003

CMD ["npm", "start"]
