# CodeAlloy: Brand Identity & Theme Specification

> **"Where developer intent meets open models."**

---

## 🎨 The Blacksmith & Forge Philosophy

CodeAlloy's design is deeply rooted in the art of the **blacksmith**, the **anvil**, and the **furnace**:
* **The Anvil**: The unyielding foundation where raw ideas meet deliberate force. The anvil represents developer intent—solid, grounded, and directing the strike.
* **The Forging Hammer**: The active execution of tools and code synthesis. Each turn is a hammer strike on glowing steel.
* **The Molten Ingot & Alloys**: Two metals (developer craft + open model weights) folding and fusing under intense heat to create a resilient composite structure—stronger than pure carbon steel alone.
* **The Sparks & Embers**: The eruption of creative energy at the point of impact.

---

## 🎨 Color Palette & Forge Tokens

| Token | Hex | Role | Usage |
| :--- | :--- | :--- | :--- |
| `--alloy-forge-white-hot`| `#FFF5B8` | Incandescent Strike | Impact center, active highlight, maximum heat. |
| `--alloy-forge-amber` | `#FF8C00` | Molten Ingot | Primary branding, buttons, active focus rings, agent thinking pulses. |
| `--alloy-forge-ember` | `#D9381E` | Fiery Cinder | Warnings, destructive alerts, heat dissipation. |
| `--alloy-damascus-dark` | `#121316` | Wrought Iron Bed | Window background, status bar, command palette backdrop. |
| `--alloy-damascus-surface`| `#1C1E24` | Folded Steel Core | Sidebar background, modal cards, input containers. |
| `--alloy-damascus-border` | `#2C303B` | Hammered Seam | Panel dividers, subtle borders, inactive toggles. |
| `--alloy-quench-emerald` | `#10B981` | Tempered Steel | Checkpoint saved, tests passing, rollback completed. |

---

## 🛡️ Assets

* **App Icon**: `build/branding/icon.png` (Square app badge with Damascus pattern, heavy blacksmith anvil, hammer strike, and incandescent code ingot).
* **Cinematic Showcase**: `build/branding/forge_banner.png` (Full forge environment with glowing anvil and gear crest).
* **Vector Mark**: `build/branding/logo.svg` (Clean scalable SVG for headers, Welcome screen, and splash).

---

## 💻 Default Editor Theme: Monokai Alloy

While users can install any theme from Open VSX, CodeAlloy defaults to **Monokai Alloy**—a refined, high-contrast palette inspired by Monokai Pro that harmonizes with our titanium and molten orange shell.

```json
{
  "name": "Monokai Alloy",
  "type": "dark",
  "colors": {
    "editor.background": "#1E1F24",
    "editor.foreground": "#FCFCFA",
    "activityBar.background": "#16171B",
    "activityBar.foreground": "#FF9E00",
    "sideBar.background": "#191A20",
    "sideBar.border": "#282A33",
    "statusBar.background": "#121316",
    "statusBar.foreground": "#A0A5B5",
    "titleBar.activeBackground": "#121316",
    "titleBar.activeForeground": "#E2E4EB"
  },
  "tokenColors": [
    { "scope": "keyword", "settings": { "foreground": "#FF6188" } },
    { "scope": "entity.name.function", "settings": { "foreground": "#A9DC76" } },
    { "scope": "string", "settings": { "foreground": "#FFD866" } },
    { "scope": "variable", "settings": { "foreground": "#FCFCFA" } },
    { "scope": "entity.name.type", "settings": { "foreground": "#78DCE8" } },
    { "scope": "constant.numeric", "settings": { "foreground": "#AB9DF2" } },
    { "scope": "comment", "settings": { "foreground": "#727072", "fontStyle": "italic" } }
  ]
}
```

---

## 🛡️ Logo & Assets

* **App Icon**: `build/branding/icon.png` (High-res rendered badge with interlocking titanium A/C structure and illuminated molten core).
* **Vector Mark**: `build/branding/logo.svg` (Scalable vector for headers, Welcome screen, and splash).
