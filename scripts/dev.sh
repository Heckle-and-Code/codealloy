#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="${ROOT_DIR}/.build/code-oss"

# Ensure Node 20 LTS is active
if [ -d "${HOME}/.nvm/versions/node/v20.16.0/bin" ]; then
    export PATH="${HOME}/.nvm/versions/node/v20.16.0/bin:${PATH}"
elif [ -s "${HOME}/.nvm/nvm.sh" ]; then
    export NVM_DIR="${HOME}/.nvm"
    # shellcheck disable=SC1090
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm use 20 2>/dev/null || true
fi

if [ ! -d "${UPSTREAM_DIR}" ]; then
    echo "⚡ CodeAlloy shell not bootstrapped yet. Running bootstrap..."
    bash "${ROOT_DIR}/scripts/bootstrap.sh"
fi

# Ensure latest product.json and branding are synced
echo "⚡ Syncing CodeAlloy product configuration..."
cp "${ROOT_DIR}/build/product.json" "${UPSTREAM_DIR}/product.json"

echo "⚡ Launching CodeAlloy in development mode..."
cd "${UPSTREAM_DIR}"
./scripts/code.sh
