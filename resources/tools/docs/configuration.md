# Configuration

Set `RDX_TOOLS_ROOT` when launching from another directory. Set `RDX_PYTHON` to override Python selection; otherwise the Windows launcher prefers the bundled Python runtime and `bin/rdx` prefers `RDX_PYTHON`, bundled Windows Python, then `python3` or `python`.

Runtime artifacts live under `intermediate/runtime`, `intermediate/artifacts`, and `intermediate/logs`.

## preview 运行约束

Preview uses `screen_cap_ratio` to keep the preview window bounded while preserving framebuffer geometry.