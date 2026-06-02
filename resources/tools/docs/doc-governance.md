# Documentation Governance

This package is CLI-only. Documentation must not describe an `rdx-tools` MCP server, MCP transport, or built-in RDC ToolBridge MCP descriptor.

Keep navigation links current and follow [../AGENTS.md](../AGENTS.md). User-facing docs should mention CLI commands, not Python bootstrap internals, except in maintainer sections.

Changes that touch `rd.session.open_preview` or preview geometry must keep `preview_geometry_smoke.py` and the user-facing preview documentation synchronized.