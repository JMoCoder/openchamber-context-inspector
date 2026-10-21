# Changelog

All notable changes to `openchamber-context-inspector` will be documented in this file.

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
