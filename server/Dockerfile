# Stage 1: Build client
FROM node:20-alpine AS client-builder

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./
RUN npm install

# Copy client source and build
COPY client/ ./
RUN npm run build

# Stage 2: Production server
FROM node:20-alpine

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy server package files
COPY package*.json ./
RUN npm ci --only=production

# Copy server source
COPY src/ ./src/

# Copy built client from stage 1
COPY --from=client-builder /app/client/dist /app/client/dist

# Create data directories
RUN mkdir -p /data/vault /data/trash

# Set environment variables
ENV NODE_ENV=production \
    VAULT_ROOT=/data/vault \
    TRASH_PATH=/data/trash \
    DB_PATH=/data/state.db

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "src/index.js"]
