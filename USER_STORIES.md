# CodeAlloy: Granular User Stories & Acceptance Criteria

This document specifies the feature set of **CodeAlloy** in the form of agile user stories and testable acceptance criteria across six primary epics.

---

## Epic 1: Dynamic Model Discovery & Ollama Integration

### US-1.1: Automatic Discovery of Local Ollama Models
* **User Story**: As a developer running Ollama on my workstation, I want CodeAlloy to automatically detect my running Ollama instance and discover all locally installed models on launch, so that I don't have to manually configure ports or type model names.
* **Acceptance Criteria**:
  * **AC 1.1.1**: When CodeAlloy starts up, the sidecar daemon sends a request to `http://localhost:11434/api/tags`.
  * **AC 1.1.2**: If the response is successful (HTTP 200), the model selector dropdown is dynamically populated with the returned model tags (e.g., `qwen2.5-coder:14b`, `deepseek-r1:8b`).
  * **AC 1.1.3**: If Ollama is not running, the UI displays a non-blocking subtle status icon: *"Ollama not detected"*, with a 1-click option to *"Retry Connection"* or *"Launch Ollama"*.

### US-1.2: Pulling Models from Command Palette (`Cmd+Shift+P`)
* **User Story**: As a developer, I want to pull any model tag from the Ollama library directly from the VS Code Command Palette without switching to a terminal, so that I can install and test new models seamlessly.
* **Acceptance Criteria**:
  * **AC 1.2.1**: Pressing `Cmd+Shift+P` (or `Ctrl+Shift+P`) and typing `CodeAlloy: Pull / Download Ollama Model` opens an input box with autocomplete for trending models (`qwen2.5-coder:7b`, `qwen2.5-coder:14b`, `deepseek-r1:14b`, `gemma2:9b`) and freeform text input.
  * **AC 1.2.2**: When a model is selected, CodeAlloy initiates a streaming POST request to `/api/pull`.
  * **AC 1.2.3**: Download progress percentage and layer status are displayed in the status bar with an active progress bar and an option to cancel.
  * **AC 1.2.4**: Upon completion, a notification appears: *"Model <tag> downloaded successfully"*, and the active model is optionally set to the new download.

### US-1.3: Hardware-Aware Welcome Screen Onboarding
* **User Story**: As a first-time user, I want the Welcome screen to examine my machine's RAM and VRAM to recommend the right model size, so that I don't accidentally pull a 70B model that freezes my 16GB laptop.
* **Acceptance Criteria**:
  * **AC 1.3.1**: On first launch, the Welcome Screen queries OS memory specs (e.g., `os.totalmem()` and GPU detection).
  * **AC 1.3.2**: Devices with $\le$ 16GB RAM are recommended 7B–9B models (e.g. `Qwen 2.5 Coder 7B`); devices with 32GB RAM are recommended 14B models; devices with 64GB+ or dedicated high-VRAM GPUs are recommended 32B+ models.
  * **AC 1.3.3**: The welcome screen provides a single primary button: **"Download Recommended Model"** which triggers the download in one click.

### US-1.4: Dynamic Model Fallback on OOM
* **User Story**: As a developer running local models, I want CodeAlloy to automatically fall back to a smaller backup model if a larger model triggers an Out-Of-Memory (OOM) error, so that my active agent turn doesn't crash.
* **Acceptance Criteria**:
  * **AC 1.4.1**: Users can configure a fallback precedence chain in settings (e.g., `qwen2.5-coder:32b` $\to$ `qwen2.5-coder:14b` $\to$ `qwen2.5-coder:7b`).
  * **AC 1.4.2**: If the backend returns a 500 error containing "out of memory" or context-length exhaustion, the agent logs a warning, falls back to the next model in the chain, and continues execution seamlessly.

---

## Epic 2: Autonomy Levels & Permissions Guardrails

