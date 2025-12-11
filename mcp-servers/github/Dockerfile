FROM node:20-alpine

WORKDIR /app

# Copy base package
COPY base/package*.json ../base/
COPY base/src ../base/src
COPY base/tsconfig.json ../base/

# Copy github server
COPY github/package*.json ./
COPY github/src ./src
COPY github/tsconfig.json ./

# Install dependencies and build
WORKDIR /app/../base
RUN npm ci && npm run build

WORKDIR /app
RUN npm ci && npm run build

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["npm", "start"]
