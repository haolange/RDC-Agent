# Architecture Overview

RDC-Agent is an Electron desktop workbench for RenderDoc `.rdc` captures. The application is split into four code layers:

- `src/main`: Electron shell, IPC handlers, workflow orchestration, settings, workspace storage, reports, evidence, trace, and external capability invocation.
- `src/preload`: the controlled `window.electronAPI` bridge exposed to renderer code.
- `src/renderer`: React UI, interaction state, browser-session bridge, and workbench presentation.
- `src/shared`: cross-layer types, constants, and pure helpers.

## Main Data Flow

```mermaid
flowchart LR
  Renderer["Renderer UI"] --> Preload["Preload API"]
  Preload --> IPC["IPC handlers"]
  IPC --> Runtime["Agent / session services"]
  Runtime --> Trace["Agentic Trace"]
  Runtime --> Settings["SettingsService"]
  Runtime --> Actions["RDX shell actions"]
  Actions --> Shell["ShellInvocationService"]
  Shell --> CLI["System-installed RDX CLI"]
  Trace --> Renderer
```

The RDX CLI command is not hardcoded or bundled. System-installed CLI commands, action arguments, working directory, environment variables, timeout, and catalog path are Settings data.

## Public Boundaries

- Renderer/preload can read catalog and runtime status through IPC.
- Renderer/preload do not expose arbitrary tool execution.
- RDX vertical entries call configured shell actions through `ShellInvocationService`; agents use allowed shell access and read stable runtime context through `rdxContext`.
- Agentic Trace exposes projection APIs under `trace:*`.
- Debugger workflow actions remain under `workflow:*`.

## Verification

Use `pnpm run typecheck` for static validation. For renderer or IPC changes, also run `pnpm run check:architecture`, `pnpm run check:fidelity`, and `pnpm run check:shared-exports`. For shell/window/local invocation boundaries, build first and then run the relevant smoke test.

Source development uses pnpm `11.7.0` with a per-user store under `~/.cache/rdc-agent`; every human/browser and production/development source entry reaches the shared launcher. Dependency and build fingerprints avoid repeated preparation while preserving a `--force-prepare` recovery path. Packaged applications contain compiled runtime inputs only and never depend on the source package manager or launcher.
