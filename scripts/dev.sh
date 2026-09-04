#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="${ROOT_DIR}/.build/code-oss"

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
