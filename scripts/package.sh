#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
UPSTREAM_DIR="${HOME}/.codealloy/build/code-oss"

if [ ! -d "${UPSTREAM_DIR}" ]; then
    UPSTREAM_DIR="${ROOT_DIR}/.build/code-oss"
fi

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

mkdir -p "${DIST_DIR}"
VERSION=$(node -p "require('${ROOT_DIR}/package.json').version" 2>/dev/null || echo "0.1.0-alpha.1")

export NODE_OPTIONS="--max-old-space-size=8192"

echo "📦 Packaging CodeAlloy v${VERSION}..."
cd "${UPSTREAM_DIR}"

# Ensure product.json has builtInExtensions and licenseFileName required by gulp packaging
node -e "
  const fs = require('fs');
  const p = '${UPSTREAM_DIR}/product.json';
  if (fs.existsSync(p)) {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(data.builtInExtensions)) data.builtInExtensions = [];
    if (!data.licenseFileName) data.licenseFileName = 'LICENSE.txt';
    if (!data.quality) data.quality = 'stable';
    if (!data.serverDataFolderName) data.serverDataFolderName = '.codealloy-remote';
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  }
" 2>/dev/null || true

echo "  ⚡ Compiling CodeAlloy core extension (codealloy-models)..."
(cd "${ROOT_DIR}" && "${UPSTREAM_DIR}/node_modules/typescript/bin/tsc" -p extensions/codealloy-models/tsconfig.json 2>/dev/null || true)

echo "  ⚡ Staging codealloy-models into Code-OSS extensions..."
rm -rf "${UPSTREAM_DIR}/extensions/codealloy-models"
mkdir -p "${UPSTREAM_DIR}/extensions/codealloy-models"
cp "${ROOT_DIR}/extensions/codealloy-models/package.json" "${UPSTREAM_DIR}/extensions/codealloy-models/"
cp -R "${ROOT_DIR}/extensions/codealloy-models/out" "${UPSTREAM_DIR}/extensions/codealloy-models/"
if [ -d "${ROOT_DIR}/extensions/codealloy-models/resources" ]; then
    cp -R "${ROOT_DIR}/extensions/codealloy-models/resources" "${UPSTREAM_DIR}/extensions/codealloy-models/"
fi
rm -rf "${UPSTREAM_DIR}/extensions/codealloy-models/node_modules"

echo "  ⚡ Transpiling client and extensions..."
npm run gulp transpile-client-esbuild transpile-extensions

