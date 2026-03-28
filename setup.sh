#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"
ENV_EXAMPLE=".env.production.example"

# ── Helpers ──

info()  { printf "\033[1;34m→\033[0m %s\n" "$1"; }
ok()    { printf "\033[1;32m✓\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33m!\033[0m %s\n" "$1"; }
err()   { printf "\033[1;31m✗\033[0m %s\n" "$1" >&2; }

generate_secret() {
  # 32 bytes → 44-char base64 string (URL-safe, no padding)
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
}

# ── Prerequisites ──

for cmd in docker openssl; do
  if ! command -v "$cmd" &>/dev/null; then
    err "$cmd is required but not installed."
    exit 1
  fi
done

if ! docker compose version &>/dev/null; then
  err "docker compose (v2) is required."
  exit 1
fi

# ── 1. Ensure .env exists ──

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok "Created $ENV_FILE from $ENV_EXAMPLE"
  else
    err "$ENV_EXAMPLE not found. Cannot create $ENV_FILE."
    exit 1
  fi
fi

# ── 2. Generate DB_PASSWORD if empty ──

current_db_pass=$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2- | xargs)
if [ -z "$current_db_pass" ]; then
  new_pass=$(generate_secret)
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^DB_PASSWORD=.*|DB_PASSWORD=${new_pass}|" "$ENV_FILE"
  else
    sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${new_pass}|" "$ENV_FILE"
  fi
  ok "Generated random DB_PASSWORD"
fi

# ── 3. Generate MASTER_KEY if empty ──

current_key=$(grep -E '^MASTER_KEY=' "$ENV_FILE" | cut -d'=' -f2- | xargs)
if [ -z "$current_key" ]; then
  new_key=$(generate_secret)
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^MASTER_KEY=.*|MASTER_KEY=${new_key}|" "$ENV_FILE"
  else
    sed -i "s|^MASTER_KEY=.*|MASTER_KEY=${new_key}|" "$ENV_FILE"
  fi
  ok "Generated random MASTER_KEY"
fi

# ── 4. Generate API_KEY if empty ──

current_api_key=$(grep -E '^API_KEY=' "$ENV_FILE" | cut -d'=' -f2- | xargs)
if [ -z "$current_api_key" ]; then
  new_api_key=$(generate_secret)
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^API_KEY=.*|API_KEY=${new_api_key}|" "$ENV_FILE"
    sed -i '' "s|^VITE_API_KEY=.*|VITE_API_KEY=${new_api_key}|" "$ENV_FILE"
  else
    sed -i "s|^API_KEY=.*|API_KEY=${new_api_key}|" "$ENV_FILE"
    sed -i "s|^VITE_API_KEY=.*|VITE_API_KEY=${new_api_key}|" "$ENV_FILE"
  fi
  ok "Generated random API_KEY"
fi

# ── 5. Build and start ──

info "Building and starting InfraWatch…"
docker compose -f "$COMPOSE_FILE" up -d --build

# ── 5. Wait for health check ──

info "Waiting for services to become healthy…"
MAX_WAIT=120
ELAPSED=0
INTERVAL=5

while [ $ELAPSED -lt $MAX_WAIT ]; do
  api_health=$(docker compose -f "$COMPOSE_FILE" ps api --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)
  if echo "$api_health" | grep -q "healthy"; then
    break
  fi
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
  printf "."
done
echo ""

if [ $ELAPSED -ge $MAX_WAIT ]; then
  warn "Timed out waiting for health check (${MAX_WAIT}s)."
  warn "Check logs with: docker compose -f $COMPOSE_FILE logs"
  exit 1
fi

# ── 6. Done ──

WEB_PORT=$(grep -E '^WEB_PORT=' "$ENV_FILE" | cut -d'=' -f2- | xargs)
WEB_PORT=${WEB_PORT:-80}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "InfraWatch is running at http://localhost:${WEB_PORT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Useful commands:"
echo "    docker compose -f $COMPOSE_FILE logs -f      # follow logs"
echo "    docker compose -f $COMPOSE_FILE ps           # service status"
echo "    docker compose -f $COMPOSE_FILE down         # stop all"
echo ""
