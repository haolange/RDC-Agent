# rdx-tools

`rdx-tools` is a CLI-only RenderDoc `.rdc` runtime package. It exposes 200 `rd.*` tools through `rdx.bat`, `bin/rdx`, or `python cli/run_cli.py`; it no longer ships an MCP server, MCP transport, or built-in RDC ToolBridge MCP descriptor.

## Entry Points

```bat
rdx.bat --json doctor
rdx.bat tools list --json
rdx.bat capture open --file "C:\path\capture.rdc" --frame-index 0
rdx.bat call rd.session.get_context --format json
```

```bash
bash resources/tools/bin/rdx --json doctor
```

`--non-interactive` is a launcher flag only. `rdx.bat --non-interactive --json doctor` runs the same CLI. `rdx.bat --non-interactive mcp --ensure-env` is intentionally unsupported and returns non-zero JSON.

## Smoke

Agent platforms should run smoke through bash so every CLI step is visible in the terminal:

```bash
bash scripts/smoke_cli.sh --skip-rdc
bash scripts/smoke_cli.sh --rdc "C:/path/sample.rdc" --context cli-smoke
```

The smoke script calls `bin/rdx` directly for `doctor`, `tools list`, `tools search`, the negative MCP route check, and the daemon-backed capture chain. It writes the same live output to `intermediate/logs/smoke_cli.log`. It does not run a Python smoke runner or a Python command aggregator.

## Session State

Use `rd.session.get_context` to read context state and `rd.session.update_context` to update notes, focus, and agent-visible metadata. The state includes `session_locator`, current capture/session IDs, preview state, and remote lifecycle fields. `remote_handle_consumed` means a remote handle has been bound to a replay session and must not be reused as a free remote connection.

## Preview CLI Contract

`rd.session.open_preview` is still a daemon-backed CLI operation. `rd.session.get_context.preview` reports preview state and `preview.display`; the preview surface should expose the complete framebuffer（完整 framebuffer）instead of cropping viewport / scissor state.

## Docs

- [Session model](docs/session-model.md)
- [Agent model](docs/agent-model.md)
- [Documentation governance](docs/doc-governance.md)
- [Tools](docs/tools.md)
- [Scripts](scripts/README.md)
