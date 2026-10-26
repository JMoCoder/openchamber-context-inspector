# Changelog

All notable changes to `openchamber-context-inspector` will be documented in this file.

## [1.1.2] - 2026-10-26

### Fixed
- Include cache writes in the cache hit rate denominator, matching OpenChamber's formula: `cache.read / (input + cache.read + cache.write)`.
- Show an em dash instead of a misleading 0% when no input usage is available.

### Changed
- Label the cache card as **Latest Cache Hit Rate**, explain its latest-record scope in Chinese and English, and display cache writes alongside reads. OpenChamber's official Usage Statistics remains a date-range/project aggregate and may show a different value.

### Added
- Dependency-free regression tests for cache writes, missing/zero usage, rounding, and exclusion of output/reasoning tokens.

## [1.1.1] - 2026-10-23

### Fixed
- Context window is resolved by the extension service via the local `opencode api`, the same catalog the official sidebar reads. `host.request` only proxies an extension integration and cannot see OpenCode models, which made every window show as unknown.

## [1.1.0] - 2026-10-23

### Changed
- Context window now comes from the live OpenCode model catalog (`GET /api/model` → `limit.context`), keyed by `providerID/modelID`.
- Catalog is cached for 10 seconds and refreshed immediately when the current model is missing, so provider limit edits and newly added models show up without a plugin change.
- Removed the model-name heuristic (`200000` / `gemini` / `grok`). An unresolved window is shown as unknown instead of a fabricated limit.

## [1.0.2] - 2026-10-21

### Changed
- Settings extension list name is now `Context Inspector` (English), matching official OpenChamber extensions.

## [1.0.1] - 2026-10-21

### Added
- Automatic UI locale detection (`payload.locale` from OpenChamber host handshake) supporting seamless switching between English and Chinese (`zh-CN` / `zh-TW`).
- Pure English `README.md` and `CHANGELOG.md` aligned with OpenChamber official extension repositories.

## [1.0.0] - 2026-10-21

### Added
- **Work Status Section (`statusSection`)**: Compact 6-category context breakdown with individual 4px horizontal meter bars, dynamically sorted from highest to lowest token footprint.
- **Full Inspector Panel (`panel`)**:
  - Top KPI cards for **Context Window Usage (`%`)** and **Prompt Cache Hit Rate (`%`)**.
  - **Total Context Bar** with three visual watermarks (`55%` soft nudge, `75%` DCP compression threshold, `85%` hard limit).
  - **DCP Compression Details** card displaying total compressed tokens, range blocks (`@b1@`), and auto-pruned tool outputs from `@tarquinen/opencode-dcp`.
  - **Disabled MCPs** card listing on-demand MCP servers with zero runtime token overhead.
  - **Foldable `MODULES` Tree** with group rails for conversation payloads, active MCP servers, and system/tool baseline.
- **High-Performance Local Service (`service`)**:
  - Built-in `node:sqlite` (`DatabaseSync`) read-only connection to `opencode.db` (~2ms query latency, zero external subprocesses).
  - Dual-channel MCP discovery combining live `/api/mcp` runtime states with hierarchical `opencode.json` configs.
  - 1-second live polling with DOM signature diffing to prevent flicker during user interaction.
