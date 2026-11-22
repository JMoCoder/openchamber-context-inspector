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
  - **Top KPI Cards**: Context window usage percentage (`%` + limit / remaining + baseline / dynamic tokens) and Latest Cache Hit Rate (`%` + cache read / cache write / incremental input / output tokens).
  - **Total Context & Threshold Bar**: Visualizes current usage against 3 configurable DCP / system watermarks (`55%` soft nudge, `75%` compress trigger, `85%` hard limit).
  - **DCP Compression Details**: Live readout from `@tarquinen/opencode-dcp` storage (`~/.local/share/opencode/storage/plugin/dcp/<sessionId>.json`), showing total compressed tokens, active `@b1@` range blocks (`before → after`), and auto-pruned tool outputs.
  - **Context Breakdown Card**: Individual horizontal meter bars matching the Work Status style.
  - **Disabled MCPs**: Card view of on-demand MCP servers currently disabled (zero token cost).
  - **Foldable Module Tree (`MODULES`)**: Collapsible rail groups for `Conversation Payloads`, `MCP Servers`, and `System & Baseline`.
- **Automatic UI Language Switching**:
  - Automatically adapts between **English** and **Chinese (`zh-CN` / `zh-TW`)** based on OpenChamber's active UI locale (`payload.locale`).
- **Live Refresh**:
  - Powered by Node's built-in `node:sqlite` (`DatabaseSync`) read-only connection and OpenChamber's live `/api/mcp` bridge.
  - Requires **zero external dependencies** (`node_modules` free). The local service can invoke the installed OpenCode CLI for its model catalog.

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

### Context window

On OpenChamber 2.8.0 and newer, the panel's Context Window card and Total Context bar use the host's latest measured window, including the limit of the model that produced that step. An unmeasured window (such as after compaction) stays unmeasured until the next recorded step. A measurement with an unknown limit still shows the token count, without a percentage or remaining capacity.

Older hosts that omit the measurement use the existing local OpenCode database and model-catalog fallback. The six-category breakdown, baseline and dynamic estimates, DCP details, and latest-step cache card keep their existing local sources, so the breakdown and host window need not total the same value.

### Cache hit rate

The cache card uses the latest assistant record with input usage in the current session, not a session-wide aggregate. It follows OpenChamber's input-token formula:

```text
cache.read / (input + cache.read + cache.write) × 100%
```

`input` is uncached input. Output and reasoning tokens are excluded. With no input usage the rate is shown as `—`. OpenChamber's official Usage Statistics applies this formula to cumulative tokens within the selected date range and project, so the two cards need not match even after this fix. If cache writes are zero, this correction alone does not lower the previous rate.

| Data Source | Path / Endpoint | Refresh Rate |
| :--- | :--- | :--- |
| Live MCP Status | OpenCode `/api/mcp` via `host.request` + merged `opencode.json` files | Every `1s` |
| Session Token Ledger | `~/.local/share/opencode/opencode.db` (`session_v2`, `session_message`) via `node:sqlite` | Every `1s` |
| Host context window | OpenChamber extension bridge `ready.session.context` / `session.context` | When the host publishes a reading |
| Legacy context window | The extension service calls `opencode api get /api/model` and reads `limit.context` for `providerID/modelID`. Cached 10s; refreshed at once if the current model is missing. The panel does not use `host.request` for this: that channel only proxies an extension's declared external API | With each inspect |
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
├── shared/
│   ├── model-limits.mjs # Catalog index and context-limit lookup
│   ├── limits.test.mjs  # Lookup tests
│   ├── cache-usage.mjs  # Official input-token cache ratio (latest record)
│   └── cache-usage.test.mjs # Cache ratio regression tests
├── service/
│   └── main.js          # Host service (node:sqlite + MCP/Skill/DCP inspector)
├── CHANGELOG.md
├── LICENSE              # MIT
└── README.md
```

---

## License

[MIT](./LICENSE)
