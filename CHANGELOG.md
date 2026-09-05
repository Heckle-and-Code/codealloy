# Changelog

All notable changes to the **CodeAlloy** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0-alpha.3] - 2026-09-05

### Fixed
- **Built-in AI Extension Packaging**: Explicitly compiled and embedded `extensions/codealloy-models` into the final application bundle across macOS, Linux, and Windows releases. Previously, the release packager built clean Code-OSS without embedding the CodeAlloy agent panel, model selector, and autonomy dial.
- **Developer Bootstrap Extension Link**: Updated `scripts/bootstrap.sh` to automatically link and compile `codealloy-models` during setup.

---

## [0.1.0-alpha.2] - 2026-09-05

### Fixed
- **macOS DMG Packaging (Finder Error -36)**: Explicitly enforced standard `-fs HFS+` filesystem for `hdiutil create` compressed DMGs (`UDZO`), fixing a macOS Sonoma APFS compression bug that caused Finder I/O read errors on launch.
- **App Bundle Staging**: Replaced standard Unix `cp -R` with Apple's native `ditto` in `package.sh` to preserve framework symlinks, extended attributes, and permissions without corruption.
- **macOS Gatekeeper Code Signature**: Added automatic ad-hoc codesigning (`codesign --force --deep --sign -`) during packaging to prevent macOS from flagging modified bundles as damaged or malicious.
- **Zip Archiving**: Standardized `.zip` packaging using `ditto -c -k --keepParent` for clean, uncorrupted bundle extractions.

---

## [0.1.0-alpha.1] - 2026-09-05

### Initial Developer Preview: "Where developer intent meets open models"

This release marks the first complete, functional developer preview of CodeAlloy—an open-model-native autonomous IDE forked from Code-OSS. It brings sovereign, agentic coding capabilities to local open-weights models (such as Qwen 2.5 Coder, DeepSeek-Coder, Gemma, and Llama) without sending proprietary code to third-party cloud AI vendors.

### Added

#### Epic 1: Autonomous Engine & Agent Chat Interface
- **Local Model Provider Engine**: Native streaming integration with local [Ollama](https://ollama.com) instances (`localhost:11434`) and self-hosted [vLLM](https://github.com/vllm-project/vllm) / llama.cpp servers.
- **Dynamic Model Discovery**: Queries the runtime endpoints dynamically to list available models; eliminates hardcoded deprecations.
- **Dedicated Agent Sidebar Webview**: High-performance, reactive chat panel built into the CodeAlloy workbench activity bar with syntax-highlighted code blocks, tool status badges, and token streaming.
- **Autonomous Tool-Calling Protocol**: Parser supporting OpenAI-compatible function calling, Qwen XML tool syntax (`<tool_call>`), and fallback regex for open-weights models.
- **Workspace Tool Suite**: Native implementations of `write_file`, `replace_file_content`, `read_file`, `list_dir`, and `execute_command`.

#### Epic 2: Autonomy Levels & Permissions Guardrails
- **5-Tier Autonomy Dial**: Segmented control (`L0: Assist`, `L1: Chat`, `L2: Supervised`, `L3: Guarded`, `L4: Autonomous`) accessible in the agent panel and status bar.
- **Level 2 (Supervised) Interactive Approvals**: Interactive approval cards with side-by-side diff previews before any file write or command execution; keyboard shortcuts (`Enter` to approve, `Esc` to reject).
- **Level 3 (Guarded) Workspace Safety**: Automatic execution of edits within the workspace root; explicit approval required for dangerous operations (`rm -rf`, `sudo`, `git push --force`, or access outside workspace).
- **Level 4 (Autonomous) Goal Runner**: Continuous execution loop with built-in loop detector circuit breaker (trips on 3 identical errors) and configurable turn cap.

#### Epic 3: Shadow Git Checkpoints & Time-Travel Rollback
- **Atomic Pre-Turn Snapshots**: Isolated Git store in `~/.codealloy/projects/<hash>/history.git` executing `git write-tree` and `git commit-tree` in `< 5ms` without touching or polluting workspace `.git`.
- **1-Click Turn Rollback**: Instant `[Undo Turn]` button restoring all modified, created, and deleted files for that turn using `git checkout <pre-turn-tree-id> -- .`.
- **Historical Time-Travel Scrubber**: Visual session scrubber allowing developers to step back to any prior checkpoint.

#### Epic 4: Extension Ecosystem & Open VSX Marketplace
- **Open VSX Marketplace Integration**: Preconfigured gallery endpoints (`serviceUrl: https://open-vsx.org/vscode/gallery`) enabling discovery and 1-click installation of thousands of open-source language servers, themes, and linters.
- **VSIX Sideloading**: Direct `.vsix` drag-and-drop installation and terminal installation via `codealloy --install-extension <path.vsix>`.
- **CodeAlloy CLI Launcher (`bin/codealloy`)**: Terminal command launcher supporting `codealloy .`, `--install-extension`, and `--list-extensions`.

#### Epic 5: Workbench Customization, Inline Diffs & MCP
- **Native Inline Streaming Diffs**: Zero-dependency Longest Common Subsequence (LCS) differ that renders additions (green) and deletions (red strikethrough) directly in the active editor buffer with keyboard shortcuts (`Tab` accept, `Esc` reject, `Cmd+Enter` accept all).
- **Model Context Protocol (MCP) Support**: Stdio JSON-RPC 2.0 client discovering `.codealloy/mcp_config.json` and bridging external tools into model tool declarations.

#### Epic 6: Cross-Platform Packaging & Desktop Installers
- **Distribution Packaging**: Automated build scripts generating macOS `.dmg` / `.zip`, Linux `.deb` / `.tar.gz`, and Windows `.exe` / `.zip`.
- **GitHub Actions Release Pipeline**: Cloud matrix CI/CD workflow (`.github/workflows/release.yml`) automatically building and publishing multi-platform releases on tag push.
- **Automated Releasing Helper (`scripts/release.sh`)**: CLI utility to generate changelogs, create git tags, and trigger release pipelines.

---
[0.1.0-alpha.1]: https://github.com/Heckle-and-Code/codealloy/releases/tag/v0.1.0-alpha.1
