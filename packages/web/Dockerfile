# ──────────────────────────────────────────────
# Stage 1: Build
# ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace config + web package
COPY package.json package-lock.json ./
COPY packages/web/package.json packages/web/

# Install dependencies
RUN npm ci --workspace=packages/web

# Copy web source
COPY packages/web/ packages/web/

# Build production bundle
RUN npm run build -w packages/web

# ──────────────────────────────────────────────
# Stage 2: Serve with nginx
# ──────────────────────────────────────────────
FROM nginx:alpine AS runner

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY packages/web/nginx.conf /etc/nginx/conf.d/infrawatch.conf

# Copy built assets
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
