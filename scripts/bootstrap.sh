#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="${ROOT_DIR}/.build/code-oss"
PINNED_VSCODE_TAG="1.96.4"

# Ensure Node 20 LTS is active for VS Code native C++ gyp builds
if [ -d "${HOME}/.nvm/versions/node/v20.16.0/bin" ]; then
    export PATH="${HOME}/.nvm/versions/node/v20.16.0/bin:${PATH}"
elif [ -s "${HOME}/.nvm/nvm.sh" ]; then
    export NVM_DIR="${HOME}/.nvm"
    # shellcheck disable=SC1090
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm use 20 2>/dev/null || true
fi

echo "⚡ ========================================================"
echo "⚡ CodeAlloy Shell Bootstrap"
echo "⚡ Pinned upstream base: Code-OSS v${PINNED_VSCODE_TAG}"
echo "⚡ Active Node: $(node -v)"
echo "⚡ ========================================================"

# 1. Environment & Toolchain Diagnostics
echo ""
echo "🔍 Checking developer toolchain..."

if ! command -v git >/dev/null 2>&1; then
    echo "❌ Error: git is required but not installed."
    exit 1
fi
echo "  ✓ git: $(git --version)"

if ! command -v node >/dev/null 2>&1; then
    echo "❌ Error: node is required but not installed."
    exit 1
fi
echo "  ✓ node: $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
    echo "❌ Error: npm is required but not installed."
    exit 1
fi
echo "  ✓ npm: $(npm -v)"

if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ Error: python3 is required for native module compilation."
    exit 1
fi
echo "  ✓ python3: $(python3 --version)"

# 2. Fetching Upstream Code-OSS
echo ""
echo "📦 Setting up Code-OSS base..."
mkdir -p "${ROOT_DIR}/.build"

if [ ! -d "${UPSTREAM_DIR}/.git" ]; then
    echo "  Cloning Code-OSS (tag: ${PINNED_VSCODE_TAG})..."
    git clone --depth 1 --branch "${PINNED_VSCODE_TAG}" https://github.com/microsoft/vscode.git "${UPSTREAM_DIR}"
else
    echo "  Upstream Code-OSS source already present at ${UPSTREAM_DIR}."
fi

# 3. Applying CodeAlloy Branding & product.json
echo ""
echo "🎨 Applying CodeAlloy branding & Open VSX marketplace configuration..."
cp "${ROOT_DIR}/build/product.json" "${UPSTREAM_DIR}/product.json"
echo "  ✓ Installed custom product.json (Open VSX configured, telemetry disabled)"

# Copy icons if available
if [ -f "${ROOT_DIR}/build/branding/icon.png" ]; then
    mkdir -p "${UPSTREAM_DIR}/resources/darwin"
    mkdir -p "${UPSTREAM_DIR}/resources/win32"
    mkdir -p "${UPSTREAM_DIR}/resources/linux"
    cp "${ROOT_DIR}/build/branding/icon.png" "${UPSTREAM_DIR}/resources/darwin/code.png"
    echo "  ✓ CodeAlloy branding assets overlaid"
fi

# 4. Dependency Installation
echo ""
echo "📥 Installing upstream dependencies with npm (this may take a few minutes on first run)..."
cd "${UPSTREAM_DIR}"
npm ci || npm install

echo ""
echo "🎉 ========================================================"
echo "🎉 CodeAlloy Shell Bootstrap Complete!"
echo "🎉 Run 'npm run dev' (or ./scripts/dev.sh) to launch CodeAlloy."
echo "🎉 ========================================================"
