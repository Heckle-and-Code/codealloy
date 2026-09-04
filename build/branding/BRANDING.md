# CodeAlloy: Brand Identity & Theme Specification

> **"Where developer intent meets open models."**

---

## 🎨 Color Palette & Visual Philosophy

CodeAlloy's design balances the heat of the forge (developer creation) with the precision of tempered titanium and electric intelligence.

### 1. Brand Color Tokens

| Token | Hex | Role | Usage |
| :--- | :--- | :--- | :--- |
| `--alloy-core-primary` | `#FF7700` | Molten Amber (Hero) | Primary branding, buttons, active focus rings, agent thinking pulses. |
| `--alloy-core-highlight` | `#FFB703` | Radiant Gold | Secondary highlights, warnings, key badges. |
| `--alloy-intel-cyan` | `#00E5FF` | Electric Cyan | AI state active, model connection indicator, streaming status. |
| `--alloy-titanium-deep` | `#121316` | Deep Carbon Void | Window background, status bar, command palette backdrop. |
| `--alloy-titanium-card` | `#1C1E24` | Brushed Titanium | Sidebar background, modal cards, input containers. |
| `--alloy-titanium-border`| `#2C303B` | Tempered Seam | Panel dividers, subtle borders, inactive toggles. |
| `--alloy-forge-green` | `#10B981` | Quenched Emerald | Checkpoint saved, tests passing, rollback completed. |

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
