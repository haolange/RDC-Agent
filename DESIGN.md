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

Renderer code must not create fake reasoning stages. Runtime events project into `ConversationWorkTrace`, not visible chain-of-thought. Hidden CoT is never displayed or persisted as UI content; provider-visible thinking may appear only as an explicit `ThinkingArtifact` with controlled Work Process visibility.

`ConversationWorkTrace` is the visible progress contract. Blocks may be:

- `llm_turn`: one model loop, including optional thinking, loop result text, requested tool calls, and tool results;
- `reasoning`: short visible summaries only;
- `approval`: permission requests and decisions;
- `user_input`: explicit `ask_user` questions and answers;
- `compaction`: context compaction summaries;
- `subagent`: delegated agent activity;
- `handoff`: next-agent or next-action handoffs;
- `diagnostic`: provider, route, runtime, or RDX diagnostics;
- `output`: final answer preparation.

Historical `workTrace` entries that do not match the current canonical schema are discarded at storage read boundaries (`workTrace: null`). Runtime code and visible UI use only the canonical contract; no legacy normalization or migration shims are applied.

## Provider Account Boundary

Account providers are login products, not API-key shortcuts. Super Grok Account is the xAI account-OAuth provider: it uses xAI OIDC metadata, browser OAuth by default, and device-code flow for headless or remote environments. xAI (Grok) remains the separate API-key provider for console keys. The Super Grok OAuth Client ID field accepts only an xAI-issued public OAuth client id; users must not paste xAI API keys into that field.

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

Runtime permissions are profile-aware and mode-aware. The composer exposes `Default`, `Auto-review`, `Full access`, and `Custom(config.toml)` permission modes, but the main process remains authoritative. `Default` allows routine workspace inspection and pauses for external files, network, mutation, destructive shell, or unrecognized commands. `Auto-review` records a reviewer decision before continuing. `Full access` is an explicit trusted mode for local file and command access. `Custom(config.toml)` uses configured readable roots, writable roots, and command allow/deny lists. Work Process must show the real `Requested approval`, `Approved`, `Denied`, or `Auto-reviewed` transcript; it must not present a policy pause as an ordinary failed shell command.

## RDX Boundary

This repository does not vendor an RDX toolchain. RDX and RenderDoc capabilities must come from user-configured external CLI actions in Settings. Do not hardcode CLI paths, catalog paths, shell commands, or repository fallbacks in `src/main`, `src/preload`, `src/renderer`, or packaging configuration.

The only UI entrance for opening a `.rdc` into a session is the session context panel. Project-level surfaces may browse, import, and refresh project captures, but must not provide a hidden or duplicate open action.

## UI / UX Boundary

Agent messages are structured as:

1. user message;
2. Work Process block;
3. final answer.

The Work Process block is a real runtime transcript, not a stage status log. Its header is process-first copy such as `思考过程 · 持续 7.5s · 5 个动作`; terminal status like `执行完成` must not become the visible headline or primary meta copy. It is expanded while running and keeps its latest expanded/collapsed state after terminal states; users collapse or expand it manually. Errors, approvals, long-running tools, and diagnostics may auto-expand. Tool rows show a readable transcript preview by default; arguments and raw tool results stay behind a user-opened details control and must not render as default visible noise.

Work Process section semantics are stable: each section represents one `llm_turn` only when that loop has visible process evidence: provider-visible thinking, loop result text before tool execution, tool calls, approvals, diagnostics, or user input. The section hierarchy is fixed: thinking disclosure is the top transcript node for the loop when present; loop narration/result text follows; tool calls, approvals, and `ask_user` interactions are nested below as execution evidence produced by that same model loop. Rail marker color communicates status only, not hierarchy: top-level thinking sections and final-response boundary rows with the same status use the same marker color, while nesting is expressed by rail position and indentation. The Work Process header may be named `思考过程`, but loop-level summary thinking uses lower-level copy such as `思考` and must not duplicate the header label. Assistant final-answer text streams only in the assistant message body; Work Process must not duplicate final-answer tokens as a loop result. Provider summary thinking is shown as a user-collapsible disclosure, raw provider-visible thinking is collapsed but user-expandable, and hidden/opaque provider continuation state never reveals plaintext. A loop without thinking may show its direct result when it also has tool evidence; a loop with neither thinking nor tool evidence is skipped as answer-body-only. Tool-call rows remain folded by default, including while fast tools are requested and completed; only errors or human-in-the-loop actions may auto-expand.

When an answer-only `llm_turn` follows visible process evidence, the renderer projects it as a compact final-response boundary row, not as a second top-level process section. Its marker and text origin align with the top-level process rail; it must not visually nest under the preceding tool group. The boundary row may say that the final reply is being generated or has been generated, and provider-visible closing summary thinking may be folded under that row. The final answer body itself still renders only in the assistant message body and must not be copied into Work Process. Duplicate late summary thinking that was already shown in the preceding process section is suppressed rather than rendered as a new empty row.

`ask_user` and tool approvals are human-in-the-loop interactions. The runtime pauses the active tool call, the composer area shows the pending question or approval controls, and the Work Process records only the real request/decision transcript. They must not render as raw tool result blocks with choices JSON, policy JSON, or fake assistant text responses. Profile handoff events are recorded in Work Process and the agent event stream; ordinary completed assistant messages must not append automatic Next actions buttons.

Composer profile menus show profile name and status. Long descriptions belong in hover tooltips, not inline list clutter.

Composer footer controls are grouped by intent: left side is pre-send context and policy (`attach`, agent profile, permission mode); right side is execution telemetry and action (`context usage`, send/stop). Permission mode must not sit beside the send button as if it were an execution action.

## Design System

Use semantic tokens from `src/renderer/styles/design-system.css`. Component CSS must prefer `--token-*`, `--text-*`, and `--space-*` variables. Buttons must use the shared `.button` system or `Button` component. Do not introduce new hardcoded color systems, duplicate button classes, or unrelated visual rewrites.

The visual language is macOS-flavored: depth comes from layered soft shadows and a glassy top edge, not from hard 1px outlines. Raised surfaces (bubbles, cards, popovers) express elevation through the `--token-shadow-raised` / `--token-shadow-card` / `--token-shadow-popover` tokens paired with `--token-elevation-edge`, keep borders at `--token-border-muted`, and use the softened radius scale (`--radius-*`, chat bubbles use `--radius-bubble`). `--token-surface-raised` is the raised fill with a faint vertical sheen; `--token-surface-sunken` is the inset fill for code/result blocks. Monospace (`--font-mono`) is reserved for code and raw tool/result previews only; transcript meta, paths, tool-name chips, timestamps, and labels use the sans stack.

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
