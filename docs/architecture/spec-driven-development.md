# Spec-Driven Development

This document defines the current engineering contract for Debugger work that spans workflow, trace, RDX CLI invocation, settings, and renderer projection.

## Success Criteria

Every change must define verification before implementation. Prefer:

1. Automated tests or smoke tests.
2. Typecheck, build, architecture, fidelity, and shared export checks.
3. A precise manual checklist only when automation cannot observe the behavior.

## Runtime Contract

RDX tool execution is not a bundled bridge or repository resource. The current forward path is:

`UI/agent -> Settings shell action or bash -> ShellInvocationService -> system-installed CLI -> JSON runtime context`

Catalog/runtime summary configuration reads `settings.tooling.rdxCli`:

- `enabled`
- `command`
- `argsPrefix`
- `workingDirectory`
- `env`
- `timeoutMs`
- `catalogPath`
- `jsonMode`

Open `.rdc` (`openCapture` / `openRemoteCapture`), connect remote, preview, and close runtime read `settings.tooling.rdxActions`. If the CLI/action configuration is disabled or incomplete, execution fails closed with an explicit diagnostic. There is no repository-path fallback.

## Catalog Contract

The tool catalog is loaded from the configured `catalogPath`. Catalog metadata is exposed through `tool:getCatalog` and `tool:getRuntimeSummary`.

Workbench right rail must **not** render a per-tool `rd.*` inventory. RDX capability status in UI comes from `tool:getRuntimeSummary` (CLI available / source / command / catalog present / namespace counts). Skills and Artifacts remain separate session panels. Renderer code cannot invoke arbitrary tools; execution stays on Settings shell actions / bash → `ShellInvocationService` → external CLI.

## Trace Contract

Debugger and conversation state are projected through Agentic Trace. The renderer-facing APIs are under `trace:*`, and right-panel records use `traceLaneId`.

Trace run export and branch switching belong to `trace:exportRun` and `trace:switchBranch`.

## Settings Contract

Any new CLI setting must be wired through:

- `src/shared/types/settings.ts`
- `src/main/settings/SettingsService.ts`
- Settings modal state/actions/UI
- Architecture and AGENTS documentation

Do not add call-site constants for commands, catalog paths, or environment variables.

## Verification Matrix

| Change type | Required verification |
| --- | --- |
| Shared type or settings schema | `pnpm run typecheck`, `pnpm run check:shared-exports` |
| Renderer structure or anchors | `pnpm run typecheck`, `pnpm run check:architecture`, `pnpm run check:fidelity` |
| Main IPC or invocation boundary | `pnpm run typecheck`, `pnpm run build`, shell smoke when available |
| RDX CLI catalog/tooling config | `pnpm run typecheck`, catalog/runtime summary smoke |
| Settings Agents routing | `pnpm run check:settings-agents` |
| Product browser flow with real local inputs | `pnpm run start:agent-browser`, then inspect `/app` in the Codex in-app browser with real project and `.rdc` inputs |
| Documentation only | Path and terminology scan |

## Cleanup Rules

- Do not keep parallel names for the same concept.
- Do not reintroduce hidden bridge, MCP, or skill-based RDX tool defaults.
- Do not keep or bundle a local RDX tool copy in the repository.
- Do not expose generic execution from renderer/preload.
- Do not keep stale docs that point to removed files or old IPC names.
- Do not commit mojibake or unreadable encoded text; restore readable UTF-8 before merging.
