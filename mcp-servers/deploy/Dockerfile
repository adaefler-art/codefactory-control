FROM node:20-alpine

WORKDIR /app

# Copy base package
COPY base/package*.json ../base/
COPY base/src ../base/src
COPY base/tsconfig.json ../base/

# Copy deploy server
COPY deploy/package*.json ./
COPY deploy/src ./src
COPY deploy/tsconfig.json ./

# Install dependencies and build
WORKDIR /app/../base
RUN npm ci && npm run build

WORKDIR /app
RUN npm ci && npm run build

ENV NODE_ENV=production
ENV PORT=3002

EXPOSE 3002

CMD ["npm", "start"]
