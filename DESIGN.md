# RDC-Agent Design and Architecture Guide

`DESIGN.md` is the authority for product boundary, runtime architecture, UI standards, and verification gates in this repository. If `README.md`, `AGENTS.md`, or `docs/architecture/*` conflict with this file, update the other document and keep this file as the source of truth.

## Product Boundary

RDC-Agent is a general agent workbench with first-class RDC/RDX and RenderDoc `.rdc` capabilities. It must feel useful as a normal agent workbench for reading, planning, editing, searching, tool use, handoff, memory, and subagent orchestration, while retaining specialist workflows for capture opening, replay context, RDX actions, diagnostics, and RenderDoc investigation.

The product is not a fixed-mode wizard. Ask, Plan, Edit, Debugger, Analyzer, and Optimizer are agent profiles with different instructions, tools, approval policy, handoffs, and visibility. A profile may appear in the composer orchestrator menu only when it is user-invocable. Plan is not a hardcoded `AppMode`; it emerges from a `.agent.md` profile that can research, ask the user, write plan artifacts, call allowed subagents, and hand off implementation.

## Runtime Boundary

The only agent runtime path is the agent loop:

1. resolve profile, model route, policy, and available tools;
2. call the LLM;
3. execute approved tools;
4. feed tool results back into the loop;
5. produce a final answer.

Renderer code must not create fake reasoning stages. Runtime events project into `ConversationWorkTrace`, not visible chain-of-thought. Hidden CoT is never displayed or persisted as UI content.

`ConversationWorkTrace` is the visible progress contract. Blocks may be:

- `reasoning`: short visible summaries only;
- `tool`: tool call and result summaries;
- `approval`: permission requests and decisions;
- `compaction`: context compaction summaries;
- `subagent`: delegated agent activity;
- `handoff`: next-agent or next-action handoffs;
- `diagnostic`: provider, route, runtime, or RDX diagnostics;
- `output`: final answer preparation.

Historical `reasoningTrace` data may be read by a one-time migration or renderer compatibility adapter so old sessions remain viewable. New runtime code and visible UI must write and render `workTrace`.

## Profiles

Profiles are `.agent.md` files in workspace user space. Source defaults may seed missing profiles, but user-space profiles are the editable truth for the current device/workspace.

Required baseline profiles:

- Ask: read-only clarification, project search, web lookup, and guidance.
- Plan: research, questions, subagent exploration, memory/plan artifact writing, and implementation handoff without direct mutation.
- Edit: ordinary implementation work with read/search/web/bash/write/edit/task/memory/agent capabilities governed by approval policy.
- Debugger: RDC/RDX and RenderDoc investigation.
- Analyzer: evidence analysis, triage, and reportable findings.
- Optimizer: bottleneck analysis, optimization ordering, and validation.

Do not add mode-specific runtime branches when profile instructions, tool permissions, approval policy, or handoffs can express the behavior.

## Tool and Command Catalog

Tools must be declared with name, permission level, input schema, result summary, UI icon, and approval requirement. The canonical catalog covers:

- file and search: `read_file`, `glob`, `grep`;
- web: `web_fetch`, `web_search`;
- execution and mutation: `bash`, `write_file`, `edit_file`;
- workflow: `askUser`, `todo`, `task_*`, `agent`, `handoff`;
- context: `memory`, `skills`, `MCP`;
- RDC/RDX: capture context, open/preview/close, remote connection, and RDX shell actions.

Slash commands are runtime inputs, not bypasses around profile permission. Baseline commands are `/help`, `/compact`, `/context`, `/memory`, `/agents`, `/skills`, `/mcp`, `/status`, and `/model`.

## RDX Boundary

This repository does not vendor an RDX toolchain. RDX and RenderDoc capabilities must come from user-configured external CLI actions in Settings. Do not hardcode CLI paths, catalog paths, shell commands, or repository fallbacks in `src/main`, `src/preload`, `src/renderer`, or packaging configuration.

The only UI entrance for opening a `.rdc` into a session is the session context panel. Project-level surfaces may browse, import, and refresh project captures, but must not provide a hidden or duplicate open action.

## UI / UX Boundary

Agent messages are structured as:

1. user message;
2. Work Process block;
3. final answer.

The Work Process block is a real runtime transcript, not a stage status log. It is expanded while running and keeps its latest expanded/collapsed state after terminal states; users collapse or expand it manually. Errors, approvals, long-running tools, and diagnostics may auto-expand. Tool rows show tool name, status, duration, argument summary, readable result preview, and lazily loaded raw details.

Composer profile menus show profile name and status. Long descriptions belong in hover tooltips, not inline list clutter.

## Design System

Use semantic tokens from `src/renderer/styles/design-system.css`. Component CSS must prefer `--token-*`, `--text-*`, and `--space-*` variables. Buttons must use the shared `.button` system or `Button` component. Do not introduce new hardcoded color systems, duplicate button classes, or unrelated visual rewrites.

Every new component must cover rest, hover, active, focus, disabled, and relevant loading/error states. Avoid nested cards, unrelated decorative gradients, and layout shifts caused by dynamic text or controls.

## Legacy Cleanup

Legacy or deprecated compatibility may exist only at data migration boundaries. It must not appear in user-visible UI, runtime primary paths, duplicate schemas, or old-named wrappers. Removed visible terms and pseudo-stage ids are guarded by the architecture check; do not restate them in product copy or runtime identifiers.

## Verification Gate

Code changes should run:

- `npm run typecheck`;
- `npm run check:architecture`;
- `npm run check:fidelity`;
- `npm run check:shared-exports`;
- `npm run check:settings-agents`;
- `npm run build` when entry, runtime, renderer, or packaging behavior changes.

UI and workflow changes must be verified in the real browser session that connects to the real main process bridge. Browser verification should cover at least Settings > Agents, Settings > Skills and Tools, Project/Session sidebars, Ask/Plan/Edit profile behavior, Work Process rendering, dark/light themes, narrow viewport, long paths, Chinese filenames, and long tool output.
