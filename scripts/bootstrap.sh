#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Using a space-free directory in ~/.codealloy/build to ensure C++ node-gyp Makefiles don't fail on paths with spaces
BUILD_CACHE_DIR="${HOME}/.codealloy/build/code-oss"
WORKSPACE_SYMLINK="${ROOT_DIR}/.build/code-oss"
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
echo "⚡ Active Node: $(node -v) ($(which node))"
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

# 2. Fetching Upstream Code-OSS in space-free build cache
echo ""
echo "📦 Setting up Code-OSS base at ${BUILD_CACHE_DIR}..."
mkdir -p "${HOME}/.codealloy/build"
mkdir -p "${ROOT_DIR}/.build"

if [ ! -d "${BUILD_CACHE_DIR}/.git" ]; then
    echo "  Cloning Code-OSS (tag: ${PINNED_VSCODE_TAG})..."
    git clone --depth 1 --branch "${PINNED_VSCODE_TAG}" https://github.com/microsoft/vscode.git "${BUILD_CACHE_DIR}"
else
    echo "  Upstream Code-OSS source already present."
fi

# Ensure workspace symlink exists
if [ ! -e "${WORKSPACE_SYMLINK}" ]; then
    ln -s "${BUILD_CACHE_DIR}" "${WORKSPACE_SYMLINK}"
fi

# 3. Applying CodeAlloy Branding & product.json
echo ""
echo "🎨 Applying CodeAlloy branding & Open VSX marketplace configuration..."
cp "${ROOT_DIR}/build/product.json" "${BUILD_CACHE_DIR}/product.json"
echo "  ✓ Installed custom product.json (Open VSX configured, telemetry disabled)"

# Copy icons if available
if [ -f "${ROOT_DIR}/build/branding/icon.png" ]; then
    mkdir -p "${BUILD_CACHE_DIR}/resources/darwin"
    mkdir -p "${BUILD_CACHE_DIR}/resources/win32"
    mkdir -p "${BUILD_CACHE_DIR}/resources/linux"
    cp "${ROOT_DIR}/build/branding/icon.png" "${BUILD_CACHE_DIR}/resources/darwin/code.png"
    echo "  ✓ CodeAlloy branding assets overlaid"
fi

# 4. Patch native spdlog for macOS Xcode 16 Clang consteval compatibility
echo ""
echo "🔧 Applying platform compatibility patches..."
sed -i '' 's/"@vscode\/spdlog": "\^0.15.0"/"@vscode\/spdlog": "0.15.8"/g' "${BUILD_CACHE_DIR}/package.json" 2>/dev/null || true
sed -i '' 's/"@vscode\/spdlog": "0.15.1"/"@vscode\/spdlog": "0.15.8"/g' "${BUILD_CACHE_DIR}/package-lock.json" 2>/dev/null || true

# 5. Installing dependencies across all subprojects
echo ""
echo "📥 Installing dependencies (root, build, extensions)..."
cd "${BUILD_CACHE_DIR}"
npm install

echo "  Installing build tool dependencies..."
cd "${BUILD_CACHE_DIR}/build"
npm install

echo "  Installing extension dependencies..."
cd "${BUILD_CACHE_DIR}"
export npm_command="install"
node build/npm/postinstall.js

# 6. Compiling the CodeAlloy Shell
echo ""
echo "🔨 Compiling CodeAlloy shell..."
cd "${BUILD_CACHE_DIR}"
npm run compile

echo ""
echo "🎉 ========================================================"
echo "🎉 CodeAlloy Shell Bootstrap & Compilation Complete!"
echo "🎉 Run 'npm run dev' (or ./scripts/dev.sh) to launch CodeAlloy."
echo "🎉 ========================================================"
