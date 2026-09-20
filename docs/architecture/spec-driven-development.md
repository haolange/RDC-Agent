# Spec-Driven Development

This document defines the current engineering contract for Debugger work that spans workflow, trace, RDC-Tool CLI invocation, settings, and renderer projection.

## Success Criteria

Every change must define verification before implementation. Prefer:

1. Automated tests or smoke tests.
2. Typecheck, build, architecture, fidelity, and shared export checks.
3. A precise manual checklist only when automation cannot observe the behavior.

## Runtime Contract

RDC tool execution is not a bundled bridge or repository resource. The current forward path is:

`UI/agent -> fixed session boundary or shell -> ShellInvocationService -> system-installed CLI -> canonical JSON runtime context`

Catalog/runtime summary configuration reads `settings.tooling.rdcCli`:

- `enabled`
- `command`
- `argsPrefix`
- `workingDirectory`
- `env`
- `timeoutMs`
  - catalog is discovered from the configured CLI with `tools list --full`

Open `.rdc`, connect remote, preview, and close runtime use fixed native RDC operations through the owning session context. CLI installation settings remain configurable; lifecycle command templates are not settings. If the CLI configuration is disabled or incomplete, execution fails closed with an explicit diagnostic.

## Catalog Contract

The tool catalog is loaded from the same configured CLI using `tools list --full`; catalog metadata is exposed through `tool:getCatalog` and `tool:getRuntimeSummary`.

Workbench right rail must **not** render a per-tool `rd.*` inventory, CLI catalog summary, tool count, or namespace counts. The session Capture area consumes the owner-session opened-capture and runtime context snapshot for `.rdc` selection, open/preview state, Replay Device, compact diagnostics, and Copy. contextId/replaySessionId/capture ids, lease/runtime owner, remoteId, and remote status remain owner-scoped agent data. Renderer code cannot invoke arbitrary tools; execution stays on Settings shell actions / shell -> `ShellInvocationService` -> external CLI.

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
| RDC shell action config | `pnpm run typecheck`, scoped open/preview smoke when available |
| Settings Agents routing | `pnpm run check:settings-agents` |
| Product browser flow with real local inputs | `pnpm run start:agent-browser`, then inspect `/app` in the Codex in-app browser with real project and `.rdc` inputs |
| Documentation only | Path and terminology scan |

## Cleanup Rules

- Do not keep parallel names for the same concept.
- Do not reintroduce hidden bridge, MCP, or skill-based RDC tool defaults.
- Do not keep or bundle a local RDC tool copy in the repository.
- Do not expose generic execution from renderer/preload.
- Do not keep stale docs that point to removed files or old IPC names.
- Do not commit mojibake or unreadable encoded text; restore readable UTF-8 before merging.

## Right Rail projection

Workbench Right Rail has two target-specific forms: a selected Project shows only `Import .rdc` and project inputs; a selected Session shows `Progress / Artifacts / Outputs / Context / Capture`, with Capture always visible. Artifacts project only main-owned Investigation records; Outputs still require explicit `output_register`. It must not render a per-tool `rd.*` inventory, standalone Memory panel, duplicate Skills catalog, CLI catalog summary, tool count, or namespace counts. Context only presents real task resources: attachments, references, tools, and used capabilities. Capture presents an honest empty state when no project input exists; otherwise it presents owner-session `.rdc` selection/open/preview/refresh/copy/clear and Replay Device. contextId/replaySessionId/capture ids, lease/runtime owner, and remoteId/remote status remain owner-scoped runtime data for agent consumption rather than visible inventory. Diagnostics stay deduplicated and actionable. CLI unavailable is only a diagnostic for failed open/preview shell actions; the sidebar does not expose CLI catalog metadata. Renderer code cannot invoke arbitrary tools or reconstruct runtime state; execution stays on Settings shell actions / shell -> `ShellInvocationService` -> external CLI. Attachments and uploads are Task Context inputs; Outputs require explicit `output_register` publication of a completed project file into the owning run and use only user-facing source labels.
