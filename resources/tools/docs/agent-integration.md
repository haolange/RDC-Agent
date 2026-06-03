# Agent Integration

Agents should call `rdx-tools` through their shell tool. The public entrypoints are:

- `rdx.bat`
- `bin/rdx`
- `python cli/run_cli.py`

Recommended probes:

```bat
rdx.bat --version
rdx.bat --json doctor
rdx.bat tools search pipeline --json
rdx.bat call rd.session.get_context --format json
```

For visible smoke, use bash so every CLI command and result appears in the agent terminal:

```bash
bash scripts/smoke_cli.sh
```

`rdx-tools` is CLI-only. Agents must not expect an MCP server, MCP transport, or built-in RDC ToolBridge MCP descriptor from this package.

