# scripts

`resources/tools/scripts` contains reusable smoke and release checks for the CLI-only package.

Common checks:

```bat
python scripts/check_markdown_health.py
python scripts/release_gate.py --require-smoke-reports
```

Smoke checks should be run through bash so every CLI call is visible to the agent terminal:

```bash
bash scripts/smoke_cli.sh --skip-rdc
bash scripts/smoke_cli.sh --rdc "C:/path/sample.rdc" --context cli-smoke
```

`smoke_cli.sh` directly invokes `bin/rdx` for `doctor`, tool discovery, the negative MCP route check, and the capture/session chain. It does not delegate command orchestration to Python. The release gate checks `intermediate/logs/smoke_cli.log` only when smoke reports are required.

`preview_geometry_smoke.py` validates preview window geometry and should stay aligned with CLI preview behavior.
