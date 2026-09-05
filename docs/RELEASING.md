# How to Create a Release for CodeAlloy 🚀

This guide explains step-by-step how to create official releases of CodeAlloy on GitHub, publish changelogs, and distribute downloadable desktop installers (macOS DMG, Windows EXE, Linux deb/tar).

---

## 🌟 How GitHub Releases Work

When users visit an open-source tool like VS Code or CodeAlloy, they don't want to clone code and compile it with Node.js and C++ tools. They expect to click a **Release** link and download a pre-built app:
- **macOS**: `CodeAlloy-v0.1.0-alpha.1-darwin-arm64.dmg` (Apple Silicon) or `darwin-x64.dmg` (Intel)
- **Windows**: `CodeAlloy-v0.1.0-alpha.1-win32-x64.zip` / setup
- **Linux**: `codealloy_0.1.0_amd64.deb` or `CodeAlloy-v0.1.0-alpha.1-linux-x64.tar.gz`

CodeAlloy automates this entire process using **GitHub Actions cloud builders**. You never need to manually cross-compile Windows or Linux binaries on your Mac.

---

## 🛠️ Method 1: The 1-Command Release (Recommended)

From your terminal in the CodeAlloy project directory:

### Step 1: Dry-Run Check
Verify your repository state, changelog, and target tag:
```bash
./scripts/release.sh --dry-run
```

### Step 2: Publish the Release
Make sure your working directory is committed and clean, then run:
```bash
npm run release
```
*(or run `./scripts/release.sh` directly)*

### What happens automatically:
1. The script verifies that `CHANGELOG.md` documents this version.
2. It creates an annotated git tag (e.g. `v0.1.0-alpha.1`).
3. It pushes the tag to GitHub (`git push origin v0.1.0-alpha.1`).
4. GitHub detects the new tag and immediately triggers the **Release CodeAlloy** cloud workflow.
5. GitHub's macOS, Windows, and Ubuntu virtual machines compile the IDE simultaneously.
6. GitHub drafts the release page with categorized release notes, formats SHA-256 checksums, and attaches all downloadable installer files.

You will see live progress at:
👉 **`https://github.com/Heckle-and-Code/codealloy/actions`**

---

## 🌐 Method 2: Creating a Release via the GitHub Web UI

If you prefer clicking through the GitHub website:

1. Go to your repository on GitHub: `https://github.com/Heckle-and-Code/codealloy`
2. Click **Actions** in the top navigation tab.
3. In the left sidebar, click **Release CodeAlloy**.
4. Click the **Run workflow** dropdown on the right.
5. (Optional) Enter a custom tag name (e.g. `v0.1.0-alpha.1`), choose whether it's a pre-release or draft.
6. Click the green **Run workflow** button.

GitHub Actions will build the artifacts and publish the release.

---

## 📝 How Changelogs Work

CodeAlloy maintains two synchronized levels of changelogs:

### 1. In-Repo `CHANGELOG.md`
Located at the root of the project. Whenever a new feature or fix is developed, add it under the corresponding version header:
```markdown
## [0.2.0] - 2026-10-15
### Added
- New model provider support...
### Fixed
- Resolved edge case in inline diff rendering...
```

### 2. GitHub Release Notes Generator (`.github/release.yml`)
When GitHub publishes the release page, it automatically scans all pull requests and commits since the last release tag and sorts them into:
- 🚀 **Exciting New Features**
- 🤖 **Autonomous Engine & Models**
- 🎛️ **Workbench & Autonomy Dial**
- ⏪ **Shadow Git & Time-Travel**
- 🧩 **Extension Ecosystem & Marketplace**
- 🐛 **Bug Fixes**
- ⚡ **Performance Improvements**
- 📦 **Packaging, Installers & CI/CD**
- 📖 **Documentation & Branding**

---

## 📦 Where Do Users Download the App?

Once the GitHub Actions workflow finishes (typically 8–15 minutes for Code-OSS compilation):

1. Anyone visiting `https://github.com/Heckle-and-Code/codealloy/releases` will see the latest release at the very top.
2. Under **Assets**, they can click their respective operating system file:
   - **macOS (M1/M2/M3/M4 Apple Silicon)**: `CodeAlloy-v0.1.0-alpha.1-darwin-arm64.dmg`
   - **macOS (Intel Core)**: `CodeAlloy-v0.1.0-alpha.1-darwin-x64.dmg`
   - **Windows**: `CodeAlloy-v0.1.0-alpha.1-win32-x64.zip`
   - **Linux**: `CodeAlloy-v0.1.0-alpha.1-linux-x64.tar.gz`
3. A checksum block (`checksums.txt`) allows security-conscious developers to verify their downloads with `shasum -a 256 <file>`.

---

## 🔒 Code-Signing & Notarization (Production Next Steps)

For initial developer previews and alpha releases, users can open the application directly. When preparing for public commercial distribution:
- **macOS**: Add Apple Developer ID certificates and `notarytool` API keys to GitHub Secrets (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY`).
- **Windows**: Add an EV or standard Authenticode code-signing certificate to GitHub Secrets (`WINDOWS_SIGN_CERT`, `WINDOWS_SIGN_PASSWORD`).
The `.github/workflows/release.yml` is structured to consume these secrets seamlessly once configured.
