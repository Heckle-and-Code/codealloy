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
if [ -f "${ROOT_DIR}/build/branding/CodeAlloy.icns" ]; then
    mkdir -p "${BUILD_CACHE_DIR}/resources/darwin"
    cp "${ROOT_DIR}/build/branding/CodeAlloy.icns" "${BUILD_CACHE_DIR}/resources/darwin/code.icns"
fi
if [ -f "${ROOT_DIR}/build/branding/icon.png" ]; then
    mkdir -p "${BUILD_CACHE_DIR}/resources/darwin"
    mkdir -p "${BUILD_CACHE_DIR}/resources/win32"
    mkdir -p "${BUILD_CACHE_DIR}/resources/linux"
    cp "${ROOT_DIR}/build/branding/icon.png" "${BUILD_CACHE_DIR}/resources/darwin/code.png"
    echo "  ✓ CodeAlloy branding assets overlaid"
fi

# Apply CodeAlloy patches
for patchfile in "${ROOT_DIR}/patches"/*.patch; do
    if [ -f "${patchfile}" ]; then
        cd "${BUILD_CACHE_DIR}"
        git apply "${patchfile}" 2>/dev/null || true
        echo "  ✓ Applied $(basename "${patchfile}")"
    fi
done

# Setup embedded llama.cpp inference engine
echo ""
echo "⚙️ Setting up embedded llama.cpp native inference engine..."
mkdir -p "${HOME}/.codealloy/bin"
mkdir -p "${HOME}/.codealloy/models"

LLAMA_TAG="b10798"
LLAMA_URL=""
LLAMA_ARCHIVE_TYPE="tar"

OS_NAME="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH_NAME="$(uname -m)"

if [ "${OS_NAME}" = "darwin" ]; then
    if [ "${ARCH_NAME}" = "arm64" ]; then
        LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-macos-arm64.tar.gz"
    else
        LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-macos-x64.tar.gz"
    fi
elif [ "${OS_NAME}" = "linux" ]; then
    if [ "${ARCH_NAME}" = "aarch64" ] || [ "${ARCH_NAME}" = "arm64" ]; then
        LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-ubuntu-arm64.tar.gz"
    else
        LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-ubuntu-x64.tar.gz"
    fi
elif [[ "${OS_NAME}" == *"mingw"* ]] || [[ "${OS_NAME}" == *"msys"* ]] || [[ "${OS_NAME}" == *"cygwin"* ]]; then
    LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-win-avx2-x64.zip"
    LLAMA_ARCHIVE_TYPE="zip"
fi

if [ ! -f "${HOME}/.codealloy/bin/llama-server" ] && [ ! -f "${HOME}/.codealloy/bin/llama-server.exe" ]; then
    if [ -n "${LLAMA_URL}" ]; then
        echo "  Downloading native llama.cpp runner for ${OS_NAME} (${ARCH_NAME})..."
        if [ "${LLAMA_ARCHIVE_TYPE}" = "zip" ]; then
            curl -sL "${LLAMA_URL}" -o /tmp/llama.zip && unzip -q -o /tmp/llama.zip -d "${HOME}/.codealloy/bin" && rm -f /tmp/llama.zip
        else
            curl -sL "${LLAMA_URL}" | tar -xzf - -C "${HOME}/.codealloy/bin" --strip-components=1
        fi
        chmod +x "${HOME}/.codealloy/bin/llama-server"* 2>/dev/null || true
        echo "  ✓ Embedded inference engine installed in ~/.codealloy/bin"
    fi
else
    echo "  ✓ Embedded inference engine already present in ~/.codealloy/bin"
fi

# 4. Patch native spdlog for macOS Xcode 16 Clang consteval compatibility
echo ""
echo "🔧 Applying platform compatibility patches..."
node -e "
  const fs = require('fs');
  const p1 = '${BUILD_CACHE_DIR}/package.json';
  if (fs.existsSync(p1)) {
    fs.writeFileSync(p1, fs.readFileSync(p1, 'utf8').replace(/\"@vscode\/spdlog\": \"\^0\.15\.0\"/g, '\"@vscode\/spdlog\": \"0.15.8\"'));
  }
  const p2 = '${BUILD_CACHE_DIR}/package-lock.json';
  if (fs.existsSync(p2)) {
    fs.writeFileSync(p2, fs.readFileSync(p2, 'utf8').replace(/\"@vscode\/spdlog\": \"0\.15\.1\"/g, '\"@vscode\/spdlog\": \"0.15.8\"'));
  }
" 2>/dev/null || true

# 5. Installing dependencies across all subprojects
echo ""
echo "📥 Installing dependencies (root, build, extensions)..."
if [[ "${OS_NAME}" == *"mingw"* ]] || [[ "${OS_NAME}" == *"msys"* ]] || [[ "${OS_NAME}" == *"cygwin"* ]]; then
    npm config set msvs_version 2022 2>/dev/null || true
fi
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
