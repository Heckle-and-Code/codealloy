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

echo "📦 Packaging CodeAlloy for current platform..."
cd "${UPSTREAM_DIR}"

UNAME_OUT="$(uname -s)"
case "${UNAME_OUT}" in
    Darwin*)
        ARCH="$(uname -m)"
        if [ "${ARCH}" = "arm64" ]; then
            echo "  Building macOS Apple Silicon (arm64)..."
            npx gulp vscode-darwin-arm64
        else
            echo "  Building macOS Intel (x64)..."
            npx gulp vscode-darwin-x64
        fi
        ;;
    Linux*)
        echo "  Building Linux..."
        npx gulp vscode-linux-x64
        ;;
    CYGWIN*|MINGW*|MSYS*)
        echo "  Building Windows..."
        npx gulp vscode-win32-x64
        ;;
    *)
        echo "❌ Unsupported operating system: ${UNAME_OUT}"
        exit 1
        ;;
esac

echo "🎉 Build completed. Package artifacts located in .build/code-oss/../VSCode-*"
