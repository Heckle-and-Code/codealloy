# The 5-Tier Autonomy Dial

You should always be in full control of your AI assistant. CodeAlloy features a 5-tier autonomy dial accessible directly in the Agent panel and bottom status bar:

---

### Autonomy Levels:
- **L0: Assist** — Passive autocomplete & ghost text. The model never touches disk or executes commands.
- **L1: Chat** — Interactive sidebar Q&A and architecture discussions. Zero disk writes.
- **L2: Supervised (Default)** — Interactive approvals. Before any file write or command executes, CodeAlloy presents side-by-side diff previews for your review (`Enter` to approve, `Esc` to reject).
- **L3: Guarded** — Autonomous multi-file project edits within workspace boundaries. Dangerous operations (`rm -rf`, `sudo`, `git push --force`) still require explicit confirmation.
- **L4: Autonomous** — Continuous goal runner with built-in loop detection circuit breakers.

---

### Shadow Git Safety Net:
No matter which autonomy level you choose, CodeAlloy automatically takes sub-5ms isolated Git checkpoints before every agent turn. If an edit ever goes wrong, click **[Undo Turn]** to restore your workspace instantly!

---

[Switch Autonomy Level](command:codealloy.selectAutonomy)
[Open Forge Agent](command:codealloy.focusChat)
