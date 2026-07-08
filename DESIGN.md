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
- workflow: `ask_user`, `todo`, `task_*`, `agent`, `handoff`;
- context: `memory`, `skills`, `MCP`;
- RDC/RDX: capture context, open/preview/close, remote connection, and RDX shell actions.

Slash commands are runtime inputs, not bypasses around profile permission. Baseline commands are `/help`, `/compact`, `/context`, `/memory`, `/agents`, `/skills`, `/mcp`, `/status`, and `/model`.

Runtime permissions are profile-aware and mode-aware. The composer exposes `Default`, `Auto-review`, `Full access`, and `Custom(config.toml)` permission modes, but the main process remains authoritative. `Default` allows routine workspace inspection and pauses for external files, network, mutation, destructive shell, or unrecognized commands. `Auto-review` records a reviewer decision before continuing. `Full access` is an explicit trusted mode for local file and command access. `Custom(config.toml)` uses configured readable roots, writable roots, and command allow/deny lists. Work Process must show the real `Requested approval`, `Approved`, `Denied`, or `Auto-reviewed` transcript; it must not present a policy pause as an ordinary failed shell command.

## RDX Boundary

This repository does not vendor an RDX toolchain. RDX and RenderDoc capabilities must come from user-configured external CLI actions in Settings. Do not hardcode CLI paths, catalog paths, shell commands, or repository fallbacks in `src/main`, `src/preload`, `src/renderer`, or packaging configuration.

The only UI entrance for opening a `.rdc` into a session is the session context panel. Project-level surfaces may browse, import, and refresh project captures, but must not provide a hidden or duplicate open action. An opened `.rdc` is owned by the app session that opened it via `ownerSessionId`; RDX replay `sessionId` remains a runtime identifier and must not be used as the app-session owner. Session UI and agent context injection must fail closed when `ownerSessionId` does not match the current app session, so a new or switched session never inherits another session's opened capture.

## UI / UX Boundary

Agent messages are structured as:

1. user message;
2. Work Process block;
3. final answer.

The Work Process block is a real runtime transcript, not a stage status log. Its header is process-first copy such as `思考过程 · 持续 7.5s · 5 个动作`; terminal status like `执行完成` must not become the visible headline or primary meta copy. It is expanded while running and keeps its latest expanded/collapsed state after terminal states; users collapse or expand it manually. Errors, approvals, long-running tools, and diagnostics may auto-expand. Tool rows show a readable transcript preview by default; arguments and raw tool results stay behind a user-opened details control and must not render as default visible noise.

Work Process section semantics are stable: each section represents one `llm_turn` only when that loop has visible process evidence: provider-visible thinking, loop result text before tool execution, tool calls, approvals, diagnostics, or user input. The section hierarchy is fixed: thinking disclosure is the top transcript node for the loop when present; loop narration/result text follows; tool calls, approvals, and `ask_user` interactions are nested below as execution evidence produced by that same model loop. Rail marker color communicates status only, not hierarchy: top-level thinking sections and final-response boundary rows with the same status use the same marker color, while nesting is expressed by rail position and indentation. The Work Process header may be named `思考过程`, but loop-level summary thinking uses lower-level copy such as `思考` and must not duplicate the header label. Assistant final-answer text streams only in the assistant message body; Work Process must not duplicate final-answer tokens as a loop result. Provider summary thinking is shown as a user-collapsible disclosure, raw provider-visible thinking is collapsed but user-expandable, and hidden/opaque provider continuation state never reveals plaintext. A loop without thinking may show its direct result when it also has tool evidence; a loop with neither thinking nor tool evidence is skipped as answer-body-only. Tool-call rows remain folded by default, including while fast tools are requested and completed; only errors or human-in-the-loop actions may auto-expand.

