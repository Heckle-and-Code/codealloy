#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="$(cd "${ROOT_DIR}/.build/code-oss" 2>/dev/null && pwd -P || echo "${ROOT_DIR}/.build/code-oss")"

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

echo "⚡ Syncing CodeAlloy product configuration..."
cp "${ROOT_DIR}/build/product.json" "${UPSTREAM_DIR}/product.json"

echo "⚡ Syncing CodeAlloy built-in extensions..."
mkdir -p "${UPSTREAM_DIR}/extensions"
ln -sfn "${ROOT_DIR}/extensions/codealloy-models" "${UPSTREAM_DIR}/extensions/codealloy-models"
(cd "${ROOT_DIR}" && "${UPSTREAM_DIR}/node_modules/typescript/bin/tsc" -p extensions/codealloy-models/tsconfig.json 2>/dev/null || true)


ORIGINAL_PWD="$(pwd)"
TARGET_ARGS=()
if [ $# -eq 0 ]; then
    # Default to current working directory
    TARGET_ARGS+=("${ORIGINAL_PWD}")
else
    for arg in "$@"; do
        if [ "$arg" = "." ]; then
            TARGET_ARGS+=("${ORIGINAL_PWD}")
        elif [[ "$arg" = /* ]]; then
            TARGET_ARGS+=("${arg}")
        elif [ -e "${ORIGINAL_PWD}/${arg}" ]; then
            TARGET_ARGS+=("${ORIGINAL_PWD}/${arg}")
        else
            TARGET_ARGS+=("${arg}")
        fi
    done
fi

IS_CLI_COMMAND=false
for arg in "$@"; do
    if [[ "$arg" == --install-extension* || "$arg" == "--list-extensions" || "$arg" == "--uninstall-extension"* || "$arg" == "--version" ]]; then
        IS_CLI_COMMAND=true
        break
    fi
done

if [ "$IS_CLI_COMMAND" = true ]; then
    echo "⚡ Executing CodeAlloy CLI command..."
    cd "${UPSTREAM_DIR}"
    "${UPSTREAM_DIR}/scripts/code-cli.sh" "${TARGET_ARGS[@]}"
else
    echo "⚡ Launching CodeAlloy in ${TARGET_ARGS[0]}..."
    cd "${UPSTREAM_DIR}"
    "${UPSTREAM_DIR}/scripts/code.sh" "${TARGET_ARGS[@]}"
fi

