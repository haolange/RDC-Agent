# Spec-Driven Development

This document defines the current engineering contract for Debugger work that spans workflow, trace, RDX CLI invocation, settings, and renderer projection.

## Success Criteria

Every change must define verification before implementation. Prefer:

1. Automated tests or smoke tests.
2. Typecheck, build, architecture, fidelity, and shared export checks.
3. A precise manual checklist only when automation cannot observe the behavior.

## Runtime Contract

RDX tool execution is not a bundled bridge. The current forward path is:

`workflow/runtime -> RdxCliInvokerService -> ShellInvocationService -> configured CLI command`

The invoker reads `settings.tooling.rdxCli`:

- `enabled`
- `command`
- `argsPrefix`
- `workingDirectory`
- `env`
- `timeoutMs`
- `catalogPath`
- `jsonMode`

If the invoker is disabled or incomplete, execution fails closed with an explicit diagnostic. There is no repository-path fallback.

## Catalog Contract

The tool catalog is loaded from the configured `catalogPath`. Catalog metadata is exposed through `tool:getCatalog` and `tool:getRuntimeSummary`.

Renderer code can display catalog/runtime status, but it cannot invoke arbitrary tools.

## Trace Contract

Debugger and conversation state are projected through Agentic Trace. The renderer-facing APIs are under `trace:*`, and right-panel records use `traceLaneId`.

Trace export and branch switching belong to `trace:exportSession` and `trace:switchBranch`.

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
| Shared type or settings schema | `npm run typecheck`, `npm run check:shared-exports` |
| Renderer structure or anchors | `npm run typecheck`, `npm run check:architecture`, `npm run check:fidelity` |
| Main IPC or invocation boundary | `npm run typecheck`, `npm run build`, shell smoke when available |
| RDX CLI catalog/tooling config | `npm run typecheck`, catalog/runtime summary smoke |
| Settings Agents routing | `npm run test:settings-agents` |
| Product browser flow with real local inputs | `npm run test:product-smoke` with `RDC_AGENT_PRODUCT_SMOKE_PROJECT_ROOT` and `RDC_AGENT_PRODUCT_SMOKE_RDC_PATH` |
| Documentation only | Path and terminology scan |

## Cleanup Rules

- Do not keep parallel names for the same concept.
- Do not reintroduce hidden bridge, MCP, or skill-based RDX tool defaults.
- Do not bundle a local tool copy as the default execution path.
- Do not expose generic execution from renderer/preload.
- Do not keep stale docs that point to removed files or old IPC names.
- Do not commit mojibake or unreadable encoded text; restore readable UTF-8 before merging.
