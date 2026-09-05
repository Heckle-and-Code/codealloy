#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DRY_RUN=false
for arg in "$@"; do
    if [ "$arg" = "--dry-run" ]; then
        DRY_RUN=true
    fi
done

echo "🚀 ========================================================"
echo "🚀 CodeAlloy Release Pipeline"
echo "🚀 ========================================================"

# 1. Check Git Status
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    if [ "${DRY_RUN}" = false ]; then
        echo "⚠️  Working tree has uncommitted changes. Please commit or stash them first."
        exit 1
    else
        echo "ℹ️  [Dry Run] Working tree has uncommitted changes (ignoring for dry-run)."
    fi
fi

# 2. Determine Version
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.1.0-alpha.1")
TAG="v${VERSION}"

echo "📌 Target Release Version: ${VERSION} (Tag: ${TAG})"

# 3. Check for CHANGELOG.md
if [ ! -f "${ROOT_DIR}/CHANGELOG.md" ]; then
    echo "❌ Error: CHANGELOG.md not found."
    exit 1
fi

if ! grep -q "## \[${VERSION}\]" "${ROOT_DIR}/CHANGELOG.md"; then
    echo "⚠️  Warning: Version [${VERSION}] is not yet documented in CHANGELOG.md."
    echo "    Please update CHANGELOG.md before publishing a release."
    if [ "${DRY_RUN}" = false ]; then
        exit 1
    fi
else
    echo "  ✓ Verified CHANGELOG.md contains entries for [${VERSION}]"
fi

# 4. Check Existing Git Tag
if git rev-parse "${TAG}" >/dev/null 2>&1; then
    echo "⚠️  Tag ${TAG} already exists locally."
    if [ "${DRY_RUN}" = false ]; then
        echo "    Delete it with 'git tag -d ${TAG}' or bump version in package.json."
        exit 1
    fi
else
    echo "  ✓ Git tag ${TAG} is available."
fi

# 5. Compile Recent Commit Summary
echo ""
echo "📝 Recent Changes to be included in release:"
PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "${PREV_TAG}" ]; then
    git log "${PREV_TAG}..HEAD" --oneline --no-merges || true
else
    git log -n 15 --oneline --no-merges || true
fi
echo ""

# 6. Execute or Dry-Run
if [ "${DRY_RUN}" = true ]; then
    echo "🔎 [Dry-Run Complete] Everything is valid!"
    echo "   To trigger the live release, run: npm run release"
    exit 0
fi

echo "🏷️  Creating git tag ${TAG}..."
git tag -a "${TAG}" -m "Release CodeAlloy ${TAG}"

echo "📤 Pushing git tag to GitHub (origin)..."
git push origin "${TAG}"

echo ""
echo "🎉 ========================================================"
echo "🎉 Tag ${TAG} pushed successfully to GitHub!"
echo "🎉 GitHub Actions release workflow is now running at:"
echo "   https://github.com/Heckle-and-Code/codealloy/actions"
echo ""
echo "📦 Once the build completes, download installers from:"
echo "   https://github.com/Heckle-and-Code/codealloy/releases/tag/${TAG}"
echo "🎉 ========================================================"