### US-2.1: The Persistent Autonomy Dial
* **User Story**: As a developer, I want a visible autonomy selector in the agent sidebar and status bar, so that I can instantly switch between Assisted, Supervised, Guarded, and Full Autonomous modes with a single click.
* **Acceptance Criteria**:
  * **AC 2.1.1**: A segmented control with 5 levels (`L0: Assist`, `L1: Chat`, `L2: Supervised`, `L3: Guarded`, `L4: Autonomous`) is displayed at the top of the agent panel and in the bottom status bar.
  * **AC 2.1.2**: Switching levels updates the active session instantly without restarting the agent or clearing conversation context.

### US-2.2: Level 2 (Supervised) 1-Click Action Confirmations
* **User Story**: As a developer working on sensitive production code, I want the agent in Level 2 to present every proposed file write and terminal command for approval, so that I can review each change before disk modification.
* **Acceptance Criteria**:
  * **AC 2.2.1**: When the agent decides to invoke `write_to_file`, `replace_file_content`, or `run_command`, the execution pauses.
  * **AC 2.2.2**: The agent panel displays an interactive confirmation card with a side-by-side diff (for files) or command preview (for shell).
  * **AC 2.2.3**: Clicking **[Approve]** (`Enter`) executes the tool; clicking **[Reject]** (`Esc`) cancels the action and sends the user's rejection reason back to the agent.

### US-2.3: Level 3 (Guarded) Safe Workspace Auto-Execution
* **User Story**: As a developer developing a new feature, I want the agent to automatically write files and run safe commands within the workspace root without nagging me, but pause for dangerous operations, so that I can work fast with safety.
* **Acceptance Criteria**:
  * **AC 2.3.1**: File edits and reads within the workspace folder execute automatically without pausing.
  * **AC 2.3.2**: Commands matching a configurable dangerous blacklist (`rm -rf`, `sudo`, `git push --force`, `curl | bash`, or accessing paths outside workspace) trigger an explicit approval dialog.

### US-2.4: Level 4 (Autonomous) Goal Runner Loop
* **User Story**: As a developer, I want to assign a high-level goal to the agent (e.g., "Build unit tests for the auth module until 100% pass") and let it iterate autonomously with circuit breakers, so that I can delegate self-contained engineering tasks.
* **Acceptance Criteria**:
  * **AC 2.4.1**: The agent loops through: Plan $\to$ Edit $\to$ Run Test $\to$ Inspect Error $\to$ Self-Heal without human intervention.
  * **AC 2.4.2**: Execution stops when:
    1. The goal criteria are satisfied (tests pass, zero errors).
    2. A configurable maximum turn cap is reached (e.g., 25 turns).
    3. An identical error is repeated 3 times in a row (loop detector circuit breaker).
    4. The user clicks the prominent **[Stop Agent]** button.

---

## Epic 3: Shadow Git Checkpoints & Time-Travel Rollback

### US-3.1: Sub-5ms Atomic Pre-Turn Snapshots
* **User Story**: As a developer, I want CodeAlloy to automatically take a sub-5ms snapshot of my project before any agent turn executes, so that my codebase is protected without any noticeable latency.
* **Acceptance Criteria**:
  * **AC 3.1.1**: The engine initializes a headless Git store in `~/.codealloy/projects/<hash>/history.git`.
  * **AC 3.1.2**: Before executing any modifying tool in a turn, the engine executes `git write-tree` and `git commit-tree` pointing to the workspace directory.
  * **AC 3.1.3**: The operation completes in $< 10\text{ ms}$ and does not create, touch, or modify any `.git` folder in the user's workspace.

### US-3.2: 1-Click Turn Rollback
* **User Story**: As a developer, I want an **[Undo Turn]** button on every agent turn card, so that if the model's changes are undesirable, I can revert all touched files in one click.
* **Acceptance Criteria**:
  * **AC 3.2.1**: Clicking **[Undo Turn]** triggers `git checkout <pre-turn-tree-id> -- .` against the workspace.
  * **AC 3.2.2**: All modified, deleted, and newly created files for that turn are restored to their exact pre-turn state.
  * **AC 3.2.3**: The editor buffers refresh immediately, reflecting the rollback without requiring IDE restart.

