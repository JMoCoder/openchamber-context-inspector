# Changelog

All notable changes to `openchamber-context-inspector` will be documented in this file.

## [1.0.0] - 2026-10-21

### Added
- **Work Status Section (`statusSection`)**: Compact 6-category context breakdown (`工具载荷`, `MCP 工具`, `原生工具`, `Skills 清单`, `系统与规约`, `对话消息`) with individual 4px horizontal meter bars, dynamically sorted from highest to lowest token footprint.
- **Full Inspector Panel (`panel`)**:
  - Top KPI cards for **Context Window Usage (`%`)** and **Prompt Cache Hit Rate (`%`)**.
  - **Total Context Bar** with three visual watermarks (`55%` soft nudge, `75%` DCP compression threshold, `85%` hard limit).
  - **DCP Compression Details (`压缩详情`)** card displaying total compressed tokens (`已压缩`), range blocks (`@b1@`), and auto-pruned tool outputs from `@tarquinen/opencode-dcp`.
  - **Disabled MCPs (`已停用 MCP`)** card listing on-demand MCP servers with zero runtime token overhead.
  - **Foldable `MODULES` Tree** with group rails for conversation payloads, active MCP servers, and system/tool baseline.
- **High-Performance Local Service (`service`)**:
  - Built-in `node:sqlite` (`DatabaseSync`) read-only connection to `opencode.db` (~2ms query latency, zero external subprocesses).
  - Dual-channel MCP discovery combining live `/api/mcp` runtime states with hierarchical `opencode.json` configs.
  - 1-second live polling with DOM signature diffing to prevent flicker during user interaction.