UNAME_OUT="$(uname -s)"
case "${UNAME_OUT}" in
    Darwin*)
        ARCH="$(uname -m)"
        if [ "${ARCH}" = "arm64" ]; then
            TARGET="vscode-darwin-arm64"
            OUT_NAME="CodeAlloy-v${VERSION}-darwin-arm64"
            BUILD_FOLDER="VSCode-darwin-arm64"
        else
            TARGET="vscode-darwin-x64"
            OUT_NAME="CodeAlloy-v${VERSION}-darwin-x64"
            BUILD_FOLDER="VSCode-darwin-x64"
        fi

        echo "  🔨 Running gulp ${TARGET}..."
        npm run gulp "${TARGET}"

        PARENT_DIR="$(cd "${UPSTREAM_DIR}/.." && pwd)"
        SEARCH_APP="${PARENT_DIR}/${BUILD_FOLDER}"
        if [ ! -d "${SEARCH_APP}" ]; then
            SEARCH_APP="${UPSTREAM_DIR}/../${BUILD_FOLDER}"
        fi

        APP_BUNDLE=$(find "${SEARCH_APP}" -maxdepth 2 -name "*.app" | head -n 1)

        if [ -n "${APP_BUNDLE}" ] && [ -d "${APP_BUNDLE}" ]; then
            echo "  📦 Embedding codealloy-models into ${APP_BUNDLE}..."
            mkdir -p "${APP_BUNDLE}/Contents/Resources/app/extensions/codealloy-models"
            cp -R "${ROOT_DIR}/extensions/codealloy-models/package.json" "${APP_BUNDLE}/Contents/Resources/app/extensions/codealloy-models/"
            cp -R "${ROOT_DIR}/extensions/codealloy-models/out" "${APP_BUNDLE}/Contents/Resources/app/extensions/codealloy-models/"
            if [ -d "${ROOT_DIR}/extensions/codealloy-models/resources" ]; then
                cp -R "${ROOT_DIR}/extensions/codealloy-models/resources" "${APP_BUNDLE}/Contents/Resources/app/extensions/codealloy-models/"
            fi

            # Create CLI launcher symlinks in app bin
            mkdir -p "${APP_BUNDLE}/Contents/Resources/app/bin"
            ln -sf code "${APP_BUNDLE}/Contents/Resources/app/bin/alloy"
            ln -sf code "${APP_BUNDLE}/Contents/Resources/app/bin/codealloy"

            if command -v codesign >/dev/null 2>&1; then
                echo "  🔏 Ad-hoc codesigning ${APP_BUNDLE}..."
                codesign --force --deep --sign - "${APP_BUNDLE}" 2>/dev/null || true
            fi

            echo "  📦 Creating ${OUT_NAME}.zip..."
            ditto -c -k --keepParent "${APP_BUNDLE}" "${DIST_DIR}/${OUT_NAME}.zip"

            if command -v hdiutil >/dev/null 2>&1; then
                echo "  💿 Creating ${OUT_NAME}.dmg..."
                DMG_TMP="${DIST_DIR}/tmp_dmg"
                rm -rf "${DMG_TMP}"
                mkdir -p "${DMG_TMP}"
                ditto "${APP_BUNDLE}" "${DMG_TMP}/$(basename "${APP_BUNDLE}")"
                ln -s /Applications "${DMG_TMP}/Applications"
                hdiutil create -volname "CodeAlloy" -srcfolder "${DMG_TMP}" -ov -format UDZO -fs HFS+ "${DIST_DIR}/${OUT_NAME}.dmg" -quiet
                rm -rf "${DMG_TMP}"
                echo "  ✓ Generated: ${DIST_DIR}/${OUT_NAME}.dmg"
            fi
        fi
        ;;

    Linux*)
        echo "  🔨 Running gulp vscode-linux-x64..."
        npm run gulp vscode-linux-x64
        PARENT_DIR="$(cd "${UPSTREAM_DIR}/.." && pwd)"
        LINUX_OUT="${PARENT_DIR}/VSCode-linux-x64"
        if [ -d "${LINUX_OUT}" ]; then
            echo "  📦 Embedding codealloy-models into ${LINUX_OUT}..."
            mkdir -p "${LINUX_OUT}/resources/app/extensions/codealloy-models"
            cp -R "${ROOT_DIR}/extensions/codealloy-models/package.json" "${LINUX_OUT}/resources/app/extensions/codealloy-models/"
            cp -R "${ROOT_DIR}/extensions/codealloy-models/out" "${LINUX_OUT}/resources/app/extensions/codealloy-models/"
            if [ -d "${ROOT_DIR}/extensions/codealloy-models/resources" ]; then
                cp -R "${ROOT_DIR}/extensions/codealloy-models/resources" "${LINUX_OUT}/resources/app/extensions/codealloy-models/"
            fi

            # Create CLI launcher symlinks
            mkdir -p "${LINUX_OUT}/bin"
            ln -sf code "${LINUX_OUT}/bin/alloy" 2>/dev/null || true
            ln -sf code "${LINUX_OUT}/bin/codealloy" 2>/dev/null || true

            echo "  📦 Creating CodeAlloy-v${VERSION}-linux-x64.tar.gz..."
            tar -czf "${DIST_DIR}/CodeAlloy-v${VERSION}-linux-x64.tar.gz" -C "${PARENT_DIR}" "VSCode-linux-x64"
        fi
        ;;

    CYGWIN*|MINGW*|MSYS*)
        echo "  🔨 Running gulp vscode-win32-x64..."
        npm run gulp vscode-win32-x64
        PARENT_DIR="$(cd "${UPSTREAM_DIR}/.." && pwd)"
        WIN_OUT="${PARENT_DIR}/VSCode-win32-x64"
        if [ -d "${WIN_OUT}" ]; then
            echo "  📦 Embedding codealloy-models into ${WIN_OUT}..."
            mkdir -p "${WIN_OUT}/resources/app/extensions/codealloy-models"
            cp -R "${ROOT_DIR}/extensions/codealloy-models/package.json" "${WIN_OUT}/resources/app/extensions/codealloy-models/"
            cp -R "${ROOT_DIR}/extensions/codealloy-models/out" "${WIN_OUT}/resources/app/extensions/codealloy-models/"
            if [ -d "${ROOT_DIR}/extensions/codealloy-models/resources" ]; then
                cp -R "${ROOT_DIR}/extensions/codealloy-models/resources" "${WIN_OUT}/resources/app/extensions/codealloy-models/"
            fi

            # Create Windows CLI cmd wrappers
            if [ -f "${WIN_OUT}/bin/code.cmd" ]; then
                cp "${WIN_OUT}/bin/code.cmd" "${WIN_OUT}/bin/alloy.cmd"
                cp "${WIN_OUT}/bin/code.cmd" "${WIN_OUT}/bin/codealloy.cmd"
            fi

            echo "  📦 Creating CodeAlloy-v${VERSION}-win32-x64.zip..."
            if command -v 7z >/dev/null 2>&1; then
                7z a -tzip -mx=5 "${DIST_DIR}/CodeAlloy-v${VERSION}-win32-x64.zip" "${WIN_OUT}"/*
            elif command -v powershell >/dev/null 2>&1; then
                powershell -Command "Compress-Archive -Path '${WIN_OUT}/*' -DestinationPath '${DIST_DIR}/CodeAlloy-v${VERSION}-win32-x64.zip' -Force"
            elif command -v zip >/dev/null 2>&1; then
                (cd "${PARENT_DIR}" && zip -r -q "${DIST_DIR}/CodeAlloy-v${VERSION}-win32-x64.zip" "VSCode-win32-x64")
            fi
        fi
        ;;

    *)
        echo "❌ Unsupported operating system: ${UNAME_OUT}"
        exit 1
        ;;
esac

# Generate SHA256 Checksums
echo "🔒 Generating SHA-256 Checksums in dist/..."
cd "${DIST_DIR}"
for file in *; do
    if [ -f "${file}" ] && [[ "${file}" != *.sha256 ]] && [[ "${file}" != "checksums.txt" ]]; then
        if command -v shasum >/dev/null 2>&1; then
            shasum -a 256 "${file}" > "${file}.sha256"
        else
            sha256sum "${file}" > "${file}.sha256"
        fi
        echo "  ✓ ${file}.sha256"
    fi
done

echo "🎉 Build completed. Distribution assets located in: ${DIST_DIR}"