### US-3.3: Historical Time-Travel Scrubber
* **User Story**: As a developer, I want to view a timeline of all previous turns in the current session and revert back 5 steps, so that I can recover from a compounding agent mistake.
* **Acceptance Criteria**:
  * **AC 3.3.1**: The history view lists each turn with timestamp, user prompt, and files modified.
  * **AC 3.3.2**: Clicking **"Revert to this point"** restores the entire workspace state to the beginning of that historical turn.

---

## Epic 4: Extension Ecosystem & Open VSX Marketplace

### US-4.1: Browsing and Installing Extensions via Open VSX
* **User Story**: As a developer switching from VS Code, I want to browse and install extensions (e.g. Python, Prettier, ESLint, Gruvbox) from Open VSX seamlessly, so that I have all my language tools and themes.
* **Acceptance Criteria**:
  * **AC 4.1.1**: The Extensions tab in CodeAlloy connects to `https://open-vsx.org/vscode/gallery`.
  * **AC 4.1.2**: Search, installation, enable/disable, and updates function identically to standard VS Code.

### US-4.2: Sideloading `.vsix` Packages
* **User Story**: As a developer with proprietary or offline extensions, I want to drag-and-drop a `.vsix` file into CodeAlloy, so that I can install non-marketplace extensions.
* **Acceptance Criteria**:
  * **AC 4.2.1**: Dragging a `.vsix` into the window or running `CodeAlloy --install-extension <path.vsix>` installs the extension cleanly.

---

## Epic 5: Code-OSS Workbench Customization & Inline Diffs

### US-5.1: Native Inline Multi-Line Streaming Diffs
* **User Story**: As a developer reviewing agent edits, I want the code modifications to stream directly inside the active editor buffer with red/green diff highlights, so that I can accept or reject chunks using keyboard shortcuts.
* **Acceptance Criteria**:
  * **AC 5.1.1**: When the agent modifies the active file, changes render inline with green addition and red deletion decorations.
  * **AC 5.1.2**: Pressing `Tab` accepts the current diff chunk; pressing `Esc` rejects the chunk; pressing `Cmd+Enter` accepts all chunks.

### US-5.2: Model Context Protocol (MCP) Integration
* **User Story**: As a developer, I want CodeAlloy to connect to MCP servers (e.g., PostgreSQL, GitHub, custom internal APIs), so that my local model can query external tools.
* **Acceptance Criteria**:
  * **AC 5.2.1**: CodeAlloy reads standard MCP configuration files (`mcp_config.json`).
  * **AC 5.2.2**: MCP tool schemas are passed to the active model and results are fed back into the agent context loop.

---

## Epic 6: Cross-Platform Packaging & Desktop Installers

### US-6.1: macOS Universal `.dmg` with Notarization
* **User Story**: As a macOS user, I want a standard `.dmg` installer that installs to `/Applications` without Gatekeeper warnings, so that setup is frictionless.
* **Acceptance Criteria**:
  * **AC 6.1.1**: Native Apple Silicon (`arm64`) and Intel (`x64`) `.dmg` files built via GitHub Actions runner.
  * **AC 6.1.2**: Signed with Apple Developer ID and notarized via Apple's `notarytool`.

### US-6.2: Windows Native `.exe` Installer
* **User Story**: As a Windows user, I want a standard Inno Setup / NSIS `.exe` installer with a clean uninstaller and right-click "Open with CodeAlloy" context menu, so that it behaves like a first-class Windows app.
* **Acceptance Criteria**:
  * **AC 6.2.1**: Executable installer with custom CodeAlloy icon, desktop shortcut option, and PATH registration.
  * **AC 6.2.2**: Code-signed with an EV certificate to prevent Windows Defender SmartScreen blocks.

### US-6.3: Linux Distributions (`.deb`, `.rpm`, `.AppImage`)
* **User Story**: As a Linux user, I want ready-to-run `.deb`, `.rpm`, and portable `.AppImage` packages, so that I can run CodeAlloy on Ubuntu, Fedora, or Arch Linux.
* **Acceptance Criteria**:
  * **AC 6.3.1**: Automated package generation with proper desktop entry (`codealloy.desktop`) and icon assets.
