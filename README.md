# Context Inspector for OpenChamber

Cursor-style fine-grained context window inspector for **OpenChamber** and **OpenCode**.

See exactly where your context budget goes in real time: **MCP server schemas & instructions**, **native tools**, **registered skills (`<available_skills>`)**, **system harness & `AGENTS.md` rules**, **DCP dynamic context pruning records**, and **session conversation/tool payloads**.

---

## Features

- **Work Status Section**:
  - Embedded directly into OpenChamber's right-hand Work Status sidebar beneath `Resources`.
  - 6 individual meter bars (`Tool Payloads`, `MCP Tools`, `Native Tools`, `Skills`, `System & Rules`, `Conversation`), dynamically sorted from highest to lowest token footprint every second.
  - Click any row to open the full Context Inspector drawer panel.
- **Full Inspector Panel**:
  - **Top KPI Cards**: Context window usage percentage (`%` + total/limit + empty-session baseline) and Prompt Cache hit rate (`%` + cached read / incremental input / output tokens).
  - **Total Context & Threshold Bar**: Visualizes current usage against 3 configurable DCP / system watermarks (`55%` soft nudge, `75%` compress trigger, `85%` hard limit).
  - **DCP Compression Details**: Live readout from `@tarquinen/opencode-dcp` storage (`~/.local/share/opencode/storage/plugin/dcp/<sessionId>.json`), showing total compressed tokens, active `@b1@` range blocks (`before → after`), and auto-pruned tool outputs.
  - **Context Breakdown Card**: Individual horizontal meter bars matching the Work Status style.
  - **Disabled MCPs**: Card view of on-demand MCP servers currently disabled (zero token cost).
  - **Foldable Module Tree (`MODULES`)**: Collapsible rail groups for `Conversation Payloads`, `MCP Servers`, and `System & Baseline`.
- **Automatic UI Language Switching**:
  - Automatically adapts between **English** and **Chinese (`zh-CN` / `zh-TW`)** based on OpenChamber's active UI locale (`payload.locale`).
- **1-Second Zero-Overhead Live Refresh**:
  - Powered by Node's built-in `node:sqlite` (`DatabaseSync`) read-only connection and OpenChamber's live `/api/mcp` bridge.
  - Requires **zero external dependencies** (`node_modules` free) and **zero shell/subprocess permissions**.

---

## Install

In OpenChamber:

1. Open **Settings → Extensions** (or **Integrations**).
2. Paste this repository's Git URL:
   ```text
   https://github.com/JMoCoder/openchamber-context-inspector
   ```
3. Approve the local `service` capability when prompted.

Works on **Linux, macOS, and Windows** (OpenChamber Desktop & Web `>= 2.0.0`).

---

## How It Works

| Data Source | Path / Endpoint | Refresh Rate |
| :--- | :--- | :--- |
| Live MCP Status | OpenCode `/api/mcp` via `host.request` + merged `opencode.json` files | Every `1s` |
| Session Token Ledger | `~/.local/share/opencode/opencode.db` (`session_v2`, `session_message`) via `node:sqlite` | Every `1s` |
| DCP Compression State | `~/.config/opencode/dcp.jsonc` + `~/.local/share/opencode/storage/plugin/dcp/<sid>.json` | Every `1s` |
| Skills & Rules | `~/.agents/skills/*/SKILL.md` + `~/.config/opencode/AGENTS.md` + project `AGENTS.md` | Cached `5s` |

---

## Project Structure

```text
openchamber-context-inspector/
├── package.json         # OpenChamber Guest SDK manifest (apiVersion: 1)
├── panel/
│   ├── index.html       # Drawer panel styles & container
│   └── main.js          # Drawer panel renderer & 1s live polling
├── status/
│   ├── index.html       # Work Status section container
│   └── main.js          # Compact 6-bar sorted status renderer
├── service/
│   └── main.js          # Host service (node:sqlite + MCP/Skill/DCP inspector)
├── CHANGELOG.md
├── LICENSE              # MIT
└── README.md
```

---

## License

[MIT](./LICENSE)
