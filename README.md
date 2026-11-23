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
  - **Total Context & Threshold Bar**: Visualizes current usage alongside the two DCP nudge thresholds and the model's OpenCode auto-compaction threshold when available.
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

### Reading the threshold bar

The bar uses one scale for both sets of markers: **threshold tokens divided by the total context window**. DCP and OpenCode calculate those token thresholds from different bases:

- **DCP** applies `minContextLimit` and `maxContextLimit` percentages to the model's total context limit (`limit.context`). The panel shows baseline nudge markers; it does not apply per-model overrides or the active-summary buffer that can raise DCP's upper nudge threshold.
- **OpenCode** subtracts the reserved space (`compaction.buffer` or the native default) from the effective input window: the smaller of `limit.input` and `limit.context` when both are set, or the available limit otherwise. The panel divides the resulting token threshold by the total context limit, not the input limit.

For example, with a **628,000-token** context window and a **500,000-token** input limit, a DCP baseline of `65%` marks **408,200 tokens**. A `15%` OpenCode buffer leaves **425,000 tokens** before auto-compaction: **85% of the input limit**, but **67.7% on the shared bar**.

### OpenCode auto-compaction

On OpenCode 2.3 and newer V2 releases, the extension reads the local OpenCode CLI's config layers and model limits for the session's directory. `compaction.buffer` can be a percentage or a token count. A percentage represents space kept free, not the used percentage at which compaction starts.

The line is separate from DCP and is not a provider hard limit. It is hidden when `compaction.auto` is off, the local data is unavailable, or the chart and local catalog disagree on the window. Settings available only on a different OpenCode server are not read by the local CLI. `compaction.keep.tokens` does not move the line.

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
| Legacy context window | Local OpenCode CLI `/api/model`, using the session's directory and `providerID/modelID` | Cached `10s` |
| OpenCode auto-compaction | Local OpenCode CLI `/api/config` and `/api/model` scoped to the session's directory, plus the server version from `/api/info` | Cached `10s` while polling |
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
