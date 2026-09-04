#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="${ROOT_DIR}/.build/code-oss"

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
            yarn gulp vscode-darwin-arm64
        else
            echo "  Building macOS Intel (x64)..."
            yarn gulp vscode-darwin-x64
        fi
        ;;
    Linux*)
        echo "  Building Linux..."
        yarn gulp vscode-linux-x64
        ;;
    CYGWIN*|MINGW*|MSYS*)
        echo "  Building Windows..."
        yarn gulp vscode-win32-x64
        ;;
    *)
        echo "❌ Unsupported operating system: ${UNAME_OUT}"
        exit 1
        ;;
esac

echo "🎉 Build completed. Package artifacts located in .build/code-oss/../VSCode-*"
