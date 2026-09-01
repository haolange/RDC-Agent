---
name: rdx-cli-shell
description: Invoke RenderDoc or RDX only through the Settings-configured CLI shell action.
allowed-tools: [shell, rdx_context]
---

# RDX CLI Shell

Use this skill when a planned step needs a RenderDoc or RDX capability that already exists as a configured CLI action.

1. Read live context with `rdx_context`. Confirm the Settings RDX shell action is configured.
2. Invoke that action through `shell` / `ShellInvocationService`. Discover flags with the configured binary's `--help` when needed.
3. Keep live capture, shader replace, and replay exclusive. Do not place them in a concurrent tool group.
4. Record only the resulting facts through investigation tools after the command finishes.

Do not hardcode `renderdoccmd`, `qrenderdoc`, install paths, catalog paths, or env fallbacks. Do not invent RDX MCP tools or expand the CLI catalog into model tool schemas. Unconfigured CLI is a fail-closed diagnosis, not a guessed command.
