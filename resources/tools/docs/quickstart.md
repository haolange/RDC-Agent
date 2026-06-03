# Quickstart

Run all commands from `resources/tools`, or set `RDX_TOOLS_ROOT` when using `bin/rdx` from another directory.

```bat
rdx.bat --version
rdx.bat version --json
rdx.bat --json doctor
rdx.bat tools search pipeline --json
rdx.bat capture open --file "C:\path\sample.rdc" --frame-index 0
rdx.bat call rd.session.get_context --format json
rdx.bat call rd.session.update_context --args-json "{\"key\":\"notes\",\"value\":\"triaged\"}" --format json
rdx.bat completion powershell
```

For preview checks after a capture is open:

```bat
rdx.bat session preview on
rdx.bat session preview status
rdx.bat session preview off
```

Inspect `preview.display` in JSON output for framebuffer, window, and fit geometry. Use `context clear` and `daemon stop` at the end of smoke runs.

For agent-visible smoke, run the bash entrypoint instead of a Python smoke runner:

```bash
bash scripts/smoke_cli.sh
bash scripts/smoke_cli.sh --skip-rdc
bash scripts/smoke_cli.sh --rdc "C:/path/sample.rdc" --context cli-smoke
```

The script prints each CLI command before executing it and mirrors output to `intermediate/logs/smoke_cli.log`. Without `--rdc`, it uses the first `tests/fixtures/*.rdc` fixture when one exists. If a daemon-backed command times out, it prints the failed command, daemon status, known context state fields, and cleanup results.

Remote-only smoke still uses CLI transport. Watch for `remote_handle_consumed` after `rd.capture.open_replay` binds a remote handle to a session.
