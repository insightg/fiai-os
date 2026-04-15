#!/bin/bash
# FIAI OS — Deploy instance to remote server
#
# Usage:
#   ./deploy.sh bernardini              # Deploy to server configured in registry
#   ./deploy.sh bernardini 1.2.3.4      # Deploy to specific IP
#   ./deploy.sh bernardini user@host    # Deploy with custom SSH target
#
# What it does:
#   1. Syncs core code + instance config to remote server
#   2. Rebuilds and restarts Docker containers
#   3. Reports status

set -e

INSTANCE=${1:?Usage: ./deploy.sh <instance> [ssh-target]}
SSH_TARGET=${2:-}
REMOTE_DIR="/opt/fiai-os"
REGISTRY="admin/data/instances-registry.yaml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}═══════════════════════════════════════${NC}"
echo -e "${YELLOW}  FIAI OS Deploy — ${INSTANCE}${NC}"
echo -e "${YELLOW}═══════════════════════════════════════${NC}"

# Resolve SSH target from registry if not provided
if [ -z "$SSH_TARGET" ]; then
  if [ -f "$REGISTRY" ]; then
    SERVER_IP=$(grep -A5 "id: ${INSTANCE}" "$REGISTRY" | grep "server_ip:" | awk '{print $2}' | tr -d '"')
    SSH_USER=$(grep -A5 "id: ${INSTANCE}" "$REGISTRY" | grep "ssh_user:" | awk '{print $2}' | tr -d '"')
    SSH_TARGET="${SSH_USER:-root}@${SERVER_IP}"
  fi
fi

if [ -z "$SSH_TARGET" ]; then
  echo -e "${RED}Error: No SSH target. Provide as argument or configure in ${REGISTRY}${NC}"
  exit 1
fi

echo -e "${GREEN}Target: ${SSH_TARGET}:${REMOTE_DIR}${NC}"
echo ""

# Check instance config exists
if [ ! -d "instances/${INSTANCE}" ]; then
  echo -e "${RED}Error: instances/${INSTANCE}/ not found${NC}"
  exit 1
fi

# 1. Sync code to remote server
echo -e "${YELLOW}[1/3] Syncing code...${NC}"
rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude '*.db' \
  --exclude 'data/' \
  --exclude 'admin/data/' \
  --exclude 'admin/node_modules' \
  --exclude 'dist/' \
  ./ "${SSH_TARGET}:${REMOTE_DIR}/"

# 2. Sync instance .env if it exists locally (without overwriting remote)
if [ -f "instances/${INSTANCE}/.env" ]; then
  echo -e "${YELLOW}[1b] Syncing .env...${NC}"
  rsync -avz "instances/${INSTANCE}/.env" "${SSH_TARGET}:${REMOTE_DIR}/instances/${INSTANCE}/.env"
fi

# 3. Rebuild and restart on remote
echo -e "${YELLOW}[2/3] Building on remote...${NC}"
ssh "${SSH_TARGET}" "cd ${REMOTE_DIR} && FIAI_INSTANCE=${INSTANCE} docker compose up --build -d"

# 4. Check health
echo -e "${YELLOW}[3/3] Checking health...${NC}"
sleep 5
HEALTH=$(ssh "${SSH_TARGET}" "docker exec ${INSTANCE}-backend curl -sf http://localhost:3001/api/health 2>/dev/null" || echo '{"status":"error"}')
echo -e "Health: ${HEALTH}"

if echo "$HEALTH" | grep -q '"ok"'; then
  echo -e "\n${GREEN}✓ Deploy successful: ${INSTANCE} is healthy${NC}"
else
  echo -e "\n${RED}⚠ Deploy completed but health check failed. Check logs:${NC}"
  echo -e "  ssh ${SSH_TARGET} 'docker logs ${INSTANCE}-backend --tail 20'"
fi
