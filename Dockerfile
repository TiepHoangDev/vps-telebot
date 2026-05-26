# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
COPY tsconfig.json ./
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache docker-cli docker-cli-compose
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist/
CMD ["node", "dist/index.js"]
