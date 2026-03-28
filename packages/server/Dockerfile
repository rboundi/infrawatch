# ──────────────────────────────────────────────
# Stage 1: Builder
# ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace config
COPY package.json package-lock.json ./
COPY packages/scanner/package.json packages/scanner/
COPY packages/server/package.json packages/server/

# Install all deps (including devDependencies for build)
RUN npm ci --workspace=packages/server --workspace=packages/scanner

# Build scanner first (server depends on it)
COPY packages/scanner/tsconfig.json packages/scanner/
COPY packages/scanner/src packages/scanner/src
RUN npm run build -w packages/scanner

# Build server
COPY packages/server/tsconfig.json packages/server/
COPY packages/server/src packages/server/src
COPY packages/server/migrations packages/server/migrations
RUN npm run build -w packages/server

# Prune dev dependencies and clean up
RUN npm prune --production --workspace=packages/server --workspace=packages/scanner \
    && rm -rf /app/node_modules/@types \
              /app/node_modules/typescript \
              /app/node_modules/vitest \
              /app/node_modules/@vitest

# ──────────────────────────────────────────────
# Stage 2: Runner
# ──────────────────────────────────────────────
FROM node:20-alpine AS runner

# Install nmap for network discovery + curl for healthcheck
RUN apk add --no-cache nmap nmap-scripts sudo curl \
    && addgroup -S infrawatch \
    && adduser -S infrawatch -G infrawatch \
    && echo "infrawatch ALL=(ALL) NOPASSWD: /usr/bin/nmap" >> /etc/sudoers.d/nmap \
    && chmod 0440 /etc/sudoers.d/nmap

WORKDIR /app

# Copy production node_modules (hoisted to root by npm workspaces)
COPY --from=builder /app/node_modules ./node_modules

# Copy built output
COPY --from=builder /app/packages/scanner/dist ./packages/scanner/dist
COPY --from=builder /app/packages/scanner/package.json ./packages/scanner/
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/migrations ./packages/server/migrations
COPY --from=builder /app/packages/server/package.json ./packages/server/
COPY --from=builder /app/package.json ./

# Set ownership
RUN chown -R infrawatch:infrawatch /app

USER infrawatch

WORKDIR /app/packages/server

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/api/v1/health || exit 1

CMD ["node", "dist/index.js"]
