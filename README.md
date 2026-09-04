# CodeAlloy ⚡

> **"Where developer intent meets open models."**

CodeAlloy is an open-source, open-model-native autonomous IDE forked from **Code-OSS / VSCodium**. It brings Antigravity/Cursor-grade agentic coding to sovereign and local open-weights models (like **Qwen 2.5 Coder**, **DeepSeek**, **Gemma**, and **Llama**) with fine-grained autonomy controls and atomic time-travel rollbacks.

---

## 🌟 Core Pillars

* **🤖 Dynamic Open-Model Engine**: Connects directly to local [Ollama](https://ollama.com) runtimes, self-hosted [vLLM](https://github.com/vllm-project/vllm) / llama.cpp servers, or remote OpenAI-compatible endpoints. Zero hardcoded model versions—search, pull, and switch models directly inside the editor or via `Cmd+Shift+P`.
* **🎛️ 5-Tier Autonomy Dial**: From passive inline autocomplete (**Level 0**) to interactive chat (**Level 1**), supervised pair programming (**Level 2**), guarded project autonomy (**Level 3**), up to full autonomous goal-runner mode (**Level 4**).
* **⏪ Atomic Shadow Git Time-Travel**: Built-in snapshot engine in `.codealloy/history.git`. Creates a sub-5ms atomic checkpoint before every agent turn. Click **[Undo Turn]** to cleanly restore all modified files without ever polluting your working branch or personal Git commits.
* **🧩 Open VSX Extension Ecosystem**: Full compatibility with standard VS Code extensions via the [Open VSX](https://open-vsx.org) registry. Sideload any `.vsix` file or install your favorite language servers and themes.
* **📦 Cross-Platform Native Installers**: Standalone desktop applications for macOS (`.dmg` Apple Silicon & Intel), Windows (`.exe`), and Linux (`.deb`, `.rpm`, `.AppImage`).

---

## 📁 Repository Documentation

| Document | Purpose |
| :--- | :--- |
| **[PROPOSAL.md](./PROPOSAL.md)** | Full technical proposal, architectural diagrams, model matrix, and storage tradeoffs. |
| **[USER_STORIES.md](./USER_STORIES.md)** | Granular user stories and acceptance criteria organized by feature epic. |

---

## 🏗️ High-Level Architecture

```text
┌────────────────────────────────────────────────────────────┐
│                    CodeAlloy Workbench                    │
│   (Code-OSS Shell + Open VSX Marketplace + Native Diffs)   │
└────────────────────────────┬───────────────────────────────┘
                             │
                  [Editor-to-Agent Bridge]
                             │
┌────────────────────────────▼───────────────────────────────┐
│                    Agent Sidecar Engine                    │
│  ┌─────────────────────────┐     ┌──────────────────────┐  │
│  │   Autonomy Controller   │     │ Shadow Git Snapshot  │  │
│  │   (L0 - L4 State Mach)  │     │ (Sub-5ms Rollback)   │  │
│  └─────────────────────────┘     └──────────────────────┘  │
│  ┌─────────────────────────┐     ┌──────────────────────┐  │
│  │ Context & AST Indexer   │     │ Dual Tool Parser     │  │
│  │ (Tree-sitter + Vector)  │     │ (JSON + XML fallback)│  │
│  └─────────────────────────┘     └──────────────────────┘  │
└────────────────────────────┬───────────────────────────────┘
                             │
                  [Dynamic Model Gateway]
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Local Ollama │      │  Local vLLM  │      │ OpenRouter / │
│   Instance   │      │  / llama.cpp │      │ Remote Cloud │
└──────────────┘      └──────────────┘      └──────────────┘
```

---

## 🗺️ Roadmap & Milestones

1. **Phase 1: The Core Agent & Shadow Git Engine**
   - Headless agent runtime with dual-mode tool calling.
   - Dynamic Ollama `/api/tags` integration and Command Palette puller.
   - Shadow Git transaction manager with 1-click atomic undo.
2. **Phase 2: VSCodium Fork & UI Customization**
   - Brand customization (`product.json`), Open VSX configuration.
   - Native Agent sidebar with Autonomy Dial and Checkpoint Scrubber.
   - Inline multi-line streaming diff editor widget.
3. **Phase 3: Cross-Platform Packaging & Release**
   - GitHub Actions matrix build pipelines for macOS, Windows, and Linux.
   - Code signing, notarization, and auto-update infrastructure.

---

## 📄 License

CodeAlloy is open-source under the MIT License. Built with appreciation for the Code-OSS, VSCodium, Ollama, and open-weights AI communities.