Work Process trace and presentation have separate contracts. The trace model records canonical runtime events immediately, including tool starts/completions, approvals, `ask_user`, provider-visible thinking deltas, and loop result deltas. The renderer is a causal disclosure projection over that trace: when a loop has visible thinking or result text still streaming, child tool/user-input evidence remains in the model for counts and replay but the body details are not expanded until the visible loop text settles. Pending `ask_user` and approval headers may stay visible as blocking interaction signals, but their internal completion/result details must not pre-empt the active loop transcript. Disclosure timing is driven only by canonical event lifecycle and loop boundaries; timers, artificial delays, fake stages, and hidden chain-of-thought placeholders are not product paths. New assistant content events after a tool-use loop, including thinking-only events before text deltas, start a new `llm_turn`; tool and human-in-the-loop evidence continues to belong to the loop that requested it.


When an answer-only `llm_turn` follows visible process evidence, the renderer projects it as a compact final-response boundary row, not as a second top-level process section. Its marker and text origin align with the top-level process rail; it must not visually nest under the preceding tool group. The boundary row may say that the final reply is being generated or has been generated, and provider-visible closing summary thinking may be folded under that row. The final answer body itself still renders only in the assistant message body and must not be copied into Work Process. Duplicate late summary thinking that was already shown in the preceding process section is suppressed rather than rendered as a new empty row.

Each canonical `llm_turn` may carry provider/runtime metadata: `stopReason`, `outputPhase` (`commentary` vs `final_answer`), and `reasoningState` (`raw`, `summary`, `opaque`, `hidden`, `none`). `final_answer` must be inferred from stop metadata and pending-continuation state, not from fragile text heuristics. Visible loop text with `outputPhase: commentary` is ordinary model narration and must not be labeled as thinking.

Work Process UI may aggregate multiple `llm_turn` blocks into semantic step groups (for example explore, edit, verify, web, memory, interaction, collaboration) for readability. Grouping is a pure presentation projection over canonical trace data; it must not rewrite loop order, drop tool evidence, or affect composer replay. The default view is grouped; users may toggle a loop-detail view to inspect exact `llm_turn` boundaries.

Active Signal text is a shared visual primitive for live Work Process activity. The text itself stays normally rendered; the active state adds only a small tokenized inline signal with reduced-motion fallback, never transparent text, clipped-gradient glyphs, spinners, or progress bars. It may appear only on primary active phrases backed by canonical `running`, `pending`, or thinking `streaming` state: active thinking labels, pending `ask_user` interaction headers, final-response generation copy, and composer human-in-the-loop panel kickers. It must not appear on completed, failed, stopped, or historical transcript rows; it must not animate semantic group titles, ordinary tool verbs, subagent/task child labels, raw arguments, tool results, answers, metadata, or hidden/opaque reasoning content. The signal communicates that real runtime work or human-in-the-loop waiting is still in progress; it is not a fake progress stage, not a completion indicator, and not a way to disclose hidden chain-of-thought.

`ask_user` and tool approvals are human-in-the-loop interactions. The canonical `ask_user` contract is a batch `questions[]` payload; a single question is represented as an array with one item. Each question may include `questionId`, `prompt`, `description`, structured `options[]` (`optionId`, `label`, `description`) and `allowFreeform` (default true). Runtime-generated ids fill missing ids before the request reaches renderer state. The runtime pauses the active tool call, the composer area shows the pending `ask_user` batch as a wizard with `current of count` navigation, option descriptions and freeform multiline answers, and submission resolves once with `answers[]`. Work Process records only the real request/decision transcript: the interaction group header shows the question count state such as `已询问 N 个问题`, and the expanded body renders each prompt with its submitted answer in order. It must not collapse a batch into a single Q/A card, render raw choices JSON, policy JSON, fake assistant text responses or duplicate completed tool result blocks. Profile handoff events are recorded in Work Process and the agent event stream; ordinary completed assistant messages must not append automatic Next actions buttons.

Composer profile menus show profile name and status. Long descriptions belong in hover tooltips, not inline list clutter.

Composer footer controls are grouped by intent: left side is pre-send context and policy (`attach`, agent profile, permission mode); right side is execution telemetry and action (effort control, `context usage`, send/stop). Permission mode must not sit beside the send button as if it were an execution action.

