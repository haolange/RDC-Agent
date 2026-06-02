# Tools

`spec/tool_catalog.json` defines 200 `rd.*` tools. The public transport is CLI; raw tool calls use `rdx.bat call <rd.*>` or `python cli/run_cli.py call <rd.*>`.

```bat
rdx.bat tools list --json
rdx.bat tools search texture --json
rdx.bat call rd.session.get_context --format json
```

Session tools are described in [session-model.md](session-model.md). Agent usage rules are described in [agent-model.md](agent-model.md).

`rd.session.open_preview` opens the preview window through the daemon-backed CLI runtime. `preview.display` is returned from context/session state for geometry inspection.