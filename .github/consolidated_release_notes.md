# ⚡ CodeAlloy v0.1.0-alpha.6 — Developer Preview

CodeAlloy is a sovereign, zero-telemetry autonomous coding IDE with native open-model intelligence and local inference built directly into the core shell.

---

### 🌟 Key Features & Capabilities

- **100% Sovereign & Private**: No cloud telemetry, no account login required. All AI interactions, memory, and checkpoints stay strictly on your local machine.
- **Embedded `llama.cpp` Engine**: Zero-config local inference with Apple Silicon Metal acceleration right out of the box. No separate runtime setup needed.
- **Dynamic Model Discovery & 1-Click Setup**:
  - 1-click curated GGUF downloads: **Qwen 2.5 Coder** (1.5B, 7B, 14B) & **DeepSeek R1 Distill 7B**.
  - **Load GGUF from Disk**: Run any local quantized model file with a native file picker.
  - **External Providers**: First-class connectors for local Ollama (`http://localhost:11434`), vLLM, and LM Studio.
- **5-Tier Autonomy Dial (L0 – L4)**:
  - **L0 (Read-Only)**: Agent can only read files and answer questions.
  - **L1 (Proposal)**: Agent proposes diffs; requires explicit approval for every edit.
  - **L2 (Supervised)**: Agent auto-edits project files; requires confirmation for terminal commands.
  - **L3 (Autonomous)**: Agent writes files, runs non-destructive tests and terminal commands autonomously.
  - **L4 (Full Auto)**: Unrestricted development execution.
- **Shadow Git Time-Travel Checkpoints**: Sub-5ms snapshotting before every agent action with instant 1-click turn rollbacks.
- **Native Inline Diffs**: Streamed multi-line code diffs directly inside the editor buffer with single-stroke accept (`Tab`) or discard (`Esc`).
- **Open VSX Marketplace**: Full access to install thousands of extensions from Open VSX or sideload `.vsix` packages.
- **Terminal CLI Launchers**: Use `alloy .` or `codealloy .` from your terminal to launch projects instantly.

---

### 📦 Supported Platforms & Downloads

| Platform | Architecture | Package |
| :--- | :--- | :--- |
| **macOS** | Apple Silicon (`arm64`) | `CodeAlloy-v0.1.0-alpha.6-darwin-arm64.dmg` / `.zip` |
| **macOS** | Intel (`x64`) | `CodeAlloy-v0.1.0-alpha.6-darwin-x64.dmg` / `.zip` |
| **Linux** | 64-bit (`x64`) | `CodeAlloy-v0.1.0-alpha.6-linux-x64.tar.gz` |
| **Windows** | 64-bit (`x64`) | `CodeAlloy-v0.1.0-alpha.6-win32-x64.zip` |

---

### 🛡️ Note on macOS First Launch (Gatekeeper)
Because CodeAlloy is an open-source alpha with an ad-hoc local signature rather than an Apple Developer ID notarization ticket:
- Drag `CodeAlloy.app` into `/Applications`.
- **Right-click** `CodeAlloy.app` and select **Open** (then click Open).
- Alternatively, run `xattr -cr /Applications/CodeAlloy.app` in Terminal.