The effort control sits immediately left of the context usage ring. It is a pill that opens an upward popup containing one capability-driven reasoning rail plus two switches: `Max context` (context window expansion) and `Fast mode` (fast variant switch). `Auto` is not a product state. The reasoning rail is generated from `reasoningControl`: `none` renders a single locked `Off`; `toggle` renders `Off | On`; `always-on` renders a single locked `On`; `levels` renders only the official named levels for that provider/model, and prepends `Off` only when the model can really disable reasoning. Product naming is canonical: `On`, `Minimal`, `Low`, `Medium`, `High`, `Extra`, `Max`, `Ultra`. Provider wire spellings such as `xhigh` stay in the mapping layer and must not leak into UI. Dragging is continuous: the thumb follows pointer position, preview color follows the level that would be committed, and pointer release selects `round(ratio * (visibleStops - 1))`, clamps it to the visible subset, and animates the thumb back to that stop. Slider fill uses one solid `--token-effort-*` tone across the full track; the whole track becomes deeper as the selected reasoning level increases, and current production levels map in order from `On/Minimal` through `Max`. Unsupported reasoning states are not rendered as dead stops. `Max context` and `Fast mode` rows remain visible and render only label plus switch; disabled state is expressed by the gray disabled row and switch, without visible reason copy, numeric context ranges, fast model ids, or other detail copy. Reasoning level, `Max context`, and `Fast mode` are remembered per session and snapshotted into each send request as `turnControls.reasoningLevel`, `turnControls.maxContextMode`, and `turnControls.fastModel`.

Compact Composer controls must stay state-first and terse. They may show labels, values, and short disabled reasons only. Do not render provider documentation excerpts, source claims, marketing/model notes, catalog research notes, or explanatory paragraphs inside the popup. Longer provider capability rationale belongs in Settings details, catalog source metadata, or architecture docs, not beside the send controls.

## Model Capability and Context Window

Model capability (nominal context window, `reasoningControl`, fast variant model id, tool calling, vision input, and structured output) resolves with the priority: app-managed provider catalog (`providerId + modelId/alias` in `src/shared/constants/modelCapabilityCatalog.ts`) > conservative defaults. `reasoningControl` is the single capability truth: it carries control kind, whether `Off` is actually supported, the official named level list, default/locked selection, and the wire profile used by runtime providers. Settings users do not edit capability fields. `LlmProviderModel.capabilityOverride`, per-model context overrides, old `supportedEffortLevels`-style schemas, and regex-only seed matching are not product paths.

Provider catalog ownership is explicit. `login-authorization`, `official-direct`, `cloud-platform`, `official-compatible`, and `coding-token-plan` providers are `app-managed`: RDC-Agent owns the model list and capability table, and provider connection/refresh only validates account or API availability. Unavailable app-managed catalog models remain visible as disabled rows instead of being hidden. `third-party-compatible`, `local`, and `image` providers are `user-managed`: model lists come from the endpoint or user configuration, and RDC-Agent uses conservative capability defaults instead of applying the mainline provider table.

The first-version app-managed catalog is maintained as bundled source data with official source URLs, source kind (`official`, `observed`, or `conservative`), and update date. When official documents do not expose a complete model capability table, the catalog must record conservative capability values rather than asking ordinary users to fill context, reasoning, or fast-variant fields.

The context window is a single source of truth shared by the UI usage ring and runtime compaction. The default window is `min(256k, nominal)`; enabling `Max context` uses the nominal window only for 1M-class models. The auto-compaction threshold is always 80% of the active window. `Max context` is unavailable when the nominal window is unknown or below `1_000_000` tokens; sub-1M windows such as 262.1k or 400k remain disabled. Runtime code must not hardcode context window sizes; the resolver is the only source.

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
- `npm run check:work-process` and `npm run check:work-process-tool-coverage` when Work Process projection, tool catalog labels, or transcript UI changes;
- `npm run check:reasoning-delivery` when provider thinking delivery or reasoning artifact projection changes;
- `npm run check:settings-agents`;
- `npm run build` when entry, runtime, renderer, or packaging behavior changes.

UI and workflow changes must be verified in the real browser session that connects to the real main process bridge. Browser verification should cover at least Settings > Agents, Settings > Skills and Tools, Project/Session sidebars, Ask/Plan/Edit profile behavior, Work Process rendering, dark/light themes, narrow viewport, long paths, Chinese filenames, and long tool output.
